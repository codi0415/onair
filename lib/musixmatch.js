// Musixmatch API - matcher.track.get으로 explicit 플래그만 조회합니다.
// 가사 전문(lyrics_body)은 저작권 문제로 절대 저장/표시하지 않고,
// track.explicit 필드(0 또는 1)만 사용합니다.
// 무료 티어는 하루 요청 수가 제한적이므로 실패 시 조용히 null을 반환하고
// 신청 자체를 막지 않습니다 (iTunes explicit + 자체 사전이 나머지를 커버).

// Musixmatch가 느릴 때 학생의 "신청하기"가 하염없이 돌지 않도록 상한을 둡니다.
// 어차피 실패 시 null(=판정 불가)로 넘어가므로 신청 자체는 정상 진행됩니다.
const FETCH_TIMEOUT_MS = 4000;

export async function checkMusixmatchExplicit(title, artist) {
  const apiKey = process.env.MUSIXMATCH_API_KEY;
  if (!apiKey) return null;

  try {
    const url = `https://api.musixmatch.com/ws/1.1/matcher.track.get?q_track=${encodeURIComponent(
      title
    )}&q_artist=${encodeURIComponent(artist)}&apikey=${apiKey}`;

    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;

    const data = await res.json();
    const statusCode = data?.message?.header?.status_code;

    if (statusCode !== 200) {
      // 401: 잘못된 키, 402: 한도 초과/라이선스 필요, 404: 곡 없음 등
      return null;
    }

    const track = data?.message?.body?.track;
    if (!track) return null;

    return !!track.explicit; // 1/0 -> boolean
  } catch (err) {
    console.error("Musixmatch 조회 실패:", err.message);
    return null;
  }
}
