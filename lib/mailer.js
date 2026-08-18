// 신청 결과를 학생 이메일(`{앞자리}@ushs.hs.kr`)로 보내는 모듈입니다.
//
// 발송은 Resend REST API를 fetch로 직접 호출합니다. SDK를 따로 안 쓰는 이유는
// 이 프로젝트가 의존성을 최소로 유지해 왔고, 실제로 필요한 건 POST 한 번뿐이기 때문입니다.
//
// RESEND_API_KEY가 없으면 조용히 건너뜁니다(Musixmatch와 같은 정책).
// 메일이 안 나가는 것 때문에 승인/반려 자체가 실패하면 안 되므로, 실패는 로그만 남깁니다.

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const FETCH_TIMEOUT_MS = 6000;
const EMAIL_DOMAIN = "ushs.hs.kr";

// 학교 도메인 메일함으로 보내는 것이라, 학생이 직접 입력한 앞자리를 그대로 신뢰하지 않고
// 서버의 학번 규칙을 한 번 더 확인합니다.
const STUDENT_ID_PATTERN = /^[a-zA-Z0-9._-]{2,30}$/;

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

// --- 색상: 앱 화면(globals.css)과 같은 팔레트 ---
// 메일 클라이언트는 CSS 변수를 지원하지 않으므로 hex를 그대로 씁니다.
const C = {
  ink: "#10151f",
  inkSoft: "#1a2233",
  inkLine: "#2a3448",
  paper: "#eef1f6",
  paperDim: "#9aa5b8",
  signal: "#ff5a4e",
  dawn: "#ffb454",
  ok: "#5fd0a7",
};

// 곡 제목·아티스트·반려 사유는 전부 사람이 입력한 값이라 그대로 HTML에 넣으면 안 됩니다.
function esc(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function friendlyDate(dateKey) {
  if (!dateKey) return "";
  const [y, m, d] = String(dateKey).split("-").map(Number);
  const date = new Date(y, m - 1, d);
  if (Number.isNaN(date.getTime())) return String(dateKey);
  return `${y}년 ${m}월 ${d}일 (${WEEKDAYS[date.getDay()]})`;
}

// 상태별 문안. 여기만 고치면 메일 내용이 바뀝니다.
const TEMPLATES = {
  approved: {
    subject: (r) => `[ON AIR] "${r.title}" 신청이 승인되었습니다`,
    accent: C.ok,
    badge: "승인됨",
    headline: "신청하신 곡이 승인되었습니다",
    lead: "방송부 검토를 통과했습니다. 방송 날짜가 정해지면 다시 알려드릴게요.",
  },
  scheduled: {
    subject: (r) => `[ON AIR] "${r.title}" 방송일이 정해졌습니다`,
    accent: C.dawn,
    badge: "방송 예정",
    headline: "방송 날짜가 정해졌습니다",
    lead: "아래 날짜 아침 기상곡으로 나갈 예정입니다.",
  },
  rejected: {
    subject: (r) => `[ON AIR] "${r.title}" 신청 결과 안내`,
    accent: C.signal,
    badge: "반려됨",
    headline: "아쉽게도 이번 신청은 반려되었습니다",
    lead: "아래 사유를 확인해 주세요. 다른 곡으로 다시 신청하실 수 있습니다.",
  },
};

function buildHtml(request, tpl, appUrl) {
  const title = esc(request.title);
  const artist = esc(request.artist);
  const art = request.album_image_url;
  const dateText = request.scheduled_date ? friendlyDate(request.scheduled_date) : "";
  const reason = request.reject_reason ? esc(request.reject_reason) : "";

  // 앨범아트가 없을 수도 있어 셀 자체를 조건부로 넣습니다.
  const artCell = art
    ? `<td width="72" style="padding-right:14px;vertical-align:top;">
         <img src="${esc(art)}" width="72" height="72" alt=""
              style="display:block;width:72px;height:72px;border-radius:10px;border:1px solid ${C.inkLine};object-fit:cover;" />
       </td>`
    : "";

  const dateBlock = dateText
    ? `<tr><td style="padding-top:16px;">
         <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                style="background:#20293c;border:1px solid ${C.dawn};border-radius:10px;">
           <tr><td style="padding:14px 16px;">
             <div style="font-size:12px;color:${C.paperDim};margin-bottom:4px;">방송 예정일</div>
             <div style="font-size:19px;font-weight:700;color:${C.dawn};">${esc(dateText)}</div>
           </td></tr>
         </table>
       </td></tr>`
    : "";

  const reasonBlock = reason
    ? `<tr><td style="padding-top:16px;">
         <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                style="background:#2a1c1e;border:1px solid ${C.signal};border-radius:10px;">
           <tr><td style="padding:14px 16px;">
             <div style="font-size:12px;color:${C.paperDim};margin-bottom:4px;">반려 사유</div>
             <div style="font-size:15px;color:${C.signal};line-height:1.6;">${reason}</div>
           </td></tr>
         </table>
       </td></tr>`
    : "";

  // 이메일은 flexbox/CSS변수/외부 스타일시트를 못 쓰는 클라이언트가 많아
  // 표 기반 레이아웃 + 인라인 스타일로만 구성합니다.
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${esc(tpl.subject(request))}</title>
</head>
<body style="margin:0;padding:0;background:${C.ink};">
  <!-- 받은편지함 미리보기에 뜨는 한 줄 -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(tpl.headline)} — ${title} / ${artist}</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
         style="background:${C.ink};padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
             style="max-width:560px;width:100%;font-family:-apple-system,BlinkMacSystemFont,'Malgun Gothic','Apple SD Gothic Neo',sans-serif;">

        <!-- 헤더 -->
        <tr><td align="center" style="padding-bottom:24px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"
                 style="border:1px solid ${C.signal};border-radius:999px;">
            <tr><td style="padding:6px 15px;font-size:12px;font-weight:700;letter-spacing:.18em;color:${C.signal};">
              ● ON AIR
            </td></tr>
          </table>
        </td></tr>

        <!-- 본문 카드 -->
        <tr><td style="background:${C.inkSoft};border:1px solid ${C.inkLine};border-radius:16px;padding:28px 24px;">

          <!-- Outlook 데스크톱(Word 렌더러)은 display:inline-block을 무시해서
               배지가 가로 전체를 먹습니다. 표로 감싸면 어느 클라이언트에서도 폭이 내용에 맞습니다. -->
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:14px;">
            <tr><td style="background:${tpl.accent};border-radius:5px;padding:3px 9px;
                           font-size:11px;font-weight:700;color:${C.ink};white-space:nowrap;">
              ${esc(tpl.badge)}
            </td></tr>
          </table>

          <h1 style="margin:0 0 8px;font-size:21px;line-height:1.4;font-weight:700;color:${C.paper};">
            ${esc(tpl.headline)}
          </h1>
          <p style="margin:0 0 20px;font-size:14px;line-height:1.7;color:${C.paperDim};">
            ${esc(tpl.lead)}
          </p>

          <!-- 곡 정보 -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                 style="background:${C.ink};border:1px solid ${C.inkLine};border-radius:12px;">
            <tr><td style="padding:14px 16px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  ${artCell}
                  <td style="vertical-align:top;">
                    <div style="font-size:17px;font-weight:700;color:${C.paper};line-height:1.35;">${title}</div>
                    <div style="font-size:14px;color:${C.paperDim};padding-top:4px;">${artist}</div>
                  </td>
                </tr>
              </table>
            </td></tr>
          </table>

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            ${dateBlock}
            ${reasonBlock}
          </table>

          <!-- 버튼 -->
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;">
            <tr><td style="background:${C.dawn};border-radius:10px;">
              <a href="${esc(appUrl)}"
                 style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:700;
                        color:${C.ink};text-decoration:none;">
                내 신청 현황 보기
              </a>
            </td></tr>
          </table>

        </td></tr>

        <!-- 푸터 -->
        <tr><td align="center" style="padding-top:20px;">
          <p style="margin:0;font-size:12px;line-height:1.7;color:#6b7689;">
            울산과학고등학교 방송부 ON AIR<br />
            이 메일은 기상곡 신청 결과 안내로 자동 발송되었습니다.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// HTML을 못 읽는 환경(텍스트 전용 클라이언트, 스크린리더 일부)을 위한 대체 본문.
function buildText(request, tpl, appUrl) {
  const lines = [
    `[ON AIR] ${tpl.headline}`,
    "",
    `곡: ${request.title}`,
    `아티스트: ${request.artist}`,
    `상태: ${tpl.badge}`,
  ];
  if (request.scheduled_date) lines.push(`방송 예정일: ${friendlyDate(request.scheduled_date)}`);
  if (request.reject_reason) lines.push(`반려 사유: ${request.reject_reason}`);
  lines.push("", tpl.lead, "", `내 신청 현황: ${appUrl}`, "", "울산과학고등학교 방송부 ON AIR");
  return lines.join("\n");
}

/**
 * 신청 상태가 바뀌었을 때 학생에게 결과 메일을 보냅니다.
 * 실패해도 예외를 던지지 않습니다 — 메일 때문에 승인/반려가 막히면 안 되기 때문입니다.
 * @returns {Promise<{sent:boolean, skipped?:string, error?:string}>}
 */
export async function sendStatusEmail(request) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { sent: false, skipped: "RESEND_API_KEY 미설정" };

  const tpl = TEMPLATES[request?.status];
  if (!tpl) return { sent: false, skipped: `메일 대상 아님(${request?.status})` };

  // 방송부가 직접 등록한 곡은 신청자가 없습니다(student_id가 "방송부").
  const studentId = request.student_id;
  if (!studentId || !STUDENT_ID_PATTERN.test(studentId)) {
    return { sent: false, skipped: "학생 신청이 아님" };
  }

  const from = process.env.MAIL_FROM;
  if (!from) return { sent: false, skipped: "MAIL_FROM 미설정" };

  const appUrl = process.env.APP_URL || "https://onair-three-beta.vercel.app";
  const to = `${studentId}@${EMAIL_DOMAIN}`;

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: tpl.subject(request),
        html: buildHtml(request, tpl, appUrl),
        text: buildText(request, tpl, appUrl),
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`메일 발송 실패 (${res.status}) ${to}:`, detail.slice(0, 300));
      return { sent: false, error: `${res.status}` };
    }
    return { sent: true };
  } catch (err) {
    console.error(`메일 발송 오류 ${to}:`, err.message);
    return { sent: false, error: err.message };
  }
}

// 미리보기/테스트용으로 템플릿만 뽑아 쓸 수 있게 열어둡니다.
export function renderStatusEmail(request, appUrl = "https://example.com") {
  const tpl = TEMPLATES[request.status];
  if (!tpl) return null;
  return {
    subject: tpl.subject(request),
    html: buildHtml(request, tpl, appUrl),
    text: buildText(request, tpl, appUrl),
  };
}
