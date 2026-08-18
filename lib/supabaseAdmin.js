import { createClient } from "@supabase/supabase-js";

// 이 클라이언트는 서버(API Route)에서만 import 해야 합니다.
// SERVICE_ROLE_KEY는 절대 클라이언트 번들에 노출되면 안 됩니다.
//
// 빌드 시점에는 환경변수가 아직 없을 수 있으므로(예: Vercel 환경변수 설정 전 빌드),
// 모듈 로드 즉시 createClient를 호출하지 않고 실제로 쓰일 때 생성합니다.
// 이렇게 하면 환경변수 누락이 "빌드 실패"가 아니라 "그 API를 호출했을 때의 명확한 런타임 에러"가 되어
// 원인 파악이 훨씬 쉬워집니다.

// Supabase가 느려지거나 응답이 없을 때 학생 화면이 무한정 "검색 중…"에 멈추지 않도록
// 모든 DB 요청에 타임아웃을 겁니다. 검색 경로에서는 DB가 캐시/카운터 용도라
// 타임아웃되어도 lib/itunes.js, lib/deezer.js가 그냥 캐시 없이 진행합니다.
// 같은 리전의 Supabase는 보통 100ms 안쪽이라 3초면 충분히 넉넉합니다.
const DB_TIMEOUT_MS = 3000;

let _client = null;

function fetchWithTimeout(input, init = {}) {
  return fetch(input, {
    ...init,
    // supabase-js가 자체 AbortSignal을 넘기는 경우(.abortSignal())에는 그쪽을 존중합니다.
    signal: init.signal ?? AbortSignal.timeout(DB_TIMEOUT_MS),
  });
}

function getSupabaseAdmin() {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY 환경변수가 설정되지 않았습니다. " +
        "Vercel 프로젝트의 Settings > Environment Variables에서 값을 추가한 뒤 반드시 Redeploy 해주세요."
    );
  }

  _client = createClient(url, key, {
    auth: { persistSession: false },
    global: { fetch: fetchWithTimeout },
  });
  return _client;
}

// 기존 코드와의 호환을 위해 프록시로 감싸서, supabaseAdmin.from(...) 형태의
// 기존 호출부를 전혀 수정하지 않고도 지연 생성이 동작하도록 합니다.
export const supabaseAdmin = new Proxy(
  {},
  {
    get(_target, prop) {
      const client = getSupabaseAdmin();
      return client[prop];
    },
  }
);
