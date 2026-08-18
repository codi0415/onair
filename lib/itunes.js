import { supabaseAdmin } from "./supabaseAdmin";

// iTunes Search API는 인증이 필요 없고 30초 미리듣기 URL과 explicit 플래그를
// 응답에 직접 포함해 주지만, IP당 분당 약 20회라는 낮은 레이트 리밋이 있습니다.
// 학교 전체가 아침 시간대에 몰리는 서비스 특성상 이 한도를 쉽게 넘길 수 있어
// 아래 세 가지 방어선을 둡니다.
//
// 1) 검색 결과 캐싱 (같은 검색어는 iTunes를 다시 호출하지 않음)
// 2) 자체 레이트 리밋 카운터 (분당 호출 수를 DB에 기록해 한도 근접 시 대기)
// 3) 429 응답 시 캐시 폴백 + 사용자에게 부드러운 재시도 안내

const RATE_LIMIT_PER_MINUTE = 18; // 20회 한도에서 여유를 두고 18로 설정
const CACHE_TTL_MS = 1000 * 60 * 60 * 12; // 12시간 - 앨범아트/미리듣기 URL은 자주 안 바뀜
// iTunes가 응답하지 않을 때 학생 화면이 계속 "검색 중…"에 멈춰 있지 않도록 상한을 둡니다.
// 시간이 초과되면 아래 catch로 떨어져 Deezer 결과만으로 응답합니다.
const FETCH_TIMEOUT_MS = 5000;

function normalizeQuery(q) {
  return q.trim().toLowerCase().replace(/\s+/g, " ");
}

async function countRecentCalls() {
  const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();
  try {
    const { count, error } = await supabaseAdmin
      .from("itunes_call_log")
      .select("*", { count: "exact", head: true })
      .gte("called_at", oneMinuteAgo);

    if (error) throw new Error(error.message);
    return count || 0;
  } catch (err) {
    // 카운터를 못 읽었다고 검색을 막지는 않습니다. 우리 쪽 카운터는 429를 미리 피하려는
    // 예방책일 뿐이고, 진짜 한도 초과는 아래에서 iTunes의 429 응답으로 다시 걸러집니다.
    console.error("iTunes 호출 카운트 조회 실패:", err.message);
    return 0;
  }
}

async function logCall() {
  try {
    await supabaseAdmin.from("itunes_call_log").insert({});
    await purgeOldCallLogs();
  } catch (err) {
    console.error("iTunes 호출 로그 기록 실패:", err.message);
  }
}

// 호출 로그는 최근 1분치만 의미가 있는데 그냥 두면 무한히 쌓입니다.
// 매번 지우면 낭비라, 가끔씩(약 2% 확률) 1시간 지난 행만 정리합니다.
async function purgeOldCallLogs() {
  if (Math.random() > 0.02) return;
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  await supabaseAdmin.from("itunes_call_log").delete().lt("called_at", oneHourAgo);
}

async function getCached(queryNormalized) {
  try {
    const { data, error } = await supabaseAdmin
      .from("itunes_search_cache")
      .select("results, created_at")
      .eq("query_normalized", queryNormalized)
      .maybeSingle();

    if (error || !data) return null;

    const age = Date.now() - new Date(data.created_at).getTime();
    if (age > CACHE_TTL_MS) return null; // 오래된 캐시는 무시

    return data.results;
  } catch (err) {
    // DB가 죽어 있어도 캐시만 못 쓸 뿐, 검색 자체는 계속되어야 합니다.
    console.error("iTunes 캐시 조회 실패:", err.message);
    return null;
  }
}

async function setCached(queryNormalized, results) {
  try {
    // upsert: 이미 있으면 갱신, 없으면 삽입
    await supabaseAdmin
      .from("itunes_search_cache")
      .upsert(
        { query_normalized: queryNormalized, results, created_at: new Date().toISOString() },
        { onConflict: "query_normalized" }
      );
  } catch (err) {
    console.error("iTunes 캐시 저장 실패:", err.message);
  }
}

function mapItunesResult(item) {
  // iTunes Search API는 trackExplicitness 필드가 응답에서 통째로 빠지는 경우가 실무적으로 흔하고,
  // 대신 collectionExplicitness(앨범 단위 표시)만 오는 경우도 있습니다.
  // 또한 값의 대소문자가 문서와 다르게 오는 사례도 보고되어 있어, 둘 다 확인하고 대소문자 무관하게 비교합니다.
  const trackFlag = (item.trackExplicitness || "").toLowerCase();
  const collectionFlag = (item.collectionExplicitness || "").toLowerCase();
  const isExplicit = trackFlag === "explicit" || collectionFlag === "explicit";

  return {
    itunesTrackId: String(item.trackId),
    title: item.trackName,
    artist: item.artistName,
    albumImageUrl: item.artworkUrl100 || item.artworkUrl60 || null,
    previewUrl: item.previewUrl || null,
    explicit: isExplicit,
    source: "itunes", // Deezer 결과와 구분용 (표시에는 쓰지 않고 디버깅/로그 확인용)
  };
}

export async function searchItunesTracks(query, limit = 10) {
  const queryNormalized = normalizeQuery(query);
  if (!queryNormalized) return { tracks: [], source: "empty" };

  // 1~2) 캐시 조회와 레이트 리밋 카운트는 서로 의존하지 않으므로 한 번에 같이 확인합니다.
  //       (DB 왕복이 한 번 줄어들어 평소에도 빠르고, DB가 느려졌을 때 지연도 절반이 됩니다.)
  const [cached, recentCalls] = await Promise.all([
    getCached(queryNormalized),
    countRecentCalls(),
  ]);

  if (cached) {
    return { tracks: cached, source: "cache" };
  }

  // 한도 근접 시 iTunes를 호출하지 않고 빈 결과 + 안내
  if (recentCalls >= RATE_LIMIT_PER_MINUTE) {
    // 이 상황은 학생 화면에 에러로 안 보이고 "Deezer 결과만 나오는" 형태로 조용히 나타납니다.
    // 로그에 안 남기면 운영 중에 검색 품질이 떨어지는 걸 알아챌 방법이 없어서 남깁니다.
    console.warn(
      `[RATE_LIMIT] iTunes 자체 한도 도달 (최근 1분 ${recentCalls}/${RATE_LIMIT_PER_MINUTE}) — Deezer 결과만 반환`
    );
    return { tracks: [], source: "rate_limited" };
  }

  // 3) 실제 iTunes 호출 (호출 로그 기록도 같이 진행)
  try {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(
      query
    )}&media=music&entity=song&country=KR&limit=${limit}`;

    const [, res] = await Promise.all([
      logCall(),
      fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }),
    ]);

    if (res.status === 429) {
      // Apple 쪽에서 직접 한도 초과를 알려온 경우. 우리 카운터보다 심각한 신호입니다.
      console.warn("[RATE_LIMIT] iTunes가 429 응답 — Apple 측 한도 초과");
      return { tracks: [], source: "rate_limited" };
    }
    if (!res.ok) {
      throw new Error(`iTunes 검색 실패: ${res.status}`);
    }

    const data = await res.json();
    const tracks = (data.results || []).map(mapItunesResult);

    // 검색 결과가 있을 때만 캐싱 (빈 결과를 캐싱하면 오탈자 검색 등이 영구적으로 빈 걸로 고정될 수 있음)
    if (tracks.length > 0) {
      await setCached(queryNormalized, tracks);
    }

    return { tracks, source: "live" };
  } catch (err) {
    console.error("iTunes 검색 오류:", err.message);
    return { tracks: [], source: "error" };
  }
}
