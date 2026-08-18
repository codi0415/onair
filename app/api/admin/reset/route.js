import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { verifyAdminPassword } from "@/lib/adminAuth";

// 되돌릴 수 없는 대량 삭제 작업이라, 비밀번호 인증에 더해
// 사용자가 "삭제확인"이라는 문구를 정확히 입력해야만 실행되도록 이중으로 막습니다.
// scope=all      : song_requests 테이블 전체 삭제 (비속어 사전, 캐시 테이블은 영향 없음)
// scope=played   : 방송 완료(played) 상태인 곡만 삭제
// scope=rejected : 반려(rejected) 상태인 곡만 삭제
export async function POST(request) {
  const auth = verifyAdminPassword(request);
  if (!auth.ok) return auth.response;

  let scope, confirmText;
  try {
    ({ scope, confirmText } = await request.json());
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  if (confirmText !== "삭제확인") {
    return NextResponse.json(
      { error: "확인 문구가 일치하지 않습니다." },
      { status: 400 }
    );
  }

  const allowedScopes = ["all", "played", "rejected"];
  if (!allowedScopes.includes(scope)) {
    return NextResponse.json({ error: "잘못된 scope입니다." }, { status: 400 });
  }

  let query = supabaseAdmin.from("song_requests").delete();

  if (scope === "all") {
    // Supabase는 조건 없는 delete를 막아두는 경우가 있어, 항상 참인 조건을 명시적으로 둡니다.
    query = query.gte("created_at", "1970-01-01T00:00:00Z");
  } else if (scope === "played") {
    query = query.eq("status", "played");
  } else if (scope === "rejected") {
    query = query.eq("status", "rejected");
  }

  const { error } = await query;

  if (error) {
    console.error(error);
    return NextResponse.json({ error: "삭제에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
