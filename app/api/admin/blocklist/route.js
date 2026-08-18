import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { verifyAdminPassword } from "@/lib/adminAuth";
import { isUuid } from "@/lib/validate";

const MAX_KEYWORD_LENGTH = 100;

export async function GET(request) {
  const auth = verifyAdminPassword(request);
  if (!auth.ok) return auth.response;

  const { data, error } = await supabaseAdmin
    .from("blocklist_keywords")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: "조회 실패" }, { status: 500 });
  return NextResponse.json({ keywords: data });
}

export async function POST(request) {
  const auth = verifyAdminPassword(request);
  if (!auth.ok) return auth.response;

  let keyword;
  try {
    ({ keyword } = await request.json());
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  if (typeof keyword !== "string" || !keyword.trim()) {
    return NextResponse.json({ error: "키워드를 입력해 주세요." }, { status: 400 });
  }
  if (keyword.trim().length > MAX_KEYWORD_LENGTH) {
    return NextResponse.json(
      { error: `키워드는 ${MAX_KEYWORD_LENGTH}자 이내로 입력해 주세요.` },
      { status: 400 }
    );
  }

  const { data, error } = await supabaseAdmin
    .from("blocklist_keywords")
    .insert({ keyword: keyword.trim() })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "이미 등록된 키워드입니다." }, { status: 409 });
    }
    return NextResponse.json({ error: "추가 실패" }, { status: 500 });
  }

  return NextResponse.json({ keyword: data });
}

export async function DELETE(request) {
  const auth = verifyAdminPassword(request);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!isUuid(id)) return NextResponse.json({ error: "잘못된 id입니다." }, { status: 400 });

  const { error } = await supabaseAdmin.from("blocklist_keywords").delete().eq("id", id);
  if (error) return NextResponse.json({ error: "삭제 실패" }, { status: 500 });

  return NextResponse.json({ ok: true });
}
