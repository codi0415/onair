import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { verifyAdminPassword } from "@/lib/adminAuth";
import { checkKeywordBlocklist } from "@/lib/keywordFilter";
import { normalizeUrl } from "@/lib/validate";

const MAX_TEXT_LENGTH = 200;

// iTunes 카탈로그에 없는 곡(국내 유통 계약 미체결 등)을 방송부가 직접 등록하는 API입니다.
// 방송부가 직접 확인하고 입력하는 것이므로 검토 대기(pending)가 아니라 승인(approved) 상태로 바로 생성되고,
// 그 뒤로는 기존 승인곡과 동일하게 날짜 배정 흐름을 그대로 탑니다.
// itunes_track_id는 not null 제약이 있어 "manual-{uuid}" 형태의 고유값으로 채웁니다.
export async function POST(request) {
  const auth = verifyAdminPassword(request);
  if (!auth.ok) return auth.response;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }
  const { title, artist, albumImageUrl, previewUrl, reviewedBy } = body;

  if (typeof title !== "string" || !title.trim() || typeof artist !== "string" || !artist.trim()) {
    return NextResponse.json({ error: "곡 제목과 아티스트를 입력해 주세요." }, { status: 400 });
  }
  if (title.trim().length > MAX_TEXT_LENGTH || artist.trim().length > MAX_TEXT_LENGTH) {
    return NextResponse.json(
      { error: `곡 제목과 아티스트는 각각 ${MAX_TEXT_LENGTH}자 이내로 입력해 주세요.` },
      { status: 400 }
    );
  }

  const image = normalizeUrl(albumImageUrl);
  if (!image.ok) {
    return NextResponse.json(
      { error: "앨범아트 URL은 http(s) 주소여야 합니다." },
      { status: 400 }
    );
  }
  const preview = normalizeUrl(previewUrl);
  if (!preview.ok) {
    return NextResponse.json(
      { error: "미리듣기 URL은 http(s) 주소여야 합니다." },
      { status: 400 }
    );
  }

  // 자체 비속어 사전은 수동 등록곡에도 동일하게 적용해 둡니다 (방송부 실수 방지용 참고 표시).
  const keywordResult = await checkKeywordBlocklist(title.trim(), artist.trim());

  const { data: inserted, error } = await supabaseAdmin
    .from("song_requests")
    .insert({
      student_id: "방송부",
      itunes_track_id: `manual-${crypto.randomUUID()}`,
      title: title.trim(),
      artist: artist.trim(),
      album_image_url: image.value,
      preview_url: preview.value,
      is_manual: true,
      itunes_explicit: false,
      musixmatch_explicit: null,
      keyword_flag: keywordResult.flagged,
      keyword_flag_reason: keywordResult.reason,
      status: "approved",
      reviewed_by: reviewedBy?.trim() || null,
      reviewed_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    console.error(error);
    return NextResponse.json({ error: "곡 등록에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ request: inserted });
}
