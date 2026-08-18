"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useIsMobile } from "@/lib/useIsMobile";
import AudioPreview from "@/app/components/AudioPreview";

const TABS = [
  { key: "search", label: "곡 신청" },
  { key: "mine", label: "내 신청 현황" },
  { key: "upcoming", label: "방송 예정곡" },
];

const STATUS_LABEL = {
  pending: { text: "검토 대기", color: "var(--paper-dim)" },
  approved: { text: "승인됨", color: "var(--ok)" },
  rejected: { text: "반려됨", color: "var(--signal)" },
  scheduled: { text: "방송 예정", color: "var(--dawn)" },
  played: { text: "방송 완료", color: "var(--paper-dim)" },
};

const UNKNOWN_STATUS = { text: "알 수 없음", color: "var(--paper-dim)" };

// 나중에 상태값이 하나 추가되어도 학생 화면이 통째로 깨지지 않도록 기본값을 둡니다.
function statusLabel(status) {
  return STATUS_LABEL[status] || UNKNOWN_STATUS;
}

// 서버(app/api/requests/route.js)의 STUDENT_ID_PATTERN과 같은 규칙입니다.
// 여기서 미리 막아야 학생이 신청 버튼을 누른 뒤에야 형식 오류를 보는 일이 없습니다.
const STUDENT_ID_PATTERN = /^[a-zA-Z0-9._-]{2,30}$/;
const MAX_STUDENT_ID_LENGTH = 30;
const MAX_QUERY_LENGTH = 100; // app/api/search/route.js와 동일
const MAX_SONG_TEXT_LENGTH = 200; // app/api/requests/route.js와 동일
const PAGE_SIZE = 10; // 검색 결과를 한 번에 보여주는 개수 ("더보기"로 이만큼씩 추가)

export default function StudentPage() {
  const isMobile = useIsMobile();
  const [studentId, setStudentId] = useState("");
  const [savedStudentId, setSavedStudentId] = useState("");
  const [tab, setTab] = useState("search");

  useEffect(() => {
    const saved = window.localStorage.getItem("onair_student_id");
    // 예전에 저장해 둔 값이 지금 규칙에 안 맞으면 다시 입력받습니다.
    if (saved && STUDENT_ID_PATTERN.test(saved)) {
      setStudentId(saved);
      setSavedStudentId(saved);
    }
  }, []);

  function handleSetStudentId(id) {
    const trimmed = id.trim();
    window.localStorage.setItem("onair_student_id", trimmed);
    setSavedStudentId(trimmed);
  }

  return (
    <div style={{ ...styles.page, padding: isMobile ? "0 14px 60px" : "0 20px 60px" }}>
      <Header />
      <IdentityBar
        studentId={studentId}
        setStudentId={setStudentId}
        savedStudentId={savedStudentId}
        onSave={handleSetStudentId}
      />

      <nav style={styles.tabs}>
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              ...styles.tabButton,
              ...(tab === t.key ? styles.tabButtonActive : {}),
            }}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main style={styles.main}>
        {tab === "search" && <SearchAndApply studentId={savedStudentId} isMobile={isMobile} />}
        {tab === "mine" && <MyRequests studentId={savedStudentId} isMobile={isMobile} />}
        {tab === "upcoming" && <UpcomingList isMobile={isMobile} />}
      </main>
    </div>
  );
}

function Header() {
  return (
    <header style={styles.header}>
      <div style={styles.onAirBadge}>
        <span style={styles.onAirDot} />
        ON AIR
      </div>
      <h1 style={styles.title}>아침 기상곡 신청</h1>
      <p style={styles.subtitle}>꿀팁: 국힙은 가수명 + 노래 제목 으로 검색하면 더 잘됨</p>
      <p style={styles.subtitle}>반드시 본인 이메일 사용하세요! (메일 전송됩니다)</p>
    </header>
  );
}

function IdentityBar({ studentId, setStudentId, savedStudentId, onSave }) {
  const [editing, setEditing] = useState(!savedStudentId);
  const [error, setError] = useState(null);

  function handleConfirm() {
    const trimmed = studentId.trim();
    if (!STUDENT_ID_PATTERN.test(trimmed)) {
      setError("영문/숫자 2~30자로 입력해 주세요. (@ 앞부분만, 예: 23105)");
      return;
    }
    setError(null);
    onSave(trimmed);
    setEditing(false);
  }

  if (!editing && savedStudentId) {
    return (
      <div style={styles.identityBar}>
        <span style={styles.identityText}>
          <b>{savedStudentId}</b>@ushs.hs.kr 로 신청 중
        </span>
        <button style={styles.linkButton} onClick={() => setEditing(true)}>
          변경
        </button>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ ...styles.identityEditRow, marginBottom: error ? 8 : 0 }}>
        <div style={styles.identityInputWrap}>
          <input
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleConfirm()}
            maxLength={MAX_STUDENT_ID_LENGTH}
            placeholder="예: 23105"
            style={styles.identityInput}
          />
          <span style={styles.identitySuffix}>@ushs.hs.kr</span>
        </div>
        <button style={styles.primaryButtonSmall} onClick={handleConfirm}>
          확인
        </button>
      </div>
      {error && <p style={styles.identityError}>{error}</p>}
    </div>
  );
}

function SearchAndApply({ studentId, isMobile }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [applyingId, setApplyingId] = useState(null);
  const [showManualForm, setShowManualForm] = useState(false);
  // 이미 신청한 곡은 버튼을 "신청됨"으로 바꿔 잠급니다.
  // 안 그러면 다시 눌렀을 때 서버가 409로 막으면서 "이미 신청한 곡입니다" 에러만 뜨는데,
  // 학생 입장에서는 방금 성공했는데 왜 에러가 나는지 알기 어렵습니다.
  const [appliedIds, setAppliedIds] = useState(() => new Set());
  // 서버는 최대 40곡까지 내려주지만 처음부터 다 펼치면 스크롤이 너무 길어집니다.
  // 10개만 보여주고, 찾는 곡이 없으면 "더보기"로 넓혀가게 합니다.
  // (더보기는 이미 받아온 결과를 펼치는 것뿐이라 API를 다시 호출하지 않습니다.)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  // 오늘 남은 신청 가능 개수. 신청 버튼을 누른 뒤에야 한도를 알게 되면 답답하므로 미리 보여줍니다.
  const [quota, setQuota] = useState(null);
  // 타이핑 중에는 여러 검색이 동시에 떠 있을 수 있고, 먼저 보낸 요청이 나중에 도착하면
  // 최신 검색 결과를 옛날 결과가 덮어씁니다. 가장 마지막 요청의 결과만 반영하려고 순번을 둡니다.
  const searchSeq = useRef(0);
  const debounceRef = useRef(null);

  const runSearch = useCallback(async (q, force = false) => {
      // 2글자 미만은 자동 검색(타이핑 중)에서는 건너뛰지만,
      // force=true(검색 버튼을 직접 눌렀을 때)는 1글자여도 그대로 검색합니다.
      if (q.trim().length < 1 || (!force && q.trim().length < 2)) {
        if (!q.trim()) {
          searchSeq.current += 1; // 진행 중이던 검색 결과가 뒤늦게 들어오지 않도록 무효화
          setResults([]);
          setVisibleCount(PAGE_SIZE);
          setLoading(false);
        }
        return;
      }
      const seq = ++searchSeq.current;
      setLoading(true);
      setMessage(null);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        if (seq !== searchSeq.current) return; // 이미 더 최신 검색이 시작됨
        setResults(data.tracks || []);
        setVisibleCount(PAGE_SIZE); // 새 검색이면 다시 처음 10개부터
        if (data.notice) {
          setMessage({ type: "notice", text: data.notice });
        }
      } catch {
        if (seq !== searchSeq.current) return;
        setMessage({ type: "error", text: "검색 중 문제가 발생했습니다." });
      } finally {
        if (seq === searchSeq.current) setLoading(false);
      }
    }, []);

  useEffect(() => {
    debounceRef.current = setTimeout(() => runSearch(query), 400);
    return () => clearTimeout(debounceRef.current);
  }, [query, runSearch]);

  // 이메일 앞자리를 바꾸면 다른 사람 기준이 되므로 "신청됨" 표시를 초기화합니다.
  useEffect(() => {
    setAppliedIds(new Set());
  }, [studentId]);

  // 남은 신청 가능 개수 조회 (실패해도 화면을 막지 않고 표시만 생략합니다)
  useEffect(() => {
    if (!studentId) {
      setQuota(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/requests?scope=quota&studentId=${encodeURIComponent(studentId)}`);
        const data = await res.json();
        if (!cancelled && res.ok) setQuota(data.quota);
      } catch {
        /* 표시용 부가 정보라 조용히 넘어갑니다 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  // 검색 버튼/엔터로 바로 검색할 때는 대기 중이던 자동 검색 타이머를 먼저 취소합니다.
  // 안 그러면 400ms 뒤에 똑같은 검색이 한 번 더 나가서 API 호출을 두 배로 씁니다.
  function searchNow() {
    clearTimeout(debounceRef.current);
    runSearch(query, true);
  }

  async function submitRequest(payload, applyKey) {
    if (!studentId) {
      setMessage({ type: "error", text: "먼저 이메일 앞자리를 입력해 주세요." });
      return false;
    }
    setApplyingId(applyKey);
    setMessage(null);
    try {
      const res = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId, ...payload }),
      });
      const data = await res.json();
      if (data.quota) setQuota(data.quota); // 한도 초과 응답에도 최신 값이 들어옵니다
      if (!res.ok) {
        setMessage({ type: "error", text: data.error || "신청에 실패했습니다." });
        return false;
      }
      setMessage({
        type: "success",
        text: `"${payload.title}" 신청이 접수되었습니다. 검토 결과는 학교 메일로 보내드립니다.`,
      });
      return true;
    } catch {
      setMessage({ type: "error", text: "신청 중 문제가 발생했습니다." });
      return false;
    } finally {
      setApplyingId(null);
    }
  }

  async function applySong(track) {
    const ok = await submitRequest(
      {
        itunesTrackId: track.itunesTrackId,
        title: track.title,
        artist: track.artist,
        albumImageUrl: track.albumImageUrl,
        previewUrl: track.previewUrl,
        explicit: track.explicit,
        isManual: false,
      },
      track.itunesTrackId
    );
    if (ok) {
      setAppliedIds((prev) => new Set(prev).add(track.itunesTrackId));
    }
  }

  return (
    <section>
      <div style={styles.searchRow}>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && searchNow()}
          maxLength={MAX_QUERY_LENGTH}
          placeholder="곡 제목이나 아티스트를 검색해 보세요 (한 글자는 검색 버튼 사용)"
          style={{ ...styles.searchInput, marginBottom: 0 }}
        />
        <button style={styles.searchButton} onClick={searchNow} disabled={!query.trim()}>
          검색
        </button>
      </div>

      {quota && (
        <div style={styles.quotaBar}>
          {quota.remaining > 0 ? (
            <>
              오늘 <b style={{ color: "var(--dawn)" }}>{quota.remaining}곡</b> 더 신청할 수 있어요
              <span style={styles.quotaDim}> · 하루 {quota.limit}곡까지</span>
            </>
          ) : (
            <span style={{ color: "var(--signal)" }}>
              오늘 신청 가능한 {quota.limit}곡을 모두 사용했습니다. 내일 다시 신청해 주세요.
            </span>
          )}
        </div>
      )}

      {message && (
        <div
          style={{
            ...styles.messageBox,
            borderColor:
              message.type === "error"
                ? "var(--signal)"
                : message.type === "notice"
                ? "var(--dawn)"
                : "var(--ok)",
            color:
              message.type === "error"
                ? "var(--signal)"
                : message.type === "notice"
                ? "var(--dawn)"
                : "var(--ok)",
          }}
        >
          {message.text}
        </div>
      )}

      {loading && <p style={styles.hint}>검색 중…</p>}

      <ul style={styles.resultList}>
        {results.slice(0, visibleCount).map((track) => (
          <li
            key={track.itunesTrackId}
            className="onair-card"
            style={{ ...styles.resultItem, flexDirection: isMobile ? "column" : "row", alignItems: isMobile ? "stretch" : "center" }}
          >
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start", width: "100%", minWidth: 0 }}>
              {track.albumImageUrl ? (
                <img src={track.albumImageUrl} alt="" style={styles.albumArt} />
              ) : (
                <div style={{ ...styles.albumArt, background: "var(--ink-line)" }} />
              )}
              <div style={{ ...styles.resultInfo, minWidth: 0 }}>
                <div style={styles.resultTitleRow}>
                  <span style={styles.resultTitle}>{track.title}</span>
                  {track.explicit && <span style={styles.explicitBadge}>19</span>}
                </div>
                <div style={styles.resultArtist}>{track.artist}</div>
                {track.explicit ? (
                  <p style={styles.explicitNotice}>19금 콘텐츠로 표시되어 미리듣기를 제공하지 않습니다.</p>
                ) : (
                  track.previewUrl && (
                    <div style={styles.previewWrap}>
                      <AudioPreview src={track.previewUrl} compact />
                    </div>
                  )
                )}
              </div>
            </div>
            {(() => {
              const applying = applyingId === track.itunesTrackId;
              const applied = appliedIds.has(track.itunesTrackId);
              const outOfQuota = quota ? quota.remaining <= 0 : false;
              return (
                <button
                  style={{
                    ...styles.applyButton,
                    ...(applied ? styles.appliedButton : {}),
                    width: isMobile ? "100%" : "auto",
                    marginTop: isMobile ? 10 : 0,
                  }}
                  disabled={applying || applied || outOfQuota}
                  onClick={() => applySong(track)}
                >
                  {applied
                    ? "신청됨"
                    : applying
                    ? "신청 중…"
                    : outOfQuota
                    ? "오늘 마감"
                    : "신청하기"}
                </button>
              );
            })()}
          </li>
        ))}
      </ul>

      {/* 찾는 곡이 위쪽에 없을 때 더 펼쳐볼 수 있게. 이미 받아온 결과라 재검색은 없습니다. */}
      {results.length > visibleCount && (
        <button
          style={styles.moreButton}
          onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
        >
          더보기 <span style={styles.moreCount}>({results.length - visibleCount}곡 더 있음)</span>
        </button>
      )}

      {/* 안내 문구(레이트리밋/장애)가 이미 떠 있으면 "결과 없음"까지 겹쳐 보여주지 않습니다. */}
      {!loading && query.trim() && results.length === 0 && message?.type !== "notice" && (
        <p style={styles.hint}>검색 결과가 없습니다. 다른 검색어를 입력해 보세요.</p>
      )}

      <div style={styles.manualToggleWrap}>
        {!showManualForm ? (
          <button style={styles.manualToggleButton} onClick={() => setShowManualForm(true)}>
            찾는 곡이 없나요? 곡명으로 직접 신청하기
          </button>
        ) : (
          <ManualRequestForm
            onSubmit={async (title, artist) => {
              const ok = await submitRequest(
                { title, artist, isManual: true, explicit: false },
                "manual"
              );
              if (ok) setShowManualForm(false);
              return ok;
            }}
            applying={applyingId === "manual"}
            onCancel={() => setShowManualForm(false)}
          />
        )}
      </div>
    </section>
  );
}

function ManualRequestForm({ onSubmit, applying, onCancel }) {
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");

  return (
    <div style={styles.manualCard}>
      <p style={styles.manualCardHint}>
        검색되지 않는 곡은 제목과 아티스트를 직접 입력해 신청할 수 있습니다.
        방송부 검토를 거친 뒤 승인되면 방송 예정곡에 반영됩니다.
      </p>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={MAX_SONG_TEXT_LENGTH}
        placeholder="곡 제목"
        style={styles.searchInput}
      />
      <input
        value={artist}
        onChange={(e) => setArtist(e.target.value)}
        maxLength={MAX_SONG_TEXT_LENGTH}
        placeholder="아티스트"
        style={{ ...styles.searchInput, marginTop: 8 }}
      />
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button
          style={styles.applyButton}
          disabled={applying || !title.trim() || !artist.trim()}
          onClick={() => onSubmit(title, artist)}
        >
          {applying ? "신청 중…" : "이 곡으로 신청하기"}
        </button>
        <button style={styles.manualCancelButton} onClick={onCancel}>
          취소
        </button>
      </div>
    </div>
  );
}

function MyRequests({ studentId, isMobile }) {
  const [requests, setRequests] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!studentId) return;
    let cancelled = false;
    setError(null);
    setRequests(null);

    (async () => {
      try {
        const res = await fetch(
          `/api/requests?scope=mine&studentId=${encodeURIComponent(studentId)}`
        );
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error || "조회 실패");
        setRequests(data.requests || []);
      } catch {
        // 여기서 안 잡으면 화면이 "불러오는 중…"에서 영영 멈춥니다.
        if (!cancelled) setError("신청 현황을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [studentId]);

  if (!studentId) {
    return <p style={styles.hint}>이메일 앞자리를 먼저 입력해 주세요.</p>;
  }
  if (error) {
    return <p style={{ ...styles.hint, color: "var(--signal)" }}>{error}</p>;
  }
  if (requests === null) {
    return <p style={styles.hint}>불러오는 중…</p>;
  }
  if (requests.length === 0) {
    return <p style={styles.hint}>아직 신청한 곡이 없습니다.</p>;
  }

  return (
    <ul style={styles.resultList}>
      {requests.map((r) => (
        <li key={r.id} className="onair-card" style={styles.resultItem}>
          {r.album_image_url ? (
            <img src={r.album_image_url} alt="" style={styles.albumArt} />
          ) : (
            <div style={{ ...styles.albumArt, background: "var(--ink-line)" }} />
          )}
          <div style={styles.resultInfo}>
            <div style={styles.resultTitle}>{r.title}</div>
            <div style={styles.resultArtist}>{r.artist}</div>
            {r.scheduled_date && (
              <div style={styles.scheduleTag}>{r.scheduled_date} 방송 예정</div>
            )}
            {r.status === "rejected" && r.reject_reason && (
              <div style={styles.rejectTag}>사유: {r.reject_reason}</div>
            )}
          </div>
          <span style={{ ...styles.statusBadge, color: statusLabel(r.status).color }}>
            {statusLabel(r.status).text}
          </span>
        </li>
      ))}
    </ul>
  );
}

function UpcomingList({ isMobile }) {
  const [requests, setRequests] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`/api/requests?scope=upcoming`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error || "조회 실패");
        setRequests(data.requests || []);
      } catch {
        if (!cancelled) setError("방송 예정곡을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p style={{ ...styles.hint, color: "var(--signal)" }}>{error}</p>;
  if (requests === null) return <p style={styles.hint}>불러오는 중…</p>;
  if (requests.length === 0) return <p style={styles.hint}>예정된 기상곡이 아직 없습니다.</p>;

  return (
    <ul style={styles.resultList}>
      {requests.map((r) => (
        <li key={r.id} className="onair-card" style={styles.resultItem}>
          {r.albumImageUrl ? (
            <img src={r.albumImageUrl} alt="" style={styles.albumArt} />
          ) : (
            <div style={{ ...styles.albumArt, background: "var(--ink-line)" }} />
          )}
          <div style={styles.resultInfo}>
            <div style={styles.resultTitle}>{r.title}</div>
            <div style={styles.resultArtist}>{r.artist}</div>
          </div>
          <span style={{ ...styles.statusBadge, color: statusLabel(r.status).color }}>
            {r.scheduledDate || statusLabel(r.status).text}
          </span>
        </li>
      ))}
    </ul>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    maxWidth: 560,
    margin: "0 auto",
    padding: "0 20px 60px",
  },
  header: {
    padding: "40px 0 24px",
    textAlign: "center",
  },
  onAirBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    fontFamily: "var(--font-display)",
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: "0.18em",
    color: "var(--signal)",
    border: "1px solid var(--signal)",
    borderRadius: 999,
    padding: "6px 14px",
  },
  onAirDot: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: "var(--signal)",
    boxShadow: "0 0 8px var(--signal)",
  },
  title: {
    fontFamily: "var(--font-display)",
    fontSize: 30,
    fontWeight: 700,
    margin: "16px 0 6px",
    letterSpacing: "-0.01em",
  },
  subtitle: {
    color: "var(--paper-dim)",
    fontSize: 14,
    margin: 0,
  },
  identityBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    background: "var(--ink-soft)",
    border: "1px solid var(--ink-line)",
    borderRadius: 12,
    padding: "12px 16px",
    marginBottom: 20,
  },
  identityText: {
    fontSize: 14,
    color: "var(--paper-dim)",
  },
  linkButton: {
    background: "none",
    border: "none",
    color: "var(--dawn)",
    fontSize: 13,
    cursor: "pointer",
    fontWeight: 600,
  },
  identityEditRow: {
    display: "flex",
    gap: 8,
  },
  identityError: {
    color: "var(--signal)",
    fontSize: 12,
    margin: 0,
  },
  identityInputWrap: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    background: "var(--ink-soft)",
    border: "1px solid var(--ink-line)",
    borderRadius: 12,
    padding: "0 14px",
  },
  identityInput: {
    flex: 1,
    background: "none",
    border: "none",
    outline: "none",
    color: "var(--paper)",
    fontSize: 15,
    padding: "12px 0",
  },
  identitySuffix: {
    color: "var(--paper-dim)",
    fontSize: 14,
  },
  primaryButtonSmall: {
    background: "var(--dawn)",
    color: "var(--ink)",
    border: "none",
    borderRadius: 12,
    padding: "0 20px",
    fontWeight: 700,
    fontSize: 14,
    cursor: "pointer",
  },
  tabs: {
    display: "flex",
    gap: 4,
    marginBottom: 20,
    background: "var(--ink-soft)",
    borderRadius: 12,
    padding: 4,
  },
  tabButton: {
    flex: 1,
    background: "none",
    border: "none",
    color: "var(--paper-dim)",
    padding: "10px 0",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  tabButtonActive: {
    background: "var(--ink)",
    color: "var(--paper)",
  },
  main: {
    minHeight: 300,
  },
  searchInput: {
    width: "100%",
    background: "var(--ink-soft)",
    border: "1px solid var(--ink-line)",
    borderRadius: 12,
    padding: "14px 16px",
    color: "var(--paper)",
    fontSize: 15,
    outline: "none",
    marginBottom: 16,
  },
  hint: {
    color: "var(--paper-dim)",
    fontSize: 14,
    textAlign: "center",
    padding: "30px 0",
  },
  messageBox: {
    border: "1px solid",
    borderRadius: 10,
    padding: "10px 14px",
    fontSize: 13,
    marginBottom: 14,
  },
  resultList: {
    listStyle: "none",
    padding: 0,
    margin: 0,
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  resultItem: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    background: "var(--ink-soft)",
    border: "1px solid var(--ink-line)",
    borderRadius: 14,
    padding: 14,
  },
  albumArt: {
    width: 56,
    height: 56,
    borderRadius: 10,
    objectFit: "cover",
    flexShrink: 0,
    // 밝은 앨범아트가 어두운 카드 위에서 붕 떠 보이지 않도록 아주 옅은 테두리를 둡니다.
    border: "1px solid var(--ink-line)",
  },
  resultInfo: {
    flex: 1,
    minWidth: 0,
  },
  resultTitle: {
    fontSize: 14,
    fontWeight: 600,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  resultArtist: {
    fontSize: 12,
    color: "var(--paper-dim)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  resultTitleRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  explicitBadge: {
    fontSize: 10,
    fontWeight: 800,
    lineHeight: 1.4,
    background: "var(--signal)",
    color: "white",
    borderRadius: 5,
    padding: "1px 6px",
    flexShrink: 0,
  },
  explicitNotice: {
    fontSize: 11,
    color: "var(--signal)",
    marginTop: 6,
    marginBottom: 0,
  },
  quotaBar: {
    fontSize: 13,
    color: "var(--paper)",
    background: "var(--ink-soft)",
    border: "1px solid var(--ink-line)",
    borderRadius: 10,
    padding: "9px 14px",
    marginBottom: 14,
  },
  quotaDim: {
    color: "var(--paper-dim)",
  },
  moreButton: {
    width: "100%",
    marginTop: 10,
    background: "var(--ink-soft)",
    border: "1px solid var(--ink-line)",
    color: "var(--paper)",
    borderRadius: 12,
    padding: "12px 0",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  moreCount: {
    color: "var(--paper-dim)",
    fontWeight: 500,
  },
  manualToggleWrap: {
    marginTop: 20,
    textAlign: "center",
  },
  manualToggleButton: {
    background: "none",
    border: "none",
    color: "var(--paper-dim)",
    fontSize: 13,
    textDecoration: "underline",
    cursor: "pointer",
    padding: 8,
  },
  manualCard: {
    background: "var(--ink-soft)",
    border: "1px solid var(--ink-line)",
    borderRadius: 12,
    padding: 16,
    textAlign: "left",
  },
  manualCardHint: {
    fontSize: 12,
    color: "var(--paper-dim)",
    marginTop: 0,
    marginBottom: 10,
    lineHeight: 1.6,
  },
  manualCancelButton: {
    background: "none",
    border: "1px solid var(--ink-line)",
    color: "var(--paper-dim)",
    borderRadius: 10,
    padding: "9px 14px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  previewWrap: {
    marginTop: 8,
  },
  scheduleTag: {
    fontSize: 11,
    color: "var(--dawn)",
    marginTop: 4,
    fontWeight: 600,
  },
  rejectTag: {
    fontSize: 11,
    color: "var(--signal)",
    marginTop: 4,
  },
  applyButton: {
    background: "var(--dawn)",
    color: "var(--ink)",
    border: "none",
    borderRadius: 10,
    padding: "9px 14px",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    flexShrink: 0,
  },
  appliedButton: {
    background: "none",
    border: "1px solid var(--ok)",
    color: "var(--ok)",
    cursor: "default",
  },
  statusBadge: {
    fontSize: 12,
    fontWeight: 700,
    flexShrink: 0,
  },
  searchRow: {
    display: "flex",
    gap: 8,
    marginBottom: 16,
  },
  searchButton: {
    background: "var(--dawn)",
    color: "var(--ink)",
    border: "none",
    borderRadius: 12,
    padding: "0 18px",
    fontSize: 14,
    fontWeight: 700,
    cursor: "pointer",
    flexShrink: 0,
  },
};
