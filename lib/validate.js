// API Route에서 URL 경로/쿼리로 들어온 값을 DB에 넘기기 전에 형식만 확인하는 함수들입니다.
//
// Postgres는 uuid 컬럼에 "abc" 같은 값을 비교하려 하면 쿼리 자체를 에러로 떨어뜨립니다.
// 그러면 사용자에게는 "삭제 실패" 같은 뭉뚱그린 500이 나가고 서버 로그에도 원인이 묻히므로,
// 형식이 틀린 건 DB까지 가기 전에 400으로 돌려보냅니다.

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

// 앨범아트/미리듣기 URL은 그대로 <img src> / <audio src>에 들어갑니다.
// 학생이든 방송부든 입력값으로 들어오는 값이므로, http(s)가 아닌 스킴(javascript:, data: 등)은
// 애초에 저장하지 않습니다. 빈 값은 정상(선택 입력)이라 null로 통과시킵니다.
// 반환: { ok: true, value } 또는 { ok: false }
export function normalizeUrl(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return { ok: true, value: null };
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { ok: false };
    }
    return { ok: true, value: trimmed };
  } catch {
    return { ok: false };
  }
}

// scheduled_date는 Postgres의 date 타입이라 "YYYY-MM-DD" 형태여야 합니다.
// 형식만 맞고 실제로 없는 날짜(2026-02-31 등)인 경우까지 걸러냅니다.
export function isDateString(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10) === value;
}
