import { searchItunesTracks } from "./itunes";
import { searchDeezerTracks } from "./deezer";

// iTunes와 Deezer를 병렬로 검색해서 결과를 합칩니다.
// 두 서비스는 서로 다른 카탈로그/ID 체계를 쓰기 때문에, 같은 곡이라도
// 트랙 ID로는 중복을 판단할 수 없습니다. 대신 "제목 + 아티스트"를 정규화한 문자열을
// 기준으로 동일 곡 여부를 판단합니다.

// 각 소스에서 받아올 개수. iTunes/Deezer 모두 limit과 무관하게 "호출 1회"라서
// 이 값을 올려도 레이트 리밋 소모량은 똑같습니다. 넉넉히 받아두고 아래에서 걸러냅니다.
const DEFAULT_LIMIT_PER_SOURCE = 50;
// 학생 화면에 최종적으로 내려보낼 최대 개수 (화면에서는 10개씩 "더보기"로 펼침)
const MAX_MERGED = 40;

function normalizeForDedup(text) {
  return (text || "")
    .toLowerCase()
    // 괄호 안 내용 제거 (feat., remastered, live 등 버전 표기 차이로 인한 오탐 완화)
    .replace(/[([][^)\]]*[)\]]/g, "")
    // 공백, 특수문자 제거
    .replace(/[\s\-_.,!?'"`]/g, "");
}

function dedupKey(track) {
  return `${normalizeForDedup(track.title)}::${normalizeForDedup(track.artist)}`;
}

// --- 노래방 / MR / 반주 클론 걸러내기 ---
//
// iTunes KR 카탈로그에는 원곡 말고도 노래방 반주, MR, 피아노/오르골 커버가 잔뜩 올라와 있고
// 검색 상위권을 그대로 차지합니다. 실제로 확인해 보면:
//   "아무노래"  -> 상위 10개 중 6개가 플로우뮤직 피아노/국악버전, 모두의MR 같은 클론
//   "Aqua Man" -> 1위가 금영노래방
// 학생이 신청할 수 있는 건 원곡이므로, 이런 항목이 자리를 차지하면 정작 찾는 곡이 밀려납니다.
//
// 오탐(정상 곡을 지워버리는 것)이 더 나쁘기 때문에 판단은 보수적으로 합니다.
// - 아티스트명 신호를 우선합니다. "금영노래방", "모두의MR" 같은 이름은 거의 확실합니다.
// - 제목은 "(MR)", "[피아노]" 처럼 표기가 명확할 때만 거릅니다.
//   (제목에 "피아노"가 들어간 정상 곡까지 지우지 않기 위해서입니다.)
const CLONE_ARTIST =
  /(노래방|karaoke|가라오케|오르골|뮤직박스|music\s*box|반주|모두의\s*mr|플로우뮤직)/i;
const CLONE_TITLE =
  /(karaoke|instrumental|\(mr\)|\[mr\]|\(inst\.?\)|\[inst\.?\]|노래방|반주|오르골|music\s*box|\[피아노\]|\[국악버전\]|피아노\s*버전|acca)/i;

function isCloneTrack(track) {
  return CLONE_ARTIST.test(track.artist || "") || CLONE_TITLE.test(track.title || "");
}

// 한쪽 소스에서 예상 못 한 예외가 나도 다른 쪽 결과는 살려야 하므로
// 실패한 소스만 빈 결과로 처리합니다.
async function settle(promise, label) {
  try {
    return await promise;
  } catch (err) {
    console.error(`${label} 검색 중 예외:`, err.message);
    return { tracks: [], source: "error" };
  }
}

// 같은 소스 안에서의 중복(같은 곡의 여러 앨범 수록본 등)을 먼저 정리합니다.
function dedupeWithin(tracks) {
  const seen = new Set();
  const out = [];
  for (const track of tracks) {
    const key = dedupKey(track);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(track);
  }
  return out;
}

export async function searchAllTracks(query, limitPerSource = DEFAULT_LIMIT_PER_SOURCE) {
  const [itunesResult, deezerResult] = await Promise.all([
    settle(searchItunesTracks(query, limitPerSource), "iTunes"),
    settle(searchDeezerTracks(query, limitPerSource), "Deezer"),
  ]);

  const itunesTracks = dedupeWithin(itunesResult.tracks.filter((t) => !isCloneTrack(t)));
  const cleanedDeezer = dedupeWithin(deezerResult.tracks.filter((t) => !isCloneTrack(t)));

  // 양쪽에 다 있는 곡은 iTunes 쪽을 씁니다.
  // (iTunes가 explicit 판정 필드를 더 신뢰할 만하게 주기 때문입니다.)
  // 위치와 무관하게 먼저 걸러내야, 아래에서 번갈아 넣을 때 Deezer 사본이 끼어들지 않습니다.
  const itunesKeys = new Set(itunesTracks.map(dedupKey));
  const deezerOnly = cleanedDeezer.filter((t) => !itunesKeys.has(dedupKey(t)));

  // iTunes 전부를 앞에 몰아넣고 Deezer를 뒤에 붙이면, Deezer에만 있는 곡은
  // 항상 iTunes 결과 전부보다 뒤로 밀립니다. 그런데 국내 힙합처럼
  // iTunes KR 카탈로그에 없는 곡이 정확히 그 경우라, 정작 찾아야 할 곡이 제일 아래로 갑니다.
  // (실제로 빈지노 "Aqua Man"은 Deezer에만 있는데, 이어붙이기 방식에서는 12위,
  //  각 소스를 50개씩 받으면 20위 밖으로 밀려 아예 안 보였습니다.)
  // 그래서 두 소스를 섞되, 1:1로 번갈아 넣지는 않습니다.
  // Deezer는 한국어 검색어에 대한 관련도가 iTunes보다 눈에 띄게 나쁩니다.
  // (예: "newjeans"의 Deezer 2번째 결과가 League of Legends의 "GODS")
  // 1:1로 섞으면 흔한 K-pop 검색에서 두 번째 줄마다 엉뚱한 곡이 끼어듭니다.
  // iTunes 2개당 Deezer 1개 비율이면 상단은 깨끗하게 유지하면서도
  // Deezer에만 있는 곡이 첫 화면(10개) 안에 들어옵니다.
  const ITUNES_PER_DEEZER = 2;
  const merged = [];
  let i = 0;
  let d = 0;
  while (merged.length < MAX_MERGED && (i < itunesTracks.length || d < deezerOnly.length)) {
    for (let k = 0; k < ITUNES_PER_DEEZER && i < itunesTracks.length && merged.length < MAX_MERGED; k++) {
      merged.push(itunesTracks[i++]);
    }
    if (d < deezerOnly.length && merged.length < MAX_MERGED) {
      merged.push(deezerOnly[d++]);
    }
  }

  // 안내 문구.
  // "결과가 0건"과 "API가 막혀서 못 찾음"은 학생 입장에서 전혀 다른 상황이라 구분해서 알려줍니다.
  const sources = [itunesResult.source, deezerResult.source];
  const isBlocked = (s) => s === "rate_limited" || s === "error";
  const bothBlocked = sources.every(isBlocked);
  const someBlocked = sources.some(isBlocked);

  let notice = null;
  if (bothBlocked) {
    notice = sources.every((s) => s === "rate_limited")
      ? "지금 검색 요청이 몰려 있습니다. 잠시 후 다시 검색해 주세요."
      : "곡 검색 서비스에 일시적인 문제가 있습니다. 잠시 후 다시 시도해 주세요.";
  } else if (someBlocked && merged.length === 0) {
    // 한쪽만 막혔는데 살아있는 쪽이 마침 0건을 준 경우.
    // 이걸 그냥 두면 학생은 "그런 곡이 없구나"로 오해하는데, 실제로는 검색이 반쪽이었던 겁니다.
    notice =
      "지금 곡 정보를 절반만 불러올 수 있는 상태라 결과가 안 나왔을 수 있습니다. 잠시 후 다시 검색해 주세요.";
  }

  return { tracks: merged, notice };
}
