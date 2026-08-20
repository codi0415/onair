// 같은 곡을 하나로 묶기 위한 키.
//
// 왜 필요한가:
//   서로 다른 학생이 같은 인기곡을 신청하면 지금까지는 방송부 화면에 별개 카드로 쌓였고,
//   방송부가 하나만 남기고 나머지를 손으로 반려해야 했습니다.
//   실제 운영 첫날 반려 27건 중 6건(22%)이 이 "중복 신청" 처리였습니다.
//   곡을 묶어서 한 번에 처리하면 이 작업이 통째로 사라집니다.
//
// 클라이언트(방송부 화면)와 서버(API) 양쪽에서 써야 해서, DB나 외부 API에
// 의존하지 않는 순수 함수만 둡니다. lib/search.js의 중복 제거 규칙과 같은 기준입니다.

function normalize(text) {
  return (text || "")
    .normalize("NFC")
    .toLowerCase()
    // 괄호 안 내용 제거: "FE!N (feat. Playboi Carti) [Mixed]" 와 "FE!N" 을 같은 곡으로 봅니다
    .replace(/[([][^)\]]*[)\]]/g, "")
    .replace(/[\s\-_.,!?'"`~/]/g, "");
}

export function songKey(title, artist) {
  return `${normalize(title)}::${normalize(artist)}`;
}

/**
 * 신청 목록을 같은 곡끼리 묶습니다.
 * 상태(status)까지 키에 넣는 이유: "전체" 탭처럼 여러 상태가 섞인 목록에서
 * 검토 대기인 신청과 이미 승인된 신청이 한 카드에 들어가면 어떤 버튼을 눌러야 할지 모호해집니다.
 *
 * @returns 각 그룹은 신청 배열이며, 대표값은 [0](가장 먼저 신청한 건)입니다.
 */
export function groupBySong(requests) {
  const map = new Map();
  for (const r of requests) {
    const key = `${songKey(r.title, r.artist)}::${r.status}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  }
  // 그룹 안에서는 먼저 신청한 사람이 앞에 오도록 정렬합니다.
  for (const group of map.values()) {
    group.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  }
  return [...map.values()];
}

/**
 * 같은 곡이 여러 번 나오지 않게 하나만 남깁니다 (달력, 방송 예정곡 목록용).
 * 여러 학생이 신청한 곡을 다 승인해도 방송은 한 번만 나가므로 화면에도 한 번만 보여야 합니다.
 */
export function dedupeBySong(requests) {
  const seen = new Set();
  const out = [];
  for (const r of requests) {
    const key = songKey(r.title, r.artist);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}
