import { NextResponse } from "next/server";
import { verifyAdminPassword } from "@/lib/adminAuth";

// 비밀번호 확인만 하는 가벼운 엔드포인트입니다. DB를 전혀 건드리지 않습니다.
//
// 예전에는 로그인 화면이 /api/admin/requests(신청 목록 조회)로 비밀번호를 확인했는데,
// 그러면 Supabase가 잠깐 느려지거나 막혔을 때 비밀번호가 맞는데도 로그인 자체가 안 되고
// "비밀번호가 올바르지 않습니다"처럼 보였습니다. 인증과 데이터 조회를 분리해 두면
// DB 문제는 대시보드 안에서 에러로 보이고, 로그인은 그대로 됩니다.
export async function GET(request) {
  const auth = verifyAdminPassword(request);
  if (!auth.ok) return auth.response;

  return NextResponse.json({ ok: true });
}
