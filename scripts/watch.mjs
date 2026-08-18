#!/usr/bin/env node
//
// 프로덕션 상태 감시 스크립트
//
//   node scripts/watch.mjs
//
// 하는 일:
//   1) Vercel 실시간 로그에서 "행동이 필요한 것"만 골라 출력
//      (5xx, 레이트 리밋 도달, DB 오류, 메일 발송 실패)
//   2) 3분마다 사이트에 직접 접속해 다운/지연 감지
//   3) 10분마다 요약 한 줄
//
// 사전 조건: `npx vercel login` 으로 같은 계정에 로그인되어 있어야 합니다.
//
// ⚠ 이 스크립트가 이렇게 생긴 이유 (안 지키면 트래픽이 몇 배로 부풀려 보입니다):
//   - `vercel logs`는 스트리밍이 아니라, 접속할 때마다 "최근 과거 로그"를 먼저 쏟아냅니다.
//     그래서 (a) 로그 id로 전역 중복 제거를 하고,
//          (b) 감시 시작 시각 이전 항목은 아예 버립니다.
//   - 이 스크립트 자신의 헬스체크(/api/search)도 로그에 남습니다. 그래서 실사용 지표는
//     "/" 페이지 방문 수를 씁니다 — 학생은 사이트를 열어야 검색하므로 구분이 됩니다.
//   - 헬스체크는 캐시되는 검색어를 써서 iTunes 레이트 리밋을 소모하지 않습니다.

import { spawn } from "child_process";
import readline from "readline";

const URL = process.env.WATCH_URL || "https://onair-three-beta.vercel.app";
const PROBE_MS = 3 * 60 * 1000;
const ROLLUP_MS = 10 * 60 * 1000;
const PROBE_QUERY = "aespa"; // 12시간 캐시에 걸리는 검색어 (외부 API를 부르지 않음)

const START = Date.now();
const seen = new Set();
let win = { err5: 0, err4: 0, rate: 0, dberr: 0, paths: {} };
let lastRollup = Date.now();
let probeFail = 0;

const t = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(11, 19);

// ---------- 1) 로그 감시 ----------

function handle(e) {
  if (!e.id || seen.has(e.id)) return;
  seen.add(e.id);
  if (seen.size > 50000) seen.clear();
  if (e.timestamp && e.timestamp < START) return; // 접속 시 쏟아지는 과거 로그 무시

  const code = e.responseStatusCode;
  const path = e.requestPath || "";
  if (code) win.paths[path] = (win.paths[path] || 0) + 1;

  const msgs = [];
  if (Array.isArray(e.logs)) for (const l of e.logs) if (l?.message) msgs.push(String(l.message));
  if (e.message && String(e.message).trim()) msgs.push(String(e.message));

  for (const m of msgs) {
    const s = m.trim().slice(0, 200);
    if (m.includes("[RATE_LIMIT]")) { win.rate++; console.log(`⚠️  ${t()} ${s}`); }
    else if (/캐시|카운트|Supabase|환경변수/.test(m)) { win.dberr++; console.log(`🔴 ${t()} DB: ${s}`); }
    else if (/메일/.test(m)) console.log(`✉️  ${t()} ${s}`);
    else if (/Error|실패|오류/.test(m)) console.log(`🔴 ${t()} ${s}`);
  }

  if (code >= 500) { win.err5++; console.log(`🔴 ${t()} HTTP ${code} ${path}`); }
  else if (code >= 400 && code !== 401 && code !== 404) { win.err4++; console.log(`🟡 ${t()} HTTP ${code} ${path}`); }
}

function connect() {
  const p = spawn("npx", ["vercel", "logs", URL, "--json"], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  readline.createInterface({ input: p.stdout }).on("line", (line) => {
    const s = line.trim();
    if (!s.startsWith("{")) return;
    try { handle(JSON.parse(s)); } catch {}
  });
  p.on("exit", () => setTimeout(connect, 5000)); // 끊기면 재접속
}

// ---------- 2) 외형 헬스체크 ----------

let firstProbe = true;

async function probe() {
  const started = Date.now();
  try {
    const res = await fetch(`${URL}/api/search?q=${encodeURIComponent(PROBE_QUERY)}`, {
      signal: AbortSignal.timeout(25000),
    });
    const secs = (Date.now() - started) / 1000;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // 평소에는 이상할 때만 말하지만, 첫 점검만은 결과를 찍습니다.
    // 안 그러면 감시가 정상 동작 중인지 멈춘 건지 구분할 수 없습니다.
    if (firstProbe) {
      const n = ((await res.json().catch(() => ({}))).tracks || []).length;
      console.log(`✅ ${t()} 첫 점검 정상 — 검색 ${secs.toFixed(2)}초, ${n}곡 · 이후로는 이상이 있을 때만 알립니다`);
      firstProbe = false;
    }
    if (probeFail > 0) { console.log(`🟢 ${t()} 정상 복구 (직전 ${probeFail}회 실패 후)`); probeFail = 0; }
    if (secs > 8) console.log(`🐢 ${t()} 검색 응답 느림 ${secs.toFixed(1)}초 (평시 1초 내외)`);
  } catch (err) {
    firstProbe = false;
    probeFail++;
    console.log(`🚨 ${t()} 사이트 응답 이상 — ${err.message} (연속 ${probeFail}회)`);
  }
}

// ---------- 3) 요약 ----------

function rollup() {
  const home = win.paths["/"] || 0;
  const probes = Math.round(ROLLUP_MS / PROBE_MS);
  const search = Math.max(0, (win.paths["/api/search"] || 0) - probes);
  const submit = win.paths["/api/requests"] || 0;
  const bad = win.err5 + win.dberr;
  console.log(
    `${bad ? "🟠" : "✅"} ${t()} [10분] 페이지방문 ${home} · 검색 ${search}(점검 제외) · ` +
    `신청API ${submit} · 5xx ${win.err5} · 레이트리밋 ${win.rate} · DB오류 ${win.dberr}`
  );
  win = { err5: 0, err4: 0, rate: 0, dberr: 0, paths: {} };
  lastRollup = Date.now();
}

console.log(`${t()} 감시 시작 — ${URL}`);
connect();
probe();
setInterval(probe, PROBE_MS);
setInterval(() => { if (Date.now() - lastRollup >= ROLLUP_MS) rollup(); }, 5000);
