-- ============================================================================
-- 006_team_rename.sql
--
-- 한 조직을 두 이름으로 부르고 있었다.
--   이동계획 : 광역버스사업팀
--   ERP 조직 : 광역교통지원팀   (mp_org_map 의 대표 표기도 이쪽이다)
--
-- 대표 표기를 '광역교통지원팀' 하나로 모은다.
-- 이름이 둘이면 같은 자리의 값이 두 행으로 갈라지고, 어느 쪽도 맞지 않게 된다.
--
-- 안전 장치
--   · 새 이름 행이 이미 있는 자리는 옛 행을 지운 뒤 옮긴다 (기본키 충돌 방지).
--     지금 새 이름 행은 0건이지만, 이 스크립트를 두 번 돌려도 깨지지 않아야 한다.
--   · mp_erp_rev / mp_erp_sga 는 ERP 원본이므로 건드리지 않는다.
--     원본의 옛 표기는 mp_org_map 이 대표 표기로 모아 준다.
--   · 되돌리려면 아래 UPDATE 의 양쪽을 바꿔 다시 돌리면 된다.
-- ============================================================================

begin;

-- ---- 0. 옛 이름이 몇 건인지 먼저 남긴다 -----------------------------------
create temp table _before as
select 'mp_plan'    as t, count(*) as n from mp_plan    where team = '광역버스사업팀'
union all select 'mp_week',    count(*) from mp_week    where team = '광역버스사업팀'
union all select 'mp_detail',  count(*) from mp_detail  where team = '광역버스사업팀'
union all select 'mp_notes',   count(*) from mp_notes   where team = '광역버스사업팀'
union all select 'mp_submit',  count(*) from mp_submit  where team = '광역버스사업팀'
union all select 'mp_members', count(*) from mp_members where team = '광역버스사업팀';

-- ---- 1. 기본키가 겹치는 자리는 옛 행을 버린다 -----------------------------
delete from mp_plan a
 where a.team = '광역버스사업팀'
   and exists (select 1 from mp_plan b
                where b.team = '광역교통지원팀'
                  and b.m = a.m and b.sec = a.sec and b.item = a.item);

delete from mp_week a
 where a.team = '광역버스사업팀'
   and exists (select 1 from mp_week b
                where b.team = '광역교통지원팀'
                  and b.m = a.m and b.sec = a.sec and b.item = a.item and b.k = a.k);

delete from mp_submit a
 where a.team = '광역버스사업팀'
   and exists (select 1 from mp_submit b
                where b.team = '광역교통지원팀'
                  and b.m = a.m and b.k = a.k);

-- mp_notes 는 (kind, m, team, sec, item, k) 유니크 인덱스다
delete from mp_notes a
 where a.team = '광역버스사업팀'
   and exists (select 1 from mp_notes b
                where b.team = '광역교통지원팀'
                  and b.kind = a.kind and b.m = a.m
                  and coalesce(b.sec,'')  = coalesce(a.sec,'')
                  and coalesce(b.item,'') = coalesce(a.item,'')
                  and coalesce(b.k,-1)    = coalesce(a.k,-1));

-- ---- 2. 나머지를 대표 표기로 옮긴다 ---------------------------------------
update mp_plan    set team = '광역교통지원팀' where team = '광역버스사업팀';
update mp_week    set team = '광역교통지원팀' where team = '광역버스사업팀';
update mp_detail  set team = '광역교통지원팀' where team = '광역버스사업팀';
update mp_notes   set team = '광역교통지원팀' where team = '광역버스사업팀';
update mp_submit  set team = '광역교통지원팀' where team = '광역버스사업팀';
update mp_members set team = '광역교통지원팀' where team = '광역버스사업팀';

-- 사람이 판단한 적요 매칭 확정. 팀명이 키의 일부라 안 옮기면 그 결과가 통째로
-- 무시되고 다시 «확인 필요» 로 돌아간다.
update mp_desc_match set team = '광역교통지원팀' where team = '광역버스사업팀';

-- mp_audit(변경 이력)과 mp_erp_rev(ERP 원본)은 건드리지 않는다.
--   이력은 «그때 그렇게 기록됐다» 는 사실이고, 고치면 이력이 아니게 된다.
--   ERP 원본의 옛 표기는 mp_org_map 이 대표 표기로 모아 준다.

-- ---- 3. 팀 목록 ------------------------------------------------------------
update mp_config
   set val = '["광역교통지원팀","택시지원팀","리페어팀","수도권버스지원팀","AFC지원파트","실공통"]'::jsonb
 where key = 'teams';

-- ---- 4. 조직 매핑 : 옛 조직명도 대표 표기로 모은다 -------------------------
--   'AFC지원센터' 가 빠져 있어서 2025년 12월 매출 27건이 «사업부 밖» 으로 걸러져
--   통째로 사라져 있었다. 매핑에 넣어 두면 그 달을 다시 올릴 때 살아난다.
insert into mp_org_map (org, org6) values
  ('AFC지원센터', 'AFC지원파트'),
  ('광역버스사업팀', '광역교통지원팀'),
  ('광역교통지원팀', '광역교통지원팀')
on conflict (org) do update set org6 = excluded.org6;

update mp_org_map set org6 = '광역교통지원팀' where org6 = '광역버스사업팀';

-- ---- 5. 결과 확인 ----------------------------------------------------------
select b.t                                        as 표,
       b.n                                        as "옮기기 전 옛이름",
       (select count(*) from mp_plan    where team='광역교통지원팀' and b.t='mp_plan')
     + (select count(*) from mp_week    where team='광역교통지원팀' and b.t='mp_week')
     + (select count(*) from mp_detail  where team='광역교통지원팀' and b.t='mp_detail')
     + (select count(*) from mp_notes   where team='광역교통지원팀' and b.t='mp_notes')
     + (select count(*) from mp_submit  where team='광역교통지원팀' and b.t='mp_submit')
     + (select count(*) from mp_members where team='광역교통지원팀' and b.t='mp_members')
                                                  as "옮긴 뒤 새이름"
  from _before b order by b.t;

commit;
