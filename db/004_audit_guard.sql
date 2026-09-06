-- ============================================================================
-- 004_audit_guard.sql — 변경 이력 위조 차단
--
-- 문제 : mp_audit 의 INSERT 정책이 mp_can_read() 였다. 이동계획 사용자 전원이다.
--        그리고 user_id 와 email 을 클라이언트가 보낸다.
--        그래서 누구나 «확정 해제» 같은 없었던 작업을 남의 이메일로 남길 수 있었다.
--        기록을 믿을 수 없으면 기록이 없는 것과 같다.
--
-- 고침 : 누가 남겼는지는 서버가 찍는다. 클라이언트가 보낸 값은 무시한다.
--        시각도 서버가 찍는다.
--
-- 여러 번 실행해도 안전하다.
-- ============================================================================

create or replace function mp_audit_stamp() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  new.user_id := auth.uid();
  new.email   := coalesce((select p.email from profiles p where p.id = auth.uid()), new.email);
  new.at      := now();
  return new;
end $$;

drop trigger if exists mp_audit_stamp on mp_audit;
create trigger mp_audit_stamp before insert on mp_audit
  for each row execute function mp_audit_stamp();

-- 자기 이름으로만 남길 수 있다. 트리거가 덮어쓰므로 이중 방어다.
drop policy if exists mp_i on mp_audit;
create policy mp_i on mp_audit for insert
  with check (mp_can_read() and user_id = auth.uid());
