import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { verifyAdminPassword } from "@/lib/adminAuth";

export async function GET(request) {
  const auth = verifyAdminPassword(request);
  if (!auth.ok) return auth.response;

  const { data, error } = await supabaseAdmin
    .from("song_requests")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    return NextResponse.json({ error: "조회에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ requests: data });
}
