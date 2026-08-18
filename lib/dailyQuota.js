import { supabaseAdmin } from "./supabaseAdmin";

// 한 학생이 하루에 신청할 수 있는 곡 수를 제한합니다.
// 제한이 없으면 한 명이 자기 최애곡을 몰아서 넣었을 때 다른 학생 신청이 목록 뒤로 밀립니다.
//
// "하루"는 한국 시간(KST, UTC+9) 기준입니다. created_at은 timestamptz라 UTC로 저장되므로,
// 서버가 어느 리전에 있든(Vercel은 보통 UTC) 같은 결과가 나오도록 오프셋을 직접 계산합니다.
// 서버 로컬 시간대에 의존하면 자정 근처에서 학생마다 다른 날짜가 적용될 수 있습니다.

export const DAILY_LIMIT = 3;

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// 지금 시각 기준 "한국의 오늘"이 UTC로 언제 시작하고 끝나는지 돌려줍니다.
export function kstDayRange(now = new Date()) {
  const kstNow = new Date(now.getTime() + KST_OFFSET_MS);
  // UTC 게터로 읽으면 KST 기준 연/월/일이 됩니다.
  const startKst = Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate());
  const startUtc = new Date(startKst - KST_OFFSET_MS);
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000);
  return { startUtc, endUtc };
}

// 오늘 몇 곡 신청했는지 / 몇 곡 더 가능한지.
// 반려된 곡은 학생 잘못이 아닐 수 있어 한도에서 제외합니다(다시 신청할 수 있어야 하므로).
export async function getDailyUsage(studentId) {
  const { startUtc, endUtc } = kstDayRange();

  const { count, error } = await supabaseAdmin
    .from("song_requests")
    .select("*", { count: "exact", head: true })
    .eq("student_id", studentId)
    .neq("status", "rejected")
    .gte("created_at", startUtc.toISOString())
    .lt("created_at", endUtc.toISOString());

  if (error) {
    // 카운트를 못 읽었다고 신청을 막아버리면 DB가 잠깐 흔들릴 때 서비스가 멈춥니다.
    // 제한은 남용 방지용이므로, 조회 실패 시에는 통과시키는 쪽을 택합니다.
    console.error("일일 신청 수 조회 실패:", error.message);
    return { used: 0, limit: DAILY_LIMIT, remaining: DAILY_LIMIT, unknown: true };
  }

  const used = count || 0;
  return {
    used,
    limit: DAILY_LIMIT,
    remaining: Math.max(0, DAILY_LIMIT - used),
    unknown: false,
  };
}
