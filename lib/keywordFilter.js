import { supabaseAdmin } from "./supabaseAdmin";

// 곡명 + 아티스트명 텍스트를 blocklist_keywords 테이블과 대조합니다.
// 가사 본문은 검사하지 않습니다 (저작권 문제로 저장하지 않으므로).
// 대소문자, 공백, 특수문자를 정규화한 뒤 부분 문자열 매칭합니다.

function normalize(text) {
  return text
    .toLowerCase()
    .replace(/[\s\-_.,!?()[\]{}'"]/g, "");
}

export async function checkKeywordBlocklist(title, artist) {
  const { data: keywords, error } = await supabaseAdmin
    .from("blocklist_keywords")
    .select("keyword");

  if (error) {
    console.error("비속어 사전 조회 실패:", error.message);
    return { flagged: false, reason: null };
  }

  const normalizedText = normalize(`${title} ${artist}`);

  for (const row of keywords) {
    const kw = normalize(row.keyword);
    if (kw && normalizedText.includes(kw)) {
      return { flagged: true, reason: row.keyword };
    }
  }

  return { flagged: false, reason: null };
}
