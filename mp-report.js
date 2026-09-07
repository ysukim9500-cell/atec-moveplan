/* ============================================================================
 * mp-report.js — 리포트 · 내려받기
 *
 * 보고에 그대로 쓰는 문서 한 장이다. 화면에 보이는 것이 인쇄물이고 PDF다.
 * 대시보드와 다른 점은 «고르는 화면»이 아니라 «넘기는 문서»라는 것이다 —
 * 필터는 위에 두고, 아래는 종이처럼 위에서 아래로 읽힌다.
 *
 * 숫자는 새로 만들지 않는다. 마감된 달은 확정 실적, 아직인 달은 최종 OL 을
 * 그대로 가져다 쓴다(MpCalc.blend). 리포트가 자기만의 계산을 하면
 * 화면과 보고서의 숫자가 갈라진다.
 * ========================================================================== */
(function (global) {
  'use strict';

  var D = global.MpData, K = global.MpCalc, U = global.MpUI;
  var $ = U.$, $$ = U.$$, esc = U.esc, fmt = U.fmt, sgn = U.sgn, dcls = U.dcls, pct = U.pct;

  var YEAR = 2026;
  var S = { scope: 'ytd', m: null, team: D.TOTAL };

  /* 손익 7줄 — 화면 어디서나 같은 순서로 읽히게 한다 */
  var LINES = [
    { k: 'rev',     label: '매출' },
    { k: 'cost',    label: '매출원가' },
    { k: 'gp',      label: '매출이익' },
    { k: 'sga',     label: '판관비' },
    { k: 'op',      label: '영업이익',        strong: true },
    { k: 'gongpan', label: '공판' },
    { k: 'op2',     label: '공판후영업이익',  strong: true }
  ];

  var SCOPES = [
    { id: 'm',   label: '당월' },
    { id: 'q',   label: '해당 분기' },
    { id: 'h',   label: '해당 반기' },
    { id: 'ytd', label: '누적 (1월~기준월)' },
    { id: 'y',   label: '연간' }
  ];

  function monthsOf() {
    var mo = D.moOf(S.m), out = [], i;
    if (S.scope === 'm') return [S.m];
    if (S.scope === 'y') { for (i = 1; i <= 12; i++) out.push(D.mOf(YEAR, i)); return out; }
    if (S.scope === 'ytd') { for (i = 1; i <= mo; i++) out.push(D.mOf(YEAR, i)); return out; }
    if (S.scope === 'q') {
      var q0 = Math.floor((mo - 1) / 3) * 3 + 1;
      for (i = q0; i < q0 + 3; i++) out.push(D.mOf(YEAR, i));
      return out;
    }
    var h0 = mo <= 6 ? 1 : 7;
    for (i = h0; i < h0 + 6; i++) out.push(D.mOf(YEAR, i));
    return out;
  }

  function scopeLabel() {
    var mo = D.moOf(S.m);
    if (S.scope === 'm') return mo + '월';
    if (S.scope === 'y') return '연간';
    if (S.scope === 'ytd') return '1월~' + mo + '월 누적';
    if (S.scope === 'q') return Math.floor((mo - 1) / 3) + 1 + '분기';
    return (mo <= 6 ? '상반기' : '하반기');
  }

  /** 그 달의 확정 실적, 없으면 최종 OL. 둘 중 무엇인지도 같이 돌려준다. */
  function pick(m, team) {
    var a = K.act(m, team);
    if (a) return { v: a, src: '실적' };
    return { v: K.metrics(m, team, 'ol'), src: '최종 OL' };
  }

  /* ==========================================================================
   * 화면
   * ======================================================================== */
  function render() {
    U.tabs($('#rpMonth'), monthTabs(), S.m, function (v) { S.m = v; render(); });
    U.tabs($('#rpScope'), SCOPES, S.scope, function (v) { S.scope = v; render(); });
    U.tabs($('#rpTeam'), [{ id: D.TOTAL, label: '사업부 합계' }].concat(
      D.TEAMS.map(function (t) { return { id: t, label: D.teamName(t) }; })),
      S.team, function (v) { S.team = v; render(); });

    var ms = monthsOf(), team = S.team;
    var b = K.blend(ms, team);
    var p = K.sumMetrics(ms, team, 'plan') || {};

    /* ---- 표제 ---- */
    $('#rpTitle').textContent = D.teamName(team) + ' 이동계획 · ' + YEAR + '년 ' + scopeLabel();
    $('#rpStamp').innerHTML =
      '기준 ' + D.moOf(S.m) + '월 · ' + esc(scopeLabel()) +
      ' · 작성 ' + U.ymdhm() + ' (KST)' +
      ' · ' + esc((MpAuth.me() || {}).name || '');
    $('#rpBasis').innerHTML = basisNote(b, ms);

    renderSummary(b, p);
    renderMonthly(ms, team);
    renderTeams(ms);
    renderNotes(ms);
    $('#rpUnit').textContent = '단위 : 백만원';
  }

  function p2(n) { return (n < 10 ? '0' : '') + n; }

  /**
   * 계획 대비 비율.
   * 기준이 0 이하면 비율을 내지 않는다 — 계획이 −72.8 인데 실적이 +482.2 면
   * 산술적으로는 −662% 가 나오지만 그건 읽는 사람을 속이는 숫자다.
   * 그런 줄은 금액 차이로만 읽어야 한다.
   */
  function ratio(v, base) {
    return (base == null || v == null || base <= 0) ? '–' : pct(v / base);
  }

  function monthTabs() {
    var out = [];
    for (var mo = 1; mo <= 12; mo++) {
      var m = D.mOf(YEAR, mo), st = D.stateOf(m);
      out.push({ id: m, label: mo + '월',
                 mark: st === 'final' ? '🔒' : (st === 'open' ? '●' : ''),
                 dim: st === 'closed' });
    }
    return out;
  }

  /** 이 숫자가 무엇으로 이루어졌는지 먼저 밝힌다. 보고서에서 제일 중요한 한 줄이다. */
  function basisNote(b, ms) {
    var cl = b.closed.map(D.moOf), op = b.open.map(D.moOf);
    if (!cl.length) return '전 기간이 <b>최종 OL(전망)</b> 입니다. ERP 확정본이 올라온 달이 없습니다.';
    if (!op.length) return '전 기간이 <b>ERP 확정 실적</b> 입니다 — ' + cl.join(', ') + '월.';
    return '<b>' + cl.join(', ') + '월은 ERP 확정 실적</b>, <b>' + op.join(', ') + '월은 최종 OL(전망)</b> 입니다. ' +
      '두 가지를 더한 값이므로 전액이 확정된 숫자가 아닙니다.';
  }

  /* ---- 1. 손익 요약 ---- */
  function renderSummary(b, p) {
    var h = '<thead><tr><th style="width:190px">항목</th>' +
      '<th class="n">월간계획</th><th class="n">' + esc(b.label) + '</th>' +
      '<th class="n">차이</th><th class="n">계획 대비</th></tr></thead><tbody>';
    LINES.forEach(function (L) {
      var pv = p[L.k], av = b[L.k];
      var d = (pv == null || av == null) ? null : av - pv;
      h += '<tr' + (L.strong ? ' class="grand"' : '') + '><td>' + L.label + '</td>' +
        '<td class="n gs">' + fmt(pv) + '</td><td class="n cur"><b>' + fmt(av) + '</b></td>' +
        '<td class="n ' + dcls(d) + '">' + sgn(d) + '</td>' +
        '<td class="n">' + ratio(av, pv) + '</td></tr>';
    });
    h += '<tr class="rate"><td>매출이익률</td><td class="n gs">' + (p.rev ? pct(p.gp / p.rev) : '–') + '</td>' +
      '<td class="n cur">' + (b.rev ? pct(b.gp / b.rev) : '–') + '</td><td class="n"></td><td class="n"></td></tr>';
    $('#tblRpSum').innerHTML = h + '</tbody>';
  }

  /* ---- 2. 월별 추이 ---- */
  function renderMonthly(ms, team) {
    var h = '<thead><tr><th style="width:64px">월</th><th style="width:76px">구분</th>' +
      '<th class="n">매출</th><th class="n">매출이익</th><th class="n">판관비</th>' +
      '<th class="n">영업이익</th><th class="n">공판</th><th class="n">공판후영업이익</th>' +
      '<th class="n">계획 매출</th><th class="n">계획 대비</th></tr></thead><tbody>';
    var tot = { rev: 0, gp: 0, sga: 0, op: 0, gongpan: 0, op2: 0, prev: 0 };
    ms.forEach(function (m) {
      var r = pick(m, team), v = r.v || {};
      var pv = K.PL(m, team, '매출', '합계');
      ['rev', 'gp', 'sga', 'op', 'gongpan', 'op2'].forEach(function (k) { if (v[k] != null) tot[k] += v[k]; });
      if (pv != null) tot.prev += pv;
      h += '<tr><td><b>' + D.moOf(m) + '월</b></td>' +
        '<td><span class="src ' + (r.src === '실적' ? 'act' : 'ol') + '">' + r.src + '</span></td>' +
        '<td class="n">' + fmt(v.rev) + '</td><td class="n">' + fmt(v.gp) + '</td>' +
        '<td class="n">' + fmt(v.sga) + '</td><td class="n">' + fmt(v.op) + '</td>' +
        '<td class="n">' + fmt(v.gongpan) + '</td><td class="n"><b>' + fmt(v.op2) + '</b></td>' +
        '<td class="n gs">' + fmt(pv) + '</td>' +
        '<td class="n">' + ratio(v.rev, pv) + '</td></tr>';
    });
    h += '<tr class="grand"><td>합계</td><td></td>' +
      '<td class="n">' + fmt(tot.rev) + '</td><td class="n">' + fmt(tot.gp) + '</td>' +
      '<td class="n">' + fmt(tot.sga) + '</td><td class="n">' + fmt(tot.op) + '</td>' +
      '<td class="n">' + fmt(tot.gongpan) + '</td><td class="n"><b>' + fmt(tot.op2) + '</b></td>' +
      '<td class="n gs">' + fmt(tot.prev) + '</td>' +
      '<td class="n">' + ratio(tot.rev, tot.prev) + '</td></tr>';
    $('#tblRpMonth').innerHTML = h + '</tbody>';
  }

  /* ---- 3. 팀별 ---- */
  function renderTeams(ms) {
    var h = '<thead><tr><th>팀</th><th class="n">계획 매출</th><th class="n">매출</th>' +
      '<th class="n">계획 대비</th><th class="n">매출이익</th><th class="n">이익률</th>' +
      '<th class="n">판관비</th><th class="n">공판후영업이익</th></tr></thead><tbody>';
    var t = { pv: 0, rev: 0, gp: 0, sga: 0, op2: 0 };
    D.TEAMS.forEach(function (tm) {
      var b = K.blend(ms, tm);
      var pm = K.sumMetrics(ms, tm, 'plan') || {};
      var pv = pm.rev;
      t.pv += pv || 0; t.rev += b.rev; t.gp += b.gp; t.sga += b.sga; t.op2 += b.op2;
      h += '<tr><td>' + esc(D.teamName(tm)) + '</td>' +
        '<td class="n gs">' + fmt(pv) + '</td><td class="n"><b>' + fmt(b.rev) + '</b></td>' +
        '<td class="n">' + ratio(b.rev, pv) + '</td>' +
        '<td class="n">' + fmt(b.gp) + '</td>' +
        '<td class="n">' + (b.rev ? pct(b.gp / b.rev) : '–') + '</td>' +
        '<td class="n">' + fmt(b.sga) + '</td><td class="n">' + fmt(b.op2) + '</td></tr>';
    });
    /* ERP 에서 어느 팀에도 붙지 않은 금액. 이 줄이 없으면 팀 합과 사업부 합계가 어긋난다. */
    var un = { rev: 0, cost: 0, sga: 0 };
    ms.forEach(function (m) {
      var ag = D.erpAgg(m);
      if (ag && ag.unassigned) { un.rev += ag.unassigned.rev; un.sga += ag.unassigned.sga; }
    });
    if (Math.abs(un.rev) >= 0.05 || Math.abs(un.sga) >= 0.05) {
      t.rev += un.rev; t.sga += un.sga;
      h += '<tr><td>미배분 <span class="bdg">조직 매핑 없음</span></td>' +
        '<td class="n gs">–</td><td class="n"><b>' + fmt(un.rev) + '</b></td>' +
        '<td class="n">–</td><td class="n">–</td><td class="n">–</td>' +
        '<td class="n">' + fmt(un.sga) + '</td><td class="n">–</td></tr>';
    }
    h += '<tr class="grand"><td>사업부 합계</td><td class="n gs">' + fmt(t.pv) + '</td>' +
      '<td class="n"><b>' + fmt(t.rev) + '</b></td>' +
      '<td class="n">' + ratio(t.rev, t.pv) + '</td>' +
      '<td class="n">' + fmt(t.gp) + '</td>' +
      '<td class="n">' + (t.rev ? pct(t.gp / t.rev) : '–') + '</td>' +
      '<td class="n">' + fmt(t.sga) + '</td><td class="n">' + fmt(t.op2) + '</td></tr>';
    $('#tblRpTeam').innerHTML = h + '</tbody>';
  }

  /* ---- 4. 변동 사유 ---- */
  function noteRows(ms) {
    var out = [];
    ms.forEach(function (m) {
      D.S.notes.forEach(function (n) {
        if (n.m !== m || !n.body) return;
        if (n.kind !== 'month' && n.kind !== 'erpdiff') return;
        if (S.team !== D.TOTAL && n.team !== S.team) return;
        out.push({
          m: m, team: n.team,
          kind: n.kind === 'erpdiff' ? 'ERP 확정 차이' : '주차 변동',
          item: n.item || (n.sec || ''), body: n.body
        });
      });
    });
    return out;
  }
  function renderNotes(ms) {
    var rows = noteRows(ms);
    $('#rpNoteSub').textContent = rows.length ? rows.length + '건' : '해당 기간에 기록된 사유가 없습니다';
    if (!rows.length) { $('#tblRpNote').innerHTML = '<tbody><tr><td class="q">—</td></tr></tbody>'; return; }
    var h = '<thead><tr><th style="width:56px">월</th><th style="width:150px">팀</th>' +
      '<th style="width:110px">구분</th><th style="width:90px">항목</th><th>내용</th></tr></thead><tbody>';
    var last = null;
    rows.forEach(function (r) {
      var newM = r.m !== last; last = r.m;
      h += '<tr' + (newM ? ' class="mstart"' : '') + '>' +
        '<td>' + (newM ? '<b>' + D.moOf(r.m) + '월</b>' : '') + '</td>' +
        '<td class="q">' + esc(D.teamName(r.team)) + '</td>' +
        '<td><span class="src ' + (r.kind === 'ERP 확정 차이' ? 'act' : 'ol') + '">' + r.kind + '</span></td>' +
        '<td>' + esc(r.item) + '</td>' +
        '<td class="txt">' + esc(r.body) + '</td></tr>';
    });
    $('#tblRpNote').innerHTML = h + '</tbody>';
  }

  /* ==========================================================================
   * 내려받기
   * ======================================================================== */
  function loadXlsx() { return MpXlsx.loadXlsx(); }

  /** 화면에 그린 표를 그대로 시트로 옮긴다 — 보고서와 파일이 어긋나지 않게. */
  function tableToAoa(sel) {
    var out = [];
    $$(sel + ' tr').forEach(function (tr) {
      var row = [];
      $$('th,td', tr).forEach(function (c) {
        var t = c.textContent.trim();
        if (!t || t === '–') { row.push(null); return; }
        /* 부호가 붙은 숫자(+2,137.7 · −555.0)를 글자로 넣으면 엑셀에서
           합계도 정렬도 되지 않는다. 게다가 화면의 − 는 U+2212 라
           엑셀이 숫자로 읽지도 못한다. 부호를 풀어서 넣는다. */
        var n = t.replace(/,/g, '').replace(/^\+/, '').replace(/^−/, '-');
        row.push(/^-?\d+(\.\d+)?$/.test(n) ? Number(n) : t);
        /* 병합된 칸만큼 빈 칸을 채워 열이 밀리지 않게 한다 */
        var span = +(c.getAttribute('colspan') || 1);
        for (var i = 1; i < span; i++) row.push(null);
      });
      out.push(row);
    });
    return out;
  }

  function exportXlsx() {
    var b = $('#btnRpXlsx');
    b.disabled = true; b.textContent = '준비 중…';
    loadXlsx().then(function () {
      /* 원본 «이동계획.xlsx» 의 월 시트를 그대로 만들고, 요약 네 장을 앞에 붙인다 */
      var wb = MpXlsx.planBook(monthsOf());
      var head = [
        [D.teamName(S.team) + ' 이동계획 · ' + YEAR + '년 ' + scopeLabel()],
        [$('#rpBasis').textContent],
        ['단위 : 백만원 · 작성 ' + U.ymdhm() + ' (KST)'],
        []
      ];
      var add = function (name, sel) {
        var ws = XLSX.utils.aoa_to_sheet(head.concat(tableToAoa(sel)));
        XLSX.utils.book_append_sheet(wb, ws, name);
      };
      add('손익요약', '#tblRpSum');
      add('월별', '#tblRpMonth');
      add('팀별', '#tblRpTeam');
      add('변동사유', '#tblRpNote');
      /* 요약을 앞으로 — 원본도 «요약»이 첫 시트다 */
      wb.SheetNames = wb.SheetNames.slice(-4).concat(wb.SheetNames.slice(0, -4));
      XLSX.writeFile(wb, '이동계획_리포트_' + YEAR + '_' + scopeLabel().replace(/[~ ]/g, '') + '_' +
        U.ymd(null, '').slice(2) + '.xlsx');
      b.disabled = false; b.textContent = '엑셀 내려받기';
    }).catch(function (e) {
      alert(e.message);
      b.disabled = false; b.textContent = '엑셀 내려받기';
    });
  }

  global.MpReport = {
    S: S,
    open: function (m) {
      if (m != null) S.m = m;
      if (S.m == null) S.m = D.mOf(YEAR, 1);
      if (!MpReport._b) {
        MpReport._b = true;
        $('#btnRpXlsx').onclick = exportXlsx;
        $('#btnRpPrint').onclick = function () { window.print(); };
      }
      render();
    },
    render: render
  };
})(window);
