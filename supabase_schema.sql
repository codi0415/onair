-- ============================================
-- ON AIR : 울산과학고 아침 기상곡 신청 시스템
-- Supabase Schema (v2 - iTunes Search API 기반)
-- ============================================

-- 1. 신청곡 테이블
create table song_requests (
  id uuid primary key default gen_random_uuid(),
  student_id text not null,                    -- @ushs.hs.kr 앞부분 (예: "23100")
  itunes_track_id text not null,                -- 트랙 고유 식별자. iTunes는 원본 trackId, Deezer는 "deezer-<id>", 수동 등록곡은 "manual-<uuid>" 형태로 채움
  is_manual boolean not null default false,     -- 방송부가 iTunes 미검색곡을 직접 등록한 경우 true
  title text not null,
  artist text not null,
  album_image_url text,
  preview_url text,                             -- iTunes 30초 미리듣기 URL (자체 제공)

  -- 비속어 체크 결과
  itunes_explicit boolean default false,        -- iTunes trackExplicitness == "explicit"
  musixmatch_explicit boolean,                  -- null = 조회 안 됨/실패
  keyword_flag boolean default false,           -- 자체 사전 필터링 결과
  keyword_flag_reason text,                     -- 어떤 사전 항목에 걸렸는지 (내부 참고용)
  needs_review boolean generated always as (
    itunes_explicit or coalesce(musixmatch_explicit, false) or keyword_flag
  ) stored,

  -- 방송부 처리 상태
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'scheduled', 'played')),
  scheduled_date date,                          -- 방송 예정일
  reviewed_by text,                             -- 방송부 담당자 표기 (선택)
  reviewed_at timestamptz,
  reject_reason text,

  created_at timestamptz not null default now()
);

create index idx_song_requests_student on song_requests(student_id);
create index idx_song_requests_status on song_requests(status);
create index idx_song_requests_scheduled on song_requests(scheduled_date);

-- 2. 자체 비속어/부적절어 사전 (곡명·아티스트명 텍스트 필터용)
create table blocklist_keywords (
  id uuid primary key default gen_random_uuid(),
  keyword text not null unique,
  created_at timestamptz not null default now()
);

-- 3. iTunes 검색 결과 캐시
-- iTunes Search API는 IP당 분당 약 20회 제한이 있어, 전교생이 몰리는 시간대에
-- 같은 검색어(곡 제목, 아티스트명)가 반복될 확률이 높으므로 캐싱으로 호출 수를 줄입니다.
create table itunes_search_cache (
  id uuid primary key default gen_random_uuid(),
  query_normalized text not null unique,        -- 검색어를 정규화(소문자, 공백 정리)한 키
  results jsonb not null,                       -- iTunes 응답을 가공한 결과 배열 그대로 저장
  created_at timestamptz not null default now()
);

create index idx_itunes_cache_query on itunes_search_cache(query_normalized);
create index idx_itunes_cache_created on itunes_search_cache(created_at);

-- 4. iTunes API 호출 빈도 기록 (레이트 리밋 자체 관리용)
-- 분당 호출 수를 서버가 직접 추적해서, 한도에 가까워지면 캐시로만 응답하거나
-- 잠시 대기시키는 방식으로 429 자체를 최대한 피합니다.
create table itunes_call_log (
  id bigint generated always as identity primary key,
  called_at timestamptz not null default now()
);

create index idx_itunes_call_log_time on itunes_call_log(called_at);

-- 5. Deezer 검색 결과 캐시
-- Deezer Search API는 인증이 필요 없고 iTunes보다 넉넉한 레이트 리밋(약 초당 10회)을 제공해
-- iTunes와 병행 검색해서 검색 결과량을 늘리는 용도로 사용합니다. 캐싱 방식은 iTunes와 동일합니다.
create table deezer_search_cache (
  id uuid primary key default gen_random_uuid(),
  query_normalized text not null unique,
  results jsonb not null,
  created_at timestamptz not null default now()
);

create index idx_deezer_cache_query on deezer_search_cache(query_normalized);
create index idx_deezer_cache_created on deezer_search_cache(created_at);

-- 6. Deezer API 호출 빈도 기록 (레이트 리밋 자체 관리용)
create table deezer_call_log (
  id bigint generated always as identity primary key,
  called_at timestamptz not null default now()
);

create index idx_deezer_call_log_time on deezer_call_log(called_at);

-- ============================================
-- Row Level Security
-- ============================================
alter table song_requests enable row level security;
alter table blocklist_keywords enable row level security;
alter table itunes_search_cache enable row level security;
alter table itunes_call_log enable row level security;
alter table deezer_search_cache enable row level security;
alter table deezer_call_log enable row level security;

create policy "public can view non-sensitive request list"
  on song_requests for select
  using (true);

create policy "no direct insert from client"
  on song_requests for insert
  with check (false);

create policy "no direct update from client"
  on song_requests for update
  using (false);

create policy "no public access to blocklist"
  on blocklist_keywords for select
  using (false);

create policy "no public access to itunes cache"
  on itunes_search_cache for select
  using (false);

create policy "no public access to itunes call log"
  on itunes_call_log for select
  using (false);

create policy "no public access to deezer cache"
  on deezer_search_cache for select
  using (false);

create policy "no public access to deezer call log"
  on deezer_call_log for select
  using (false);

-- 참고: 실제 쓰기/민감 조회는 모두 Next.js API Route에서
-- SUPABASE_SERVICE_ROLE_KEY로 처리하며 RLS를 우회합니다.
-- anon key는 클라이언트에 노출되어도 안전하도록 위 정책으로 잠가둡니다.

-- 오래된 호출 로그는 주기적으로 청소해도 됩니다 (선택, 수동 실행):
-- delete from itunes_call_log where called_at < now() - interval '1 hour';
