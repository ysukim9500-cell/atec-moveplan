-- ============================================================================
-- 002_submit.sql — 팀별 작성 완료(제출) 기록
--
-- 값은 입력하는 즉시 저장된다. 이 표는 «다 썼다»는 선언을 담는다.
-- 취합하는 쪽은 숫자가 들어왔는지가 아니라 팀장이 끝냈다고 했는지를 알아야 한다.
--
-- sig 는 제출 당시 값의 지문이다. 제출한 뒤에 값을 고치면 지문이 달라지고
-- 화면이 «제출 후 수정됨»으로 알려 준다. 고쳐 놓고 제출을 잊는 일을 막는다.
--
-- 여러 번 실행해도 안전하다.
-- ============================================================================

create table if not exists mp_submit (
  m            int  not null,
  team         text not null,
  k            int  not null,          -- 주차 (0 = 1주)
  submitted_at timestamptz not null default now(),
  submitted_by uuid,
  email        text,
  sig          text,
  primary key (m, team, k)
);

create index if not exists mp_submit_m on mp_submit (m);

alter table mp_submit enable row level security;

-- 읽기 : 이동계획 사용자 전원. 누가 어디까지 냈는지는 다 같이 본다.
drop policy if exists mp_r on mp_submit;
create policy mp_r on mp_submit for select using (mp_can_read());

-- 쓰기 : 자기 팀 · 열린 달만. 관리자도 닫힌 달에는 못 쓴다.
--        mp_can_write() 를 그대로 쓰므로 값 입력과 같은 규칙이다.
drop policy if exists mp_w on mp_submit;
create policy mp_w on mp_submit for all
  using      (mp_can_write(m, team))
  with check (mp_can_write(m, team));
