-- ============================================================================
-- ATEC 이동계획 (moveplan) — 스키마 · RLS
--
-- 대상   : Supabase 프로젝트 eiyksjcqntenmetmhmij (기존, 통전망·차량·교육과 공유)
-- 접두사 : mp_
-- 원칙   : 공용 테이블(profiles, auth.*)은 건드리지 않는다.
--          화면의 권한 확인은 메뉴 표시용일 뿐이고, 실제 차단은 여기(RLS)가 한다.
--
-- 이 파일은 두 번 실행해도 안전하다 (create if not exists / or replace).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. 기준 축
--    m = year*12 + (month-1)  — 연-월 절대 인덱스. 2026-09 = 24320
--    k = 0-based 주차 인덱스  — 0 = 1주
-- ---------------------------------------------------------------------------


-- ============================================================================
-- 1. 사용자 ↔ 팀 ↔ 역할
--    공용 profiles 에 팀 컬럼이 없어 별도로 둔다. 다른 시스템에 영향이 없다.
-- ============================================================================
create table if not exists mp_members (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  team        text not null,        -- 6팀 중 하나. 관리자는 '*'
  mp_role     text not null check (mp_role in ('admin','lead','viewer')),
  created_at  timestamptz not null default now(),
  created_by  uuid
);

comment on table mp_members is '이동계획 사용자의 소속 팀과 역할. profiles.role(전사)과 별개다.';


-- ============================================================================
-- 2. 월 개폐 상태 · 최종 OL 확정
--    관리자가 월 단위로 열고 닫는다. 열려 있는 동안 1~weeks 주차를 모두 쓸 수 있다.
-- ============================================================================
create table if not exists mp_periods (
  m              int primary key,
  state          text not null default 'closed'
                   check (state in ('open','closed','final')),
  weeks          int  not null default 5 check (weeks between 1 and 6),
  opened_at      timestamptz, opened_by uuid,
  closed_at      timestamptz, closed_by uuid,
  final_k        int,                  -- 최종 OL 로 확정한 주차 (0-based)
  final_at       timestamptz, final_by uuid,
  final_src      text,                 -- 예: 'ERP 마감 · 매출 126건 / 판관비 455건'
  unlock_reason  text                  -- 확정 해제 시 사유 (감사용)
);

comment on column mp_periods.state is 'open=작성 가능 · closed=마감(재개 가능) · final=확정 잠금';


-- ============================================================================
-- 3. 손익 값
--    파생값(합계·매출이익·영업이익·공판·사업부합계·누적)은 저장하지 않는다.
--    화면이 계산한다. 저장하면 반드시 어긋난다.
-- ============================================================================

-- 월간계획 — 연초에 관리자가 일괄 입력하고 잠근다
create table if not exists mp_plan (
  m          int  not null,
  team       text not null,
  sec        text not null,   -- 매출 | 매출원가 | 매출이익 | 판관비 | 공판
  item       text not null,
  val        numeric,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (m, team, sec, item)
);

-- 주차별 OL
create table if not exists mp_week (
  m          int  not null,
  team       text not null,
  sec        text not null,
  item       text not null,
  k          int  not null,
  val        numeric,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (m, team, sec, item, k)
);

create index if not exists mp_week_m_team on mp_week (m, team);


-- ============================================================================
-- 4. 매출현황 상세
--    엑셀 원본은 월당 한 벌뿐이라 주차 이력이 없었다.
--    여기서는 주차(k)를 넣어 이력을 남긴다. 주차를 넘길 때 전주를 복사해 시작한다.
-- ============================================================================
create table if not exists mp_detail (
  id         uuid primary key default gen_random_uuid(),
  m          int  not null,
  team       text not null,
  k          int  not null,
  grp        text not null,   -- 구분: 제품 | 상품 | 유지보수 | 유상 | 공사 | 영업수수료
  item       text not null,   -- 항목명
  rev        numeric,
  cost       numeric,
  note       text,            -- 비고 = 전주대비 변동 내용
  sort       int  not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create index if not exists mp_detail_slot on mp_detail (m, team, k, grp, sort);


-- ============================================================================
-- 5. 변동 사유
--    kind = item   : 손익표 항목 행의 전주대비 변동 내용
--           week   : 주차 단위 사유
--           month  : 월별 변동 요약(차이표)의 사유
--           erpdiff: ERP 확정 대비 차이 사유 — 마감 이후에 쓴다
-- ============================================================================
create table if not exists mp_notes (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('item','week','month','erpdiff')),
  m          int  not null,
  team       text not null,
  sec        text,
  item       text,
  k          int,
  body       text,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- 같은 자리에 사유가 두 줄 생기지 않게 한다
create unique index if not exists mp_notes_slot on mp_notes (
  kind, m, team, coalesce(sec,''), coalesce(item,''), coalesce(k,-1)
);


-- ============================================================================
-- 6. ERP 확정 명세 — 정답지
-- ============================================================================
create table if not exists mp_erp_rev (
  id     bigserial primary key,
  m      int  not null,
  no     text, vno text, sdate date, item text,
  amt    numeric, vat numeric, sum numeric, cost numeric,
  team   text, pcode text, pname text
);
create index if not exists mp_erp_rev_m on mp_erp_rev (m);

create table if not exists mp_erp_sga (
  id       bigserial primary key,
  m        int  not null,
  adate    date, vno text,
  cat      text,      -- 이동계획 비목 (계정명에서 가공)
  acct     text,      -- 계정명 원본
  descr    text,      -- 적요
  amt      numeric,
  team_raw text,      -- 팀명 원본
  mg       text,      -- 관리항목명1
  dept     text, emp text, wdate date
);
create index if not exists mp_erp_sga_m on mp_erp_sga (m);

create table if not exists mp_erp_meta (
  m           int primary key,
  rev_cnt     int, sga_cnt int,
  rev_excl    jsonb,   -- 제외한 영업그룹의 건수·금액 (금액까지 추적한다)
  sga_excl    jsonb,
  uploaded_at timestamptz not null default now(),
  uploaded_by uuid
);


-- ============================================================================
-- 7. ERP 자동가공 매핑
--    매핑에 없는 값은 임의 분류하지 않고 '미분류'로 남겨 사람에게 넘긴다.
--    사람이 지정하면 여기에 쌓여 다음 달부터 자동 적용된다.
-- ============================================================================
create table if not exists mp_acct_map (           -- 계정명 → 이동계획 비목
  acct       text primary key,
  cat        text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table if not exists mp_org_map (            -- 관리항목명1 → 보고조직(6)
  org        text primary key,
  org6       text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);


-- ============================================================================
-- 8. 부속 시트 — 범용 그리드
--    값과 병합 구조만 보존한다. 수식과 셀 서식은 재현하지 않는다.
-- ============================================================================
create table if not exists mp_aux (
  year       int  not null,
  name       text not null,
  rows       jsonb not null default '[]'::jsonb,   -- 2차원 배열
  merges     jsonb not null default '[]'::jsonb,   -- ["A1:P1", ...]
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (year, name)
);


-- ============================================================================
-- 9. 설정 · 변경 이력
-- ============================================================================
create table if not exists mp_config (
  key        text primary key,
  val        jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table if not exists mp_audit (
  id      bigserial primary key,
  at      timestamptz not null default now(),
  user_id uuid, email text,
  action  text,
  m       int, team text, ref text,
  before  text, after text, via text
);
create index if not exists mp_audit_at on mp_audit (at desc);


-- ============================================================================
-- 10. 헬퍼 함수
--     security definer 로 두어 RLS 재귀를 피한다.
-- ============================================================================

-- 2단계 인증(TOTP)까지 통과했는가.
-- 비밀번호만으로 얻은 토큰은 aal1 이라 여기서 걸린다.
create or replace function mp_aal2() returns boolean
  language sql stable as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
$$;

create or replace function mp_my_role() returns text
  language sql stable security definer set search_path = public as $$
  select x.mp_role from mp_members x where x.user_id = auth.uid()
$$;

create or replace function mp_my_team() returns text
  language sql stable security definer set search_path = public as $$
  select x.team from mp_members x where x.user_id = auth.uid()
$$;

create or replace function mp_month_state(p_m int) returns text
  language sql stable security definer set search_path = public as $$
  select coalesce((select p.state from mp_periods p where p.m = p_m), 'closed')
$$;

-- 읽기 : 승인 + 2단계 인증을 통과한 이동계획 사용자면 전 팀을 읽는다.
--        팀장도 사업부 전체를 봐야 하기 때문이다.
create or replace function mp_can_read() returns boolean
  language sql stable as $$
  select mp_aal2() and mp_my_role() is not null
$$;

-- 쓰기 : 열려 있는 달에만 쓴다. 관리자도 예외가 아니다.
--        닫힌 달을 고치려면 먼저 그 달을 다시 열어야 하고, 그 행위 자체가 기록된다.
create or replace function mp_can_write(p_m int, p_team text) returns boolean
  language sql stable as $$
  select mp_aal2()
     and mp_month_state(p_m) = 'open'
     and (
           mp_my_role() = 'admin'
        or (mp_my_role() = 'lead' and p_team = mp_my_team())
     )
$$;

-- 월간계획 : 관리자만. 확정된 달은 잠긴다.
create or replace function mp_can_write_plan(p_m int) returns boolean
  language sql stable as $$
  select mp_aal2() and mp_my_role() = 'admin' and mp_month_state(p_m) <> 'final'
$$;

-- 관리자 전용 영역 (주차 개폐 · 팀원 · ERP · 매핑 · 설정)
create or replace function mp_is_admin() returns boolean
  language sql stable as $$
  select mp_aal2() and mp_my_role() = 'admin'
$$;


-- ============================================================================
-- 11. RLS
--     모든 mp_ 테이블에 켠다. 정책이 없는 테이블은 아무도 못 읽는다(기본 거부).
-- ============================================================================
alter table mp_members   enable row level security;
alter table mp_periods   enable row level security;
alter table mp_plan      enable row level security;
alter table mp_week      enable row level security;
alter table mp_detail    enable row level security;
alter table mp_notes     enable row level security;
alter table mp_erp_rev   enable row level security;
alter table mp_erp_sga   enable row level security;
alter table mp_erp_meta  enable row level security;
alter table mp_acct_map  enable row level security;
alter table mp_org_map   enable row level security;
alter table mp_aux       enable row level security;
alter table mp_config    enable row level security;
alter table mp_audit     enable row level security;

-- ---- 읽기 : 이동계획 사용자 전원 -------------------------------------------
drop policy if exists mp_r on mp_members;   create policy mp_r on mp_members   for select using (mp_can_read());
drop policy if exists mp_r on mp_periods;   create policy mp_r on mp_periods   for select using (mp_can_read());
drop policy if exists mp_r on mp_plan;      create policy mp_r on mp_plan      for select using (mp_can_read());
drop policy if exists mp_r on mp_week;      create policy mp_r on mp_week      for select using (mp_can_read());
drop policy if exists mp_r on mp_detail;    create policy mp_r on mp_detail    for select using (mp_can_read());
drop policy if exists mp_r on mp_notes;     create policy mp_r on mp_notes     for select using (mp_can_read());
drop policy if exists mp_r on mp_erp_rev;   create policy mp_r on mp_erp_rev   for select using (mp_can_read());
drop policy if exists mp_r on mp_erp_sga;   create policy mp_r on mp_erp_sga   for select using (mp_can_read());
drop policy if exists mp_r on mp_erp_meta;  create policy mp_r on mp_erp_meta  for select using (mp_can_read());
drop policy if exists mp_r on mp_acct_map;  create policy mp_r on mp_acct_map  for select using (mp_can_read());
drop policy if exists mp_r on mp_org_map;   create policy mp_r on mp_org_map   for select using (mp_can_read());
drop policy if exists mp_r on mp_aux;       create policy mp_r on mp_aux       for select using (mp_can_read());
drop policy if exists mp_r on mp_config;    create policy mp_r on mp_config    for select using (mp_can_read());
drop policy if exists mp_r on mp_audit;     create policy mp_r on mp_audit     for select using (mp_can_read());

-- ---- 쓰기 : 팀 · 개폐 상태로 갈린다 ----------------------------------------
drop policy if exists mp_w on mp_week;
create policy mp_w on mp_week for all
  using      (mp_can_write(m, team))
  with check (mp_can_write(m, team));

drop policy if exists mp_w on mp_detail;
create policy mp_w on mp_detail for all
  using      (mp_can_write(m, team))
  with check (mp_can_write(m, team));

-- 변동 사유 : ERP 차이 사유(erpdiff)는 마감 뒤에 쓰는 항목이라 개폐 조건을 걸지 않는다.
drop policy if exists mp_w on mp_notes;
create policy mp_w on mp_notes for all
  using (
    case when kind = 'erpdiff'
         then mp_aal2() and (mp_my_role() = 'admin' or (mp_my_role() = 'lead' and team = mp_my_team()))
         else mp_can_write(m, team)
    end
  )
  with check (
    case when kind = 'erpdiff'
         then mp_aal2() and (mp_my_role() = 'admin' or (mp_my_role() = 'lead' and team = mp_my_team()))
         else mp_can_write(m, team)
    end
  );

-- 월간계획 : 관리자만
drop policy if exists mp_w on mp_plan;
create policy mp_w on mp_plan for all
  using      (mp_can_write_plan(m))
  with check (mp_can_write_plan(m));

-- 부속 시트 : 이동계획 사용자면 편집 가능 (연도 단위 문서라 월 개폐와 무관)
drop policy if exists mp_w on mp_aux;
create policy mp_w on mp_aux for all
  using      (mp_aal2() and mp_my_role() in ('admin','lead'))
  with check (mp_aal2() and mp_my_role() in ('admin','lead'));

-- ---- 관리자 전용 -----------------------------------------------------------
drop policy if exists mp_w on mp_members;   create policy mp_w on mp_members   for all using (mp_is_admin()) with check (mp_is_admin());
drop policy if exists mp_w on mp_periods;   create policy mp_w on mp_periods   for all using (mp_is_admin()) with check (mp_is_admin());
drop policy if exists mp_w on mp_erp_rev;   create policy mp_w on mp_erp_rev   for all using (mp_is_admin()) with check (mp_is_admin());
drop policy if exists mp_w on mp_erp_sga;   create policy mp_w on mp_erp_sga   for all using (mp_is_admin()) with check (mp_is_admin());
drop policy if exists mp_w on mp_erp_meta;  create policy mp_w on mp_erp_meta  for all using (mp_is_admin()) with check (mp_is_admin());
drop policy if exists mp_w on mp_acct_map;  create policy mp_w on mp_acct_map  for all using (mp_is_admin()) with check (mp_is_admin());
drop policy if exists mp_w on mp_org_map;   create policy mp_w on mp_org_map   for all using (mp_is_admin()) with check (mp_is_admin());
drop policy if exists mp_w on mp_config;    create policy mp_w on mp_config    for all using (mp_is_admin()) with check (mp_is_admin());

-- ---- 감사 이력 : 남기기만 하고 고치거나 지우지 못한다 ----------------------
drop policy if exists mp_i on mp_audit;
create policy mp_i on mp_audit for insert with check (mp_can_read());


-- ============================================================================
-- 12. 기본 설정값
-- ============================================================================
insert into mp_config (key, val) values
  ('gongpan_rate', '0.043'::jsonb)          -- 공판율 4.3% (이동계획 7·8월 전 팀 실측)
on conflict (key) do nothing;

insert into mp_config (key, val) values
  ('teams', '["광역교통지원팀","택시지원파트","리페어팀","수도권버스지원팀","AFC지원파트","실공통"]'::jsonb)
on conflict (key) do nothing;
