import { supabaseAdmin } from "./supabaseAdmin";

// Deezer Search API는 인증이 필요 없고(공개 카탈로그 엔드포인트), iTunes보다 넉넉한
// 레이트 리밋(공식적으로 약 5초당 50회 = 초당 10회 수준)을 제공합니다.
// iTunes와 병행 검색해서 전체 검색 커버리지와 처리량을 늘리는 용도로 사용하고,
// 같은 곡이 두 소스에 모두 있을 경우 한 번만 노출되도록 상위 레이어(lib/search.js)에서 병합합니다.
//
// 레이트 리밋/캐싱 전략은 lib/itunes.js와 동일한 패턴을 그대로 따릅니다.

const RATE_LIMIT_PER_10_SEC = 40; // 공식 한도(5초당 50회)에서 여유를 두고 10초당 40회로 보수적으로 설정
const CACHE_TTL_MS = 1000 * 60 * 60 * 12; // 12시간
// Deezer가 응답하지 않아도 iTunes 결과만으로 응답할 수 있도록 상한을 둡니다.
const FETCH_TIMEOUT_MS = 5000;

function normalizeQuery(q) {
  return q.trim().toLowerCase().replace(/\s+/g, " ");
}

async function countRecentCalls() {
  const tenSecondsAgo = new Date(Date.now() - 10 * 1000).toISOString();
  try {
    const { count, error } = await supabaseAdmin
      .from("deezer_call_log")
      .select("*", { count: "exact", head: true })
      .gte("called_at", tenSecondsAgo);

    if (error) throw new Error(error.message);
    return count || 0;
  } catch (err) {
    console.error("Deezer 호출 카운트 조회 실패:", err.message);
    return 0;
  }
}

async function logCall() {
  try {
    await supabaseAdmin.from("deezer_call_log").insert({});
    await purgeOldCallLogs();
  } catch (err) {
    console.error("Deezer 호출 로그 기록 실패:", err.message);
  }
}

// 최근 10초치만 의미가 있는 로그라, 가끔씩(약 2% 확률) 1시간 지난 행을 정리합니다.
async function purgeOldCallLogs() {
  if (Math.random() > 0.02) return;
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  await supabaseAdmin.from("deezer_call_log").delete().lt("called_at", oneHourAgo);
}

async function getCached(queryNormalized) {
  try {
    const { data, error } = await supabaseAdmin
      .from("deezer_search_cache")
      .select("results, created_at")
      .eq("query_normalized", queryNormalized)
      .maybeSingle();

    if (error || !data) return null;

    const age = Date.now() - new Date(data.created_at).getTime();
    if (age > CACHE_TTL_MS) return null;

    return data.results;
  } catch (err) {
    console.error("Deezer 캐시 조회 실패:", err.message);
    return null;
  }
}

async function setCached(queryNormalized, results) {
  try {
    await supabaseAdmin
      .from("deezer_search_cache")
      .upsert(
        { query_normalized: queryNormalized, results, created_at: new Date().toISOString() },
        { onConflict: "query_normalized" }
      );
  } catch (err) {
    console.error("Deezer 캐시 저장 실패:", err.message);
  }
}

function mapDeezerResult(item) {
  return {
    // 다른 서비스와 ID 체계가 겹치지 않도록 접두어를 붙입니다.
    itunesTrackId: `deezer-${item.id}`,
    title: item.title,
    artist: item.artist?.name || "",
    albumImageUrl: item.album?.cover_medium || item.album?.cover || null,
    previewUrl: item.preview || null, // Deezer는 30초 미리듣기를 preview 필드로 직접 제공
    explicit: !!item.explicit_lyrics,
    source: "deezer",
  };
}

export async function searchDeezerTracks(query, limit = 10) {
  const queryNormalized = normalizeQuery(query);
  if (!queryNormalized) return { tracks: [], source: "empty" };

  // 캐시 조회와 레이트 리밋 카운트는 서로 의존하지 않으므로 한 번에 같이 확인합니다.
  const [cached, recentCalls] = await Promise.all([
    getCached(queryNormalized),
    countRecentCalls(),
  ]);

  if (cached) {
    return { tracks: cached, source: "cache" };
  }

  if (recentCalls >= RATE_LIMIT_PER_10_SEC) {
    console.warn(
      `[RATE_LIMIT] Deezer 자체 한도 도달 (최근 10초 ${recentCalls}/${RATE_LIMIT_PER_10_SEC}) — iTunes 결과만 반환`
    );
    return { tracks: [], source: "rate_limited" };
  }

  try {
    const url = `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=${limit}`;

    const [, res] = await Promise.all([
      logCall(),
      fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }),
    ]);

    if (res.status === 429) {
      console.warn("[RATE_LIMIT] Deezer가 429 응답 — Deezer 측 한도 초과");
      return { tracks: [], source: "rate_limited" };
    }
    if (!res.ok) {
      throw new Error(`Deezer 검색 실패: ${res.status}`);
    }

    const data = await res.json();

    // Deezer는 오류 시에도 200과 함께 { error: {...} } 형태를 반환하는 경우가 있어 별도 체크합니다.
    if (data.error) {
      throw new Error(`Deezer API 오류: ${data.error.message || data.error.type}`);
    }

    const tracks = (data.data || []).map(mapDeezerResult);

    if (tracks.length > 0) {
      await setCached(queryNormalized, tracks);
    }

    return { tracks, source: "live" };
  } catch (err) {
    console.error("Deezer 검색 오류:", err.message);
    return { tracks: [], source: "error" };
  }
}
