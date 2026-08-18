import { NextResponse } from "next/server";

// 방송부 전용 API를 지키는 최소한의 인증입니다.
// 전교생용 계정 시스템이 아니라 방송부 내부 공유 비밀번호 하나로 충분한 수준으로 설계했습니다.
// 요청 헤더 "x-admin-password"에 담아 보내며, 비밀번호는 서버 환경변수에만 존재합니다.

export function verifyAdminPassword(request) {
  const provided = request.headers.get("x-admin-password");
  const correct = process.env.ADMIN_PASSWORD;

  if (!correct) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "서버에 관리자 비밀번호가 설정되어 있지 않습니다." },
        { status: 500 }
      ),
    };
  }

  if (provided !== correct) {
    return {
      ok: false,
      response: NextResponse.json({ error: "인증에 실패했습니다." }, { status: 401 }),
    };
  }

  return { ok: true };
}
