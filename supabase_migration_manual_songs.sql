-- 기존에 이미 supabase_schema.sql을 실행해서 song_requests 테이블이 있는 경우,
-- "사용자가 없는 곡 수동 등록" 기능을 위해 이 파일만 추가로 실행하면 됩니다.
-- (처음부터 새로 만드는 프로젝트라면 supabase_schema.sql에 이미 반영되어 있으니 이 파일은 필요 없습니다.)

alter table song_requests
  add column if not exists is_manual boolean not null default false;

comment on column song_requests.is_manual is '방송부가 iTunes 미검색곡을 직접 등록한 경우 true';
