import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { verifyAdminPassword } from "@/lib/adminAuth";
import { isUuid, isDateString } from "@/lib/validate";
import { sendStatusEmail } from "@/lib/mailer";

const MAX_TEXT_LENGTH = 200;

export async function PATCH(request, { params }) {
  const auth = verifyAdminPassword(request);
  if (!auth.ok) return auth.response;

  const { id } = params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "잘못된 신청 ID입니다." }, { status: 400 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }
  const { status, scheduledDate, rejectReason, reviewedBy } = body;

  const allowedStatus = ["pending", "approved", "rejected", "scheduled", "played"];
  if (status && !allowedStatus.includes(status)) {
    return NextResponse.json({ error: "잘못된 상태값입니다." }, { status: 400 });
  }

  // 날짜는 date 컬럼이라 형식이 틀리면 쿼리 자체가 에러납니다. 먼저 걸러냅니다.
  // null은 "배정 취소"라는 뜻으로 허용합니다.
  if (scheduledDate !== undefined && scheduledDate !== null && !isDateString(scheduledDate)) {
    return NextResponse.json({ error: "날짜 형식이 올바르지 않습니다." }, { status: 400 });
  }

  for (const [label, value] of [["반려 사유", rejectReason], ["담당자", reviewedBy]]) {
    if (value !== undefined && value !== null) {
      if (typeof value !== "string") {
        return NextResponse.json({ error: `${label} 형식이 올바르지 않습니다.` }, { status: 400 });
      }
      if (value.length > MAX_TEXT_LENGTH) {
        return NextResponse.json(
          { error: `${label}는 ${MAX_TEXT_LENGTH}자 이내로 입력해 주세요.` },
          { status: 400 }
        );
      }
    }
  }

  const updatePayload = {
    reviewed_at: new Date().toISOString(),
  };
  if (status) updatePayload.status = status;
  if (scheduledDate !== undefined) updatePayload.scheduled_date = scheduledDate;
  if (rejectReason !== undefined) updatePayload.reject_reason = rejectReason;
  if (reviewedBy !== undefined) updatePayload.reviewed_by = reviewedBy;

  // 상태가 실제로 바뀌었는지 판단하려면 바꾸기 전 값을 알아야 합니다.
  // (같은 상태로 다시 저장할 때 결과 메일이 또 나가는 걸 막기 위한 것)
  const { data: before } = await supabaseAdmin
    .from("song_requests")
    .select("status")
    .eq("id", id)
    .maybeSingle();
  const previousStatus = before?.status ?? null;

  const { data, error } = await supabaseAdmin
    .from("song_requests")
    .update(updatePayload)
    .eq("id", id)
    .select()
    .maybeSingle();

  if (error) {
    console.error(error);
    return NextResponse.json({ error: "업데이트에 실패했습니다." }, { status: 500 });
  }
  // .single()은 대상이 없으면 에러로 처리되어 "업데이트 실패"로 뭉뚱그려집니다.
  // 다른 방송부원이 방금 삭제한 신청일 수 있으니 그 상황을 따로 알려줍니다.
  if (!data) {
    return NextResponse.json(
      { error: "이미 삭제된 신청입니다. 목록을 새로고침해 주세요." },
      { status: 404 }
    );
  }

  // 상태가 실제로 "바뀐" 경우에만 메일을 보냅니다.
  // 날짜만 다시 조정하는 등 같은 상태로 여러 번 저장할 때 같은 메일이 반복 발송되면 곤란합니다.
  let mail = null;
  if (status && status !== previousStatus) {
    // await 하지만 실패해도 무시합니다. 메일이 안 나갔다고 승인 자체가 실패하면 안 됩니다.
    // (서버리스에서는 응답 후 실행이 잘려나갈 수 있어 fire-and-forget 대신 기다립니다.)
    mail = await sendStatusEmail(data);
    if (mail.error) console.error("결과 메일 발송 실패:", mail.error);
  }

  return NextResponse.json({ request: data, mail });
}

export async function DELETE(request, { params }) {
  const auth = verifyAdminPassword(request);
  if (!auth.ok) return auth.response;

  const { id } = params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "잘못된 신청 ID입니다." }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from("song_requests").delete().eq("id", id);

  if (error) {
    console.error(error);
    return NextResponse.json({ error: "삭제에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
