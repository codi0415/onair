"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useIsMobile } from "@/lib/useIsMobile";
import AudioPreview from "@/app/components/AudioPreview";
import { groupBySong, dedupeBySong } from "@/lib/songKey";

const FILTERS = [
  { key: "pending", label: "검토 대기" },
  { key: "approved", label: "승인됨" },
  { key: "scheduled", label: "예정" },
  { key: "rejected", label: "반려됨" },
  { key: "played", label: "방송 완료" },
  { key: "all", label: "전체" },
];

const PW_STORAGE_KEY = "onair_admin_pw";

// 곡 묶음 정렬 기준. 목록 탭과 달력 배정 창에서 같은 옵션을 씁니다.
// 기본값을 "등록순"으로 둔 이유: 먼저 신청한 곡이 먼저 배정되는 게 학생 입장에서 공평합니다.
const SORT_OPTIONS = [
  { key: "oldest", label: "등록순" },
  { key: "popular", label: "인기순" },
  { key: "recent", label: "최신순" },
  { key: "title", label: "곡명순" },
];

function sortGroups(groups, sortKey) {
  const first = (g) => new Date(g[0].created_at).getTime();
  const sorted = [...groups];
  switch (sortKey) {
    case "popular":
      // 신청자 많은 순. 같은 인원이면 먼저 신청된 곡이 앞으로.
      sorted.sort((a, b) => b.length - a.length || first(a) - first(b));
      break;
    case "recent":
      sorted.sort((a, b) => first(b) - first(a));
      break;
    case "title":
      sorted.sort((a, b) => (a[0].title || "").localeCompare(b[0].title || "", "ko"));
      break;
    case "oldest":
    default:
      sorted.sort((a, b) => first(a) - first(b));
  }
  return sorted;
}

function SortBar({ value, onChange, label = "정렬" }) {
  return (
    <div style={styles.sortBar}>
      <span style={styles.sortLabel}>{label}</span>
      {SORT_OPTIONS.map((o) => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          style={{
            ...styles.sortButton,
            ...(value === o.key ? styles.sortButtonActive : {}),
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// 서버 쪽 상한과 같은 값입니다. 여기서 미리 막아야 방송부가 길게 써 놓고
// 저장 버튼을 누른 뒤에야 거절당하는 일이 없습니다.
const MAX_TEXT_LENGTH = 200; // 곡명/아티스트/반려 사유/담당자
const MAX_KEYWORD_LENGTH = 100; // 비속어 사전 키워드

// 반려 사유 프리셋. 학생에게 메일로 그대로 나가는 문구라 존댓말/완결된 문장으로 씁니다.
const REJECT_PRESETS = [
  "가사에 부적절한 표현이 있습니다",
  "아침 방송 분위기와 맞지 않습니다",
  "최근에 이미 방송된 곡입니다",
  "음원을 확인할 수 없어 검토가 어렵습니다",
  "신청이 몰려 이번에는 반영하지 못했습니다",
];

export default function AdminPage() {
  const [password, setPassword] = useState("");
  const [authed, setAuthed] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [busy, setBusy] = useState(false);
  // 저장된 비밀번호를 확인하는 동안에는 로그인 화면을 잠깐 깜빡이지 않도록 대기 상태를 둡니다.
  const [restoring, setRestoring] = useState(true);

  // 저장된 비밀번호가 있어도 그대로 믿지 않고 서버에 한 번 확인합니다.
  // (비밀번호가 바뀐 뒤에도 대시보드가 열려서, 모든 요청이 조용히 실패하고
  //  신청이 하나도 없는 것처럼 보이던 문제를 막습니다.)
  useEffect(() => {
    const saved = window.sessionStorage.getItem(PW_STORAGE_KEY);
    if (!saved) {
      setRestoring(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const ok = await checkPassword(saved);
      if (cancelled) return;
      if (ok) {
        setPassword(saved);
        setAuthed(true);
      } else {
        window.sessionStorage.removeItem(PW_STORAGE_KEY);
      }
      setRestoring(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function checkPassword(pw) {
    try {
      const res = await fetch("/api/admin/verify", { headers: { "x-admin-password": pw } });
      return res.ok;
    } catch {
      return false;
    }
  }

  async function tryLogin() {
    if (!password) return;
    setAuthError(null);
    setBusy(true);
    try {
      // 비밀번호 확인 전용 엔드포인트라 DB 상태와 무관하게 로그인할 수 있습니다.
      const res = await fetch("/api/admin/verify", {
        headers: { "x-admin-password": password },
      });
      if (res.ok) {
        window.sessionStorage.setItem(PW_STORAGE_KEY, password);
        setAuthed(true);
      } else if (res.status === 401) {
        setAuthError("비밀번호가 올바르지 않습니다.");
      } else {
        const data = await res.json().catch(() => ({}));
        setAuthError(data.error || "로그인에 실패했습니다. 서버 설정을 확인해 주세요.");
      }
    } catch {
      setAuthError("서버에 연결하지 못했습니다. 네트워크를 확인해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  // 사용 중 비밀번호가 바뀌었거나 세션이 무효해지면 다시 로그인 화면으로 돌립니다.
  function handleAuthFail() {
    window.sessionStorage.removeItem(PW_STORAGE_KEY);
    setAuthed(false);
    setAuthError("인증이 만료되었습니다. 비밀번호를 다시 입력해 주세요.");
  }

  if (restoring) {
    return (
      <div style={styles.loginPage}>
        <p style={styles.hint}>확인 중…</p>
      </div>
    );
  }

  if (!authed) {
    return (
      <div style={styles.loginPage}>
        <div style={styles.loginCard}>
          <div style={styles.onAirBadge}>
            <span style={styles.onAirDot} />
            ON AIR · 방송부
          </div>
          <h1 style={styles.loginTitle}>방송부 관리 페이지</h1>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !busy && tryLogin()}
            placeholder="방송부 비밀번호"
            style={styles.loginInput}
          />
          {authError && <p style={styles.errorText}>{authError}</p>}
          <button style={styles.primaryButton} disabled={busy} onClick={tryLogin}>
            {busy ? "확인 중…" : "입장하기"}
          </button>
        </div>
      </div>
    );
  }

  return <Dashboard password={password} onAuthFail={handleAuthFail} />;
}

function Dashboard({ password, onAuthFail }) {
  const isMobile = useIsMobile();
  const [filter, setFilter] = useState("pending");
  const [requests, setRequests] = useState(null);
  const [blocklist, setBlocklist] = useState([]);
  // 방송부가 들어오자마자 "지금 뭘 해야 하는지"부터 보이도록 대시보드를 첫 화면으로 둡니다.
  const [view, setView] = useState("dashboard"); // "dashboard" | "list" | "calendar" | "manual" | "blocklist" | "danger"
  const [loadError, setLoadError] = useState(null);
  const [listSort, setListSort] = useState("oldest"); // 목록 탭 정렬 기준

  // 매 렌더마다 새 객체를 만들면 useCallback 의존성이 계속 바뀌므로 password 기준으로 고정합니다.
  const authHeaders = useMemo(() => ({ "x-admin-password": password }), [password]);

  // 방송부 화면의 모든 요청이 거치는 공통 fetch.
  // 401이면 곧바로 로그인 화면으로 돌려보내, "요청이 하나도 없는 것처럼 보이는" 상태를 없앱니다.
  const adminFetch = useCallback(
    async (url, options = {}) => {
      const res = await fetch(url, {
        ...options,
        headers: { ...(options.headers || {}), ...authHeaders },
      });
      if (res.status === 401) {
        onAuthFail();
        throw new Error("인증이 만료되었습니다.");
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "요청에 실패했습니다.");
      return data;
    },
    [authHeaders, onAuthFail]
  );

  const loadRequests = useCallback(async () => {
    try {
      const data = await adminFetch("/api/admin/requests");
      setRequests(data.requests || []);
      setLoadError(null);
    } catch (err) {
      setLoadError(err.message);
    }
  }, [adminFetch]);

  const loadBlocklist = useCallback(async () => {
    try {
      const data = await adminFetch("/api/admin/blocklist");
      setBlocklist(data.keywords || []);
    } catch {
      // 사전 목록은 부가 기능이라 실패해도 화면 전체를 막지 않습니다.
    }
  }, [adminFetch]);

  useEffect(() => {
    loadRequests();
    loadBlocklist();

    // 10초마다 자동으로 새 요청이 있는지 확인합니다.
    // 화면이 백그라운드 탭으로 가려져 있을 때는 불필요한 요청을 줄이기 위해 멈춥니다.
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        loadRequests();
      }
    }, 10000);

    return () => clearInterval(interval);
  }, [loadRequests, loadBlocklist]);

  // 같은 곡을 여러 학생이 신청한 경우 한 카드로 묶여 있으므로, 처리도 그 그룹 전체에 적용합니다.
  // 신청자마다 각각 결과 메일을 받아야 하니 건별로 PATCH를 보냅니다(보통 1~3건).
  async function updateRequests(ids, payload) {
    const list = Array.isArray(ids) ? ids : [ids];
    const failed = [];
    for (const id of list) {
      try {
        await adminFetch(`/api/admin/requests/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch (err) {
        failed.push(err.message);
      }
    }
    // 실패했는데 성공한 것처럼 목록만 새로고침되면 방송부가 처리됐다고 착각합니다.
    setLoadError(
      failed.length
        ? `${list.length}건 중 ${failed.length}건 처리 실패: ${failed[0]}`
        : null
    );
    loadRequests();
  }

  async function deleteRequests(ids) {
    const list = Array.isArray(ids) ? ids : [ids];
    const failed = [];
    for (const id of list) {
      try {
        await adminFetch(`/api/admin/requests/${id}`, { method: "DELETE" });
      } catch (err) {
        failed.push(err.message);
      }
    }
    setLoadError(failed.length ? `삭제 실패: ${failed[0]}` : null);
    loadRequests();
  }

  const filtered =
    requests === null
      ? null
      : filter === "all"
      ? requests
      : requests.filter((r) => r.status === filter);

  // 같은 곡을 신청한 건들을 한 묶음으로. 방송은 한 번만 나가므로 카드도 하나여야 합니다.
  const groups = filtered === null ? null : sortGroups(groupBySong(filtered), listSort);

  const TABS = [
    { key: "dashboard", label: "대시보드" },
    { key: "list", label: "목록" },
    { key: "calendar", label: "달력" },
    { key: "manual", label: "곡 직접 등록" },
    { key: "blocklist", label: "비속어 사전" },
    { key: "danger", label: "데이터 관리" },
  ];

  // 대시보드에서 "검토 대기 12건" 같은 항목을 누르면 목록 탭으로 넘어가면서
  // 해당 필터가 바로 걸리도록 합니다. 한 번 더 찾아 들어갈 필요가 없게.
  function goToList(nextFilter) {
    setFilter(nextFilter);
    setView("list");
  }

  return (
    <div style={{ ...styles.page, padding: isMobile ? "20px 12px 60px" : "30px 20px 60px" }}>
      <header style={{ ...styles.dashHeader, flexDirection: isMobile ? "column" : "row", alignItems: isMobile ? "flex-start" : "center", gap: isMobile ? 12 : 0 }}>
        <div style={styles.onAirBadge}>
          <span style={styles.onAirDot} />
          ON AIR · 방송부 관리
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {TABS.map((t) => (
            <button
              key={t.key}
              style={{ ...styles.linkButton, ...(view === t.key ? styles.linkButtonActive : {}) }}
              onClick={() => setView(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>

      {loadError && (
        <div style={{ ...styles.messageBox, borderColor: "var(--signal)", color: "var(--signal)" }}>
          {loadError}
        </div>
      )}

      {view === "dashboard" && (
        <DashboardOverview
          requests={requests}
          onUpdate={updateRequests}
          onGoToList={goToList}
          onGoToView={setView}
          isMobile={isMobile}
        />
      )}

      {view === "blocklist" && (
        <BlocklistManager blocklist={blocklist} adminFetch={adminFetch} onChange={loadBlocklist} />
      )}

      {view === "calendar" && (
        <CalendarView requests={requests || []} onUpdate={updateRequests} isMobile={isMobile} />
      )}

      {view === "danger" && (
        <DangerZone adminFetch={adminFetch} onChange={loadRequests} />
      )}

      {view === "manual" && (
        <ManualAddForm
          adminFetch={adminFetch}
          onAdded={() => {
            loadRequests();
            setView("list");
            setFilter("approved");
          }}
        />
      )}

      {view === "list" && (
        <>
          <nav style={styles.filterRow}>
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                style={{
                  ...styles.filterButton,
                  ...(filter === f.key ? styles.filterButtonActive : {}),
                }}
              >
                {f.label}
                {requests && f.key !== "all" && (
                  <span style={styles.filterCount}>
                    {requests.filter((r) => r.status === f.key).length}
                  </span>
                )}
              </button>
            ))}
          </nav>

          {groups && groups.length > 1 && (
            <SortBar value={listSort} onChange={setListSort} />
          )}

          {filtered === null && <p style={styles.hint}>불러오는 중…</p>}
          {filtered && filtered.length === 0 && (
            <p style={styles.hint}>해당 상태의 신청이 없습니다.</p>
          )}
          {groups && groups.length < filtered.length && (
            <p style={styles.groupNotice}>
              같은 곡을 여러 명이 신청한 건은 하나로 묶어서 보여줍니다 —
              신청 {filtered.length}건이 곡 {groups.length}개로 정리됐습니다.
              승인·반려는 묶인 신청 전체에 한 번에 적용됩니다.
            </p>
          )}

          <ul style={styles.list}>
            {groups?.map((group) => (
              <RequestCard
                key={group[0].id}
                group={group}
                onUpdate={updateRequests}
                onDelete={deleteRequests}
                isMobile={isMobile}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// 오늘 날짜를 "YYYY-MM-DD"로. scheduled_date가 Postgres date 타입이라
// UTC 기준으로 변환하면 한국 시간 기준 날짜와 하루가 어긋날 수 있어 로컬 기준으로 직접 만듭니다.
function localDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

// "2026-08-04" → "8월 4일 (화)". 대시보드에서는 연도까지 읽을 이유가 없고,
// 요일이 있어야 "내일이 토요일이라 방송이 없네" 같은 판단이 바로 됩니다.
function friendlyDate(dateKey) {
  if (!dateKey) return "";
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  if (Number.isNaN(date.getTime())) return dateKey;
  return `${m}월 ${d}일 (${WEEKDAYS[date.getDay()]})`;
}

function DashboardOverview({ requests, onUpdate, onGoToList, onGoToView, isMobile }) {
  if (requests === null) {
    return <p style={styles.hint}>불러오는 중…</p>;
  }

  const today = localDateKey(new Date());

  const by = (status) => requests.filter((r) => r.status === status);
  const pending = by("pending");
  const approved = by("approved"); // 승인은 됐지만 아직 날짜가 안 잡힌 곡
  const scheduled = by("scheduled");
  const played = by("played");

  // 확인이 필요한 곡 = 자동 필터에 걸린 것 중 아직 판단 안 한 것.
  // 이미 승인/반려한 곡까지 세면 "처리해야 할 일"이 아닌데도 숫자가 줄지 않습니다.
  const needsReview = pending.filter((r) => r.needs_review);

  // 여러 명이 신청한 곡은 전원 승인되므로, 화면에는 곡 단위로 한 번만 보여야 합니다.
  const todaySongs = dedupeBySong(scheduled.filter((r) => r.scheduled_date === today));
  const upcoming = dedupeBySong(
    scheduled
      .filter((r) => r.scheduled_date && r.scheduled_date > today)
      .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date))
  );
  // 날짜가 지났는데 아직 "방송 완료" 처리를 안 한 곡. 그냥 두면 예정 목록에 계속 쌓입니다.
  const overdue = dedupeBySong(
    scheduled
      .filter((r) => r.scheduled_date && r.scheduled_date < today)
      .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date))
  );

  // 검토 대기도 곡 단위로 묶어서 보여줍니다. 같은 곡이 여러 줄 뜨면 몇 곡이 밀렸는지 알기 어렵습니다.
  const pendingGroups = groupBySong(pending);
  const recentPending = pendingGroups.slice(0, 5);

  // 인기 신청곡: 여러 명이 신청한 곡을 신청자 수 순으로.
  // 방송부가 "많이 원하는 곡"을 먼저 배정할 수 있게 하고,
  // 동시에 중복 신청을 손으로 반려할 이유 자체를 없앱니다.
  const popular = groupBySong(
    requests.filter((r) => r.status !== "rejected")
  )
    .filter((g) => g.length > 1)
    .sort((a, b) => b.length - a.length)
    .slice(0, 5);

  return (
    <div style={styles.dash}>
      {/* 히어로: 이 화면에서 제일 먼저 알아야 하는 단 하나의 숫자 */}
      <section
        style={{
          ...styles.heroCard,
          flexDirection: isMobile ? "column" : "row",
          alignItems: isMobile ? "flex-start" : "center",
        }}
      >
        <div>
          <div style={styles.heroLabel}>검토 대기 중인 신청</div>
          <div style={styles.heroValue}>
            {pending.length}
            <span style={styles.heroUnit}>건</span>
          </div>
          <div style={styles.heroSub}>
            {pending.length === 0
              ? "밀린 신청이 없습니다. 잘 하고 있어요."
              : needsReview.length > 0
              ? `이 중 ${needsReview.length}건은 확인이 필요한 곡입니다.`
              : "자동 필터에 걸린 곡은 없습니다."}
          </div>
        </div>
        {pending.length > 0 && (
          <button style={styles.heroButton} onClick={() => onGoToList("pending")}>
            검토하러 가기 →
          </button>
        )}
      </section>

      {/* KPI 줄: 나머지 상태를 한눈에. 누르면 해당 필터가 걸린 목록으로 이동합니다. */}
      <div style={{ ...styles.statRow, gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)" }}>
        <StatTile
          label="확인 필요"
          value={needsReview.length}
          tone={needsReview.length > 0 ? "warn" : "muted"}
          note={needsReview.length > 0 ? "직접 들어보기" : "없음"}
          onClick={() => onGoToList("pending")}
        />
        <StatTile
          label="배정 대기"
          value={approved.length}
          tone={approved.length > 0 ? "accent" : "muted"}
          note={approved.length > 0 ? "날짜 미정" : "없음"}
          onClick={() => onGoToList("approved")}
        />
        <StatTile
          label="방송 예정"
          value={scheduled.length}
          tone="ok"
          note="날짜 배정됨"
          onClick={() => onGoToList("scheduled")}
        />
        <StatTile
          label="방송 완료"
          value={played.length}
          tone="muted"
          note="누적"
          onClick={() => onGoToList("played")}
        />
      </div>

      <div style={{ ...styles.dashGrid, columnCount: isMobile ? 1 : 2 }}>
        {/* 오늘 나갈 곡 */}
        <Panel
          title="오늘의 기상곡"
          badge={friendlyDate(today)}
          action={{ label: "달력 보기", onClick: () => onGoToView("calendar") }}
        >
          {todaySongs.length === 0 ? (
            <EmptyNote>
              오늘 배정된 곡이 없습니다.
              {approved.length > 0 && ` 배정 대기 중인 승인곡이 ${approved.length}곡 있습니다.`}
            </EmptyNote>
          ) : (
            todaySongs.map((r) => (
              <SongRow
                key={r.id}
                request={r}
                highlight
                action={
                  <button style={styles.rowButton} onClick={() => onUpdate(ids, { status: "played" })}>
                    방송 완료
                  </button>
                }
              />
            ))
          )}
        </Panel>

        {/* 다가오는 방송 */}
        <Panel title="다가오는 방송" badge={`${upcoming.length}곡`}>
          {upcoming.length === 0 ? (
            <EmptyNote>예정된 곡이 아직 없습니다.</EmptyNote>
          ) : (
            upcoming.slice(0, 4).map((r) => (
              <SongRow key={r.id} request={r} meta={friendlyDate(r.scheduled_date)} />
            ))
          )}
          {upcoming.length > 4 && (
            <button style={styles.moreButton} onClick={() => onGoToList("scheduled")}>
              전체 {upcoming.length}곡 보기 →
            </button>
          )}
        </Panel>

        {/* 방송일이 지났는데 완료 처리가 안 된 곡 */}
        {overdue.length > 0 && (
          <Panel title="완료 처리가 안 된 곡" badge={`${overdue.length}곡`} tone="warn">
            {overdue.slice(0, 4).map((r) => (
              <SongRow
                key={r.id}
                request={r}
                meta={`${friendlyDate(r.scheduled_date)} 예정이었음`}
                action={
                  <button style={styles.rowButton} onClick={() => onUpdate(ids, { status: "played" })}>
                    방송 완료
                  </button>
                }
              />
            ))}
          </Panel>
        )}

        {/* 인기 신청곡 — 여러 명이 원한 곡을 먼저 배정할 수 있게 */}
        {popular.length > 0 && (
          <Panel title="인기 신청곡" badge={`${popular.length}곡`}>
            {popular.map((g) => (
              <SongRow
                key={g[0].id}
                request={g[0]}
                meta={`${g.length}명이 신청`}
                warn={g.some((x) => x.needs_review)}
              />
            ))}
          </Panel>
        )}

        {/* 최근 신청 - 여기서 바로 승인까지 끝낼 수 있게 */}
        <Panel
          title="최근 신청"
          badge={`${pendingGroups.length}곡 대기`}
          action={
            pendingGroups.length > 5
              ? { label: "전체 보기", onClick: () => onGoToList("pending") }
              : null
          }
        >
          {recentPending.length === 0 ? (
            <EmptyNote>검토할 신청이 없습니다.</EmptyNote>
          ) : (
            recentPending.map((g) => {
              const r = g[0];
              return (
                <SongRow
                  key={r.id}
                  request={r}
                  meta={
                    g.length > 1
                      ? `${g.length}명이 신청`
                      : r.student_id === "방송부"
                      ? "방송부 등록"
                      : `${r.student_id}@ushs.hs.kr`
                  }
                  warn={g.some((x) => x.needs_review)}
                  action={
                    <button
                      style={styles.rowApprove}
                      onClick={() => onUpdate(g.map((x) => x.id), { status: "approved" })}
                    >
                      승인
                    </button>
                  }
                />
              );
            })
          )}
        </Panel>
      </div>
    </div>
  );
}

function StatTile({ label, value, note, tone = "muted", onClick }) {
  const toneColor = {
    ok: "var(--ok)",
    warn: "var(--signal)",
    accent: "var(--dawn)",
    muted: "var(--paper-dim)",
  }[tone];

  return (
    <button className="onair-card" style={styles.statTile} onClick={onClick}>
      <span style={styles.statLabel}>{label}</span>
      <span style={{ ...styles.statValue, color: toneColor }}>{value}</span>
      <span style={styles.statNote}>{note}</span>
    </button>
  );
}

function Panel({ title, badge, action, tone, children }) {
  return (
    <section
      className="onair-card"
      style={{
        ...styles.panel,
        ...(tone === "warn" ? { borderColor: "var(--signal)" } : {}),
      }}
    >
      <div style={styles.panelHead}>
        <h2 style={styles.panelTitle}>{title}</h2>
        {badge && (
          <span
            style={{
              ...styles.panelBadge,
              ...(tone === "warn" ? { color: "var(--signal)", borderColor: "var(--signal)" } : {}),
            }}
          >
            {badge}
          </span>
        )}
        {action && (
          <button style={styles.panelAction} onClick={action.onClick}>
            {action.label}
          </button>
        )}
      </div>
      <div style={styles.panelBody}>{children}</div>
    </section>
  );
}

function SongRow({ request: r, meta, action, warn, highlight }) {
  return (
    <div style={{ ...styles.songRow, ...(highlight ? styles.songRowHighlight : {}) }}>
      {r.album_image_url ? (
        <img src={r.album_image_url} alt="" style={styles.songArt} />
      ) : (
        <div style={{ ...styles.songArt, background: "var(--ink-line)" }} />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={styles.songTitleRow}>
          <span style={styles.songTitle}>{r.title}</span>
          {/* 상태는 색만으로 구분하지 않고 항상 글자를 같이 둡니다. */}
          {warn && <span style={styles.songWarn}>⚠ 확인 필요</span>}
        </div>
        <div style={styles.songMeta}>
          {r.artist}
          {meta ? ` · ${meta}` : ""}
        </div>
      </div>
      {action}
    </div>
  );
}

function EmptyNote({ children }) {
  return <p style={styles.emptyNote}>{children}</p>;
}

function RequestCard({ group, onUpdate, onDelete, isMobile }) {
  // 같은 곡을 여러 명이 신청했으면 group에 여러 건이 들어옵니다.
  // 대표(r)는 가장 먼저 신청한 건이고, 처리는 항상 그룹 전체(ids)에 적용합니다.
  const r = group[0];
  const ids = group.map((x) => x.id);
  const multi = group.length > 1;

  const [scheduledDate, setScheduledDate] = useState(r.scheduled_date || "");
  const [rejectReason, setRejectReason] = useState(r.reject_reason || "");
  const [showReject, setShowReject] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // 플래그는 그룹 안 어느 건에서든 걸렸으면 표시합니다.
  // (같은 곡이라도 신청 시점에 따라 explicit 판정이 다르게 저장됐을 수 있습니다.)
  const flags = [];
  if (group.some((x) => x.itunes_explicit)) flags.push("iTunes explicit");
  if (group.some((x) => x.musixmatch_explicit)) flags.push("Musixmatch explicit");
  const kw = group.find((x) => x.keyword_flag);
  if (kw) flags.push(`자체 사전: "${kw.keyword_flag_reason}"`);
  const needsReview = group.some((x) => x.needs_review);

  const requesters = group
    .filter((x) => x.student_id !== "방송부")
    .map((x) => x.student_id);

  return (
    <li style={styles.card}>
      <div style={{ ...styles.cardTop, flexDirection: isMobile ? "column" : "row" }}>
        <div style={{ display: "flex", gap: 12, width: "100%" }}>
          {r.album_image_url ? (
            <img src={r.album_image_url} alt="" style={styles.albumArt} />
          ) : (
            <div style={{ ...styles.albumArt, background: "var(--ink-line)" }} />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={styles.cardTitleRow}>
              <span style={styles.cardTitle}>{r.title}</span>
              {multi && <span style={styles.countBadge}>{group.length}명이 신청</span>}
              {r.is_manual && r.student_id === "방송부" && (
                <span style={styles.manualBadge}>방송부 직접 등록</span>
              )}
              {r.is_manual && r.student_id !== "방송부" && (
                <span style={styles.manualBadge}>학생 직접 입력</span>
              )}
            </div>
            <div style={styles.cardArtist}>{r.artist}</div>
            <div style={styles.cardMeta}>
              {r.student_id === "방송부"
                ? `방송부 직접 등록 · ${new Date(r.created_at).toLocaleString("ko-KR")}`
                : multi
                ? `신청자 ${requesters.length}명: ${requesters.join(", ")} · 처음 신청 ${new Date(
                    r.created_at
                  ).toLocaleString("ko-KR")}`
                : `신청자: ${r.student_id}@ushs.hs.kr · ${new Date(r.created_at).toLocaleString("ko-KR")}${
                    r.is_manual ? " · 검색 없이 직접 입력한 곡" : ""
                  }`}
            </div>
            {multi && (
              <div style={styles.groupHint}>
                아래 처리는 {group.length}명 신청 전체에 함께 적용됩니다 (방송은 한 번만 나갑니다).
              </div>
            )}
          </div>
        </div>
      </div>

      {needsReview && (
        <div style={styles.warningBox}>
          ⚠ 확인 필요 — {flags.join(" · ")}
        </div>
      )}

      {r.preview_url ? (
        <div style={styles.previewWrap}>
          <AudioPreview src={r.preview_url} />
        </div>
      ) : (
        <p style={styles.noPreview}>
          {r.is_manual && r.student_id !== "방송부"
            ? "학생이 검색 없이 직접 입력한 곡이라 미리듣기가 없습니다. 곡명/아티스트를 직접 확인한 뒤 승인 여부를 결정해 주세요."
            : "미리듣기를 찾을 수 없습니다."}
        </p>
      )}

      {/* 아직 결정이 안 된 곡만 승인/반려 버튼 노출. 한 번 결정되면 다시 뜨지 않습니다. */}
      {r.status === "pending" && (
        <>
          <div style={{ ...styles.actionRow, flexDirection: isMobile ? "column" : "row" }}>
            <button
              style={{ ...styles.approveButton, width: isMobile ? "100%" : "auto" }}
              onClick={() => onUpdate(ids, { status: "approved" })}
            >
              승인
            </button>
            <button
              style={{ ...styles.rejectButton, width: isMobile ? "100%" : "auto" }}
              onClick={() => setShowReject((v) => !v)}
            >
              반려
            </button>
          </div>

          {showReject && (
            <>
              {/* 자주 쓰는 사유는 눌러서 채웁니다. 누른 뒤에도 자유롭게 고칠 수 있습니다.
                  매번 직접 타이핑하면 사람마다 문구가 달라져서 학생에게 가는 안내도 들쭉날쭉해집니다. */}
              <div style={styles.presetRow}>
                {REJECT_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    style={{
                      ...styles.presetButton,
                      ...(rejectReason === preset ? styles.presetButtonActive : {}),
                    }}
                    onClick={() => setRejectReason(preset)}
                  >
                    {preset}
                  </button>
                ))}
              </div>
              <div style={{ ...styles.rejectRow, flexDirection: isMobile ? "column" : "row" }}>
                <input
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  maxLength={MAX_TEXT_LENGTH}
                  placeholder="반려 사유 입력 (위에서 고르거나 직접 작성)"
                  style={styles.smallInput}
                />
                <button
                  style={{ ...styles.rejectButton, width: isMobile ? "100%" : "auto" }}
                  disabled={!rejectReason.trim()}
                  onClick={() => {
                    onUpdate(ids, { status: "rejected", rejectReason: rejectReason.trim() });
                    setShowReject(false);
                  }}
                >
                  반려 확정
                </button>
              </div>
              <p style={styles.rejectHint}>
                반려 사유는 학생에게 그대로 메일로 전달됩니다.
              </p>
            </>
          )}
        </>
      )}

      {/* 승인된 곡만 날짜 배정 UI 노출 */}
      {(r.status === "approved" || r.status === "scheduled") && (
        <div style={{ ...styles.scheduleRow, flexDirection: isMobile ? "column" : "row" }}>
          <input
            type="date"
            value={scheduledDate}
            onChange={(e) => setScheduledDate(e.target.value)}
            style={{ ...styles.smallInput, width: isMobile ? "100%" : "auto" }}
          />
          <button
            style={{ ...styles.scheduleButton, width: isMobile ? "100%" : "auto" }}
            onClick={() => onUpdate(ids, { status: "scheduled", scheduledDate })}
            disabled={!scheduledDate}
          >
            {r.status === "scheduled" ? "날짜 변경" : "이 날짜로 배정"}
          </button>
          {r.status === "scheduled" && (
            <button
              style={{ ...styles.playedButton, width: isMobile ? "100%" : "auto" }}
              onClick={() => onUpdate(ids, { status: "played" })}
            >
              방송 완료 처리
            </button>
          )}
        </div>
      )}

      {/* 반려/완료된 곡은 상태만 표시 */}
      {(r.status === "rejected" || r.status === "played") && (
        <div style={styles.decidedTag}>
          {r.status === "rejected" ? `반려됨${r.reject_reason ? ` · ${r.reject_reason}` : ""}` : "방송 완료"}
        </div>
      )}

      {/* 개별 삭제는 위험 작업이라 항상 2단계 확인 */}
      <div style={styles.deleteRow}>
        {confirmDelete ? (
          <>
            <span style={styles.deleteConfirmText}>정말 삭제할까요? 되돌릴 수 없습니다.</span>
            <button style={styles.deleteConfirmButton} onClick={() => onDelete(ids)}>
              삭제 확정
            </button>
            <button style={styles.linkButton} onClick={() => setConfirmDelete(false)}>
              취소
            </button>
          </>
        ) : (
          <button style={styles.deleteLinkButton} onClick={() => setConfirmDelete(true)}>
            이 신청 삭제
          </button>
        )}
      </div>
    </li>
  );
}

function CalendarView({ requests, onUpdate, isMobile }) {
  const [monthCursor, setMonthCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [pickerFor, setPickerFor] = useState(null);
  const [pickerSort, setPickerSort] = useState("oldest"); // 배정 창 정렬 기준

  const year = monthCursor.getFullYear();
  const month = monthCursor.getMonth();
  const firstDay = new Date(year, month, 1);
  const startWeekday = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const scheduledByDate = {};
  requests
    .filter((r) => r.status === "scheduled" || r.status === "played")
    .forEach((r) => {
      if (!r.scheduled_date) return;
      if (!scheduledByDate[r.scheduled_date]) scheduledByDate[r.scheduled_date] = [];
      scheduledByDate[r.scheduled_date].push(r);
    });
  // 여러 명이 신청한 곡은 전원 승인되지만 방송은 한 번뿐이라, 달력에도 한 번만 표시합니다.
  for (const date of Object.keys(scheduledByDate)) {
    scheduledByDate[date] = dedupeBySong(scheduledByDate[date]);
  }

  // 배정 후보도 곡 단위로 묶습니다. 같은 곡이 목록에 여러 번 뜨면 어느 걸 눌러야 할지 모호합니다.
  const approvedGroups = sortGroups(
    groupBySong(requests.filter((r) => r.status === "approved")),
    pickerSort
  );

  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  function dateKey(day) {
    const mm = String(month + 1).padStart(2, "0");
    const dd = String(day).padStart(2, "0");
    return `${year}-${mm}-${dd}`;
  }

  return (
    <div>
      <div style={styles.calendarHeader}>
        <button style={styles.linkButton} onClick={() => setMonthCursor(new Date(year, month - 1, 1))}>
          ← 이전 달
        </button>
        <span style={styles.calendarTitle}>
          {year}년 {month + 1}월
        </span>
        <button style={styles.linkButton} onClick={() => setMonthCursor(new Date(year, month + 1, 1))}>
          다음 달 →
        </button>
      </div>

      <div style={styles.calendarGrid}>
        {["일", "월", "화", "수", "목", "금", "토"].map((w) => (
          <div key={w} style={styles.calendarWeekday}>{w}</div>
        ))}
        {cells.map((day, idx) => {
          if (day === null) return <div key={idx} style={styles.calendarCellEmpty} />;
          const key = dateKey(day);
          const songs = scheduledByDate[key] || [];
          return (
            <div
              key={idx}
              style={{ ...styles.calendarCell, minHeight: isMobile ? 52 : 70 }}
              onClick={() => approvedGroups.length > 0 && setPickerFor(key)}
            >
              <div style={styles.calendarDayNum}>{day}</div>
              {songs.map((s) => (
                <div key={s.id} style={styles.calendarSongTag} title={`${s.title} - ${s.artist}`}>
                  {s.status === "played" ? "✓ " : ""}{isMobile ? "" : s.title}
                  {isMobile && <span style={styles.calendarDotMobile} />}
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {approvedGroups.length === 0 && (
        <p style={styles.hint}>배정 대기 중인 승인곡이 없습니다. 날짜 칸을 눌러도 배정할 곡이 없으면 반응하지 않습니다.</p>
      )}

      {pickerFor && (
        <div style={styles.modalOverlay} onClick={() => setPickerFor(null)}>
          <div style={styles.modalBox} onClick={(e) => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>{pickerFor}에 배정할 곡 선택</h3>
            {approvedGroups.length > 1 && (
              <SortBar value={pickerSort} onChange={setPickerSort} />
            )}
            <ul style={styles.list}>
              {approvedGroups.map((g) => (
                <li key={g[0].id} style={styles.modalSongRow}>
                  <span>
                    {g[0].title} · {g[0].artist}
                    {g.length > 1 && <span style={styles.modalCount}> ({g.length}명)</span>}
                  </span>
                  <button
                    style={styles.scheduleButton}
                    onClick={() => {
                      onUpdate(g.map((x) => x.id), { status: "scheduled", scheduledDate: pickerFor });
                      setPickerFor(null);
                    }}
                  >
                    배정
                  </button>
                </li>
              ))}
            </ul>
            <button style={styles.rejectButton} onClick={() => setPickerFor(null)}>닫기</button>
          </div>
        </div>
      )}
    </div>
  );
}

function BlocklistManager({ blocklist, adminFetch, onChange }) {
  const [newKeyword, setNewKeyword] = useState("");
  const [error, setError] = useState(null);

  async function addKeyword() {
    if (!newKeyword.trim()) return;
    setError(null);
    try {
      await adminFetch("/api/admin/blocklist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword: newKeyword.trim() }),
      });
      setNewKeyword("");
      onChange();
    } catch (err) {
      setError(err.message);
    }
  }

  async function removeKeyword(id) {
    setError(null);
    try {
      await adminFetch(`/api/admin/blocklist?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      onChange();
    } catch (err) {
      setError(`삭제에 실패했습니다: ${err.message}`);
    }
  }

  return (
    <div>
      <p style={styles.hint}>
        곡명/아티스트명에 포함되면 자동으로 "확인 필요" 표시가 붙는 키워드 사전입니다.
        가사 전체가 아닌 곡 제목·아티스트명만 검사합니다.
      </p>
      <div style={styles.scheduleRow}>
        <input
          value={newKeyword}
          onChange={(e) => setNewKeyword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addKeyword()}
          maxLength={MAX_KEYWORD_LENGTH}
          placeholder="키워드 추가"
          style={styles.smallInput}
        />
        <button style={styles.approveButton} onClick={addKeyword}>
          추가
        </button>
      </div>
      {error && <p style={styles.errorText}>{error}</p>}
      <ul style={styles.list}>
        {blocklist.map((k) => (
          <li key={k.id} style={styles.keywordRow}>
            <span>{k.keyword}</span>
            <button style={styles.rejectButton} onClick={() => removeKeyword(k.id)}>
              삭제
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ManualAddForm({ adminFetch, onAdded }) {
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [albumImageUrl, setAlbumImageUrl] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [reviewedBy, setReviewedBy] = useState("");
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!title.trim() || !artist.trim()) {
      setMessage({ type: "error", text: "곡 제목과 아티스트는 필수입니다." });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const data = await adminFetch("/api/admin/manual-add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          artist,
          albumImageUrl,
          previewUrl,
          reviewedBy,
        }),
      });
      setMessage({ type: "success", text: `"${data.request.title}"이(가) 승인 상태로 등록되었습니다.` });
      setTitle("");
      setArtist("");
      setAlbumImageUrl("");
      setPreviewUrl("");
      onAdded();
    } catch (err) {
      setMessage({ type: "error", text: err.message || "등록 중 문제가 발생했습니다." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p style={styles.hint}>
        iTunes 검색에 안 잡히는 곡(국내 유통 계약 미체결 등)을 방송부가 직접 등록합니다.
        여기서 등록한 곡은 학생 검토 절차 없이 <b>바로 승인(approved)</b> 상태로 들어가며,
        곧바로 "목록" 탭이나 "달력" 탭에서 날짜 배정이 가능합니다.
      </p>

      {message && (
        <div
          style={{
            ...styles.messageBox,
            borderColor: message.type === "error" ? "var(--signal)" : "var(--ok)",
            color: message.type === "error" ? "var(--signal)" : "var(--ok)",
          }}
        >
          {message.text}
        </div>
      )}

      <div style={styles.manualForm}>
        <label style={styles.manualLabel}>
          곡 제목 <span style={styles.requiredMark}>*</span>
        </label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={MAX_TEXT_LENGTH}
          placeholder="예: 곡예사"
          style={styles.manualInput}
        />

        <label style={styles.manualLabel}>
          아티스트 <span style={styles.requiredMark}>*</span>
        </label>
        <input
          value={artist}
          onChange={(e) => setArtist(e.target.value)}
          maxLength={MAX_TEXT_LENGTH}
          placeholder="예: 아티스트명"
          style={styles.manualInput}
        />

        <label style={styles.manualLabel}>앨범아트 이미지 URL (선택)</label>
        <input
          value={albumImageUrl}
          onChange={(e) => setAlbumImageUrl(e.target.value)}
          placeholder="https://..."
          style={styles.manualInput}
        />

        <label style={styles.manualLabel}>미리듣기 오디오 URL (선택)</label>
        <input
          value={previewUrl}
          onChange={(e) => setPreviewUrl(e.target.value)}
          placeholder="https://... (mp3 등 직접 재생 가능한 링크)"
          style={styles.manualInput}
        />

        <label style={styles.manualLabel}>등록 담당자 (선택)</label>
        <input
          value={reviewedBy}
          onChange={(e) => setReviewedBy(e.target.value)}
          maxLength={MAX_TEXT_LENGTH}
          placeholder="예: 방송부 3학년 아무개"
          style={styles.manualInput}
        />

        <button style={{ ...styles.primaryButton, marginTop: 14 }} disabled={busy} onClick={submit}>
          {busy ? "등록 중…" : "곡 등록하기"}
        </button>
      </div>
    </div>
  );
}

function DangerZone({ adminFetch, onChange }) {
  const [confirmText, setConfirmText] = useState("");
  const [pendingScope, setPendingScope] = useState(null); // "played" | "rejected" | "all"
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  const SCOPE_LABEL = {
    played: "방송 완료된 곡만",
    rejected: "반려된 곡만",
    all: "전체 신청 데이터 (승인/대기/예정 포함 전부)",
  };

  async function runReset(scope) {
    setBusy(true);
    setMessage(null);
    try {
      await adminFetch("/api/admin/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, confirmText }),
      });
      setMessage({ type: "success", text: "삭제가 완료되었습니다." });
      setPendingScope(null);
      setConfirmText("");
      onChange();
    } catch (err) {
      setMessage({ type: "error", text: err.message || "삭제 중 문제가 발생했습니다." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div style={styles.dangerWarning}>
        ⚠ 이 화면의 작업은 되돌릴 수 없습니다. 신청곡 데이터베이스 자체를 삭제하는 기능이며,
        비속어 사전은 영향을 받지 않습니다.
      </div>

      {message && (
        <div
          style={{
            ...styles.messageBox,
            borderColor: message.type === "error" ? "var(--signal)" : "var(--ok)",
            color: message.type === "error" ? "var(--signal)" : "var(--ok)",
          }}
        >
          {message.text}
        </div>
      )}

      <div style={styles.dangerOptionList}>
        {["played", "rejected", "all"].map((scope) => (
          <div key={scope} style={styles.dangerOptionCard}>
            <div style={styles.dangerOptionLabel}>{SCOPE_LABEL[scope]} 삭제</div>
            {pendingScope === scope ? (
              <div style={styles.dangerConfirmBox}>
                <p style={styles.dangerConfirmText}>
                  아래 입력창에 <b>삭제확인</b> 이라고 정확히 입력하면 삭제가 실행됩니다.
                </p>
                <input
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder="삭제확인"
                  style={styles.smallInput}
                />
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button
                    style={styles.deleteConfirmButton}
                    disabled={busy || confirmText !== "삭제확인"}
                    onClick={() => runReset(scope)}
                  >
                    {busy ? "삭제 중…" : "최종 삭제 실행"}
                  </button>
                  <button
                    style={styles.linkButton}
                    onClick={() => {
                      setPendingScope(null);
                      setConfirmText("");
                    }}
                  >
                    취소
                  </button>
                </div>
              </div>
            ) : (
              <button style={styles.deleteLinkButton} onClick={() => setPendingScope(scope)}>
                삭제 진행
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const styles = {
  // ---------- 대시보드 ----------
  dash: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
  },
  heroCard: {
    display: "flex",
    justifyContent: "space-between",
    gap: 16,
    background: "var(--ink-soft)",
    border: "1px solid var(--ink-line)",
    borderRadius: 16,
    padding: "22px 24px",
  },
  heroLabel: {
    fontSize: 13,
    color: "var(--paper-dim)",
    fontWeight: 600,
    marginBottom: 6,
  },
  heroValue: {
    // 이 화면이 이끄는 단 하나의 숫자. 본문과 같은 sans를 그대로 쓰고 크기로만 위계를 만듭니다.
    fontSize: 52,
    fontWeight: 700,
    lineHeight: 1,
    letterSpacing: "-0.02em",
    color: "var(--paper)",
  },
  heroUnit: {
    fontSize: 20,
    fontWeight: 600,
    color: "var(--paper-dim)",
    marginLeft: 4,
  },
  heroSub: {
    fontSize: 13,
    color: "var(--paper-dim)",
    marginTop: 10,
  },
  heroButton: {
    flexShrink: 0,
    background: "var(--dawn)",
    color: "var(--ink)",
    border: "none",
    borderRadius: 10,
    padding: "11px 18px",
    fontSize: 14,
    fontWeight: 700,
    cursor: "pointer",
  },
  statRow: {
    display: "grid",
    gap: 10,
  },
  statTile: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 4,
    background: "var(--ink-soft)",
    border: "1px solid var(--ink-line)",
    borderRadius: 14,
    padding: "14px 16px",
    cursor: "pointer",
    textAlign: "left",
  },
  statLabel: {
    fontSize: 12,
    color: "var(--paper-dim)",
    fontWeight: 600,
  },
  statValue: {
    fontSize: 28,
    fontWeight: 700,
    lineHeight: 1.1,
  },
  statNote: {
    fontSize: 11,
    color: "var(--paper-dim)",
  },
  // grid로 2열을 만들면 같은 줄에 놓인 두 패널의 높이가 강제로 같아져서,
  // 내용이 짧은 쪽(예: 오늘 곡 1개) 아래에 큰 빈칸이 생깁니다.
  // 멀티컬럼으로 흘려보내면 패널이 자기 높이만 차지하면서 위아래로 촘촘히 쌓입니다.
  dashGrid: {
    columnGap: 12,
  },
  panel: {
    background: "var(--ink-soft)",
    border: "1px solid var(--ink-line)",
    borderRadius: 14,
    padding: 16,
    // 패널이 두 열에 걸쳐 잘리지 않도록
    breakInside: "avoid",
    marginBottom: 12,
  },
  panelHead: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  panelTitle: {
    fontSize: 14,
    fontWeight: 700,
    margin: 0,
  },
  panelBadge: {
    fontSize: 11,
    fontWeight: 600,
    color: "var(--paper-dim)",
    border: "1px solid var(--ink-line)",
    borderRadius: 999,
    padding: "2px 8px",
  },
  panelAction: {
    marginLeft: "auto",
    background: "none",
    border: "none",
    color: "var(--dawn)",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    padding: 0,
  },
  panelBody: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  songRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 10px",
    borderRadius: 10,
    background: "var(--ink)",
  },
  songRowHighlight: {
    border: "1px solid var(--dawn)",
    background: "rgba(255,180,84,0.08)",
  },
  songArt: {
    width: 38,
    height: 38,
    borderRadius: 8,
    objectFit: "cover",
    flexShrink: 0,
    border: "1px solid var(--ink-line)",
  },
  songTitleRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  songTitle: {
    fontSize: 13,
    fontWeight: 600,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    // flex 자식은 기본적으로 내용보다 작아지지 않아서, 이게 없으면
    // 제목이 긴 곡에서 말줄임이 안 걸리고 카드 밖으로 삐져나갑니다.
    minWidth: 0,
  },
  songWarn: {
    fontSize: 10,
    fontWeight: 700,
    color: "var(--signal)",
    border: "1px solid var(--signal)",
    borderRadius: 4,
    padding: "0 5px",
    flexShrink: 0,
  },
  songMeta: {
    fontSize: 11,
    color: "var(--paper-dim)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    marginTop: 2,
  },
  rowButton: {
    flexShrink: 0,
    background: "none",
    border: "1px solid var(--ink-line)",
    color: "var(--paper-dim)",
    borderRadius: 8,
    padding: "6px 10px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
  rowApprove: {
    flexShrink: 0,
    background: "var(--ok)",
    color: "var(--ink)",
    border: "none",
    borderRadius: 8,
    padding: "6px 12px",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
  },
  moreButton: {
    background: "none",
    border: "none",
    color: "var(--dawn)",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    padding: "6px 0 0",
    textAlign: "left",
  },
  emptyNote: {
    fontSize: 12,
    color: "var(--paper-dim)",
    margin: 0,
    padding: "10px 2px",
    lineHeight: 1.6,
  },

  loginPage: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  loginCard: {
    width: 320,
    maxWidth: "90vw",
    background: "var(--ink-soft)",
    border: "1px solid var(--ink-line)",
    borderRadius: 16,
    padding: 28,
    textAlign: "center",
  },
  loginTitle: {
    fontFamily: "var(--font-display)",
    fontSize: 20,
    margin: "16px 0 20px",
  },
  loginInput: {
    width: "100%",
    background: "var(--ink)",
    border: "1px solid var(--ink-line)",
    borderRadius: 10,
    padding: "12px 14px",
    color: "var(--paper)",
    fontSize: 15,
    marginBottom: 12,
    outline: "none",
  },
  primaryButton: {
    width: "100%",
    background: "var(--dawn)",
    color: "var(--ink)",
    border: "none",
    borderRadius: 10,
    padding: "12px 0",
    fontWeight: 700,
    fontSize: 15,
    cursor: "pointer",
  },
  errorText: {
    color: "var(--signal)",
    fontSize: 13,
    marginBottom: 10,
  },
  page: {
    maxWidth: 720,
    margin: "0 auto",
  },
  dashHeader: {
    display: "flex",
    justifyContent: "space-between",
    marginBottom: 24,
  },
  onAirBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    fontFamily: "var(--font-display)",
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.14em",
    color: "var(--signal)",
    border: "1px solid var(--signal)",
    borderRadius: 999,
    padding: "5px 12px",
  },
  onAirDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "var(--signal)",
    boxShadow: "0 0 8px var(--signal)",
  },
  linkButton: {
    background: "none",
    border: "1px solid var(--ink-line)",
    color: "var(--dawn)",
    fontSize: 13,
    cursor: "pointer",
    fontWeight: 600,
    borderRadius: 8,
    padding: "8px 14px",
  },
  linkButtonActive: {
    background: "var(--dawn)",
    color: "var(--ink)",
    borderColor: "var(--dawn)",
  },
  filterRow: {
    display: "flex",
    gap: 6,
    flexWrap: "wrap",
    marginBottom: 20,
  },
  filterButton: {
    background: "var(--ink-soft)",
    border: "1px solid var(--ink-line)",
    color: "var(--paper-dim)",
    borderRadius: 999,
    padding: "7px 14px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  filterButtonActive: {
    background: "var(--dawn)",
    color: "var(--ink)",
    borderColor: "var(--dawn)",
  },
  filterCount: {
    fontSize: 11,
    opacity: 0.8,
  },
  hint: {
    color: "var(--paper-dim)",
    fontSize: 14,
    padding: "20px 0",
    lineHeight: 1.6,
  },
  messageBox: {
    border: "1px solid",
    borderRadius: 10,
    padding: "10px 14px",
    fontSize: 13,
    marginBottom: 14,
  },
  list: {
    listStyle: "none",
    padding: 0,
    margin: 0,
    display: "flex",
    flexDirection: "column",
    gap: 14,
  },
  card: {
    background: "var(--ink-soft)",
    border: "1px solid var(--ink-line)",
    borderRadius: 14,
    padding: 16,
  },
  cardTop: {
    display: "flex",
    gap: 12,
    marginBottom: 10,
  },
  albumArt: {
    width: 56,
    height: 56,
    borderRadius: 8,
    objectFit: "cover",
    flexShrink: 0,
  },
  cardTitleRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: 700,
  },
  sortBar: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
    marginBottom: 12,
  },
  sortLabel: {
    fontSize: 12,
    color: "var(--paper-dim)",
    marginRight: 2,
  },
  sortButton: {
    background: "none",
    border: "1px solid var(--ink-line)",
    color: "var(--paper-dim)",
    borderRadius: 999,
    padding: "5px 12px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
  sortButtonActive: {
    background: "var(--dawn)",
    borderColor: "var(--dawn)",
    color: "var(--ink)",
  },
  countBadge: {
    fontSize: 10,
    fontWeight: 700,
    background: "rgba(255,180,84,0.15)",
    color: "var(--dawn)",
    border: "1px solid var(--dawn)",
    borderRadius: 4,
    padding: "1px 6px",
    flexShrink: 0,
  },
  groupHint: {
    fontSize: 11,
    color: "var(--dawn)",
    marginTop: 6,
  },
  groupNotice: {
    fontSize: 12,
    color: "var(--paper-dim)",
    background: "var(--ink-soft)",
    border: "1px solid var(--ink-line)",
    borderRadius: 10,
    padding: "9px 14px",
    margin: "0 0 14px",
    lineHeight: 1.6,
  },
  modalCount: {
    color: "var(--paper-dim)",
    fontSize: 12,
  },
  manualBadge: {
    fontSize: 10,
    fontWeight: 700,
    background: "rgba(95,208,167,0.15)",
    color: "var(--ok)",
    borderRadius: 4,
    padding: "2px 6px",
  },
  cardArtist: {
    fontSize: 13,
    color: "var(--paper-dim)",
  },
  cardMeta: {
    fontSize: 11,
    color: "var(--paper-dim)",
    marginTop: 4,
  },
  warningBox: {
    background: "rgba(255,90,78,0.12)",
    border: "1px solid var(--signal)",
    color: "var(--signal)",
    borderRadius: 8,
    padding: "8px 12px",
    fontSize: 12,
    marginBottom: 10,
    fontWeight: 600,
  },
  previewWrap: {
    marginBottom: 12,
  },
  noPreview: {
    fontSize: 12,
    color: "var(--paper-dim)",
    marginBottom: 12,
  },
  actionRow: {
    display: "flex",
    gap: 8,
    marginBottom: 8,
  },
  approveButton: {
    background: "var(--ok)",
    color: "var(--ink)",
    border: "none",
    borderRadius: 8,
    padding: "9px 16px",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
  },
  rejectButton: {
    background: "none",
    color: "var(--signal)",
    border: "1px solid var(--signal)",
    borderRadius: 8,
    padding: "9px 16px",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
  },
  rejectRow: {
    display: "flex",
    gap: 8,
    marginBottom: 10,
  },
  presetRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 8,
  },
  presetButton: {
    background: "none",
    border: "1px solid var(--ink-line)",
    color: "var(--paper-dim)",
    borderRadius: 999,
    padding: "5px 11px",
    fontSize: 12,
    cursor: "pointer",
  },
  presetButtonActive: {
    borderColor: "var(--signal)",
    color: "var(--signal)",
  },
  rejectHint: {
    fontSize: 11,
    color: "var(--paper-dim)",
    margin: "0 0 8px",
  },
  scheduleRow: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    flexWrap: "wrap",
  },
  smallInput: {
    flex: 1,
    background: "var(--ink)",
    border: "1px solid var(--ink-line)",
    borderRadius: 8,
    padding: "9px 12px",
    color: "var(--paper)",
    fontSize: 13,
    outline: "none",
  },
  scheduleButton: {
    background: "var(--dawn)",
    color: "var(--ink)",
    border: "none",
    borderRadius: 8,
    padding: "9px 14px",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
  },
  playedButton: {
    background: "none",
    border: "1px solid var(--ink-line)",
    color: "var(--paper-dim)",
    borderRadius: 8,
    padding: "9px 14px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  decidedTag: {
    fontSize: 12,
    color: "var(--paper-dim)",
    fontWeight: 600,
    padding: "8px 0 0",
  },
  deleteRow: {
    marginTop: 10,
    paddingTop: 10,
    borderTop: "1px solid var(--ink-line)",
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  deleteLinkButton: {
    background: "none",
    border: "none",
    color: "var(--paper-dim)",
    fontSize: 12,
    cursor: "pointer",
    textDecoration: "underline",
    padding: 0,
  },
  deleteConfirmText: {
    fontSize: 12,
    color: "var(--signal)",
  },
  deleteConfirmButton: {
    background: "var(--signal)",
    color: "white",
    border: "none",
    borderRadius: 8,
    padding: "7px 12px",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
  },
  keywordRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    background: "var(--ink-soft)",
    border: "1px solid var(--ink-line)",
    borderRadius: 10,
    padding: "10px 14px",
    fontSize: 14,
  },
  calendarHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  calendarTitle: {
    fontFamily: "var(--font-display)",
    fontSize: 16,
    fontWeight: 700,
  },
  calendarGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(7, 1fr)",
    gap: 4,
  },
  calendarWeekday: {
    textAlign: "center",
    fontSize: 12,
    color: "var(--paper-dim)",
    fontWeight: 600,
    padding: "6px 0",
  },
  calendarCellEmpty: {
    minHeight: 70,
  },
  calendarCell: {
    background: "var(--ink-soft)",
    border: "1px solid var(--ink-line)",
    borderRadius: 8,
    padding: 6,
    cursor: "pointer",
    overflow: "hidden",
  },
  calendarDayNum: {
    fontSize: 12,
    color: "var(--paper-dim)",
    marginBottom: 4,
  },
  calendarSongTag: {
    fontSize: 10,
    background: "rgba(255,180,84,0.15)",
    color: "var(--dawn)",
    borderRadius: 4,
    padding: "2px 4px",
    marginBottom: 2,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  calendarDotMobile: {
    display: "inline-block",
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "var(--dawn)",
  },
  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.6)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
    padding: 16,
  },
  modalBox: {
    background: "var(--ink-soft)",
    border: "1px solid var(--ink-line)",
    borderRadius: 14,
    padding: 20,
    width: 320,
    maxWidth: "100%",
    maxHeight: "70vh",
    overflowY: "auto",
  },
  modalTitle: {
    fontSize: 15,
    fontWeight: 700,
    marginBottom: 12,
  },
  modalSongRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: 13,
    padding: "8px 0",
    borderBottom: "1px solid var(--ink-line)",
    gap: 8,
  },
  dangerWarning: {
    background: "rgba(255,90,78,0.1)",
    border: "1px solid var(--signal)",
    color: "var(--signal)",
    borderRadius: 10,
    padding: "12px 16px",
    fontSize: 13,
    marginBottom: 20,
    lineHeight: 1.6,
  },
  dangerOptionList: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  dangerOptionCard: {
    background: "var(--ink-soft)",
    border: "1px solid var(--ink-line)",
    borderRadius: 12,
    padding: 16,
  },
  dangerOptionLabel: {
    fontSize: 14,
    fontWeight: 600,
    marginBottom: 10,
  },
  dangerConfirmBox: {
    marginTop: 6,
  },
  dangerConfirmText: {
    fontSize: 12,
    color: "var(--paper-dim)",
    marginBottom: 8,
  },
  manualForm: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    background: "var(--ink-soft)",
    border: "1px solid var(--ink-line)",
    borderRadius: 14,
    padding: 20,
  },
  manualLabel: {
    fontSize: 12,
    color: "var(--paper-dim)",
    fontWeight: 600,
    marginTop: 8,
  },
  requiredMark: {
    color: "var(--signal)",
  },
  manualInput: {
    background: "var(--ink)",
    border: "1px solid var(--ink-line)",
    borderRadius: 8,
    padding: "10px 12px",
    color: "var(--paper)",
    fontSize: 14,
    outline: "none",
  },
};
