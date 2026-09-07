-- ============================================================================
-- 008_taxi_rename.sql — 택시지원팀 → 택시지원파트
--
-- 006 과 같은 이유다. 한 조직을 두 이름으로 부르면 같은 자리의 값이 두 행으로
-- 갈라지고, 어느 쪽도 맞지 않게 된다. mp_org_map 의 대표 표기가 '택시지원파트' 이므로
-- 그쪽으로 모은다.
--
--   mp_audit    변경 이력이므로 건드리지 않는다 — 그때 그렇게 기록됐다는 사실이다.
--   mp_erp_rev  ERP 원본이므로 건드리지 않는다 — 옛 표기는 mp_org_map 이 모아 준다.
-- ============================================================================

begin;

-- 기본키가 겹치는 자리는 옛 행을 버린다 (두 번 돌려도 깨지지 않게)
delete from mp_plan a where a.team = '택시지원팀'
  and exists (select 1 from mp_plan b where b.team = '택시지원파트'
               and b.m = a.m and b.sec = a.sec and b.item = a.item);
delete from mp_week a where a.team = '택시지원팀'
  and exists (select 1 from mp_week b where b.team = '택시지원파트'
               and b.m = a.m and b.sec = a.sec and b.item = a.item and b.k = a.k);
delete from mp_submit a where a.team = '택시지원팀'
  and exists (select 1 from mp_submit b where b.team = '택시지원파트'
               and b.m = a.m and b.k = a.k);
delete from mp_notes a where a.team = '택시지원팀'
  and exists (select 1 from mp_notes b where b.team = '택시지원파트'
               and b.kind = a.kind and b.m = a.m
               and coalesce(b.sec,'')  = coalesce(a.sec,'')
               and coalesce(b.item,'') = coalesce(a.item,'')
               and coalesce(b.k,-1)    = coalesce(a.k,-1));
delete from mp_rev_map a where a.team = '택시지원팀'
  and exists (select 1 from mp_rev_map b where b.team = '택시지원파트'
               and b.m = a.m and b.pname = a.pname);
delete from mp_desc_match a where a.team = '택시지원팀'
  and exists (select 1 from mp_desc_match b where b.team = '택시지원파트'
               and b.m = a.m and b.cat = a.cat and b.side = a.side);

update mp_plan       set team = '택시지원파트' where team = '택시지원팀';
update mp_week       set team = '택시지원파트' where team = '택시지원팀';
update mp_detail     set team = '택시지원파트' where team = '택시지원팀';
update mp_notes      set team = '택시지원파트' where team = '택시지원팀';
update mp_submit     set team = '택시지원파트' where team = '택시지원팀';
update mp_members    set team = '택시지원파트' where team = '택시지원팀';
update mp_rev_map    set team = '택시지원파트' where team = '택시지원팀';
update mp_desc_match set team = '택시지원파트' where team = '택시지원팀';

update mp_config
   set val = '["광역교통지원팀","택시지원파트","리페어팀","수도권버스지원팀","AFC지원파트","실공통"]'::jsonb
 where key = 'teams';

insert into mp_org_map (org, org6) values
  ('택시지원팀', '택시지원파트'), ('택시지원파트', '택시지원파트')
on conflict (org) do update set org6 = excluded.org6;

commit;
