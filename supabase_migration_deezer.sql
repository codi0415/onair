-- 기존에 이미 supabase_schema.sql을 실행해서 프로젝트가 배포되어 있는 경우,
-- Deezer 검색 병행 지원을 위해 이 파일만 추가로 실행하면 됩니다.
-- (처음부터 새로 만드는 프로젝트라면 supabase_schema.sql에 이미 반영되어 있으니 이 파일은 필요 없습니다.)

create table if not exists deezer_search_cache (
  id uuid primary key default gen_random_uuid(),
  query_normalized text not null unique,
  results jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_deezer_cache_query on deezer_search_cache(query_normalized);
create index if not exists idx_deezer_cache_created on deezer_search_cache(created_at);

create table if not exists deezer_call_log (
  id bigint generated always as identity primary key,
  called_at timestamptz not null default now()
);

create index if not exists idx_deezer_call_log_time on deezer_call_log(called_at);

alter table deezer_search_cache enable row level security;
alter table deezer_call_log enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'deezer_search_cache' and policyname = 'no public access to deezer cache'
  ) then
    create policy "no public access to deezer cache"
      on deezer_search_cache for select
      using (false);
  end if;

  if not exists (
    select 1 from pg_policies
    where tablename = 'deezer_call_log' and policyname = 'no public access to deezer call log'
  ) then
    create policy "no public access to deezer call log"
      on deezer_call_log for select
      using (false);
  end if;
end $$;
