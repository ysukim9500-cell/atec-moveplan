-- ============================================================================
-- 007_rev_map.sql — ERP 매출 프로젝트 ↔ 이동계획 매출 항목 매칭
--
-- 판관비는 ERP 엑셀에 «이동계획» 열이 있어 비목이 그대로 따라온다.
-- 매출은 그런 열이 없다. 프로젝트명만 있고, 그것이 제품인지 유지보수인지는
-- 사람만 안다. 그래서 사람이 정하고, 정한 것을 여기 남긴다.
--
-- 설계에서 지킨 것
--   · 달마다 따로 둔다. 기본키가 (m, team, pname) 이다.
--     7월 매칭을 고쳐도 8월 행은 건드려지지 않는다 — 애초에 다른 행이다.
--   · 지난 달 매칭은 «새 달의 첫 값» 으로만 쓴다. 이미 저장된 달을 소급해 고치지 않는다.
--   · 프로젝트명을 코드에 박지 않는다. 무엇이 무슨 항목인지는 전부 이 표에 있다.
--   · 고칠 때마다 mp_audit 에 남는다. 누가 · 언제 · 무엇을 · 어떻게.
-- ============================================================================

create table if not exists mp_rev_map (
  m          int  not null,
  team       text not null,
  pname      text not null,
  item       text,           -- 제품 | 상품 | 유지보수 | 유상서비스 | 공사 | 영업수수료
                             -- null 은 «아직 안 정함». 0 이 아니라 빈칸이다.
  src        text,           -- 'auto' 지난 달에서 물려받음 | 'manual' 사람이 정함
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (m, team, pname)
);

-- 지난 달 매칭을 찾을 때 (team, pname) 으로 훑고 최근 달부터 본다
create index if not exists mp_rev_map_tp on mp_rev_map (team, pname, m desc);

-- 그 달 매칭을 다 봤다는 표시. 값이 아니라 «사람이 확인했다» 는 선언이다.
create table if not exists mp_rev_map_done (
  m       int primary key,
  done_at timestamptz not null default now(),
  done_by uuid,
  email   text
);

alter table mp_rev_map      enable row level security;
alter table mp_rev_map_done enable row level security;

-- 읽기 : 이동계획 사용자 전원. 팀장도 자기 팀 매출이 어디에 붙었는지 봐야 한다.
drop policy if exists mp_r on mp_rev_map;
create policy mp_r on mp_rev_map for select using (mp_can_read());
drop policy if exists mp_r on mp_rev_map_done;
create policy mp_r on mp_rev_map_done for select using (mp_can_read());

-- 쓰기 : 관리자만.
-- 월 개폐 조건은 걸지 않는다. 매칭은 마감 뒤에 손보는 일이고,
-- ERP 원본 금액을 바꾸지 않으므로 확정된 달의 «값» 을 흔들지 않는다.
drop policy if exists mp_w on mp_rev_map;
create policy mp_w on mp_rev_map for all
  using (mp_is_admin()) with check (mp_is_admin());
drop policy if exists mp_w on mp_rev_map_done;
create policy mp_w on mp_rev_map_done for all
  using (mp_is_admin()) with check (mp_is_admin());
