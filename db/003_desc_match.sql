-- ============================================================================
-- 003_desc_match.sql — 판관비 적요 매칭 확정 기록
--
-- 전월과 당월의 적요는 표기가 조금씩 다르다. 월·일자만 다른 것은 자동으로 묶지만,
-- «같은 항목이라고 확신할 수 없는» 것까지 기계가 정하면 안 된다.
-- 그런 항목은 «확인 필요»로 세워 두고, 사람이 정한 결과를 여기 남긴다.
--
--   mode='merge' → 전월 항목을 당월 to_key 와 같은 것으로 본다
--   mode='keep'  → 서로 다른 것으로 본다 (전월은 «당월 없음», 당월은 «신규»)
--
-- v20 은 이 결정을 브라우저에 저장했다. 그러면 사람마다 다른 숫자를 보게 되므로
-- 서버에 둔다 — 한 사람이 확정하면 모두가 같은 것을 본다.
--
-- 여러 번 실행해도 안전하다.
-- ============================================================================

create table if not exists mp_desc_match (
  m          int  not null,        -- 이 달의 «전월 대비» 매칭
  team       text not null,
  cat        text not null,        -- 비목
  side       text not null,        -- 전월 키, 또는 당월 전용이면 'CURR:' + 키
  mode       text not null check (mode in ('merge', 'keep')),
  to_key     text,                 -- merge 일 때 당월 상대 키
  decided_at timestamptz not null default now(),
  decided_by uuid,
  email      text,
  primary key (m, team, cat, side)
);

create index if not exists mp_desc_match_m on mp_desc_match (m);

alter table mp_desc_match enable row level security;

drop policy if exists mp_r on mp_desc_match;
create policy mp_r on mp_desc_match for select using (mp_can_read());

-- ERP 대사는 그 달을 마감한 뒤에 한다. 그래서 월 개폐 조건을 걸지 않는다
-- (mp_notes 의 erpdiff 와 같은 규칙).
drop policy if exists mp_w on mp_desc_match;
create policy mp_w on mp_desc_match for all
  using (
    mp_aal2() and (mp_my_role() = 'admin' or (mp_my_role() = 'lead' and team = mp_my_team()))
  )
  with check (
    mp_aal2() and (mp_my_role() = 'admin' or (mp_my_role() = 'lead' and team = mp_my_team()))
  );
