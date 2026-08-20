import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { checkMusixmatchExplicit } from "@/lib/musixmatch";
import { checkKeywordBlocklist } from "@/lib/keywordFilter";
import { normalizeUrl } from "@/lib/validate";
import { getDailyUsage, DAILY_LIMIT } from "@/lib/dailyQuota";
import { dedupeBySong } from "@/lib/songKey";

const STUDENT_ID_PATTERN = /^[a-zA-Z0-9._-]{2,30}$/;
const MAX_TEXT_LENGTH = 200; // 곡명/아티스트명 길이 상한 (직접 입력 신청 대비)

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const {
    studentId,
    itunesTrackId,
    title,
    artist,
    albumImageUrl,
    previewUrl,
    explicit,
    isManual, // 학생이 검색 결과 없이 곡명/아티스트를 직접 입력해 신청한 경우 true
  } = body;

  if (!studentId || !STUDENT_ID_PATTERN.test(studentId)) {
    return NextResponse.json(
      { error: "학번/이메일 앞자리 형식을 확인해 주세요." },
      { status: 400 }
    );
  }
  if (typeof title !== "string" || !title.trim() || typeof artist !== "string" || !artist.trim()) {
    return NextResponse.json({ error: "곡 정보가 올바르지 않습니다." }, { status: 400 });
  }
  if (!isManual && !itunesTrackId) {
    return NextResponse.json({ error: "곡 정보가 올바르지 않습니다." }, { status: 400 });
  }

  const trimmedTitle = title.trim();
  const trimmedArtist = artist.trim();

  if (trimmedTitle.length > MAX_TEXT_LENGTH || trimmedArtist.length > MAX_TEXT_LENGTH) {
    return NextResponse.json(
      { error: "곡 제목과 아티스트는 각각 200자 이내로 입력해 주세요." },
      { status: 400 }
    );
  }

  // 하루 신청 한도 확인. 중복 확인보다 먼저 해서, 한도를 넘었으면 불필요한 조회를 안 합니다.
  const quota = await getDailyUsage(studentId);
  if (quota.remaining <= 0) {
    return NextResponse.json(
      {
        error: `하루에 ${DAILY_LIMIT}곡까지 신청할 수 있습니다. 내일 다시 신청해 주세요.`,
        quota,
      },
      { status: 429 }
    );
  }

  // 앨범아트/미리듣기 URL은 방송부 화면에서 <img>/<audio>로 그대로 재생됩니다.
  // 검색 결과를 그대로 보내는 게 정상 흐름이지만 요청 본문은 얼마든지 조작할 수 있으므로
  // http(s) 주소가 아니면 저장하지 않고 조용히 버립니다(신청 자체는 막지 않음).
  const image = normalizeUrl(albumImageUrl);
  const preview = normalizeUrl(previewUrl);

  if (isManual) {
    // 수동 신청은 곡마다 고유 ID가 없으므로, 같은 학생이 같은 제목+아티스트로
    // 이미 대기/승인/예정 상태 신청을 넣었는지로 중복을 판단합니다.
    // maybeSingle()은 이미 중복이 2건 이상 쌓여 있으면 에러를 내면서 data가 null이 되어
    // 오히려 중복을 통과시킵니다. 존재 여부만 알면 되므로 limit(1) 배열로 확인합니다.
    const { data: existingManual } = await supabaseAdmin
      .from("song_requests")
      .select("id")
      .eq("student_id", studentId)
      .eq("title", trimmedTitle)
      .eq("artist", trimmedArtist)
      .in("status", ["pending", "approved", "scheduled"])
      .limit(1);

    if (existingManual?.length) {
      return NextResponse.json(
        { error: "이미 같은 곡을 신청하셨습니다. 신청 현황에서 확인해 주세요." },
        { status: 409 }
      );
    }
  } else {
    // 중복 신청 방지: 같은 학생이 같은 곡을 pending/approved/scheduled 상태로 이미 신청했는지 확인
    const { data: existing } = await supabaseAdmin
      .from("song_requests")
      .select("id")
      .eq("student_id", studentId)
      .eq("itunes_track_id", itunesTrackId)
      .in("status", ["pending", "approved", "scheduled"])
      .limit(1);

    if (existing?.length) {
      return NextResponse.json(
        { error: "이미 신청한 곡입니다. 신청 현황에서 확인해 주세요." },
        { status: 409 }
      );
    }
  }

  // 2차 비속어 체크 (병렬 처리). 수동 신청곡도 자체 사전 체크는 동일하게 적용합니다.
  const [musixmatchExplicit, keywordResult] = await Promise.all([
    checkMusixmatchExplicit(trimmedTitle, trimmedArtist),
    checkKeywordBlocklist(trimmedTitle, trimmedArtist),
  ]);

  const { data: inserted, error } = await supabaseAdmin
    .from("song_requests")
    .insert({
      student_id: studentId,
      itunes_track_id: isManual ? `manual-${crypto.randomUUID()}` : itunesTrackId,
      title: trimmedTitle,
      artist: trimmedArtist,
      album_image_url: image.ok ? image.value : null,
      preview_url: preview.ok ? preview.value : null,
      is_manual: !!isManual,
      itunes_explicit: !!explicit,
      musixmatch_explicit: musixmatchExplicit,
      keyword_flag: keywordResult.flagged,
      keyword_flag_reason: keywordResult.reason,
    })
    .select()
    .single();

  if (error) {
    // 23505 = unique 제약 위반. 위의 중복 확인을 통과한 두 요청이 거의 동시에 들어온 경우
    // (신청 버튼 연타, 모바일 더블탭 등) DB가 두 번째를 여기서 막아줍니다.
    // supabase_migration_dedup.sql의 unique index가 있어야 동작합니다.
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "이미 신청한 곡입니다. 신청 현황에서 확인해 주세요." },
        { status: 409 }
      );
    }
    console.error(error);
    return NextResponse.json({ error: "신청 저장에 실패했습니다." }, { status: 500 });
  }

  // 방금 한 곡을 썼으므로 남은 개수를 함께 알려줍니다. 화면에서 바로 갱신할 수 있도록.
  return NextResponse.json({
    request: inserted,
    quota: { ...quota, used: quota.used + 1, remaining: Math.max(0, quota.remaining - 1) },
  });
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const studentId = searchParams.get("studentId");
  const scope = searchParams.get("scope"); // "mine" | "upcoming" | "quota"

  // 파라미터 검증을 DB 접근보다 먼저 해서, 잘못된 요청은 DB 상태와 무관하게 400으로 답합니다.
  const needsStudent = scope === "mine" || scope === "quota";
  if (scope !== "upcoming" && !(needsStudent && studentId)) {
    return NextResponse.json({ error: "scope 파라미터가 필요합니다." }, { status: 400 });
  }

  // 오늘 몇 곡 더 신청할 수 있는지만 알려주는 가벼운 조회.
  // 화면에서 신청 버튼 옆에 남은 개수를 미리 보여주려고 씁니다.
  if (scope === "quota") {
    if (!STUDENT_ID_PATTERN.test(studentId)) {
      return NextResponse.json({ error: "학번 형식을 확인해 주세요." }, { status: 400 });
    }
    return NextResponse.json({ quota: await getDailyUsage(studentId) });
  }

  let query = supabaseAdmin.from("song_requests").select("*");

  if (scope === "mine") {
    query = query.eq("student_id", studentId).order("created_at", { ascending: false });
  } else {
    // 방송 예정곡은 "가까운 방송일 순"으로 보여야 합니다.
    // order를 붙인 순서대로 정렬 우선순위가 정해지므로 scheduled_date를 먼저 걸어야 하고,
    // 아직 날짜가 없는 승인곡(null)은 뒤로 밀어 최근 신청 순으로 이어 붙입니다.
    query = query
      .in("status", ["approved", "scheduled"])
      .order("scheduled_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });
  }

  const { data, error } = await query;

  if (error) {
    console.error(error);
    return NextResponse.json({ error: "조회에 실패했습니다." }, { status: 500 });
  }

  if (scope === "upcoming") {
    // 같은 곡을 여러 명이 신청하면 전원 승인되지만 방송은 한 번만 나갑니다.
    // 목록에 같은 곡이 여러 줄 뜨면 학생 입장에서 오해하므로 곡 단위로 한 번만 보여줍니다.
    const sanitized = dedupeBySong(data).map((r) => ({
      id: r.id,
      title: r.title,
      artist: r.artist,
      albumImageUrl: r.album_image_url,
      status: r.status,
      scheduledDate: r.scheduled_date,
    }));
    return NextResponse.json({ requests: sanitized });
  }

  // 내 신청 현황은 학생 본인에게 필요한 필드만 내려줍니다.
  // studentId만 알면 누구나 조회할 수 있는 경로라, 방송부 내부 정보
  // (어떤 사전 항목에 걸렸는지, 담당자 이름 등)까지 노출할 이유가 없습니다.
  const mine = data.map((r) => ({
    id: r.id,
    title: r.title,
    artist: r.artist,
    album_image_url: r.album_image_url,
    status: r.status,
    scheduled_date: r.scheduled_date,
    reject_reason: r.reject_reason,
    created_at: r.created_at,
  }));

  return NextResponse.json({ requests: mine });
}
