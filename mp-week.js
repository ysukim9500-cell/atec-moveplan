/* ============================================================================
 * mp-week.js — 주차별 변동 관리
 *
 * 이 화면의 «월별 변동 요약» 표가 곧 «이동계획차이» 엑셀이다.
 * 계획 → 전주 → 금주와 그 차이를 사람이 옮겨 적지 않는다. 사유만 적는다.
 *
 * v20 에 있던 «계획·전주·금주 대사» 그래픽 카드는 없앴다.
 * 같은 세 숫자를 두 번 보여주는 것이었고, 요약표가 더 정확하고 한눈에 들어온다.
 * 대신 요약표가 팀 필터를 따르게 해서 팀별로도 볼 수 있게 했다.
 * ========================================================================== */
(function (global) {
  'use strict';

  var D = global.MpData, K = global.MpCalc, U = global.MpUI;
  var $ = U.$, $$ = U.$$, esc = U.esc, fmt = U.fmt, fmt0 = U.fmt0, sgn = U.sgn, dcls = U.dcls, pct = U.pct;

  /* 계열 색 — 검증 통과한 조합을 고정 순서로 쓴다 */
  var SERIES = [
    { key: '매출',     color: U.C.plan },
    { key: '매출이익', color: U.C.ol },
    { key: '판관비',   color: U.C.act }
  ];

  var S = { m: null, team: null };

  function canNote(team) {
    return team !== D.TOTAL && MpAuth.canWriteTeam(team);
  }

  /** 그 달·그 팀의 [전주, 금주] 주차 인덱스 */
  function pair(m, team) {
    var cur = K.finalK(m, team);
    return { prev: cur < 0 ? -1 : K.prevWeek(m, team, cur), cur: cur };
  }

  function render() {
    var m = S.m, team = S.team;

    U.tabs($('#wkMonth'), monthTabs(), m, function (v) { S.m = v; render(); });
    U.tabs($('#wkTeam'), [{ id: D.TOTAL, label: '사업부 합계' }].concat(
      D.TEAMS.map(function (t) { return { id: t, label: D.teamName(t) }; })
    ), team, function (v) { S.team = v; render(); });

    $('#wkScope').innerHTML = '<b>' + esc(D.teamName(team)) + '</b> · ' + D.moOf(m) + '월';
    $('#wkSumTitle').textContent = '월별 변동 요약 · ' + D.teamName(team);

    renderSummary(team);
    renderMatrix(m);
    renderTrend(m, team);
  }

  function monthTabs() {
    var out = [];
    for (var mo = 1; mo <= 12; mo++) {
      var m = D.mOf(2026, mo), st = D.stateOf(m);
      out.push({ id: m, label: mo + '월', dim: st === 'closed',
                 mark: st === 'final' ? '🔒' : (st === 'open' ? '●' : '') });
    }
    return out;
  }

  /* ---------- 월별 변동 요약 = 이동계획차이 ---------- */
  function summaryRows(team) {
    var out = [];
    for (var mo = 1; mo <= 12; mo++) {
      var m = D.mOf(2026, mo);
      if (D.isFinal(m)) continue;                 /* 확정된 달은 더 변하지 않는다 */
      var p = pair(m, team);
      SERIES.forEach(function (s) {
        var plan = K.PL(m, team, s.key, s.key === '판관비' ? '합계' : '합계');
        var prv = p.prev < 0 ? null : K.V(m, team, s.key, '합계', p.prev);
        var cur = p.cur < 0 ? null : K.V(m, team, s.key, '합계', p.cur);
        var n = D.findNote('month', m, team, null, s.key, null);
        out.push({
          m: m, item: s.key, plan: plan, prev: prv, cur: cur,
          dPrev: (prv == null || cur == null) ? null : Math.round((cur - prv) * 10) / 10,
          dPlan: (plan == null || cur == null) ? null : Math.round((cur - plan) * 10) / 10,
          note: n ? n.body : '', pk: p.prev, ck: p.cur
        });
      });
    }
    return out;
  }

  function renderSummary(team) {
    var rows = summaryRows(team);
    var editable = canNote(team);
    $('#wkSumSub').textContent = rows.length
      ? ('미마감 ' + (rows.length / 3) + '개월 · 사유는 여기서 적습니다' + (editable ? '' : ' (읽기 전용)'))
      : '미마감 월이 없습니다';

    var h = '<colgroup><col style="width:56px"><col style="width:82px"><col style="width:92px">' +
      '<col style="width:92px"><col style="width:92px"><col style="width:88px"><col style="width:88px"><col></colgroup>' +
      '<thead><tr><th rowspan="2" class="c">월</th><th rowspan="2">항목</th>' +
      '<th colspan="3" class="c gh">기준 금액</th><th colspan="2" class="c gh">증감</th>' +
      '<th rowspan="2">변동 사유</th></tr>' +
      '<tr><th class="n">월간계획</th><th class="n">전주</th><th class="n">금주</th>' +
      '<th class="n">전주 대비</th><th class="n">계획 대비</th></tr></thead><tbody>';

    var BAND = { '매출': 'bd-rev', '매출이익': 'bd-gp', '판관비': 'bd-sga' };
    rows.forEach(function (r, i) {
      var first = i % 3 === 0;
      var wkLb = (r.pk >= 0 ? (r.pk + 1) + '주' : '–') + ' → ' + (r.ck >= 0 ? (r.ck + 1) + '주' : '–');
      h += '<tr class="' + (first ? 'mstart' : '') + (r.m === S.m ? ' msel' : '') + '">';
      if (first) h += '<td class="sec c" rowspan="3">' + D.moOf(r.m) + '월<span class="mini">' + wkLb + '</span></td>';
      h += '<td class="' + BAND[r.item] + '">' + r.item + '</td>' +
        '<td class="n gs">' + fmt0(r.plan) + '</td>' +
        '<td class="n">' + fmt0(r.prev) + '</td>' +
        '<td class="n cur"><b>' + fmt0(r.cur) + '</b></td>' +
        '<td class="n gs ' + dcls(r.dPrev) + '">' + sgn(r.dPrev, 0) + '</td>' +
        '<td class="n ' + dcls(r.dPlan) + '">' + sgn(r.dPlan, 0) + '</td>' +
        '<td class="txt">' + (editable
          ? '<textarea rows="1" class="na" data-mn="' + r.m + '~' + esc(r.item) + '" placeholder="변동 사유">' + esc(r.note) + '</textarea>'
          : (r.note ? esc(r.note) : '<span class="zero">–</span>')) + '</td></tr>';
    });
    $('#tblWeekSum').innerHTML = h + '</tbody>';

    $$('#tblWeekSum textarea.na').forEach(function (ta) {
      ta.style.height = 'auto'; ta.style.height = Math.max(24, ta.scrollHeight) + 'px';
      ta.oninput = function () { this.style.height = 'auto'; this.style.height = Math.max(24, this.scrollHeight) + 'px'; };
      ta.onblur = function () {
        var a = this.dataset.mn.split('~');
        D.setNote('month', +a[0], S.team, null, a[1], null, this.value)
          .then(function () { flash('저장됨'); })
          .catch(function (e) { flash(e.message, true); render(); });
      };
    });
  }

  function flash(msg, err) {
    var el = $('#wkSave');
    el.className = 'chip ' + (err ? 'warn' : 'ok');
    el.textContent = msg;
    clearTimeout(flash.t);
    flash.t = setTimeout(function () { el.className = 'chip'; el.textContent = '저장됨'; }, 2200);
  }

  /* ---------- 팀 × 주차 매트릭스 ---------- */
  function renderMatrix(m) {
    var nW = D.weeksOf(m);
    var h = '<thead><tr><th>팀</th><th class="n">월간계획</th>';
    for (var k = 0; k < nW; k++) h += '<th class="n">' + (k + 1) + '주</th>';
    h += '<th class="n">최종−계획</th><th class="n">달성률</th></tr></thead><tbody>';
    D.TEAMS.concat([D.TOTAL]).forEach(function (t) {
      var pv = K.PL(m, t, '매출', '합계'), ol = K.OL(m, t, '매출', '합계');
      var d = (ol || 0) - (pv || 0);
      h += '<tr' + (t === D.TOTAL ? ' class="grand"' : '') + '><td>' + esc(D.teamName(t)) + '</td>' +
        '<td class="n">' + fmt0(pv) + '</td>';
      for (var k2 = 0; k2 < nW; k2++) {
        var v = K.V(m, t, '매출', '합계', k2);
        h += '<td class="n' + (v == null ? ' zero' : '') + '">' + (v == null ? '–' : fmt0(v)) + '</td>';
      }
      h += '<td class="n ' + dcls(d) + '">' + sgn(d, 0) + '</td>' +
        '<td class="n">' + (pv ? pct(ol / pv) : '–') + '</td></tr>';
    });
    $('#tblWeekMx').innerHTML = h + '</tbody>';
  }

  /* ---------- 주차별 추이 ---------- */
  function renderTrend(m, team) {
    var nW = D.weeksOf(m), labels = [];
    for (var k = 0; k < nW; k++) labels.push((k + 1) + '주');
    U.legend($('#lgWeek'), SERIES.map(function (s) { return { name: s.key, color: s.color }; }));
    U.lineChart($('#chWeek'), {
      labels: labels, h: 230,
      aria: D.moOf(m) + '월 주차별 추이 — 매출 · 매출이익 · 판관비',
      series: SERIES.map(function (s) {
        return { name: s.key, color: s.color,
                 values: labels.map(function (_, k) { return K.V(m, team, s.key, '합계', k); }) };
      })
    });
  }

  /* ---------- 엑셀 내보내기 ----------
     SheetJS 는 880KB 라 이 버튼을 누를 때만 받아 온다. */
  function loadXlsx() {
    if (global.XLSX) return Promise.resolve();
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = 'vendor/xlsx.js';
      s.onload = res;
      s.onerror = function () { rej(new Error('엑셀 모듈을 불러오지 못했습니다.')); };
      document.head.appendChild(s);
    });
  }

  function exportXlsx() {
    var b = $('#btnWkXlsx');
    b.disabled = true; b.textContent = '준비 중…';
    loadXlsx().then(function () {
      var rows = summaryRows(S.team);
      var aoa = [['고객지원사업부 이동계획 변동 — ' + D.teamName(S.team)],
                 ['단위 : 백만원', '기준 ' + new Date().toISOString().slice(0, 10)], [],
                 ['월', '항목', '월간계획', '전주', '금주', '전주 대비', '계획 대비', '변동 사유']];
      rows.forEach(function (r, i) {
        aoa.push([i % 3 === 0 ? (D.moOf(r.m) + '월') : '', r.item,
                  r.plan == null ? null : Math.round(r.plan),
                  r.prev == null ? null : Math.round(r.prev),
                  r.cur == null ? null : Math.round(r.cur),
                  r.dPrev, r.dPlan, r.note || '']);
      });
      var ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = [{ wch: 7 }, { wch: 10 }, { wch: 11 }, { wch: 11 }, { wch: 11 }, { wch: 11 }, { wch: 11 }, { wch: 46 }];
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '이동계획차이');
      XLSX.writeFile(wb, '이동계획차이_' + new Date().toISOString().slice(2, 10).replace(/-/g, '') + '.xlsx');
      b.disabled = false; b.textContent = '엑셀 내보내기';
    }).catch(function (e) {
      b.disabled = false; b.textContent = '엑셀 내보내기';
      flash(e.message, true);
    });
  }

  global.MpWeek = {
    S: S,
    open: function (m, team) {
      S.m = m != null ? m : (S.m != null ? S.m : D.mOf(2026, 9));
      S.team = team || S.team || D.TOTAL;
      render();
      var b = $('#btnWkXlsx');
      if (b && !b._w) { b._w = 1; b.onclick = exportXlsx; }
    },
    render: render
  };
})(window);
