-- 중복 신청을 DB 차원에서 막는 마이그레이션입니다.
-- 이미 배포된 프로젝트라면 이 파일만 SQL Editor에서 추가로 실행하면 됩니다.
-- 여러 번 실행해도 안전합니다.
--
-- 왜 필요한가:
--   지금까지 중복 신청 방지는 "먼저 select 해보고 없으면 insert" 방식이라
--   같은 학생이 두 번 빠르게 신청하면(신청 버튼 연타, 새로고침 후 재신청, 모바일 더블탭)
--   두 요청이 동시에 select를 통과해서 둘 다 저장될 수 있었습니다.
--   아래 unique index가 있으면 DB가 두 번째 insert를 거절하고,
--   API는 그 에러(23505)를 받아 "이미 신청한 곡입니다"로 처리합니다.
--
-- partial index인 이유:
--   반려(rejected)되거나 방송 완료(played)된 곡은 다시 신청할 수 있어야 하므로
--   대기/승인/예정 상태에 대해서만 유일성을 겁니다. 기존 애플리케이션 로직과 동일한 조건입니다.

-- 1) 검색으로 신청한 곡: (학생, 트랙 ID) 기준
create unique index if not exists uniq_active_request_by_track
  on song_requests (student_id, itunes_track_id)
  where status in ('pending', 'approved', 'scheduled');

-- 2) 직접 입력해서 신청한 곡: 트랙 ID가 매번 새 uuid라 위 인덱스가 못 잡습니다.
--    (학생, 곡명, 아티스트) 기준으로 따로 겁니다. 대소문자/앞뒤 공백 차이는 무시합니다.
create unique index if not exists uniq_active_manual_request
  on song_requests (student_id, lower(btrim(title)), lower(btrim(artist)))
  where is_manual and status in ('pending', 'approved', 'scheduled');

-- 참고: 이미 중복 데이터가 쌓여 있으면 인덱스 생성이 실패합니다.
-- 그 경우 아래 쿼리로 중복을 먼저 확인하고 정리한 뒤 다시 실행하세요.
--
-- select student_id, itunes_track_id, count(*)
-- from song_requests
-- where status in ('pending','approved','scheduled')
-- group by 1, 2 having count(*) > 1;
