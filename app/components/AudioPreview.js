"use client";

import { useState, useRef, useEffect } from "react";

// 30초 미리듣기 플레이어입니다.
//
// 기본 <audio controls>는 브라우저마다 생김새가 다르고, 특히 크롬에서는 흰색 알약 모양이라
// 어두운 화면 위에서 카드보다 더 눈에 띄어 버립니다. 곡 정보가 주인공이어야 하는데
// 재생 컨트롤이 시선을 다 가져가서, 같은 정보를 담되 화면 톤에 맞는 컨트롤을 직접 만들었습니다.

// 목록에 미리듣기가 여러 개 있을 때 두 곡이 동시에 나오면 아무것도 못 듣게 됩니다.
// 새로 재생을 시작한 플레이어가 직전 플레이어를 멈추도록 모듈 단위로 하나만 기억합니다.
let currentlyPlaying = null;

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function AudioPreview({ src, compact = false }) {
  const audioRef = useRef(null);
  const trackRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [failed, setFailed] = useState(false);
  const [seeking, setSeeking] = useState(false);

  // src가 바뀌면(검색 결과 교체 등) 이전 곡의 재생 위치가 남지 않도록 초기화합니다.
  useEffect(() => {
    setPlaying(false);
    setCurrent(0);
    setDuration(0);
    setFailed(false);
  }, [src]);

  useEffect(() => {
    return () => {
      // 언마운트될 때 이 플레이어가 "현재 재생 중"으로 남아 있으면 참조를 놓아줍니다.
      if (currentlyPlaying === audioRef.current) currentlyPlaying = null;
    };
  }, []);

  function toggle() {
    const el = audioRef.current;
    if (!el || failed) return;

    if (el.paused) {
      if (currentlyPlaying && currentlyPlaying !== el) currentlyPlaying.pause();
      currentlyPlaying = el;
      el.play().catch(() => setFailed(true));
    } else {
      el.pause();
    }
  }

  // 진행 바를 눌렀을 때 그 지점으로 이동합니다. 누른 채 끌면 계속 따라옵니다.
  function seekTo(clientX) {
    const el = audioRef.current;
    const track = trackRef.current;
    if (!el || !track || !duration) return;

    const rect = track.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    el.currentTime = ratio * duration;
    setCurrent(el.currentTime);
  }

  function handlePointerDown(e) {
    if (failed || !duration) return;
    setSeeking(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    seekTo(e.clientX);
  }

  function handlePointerMove(e) {
    if (!seeking) return;
    seekTo(e.clientX);
  }

  function handlePointerUp(e) {
    if (!seeking) return;
    setSeeking(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  // 키보드만 쓰는 경우에도 5초씩 이동할 수 있어야 합니다.
  function handleKeyDown(e) {
    const el = audioRef.current;
    if (!el || !duration) return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      el.currentTime = Math.min(duration, el.currentTime + 5);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      el.currentTime = Math.max(0, el.currentTime - 5);
    } else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      toggle();
    }
  }

  const progress = duration ? (current / duration) * 100 : 0;

  if (failed) {
    return <div style={styles.failed}>미리듣기를 재생할 수 없습니다.</div>;
  }

  return (
    <div style={{ ...styles.wrap, ...(compact ? styles.wrapCompact : {}) }}>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onTimeUpdate={(e) => !seeking && setCurrent(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCurrent(0);
        }}
        onError={() => setFailed(true)}
      />

      <button
        type="button"
        onClick={toggle}
        style={{ ...styles.playButton, ...(playing ? styles.playButtonActive : {}) }}
        aria-label={playing ? "미리듣기 일시정지" : "미리듣기 재생"}
      >
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>

      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label="재생 위치"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(current)}
        aria-valuetext={`${formatTime(current)} / ${formatTime(duration)}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onKeyDown={handleKeyDown}
        style={styles.track}
      >
        <div style={styles.trackBase}>
          <div style={{ ...styles.trackFill, width: `${progress}%` }} />
          <div
            style={{
              ...styles.thumb,
              left: `${progress}%`,
              opacity: playing || seeking || current > 0 ? 1 : 0,
            }}
          />
        </div>
      </div>

      <span style={styles.time}>
        {formatTime(current)} <span style={styles.timeDim}>/ {formatTime(duration)}</span>
      </span>
    </div>
  );
}

function PlayIcon() {
  return (
    <svg width="12" height="14" viewBox="0 0 12 14" aria-hidden="true">
      {/* 광학적으로 가운데 보이도록 살짝 오른쪽으로 옮긴 삼각형 */}
      <path d="M1.5 1.2 L11 7 L1.5 12.8 Z" fill="currentColor" strokeLinejoin="round" strokeWidth="1.6" stroke="currentColor" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="12" height="14" viewBox="0 0 12 14" aria-hidden="true">
      <rect x="1.5" y="1.5" width="3.4" height="11" rx="1.2" fill="currentColor" />
      <rect x="7.1" y="1.5" width="3.4" height="11" rx="1.2" fill="currentColor" />
    </svg>
  );
}

const styles = {
  wrap: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    background: "var(--ink)",
    border: "1px solid var(--ink-line)",
    borderRadius: 999,
    padding: "6px 14px 6px 6px",
  },
  wrapCompact: {
    padding: "5px 12px 5px 5px",
    gap: 8,
  },
  playButton: {
    flexShrink: 0,
    width: 32,
    height: 32,
    borderRadius: "50%",
    border: "none",
    background: "var(--dawn)",
    color: "var(--ink)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    padding: 0,
    transition: "transform 0.12s ease, filter 0.12s ease",
  },
  playButtonActive: {
    // 재생 중일 때는 살짝 빛나게 해서 여러 카드 중 어느 게 나오는 중인지 바로 보이게 합니다.
    boxShadow: "0 0 0 4px rgba(255,180,84,0.18)",
  },
  track: {
    flex: 1,
    minWidth: 40,
    height: 20,
    display: "flex",
    alignItems: "center",
    cursor: "pointer",
    touchAction: "none", // 모바일에서 끌어서 탐색할 때 화면이 같이 스크롤되지 않도록
  },
  trackBase: {
    position: "relative",
    width: "100%",
    height: 4,
    borderRadius: 999,
    background: "var(--ink-line)",
  },
  trackFill: {
    position: "absolute",
    left: 0,
    top: 0,
    height: "100%",
    borderRadius: 999,
    background: "var(--dawn)",
  },
  thumb: {
    position: "absolute",
    top: "50%",
    width: 10,
    height: 10,
    marginLeft: -5,
    borderRadius: "50%",
    background: "var(--dawn)",
    border: "2px solid var(--ink)",
    transform: "translateY(-50%)",
    transition: "opacity 0.15s ease",
    pointerEvents: "none",
  },
  time: {
    flexShrink: 0,
    fontSize: 11,
    color: "var(--paper)",
    // 재생 중 숫자가 계속 바뀌는데 자리 폭이 흔들리면 옆 요소가 덜컹거려서 고정폭 숫자를 씁니다.
    fontVariantNumeric: "tabular-nums",
  },
  timeDim: {
    color: "var(--paper-dim)",
  },
  failed: {
    fontSize: 12,
    color: "var(--paper-dim)",
    padding: "8px 0",
  },
};
