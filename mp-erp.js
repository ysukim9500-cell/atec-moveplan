/* ============================================================================
 * mp-erp.js — 확정 판관비 / 매출현황
 *
 * ERP 확정본이 정답지다. 최종 OL 은 예측이었고, 여기서 답을 맞춰 본다.
 *
 * F5  업로드 시트 선택 — 가공본은 피벗과 상세를 한 파일에 함께 담는다.
 *     '합계 : 원화금액' 도 '원화금액' 에 걸리므로 첫 매치를 쓰면 피벗이 잡힌다.
 *     날짜 열까지 가진 시트를 고른다. (mp-import.js pickSheet)
 * F6  매출과 판관비가 둘 다 올라와야 그 달 마감 확정을 제안한다.
 *     판관비만 올라온 상태는 마감이 끝난 것이 아니다.
 *     잠금은 되돌리기 어려우니 자동이 아니라 확인을 받는다.
 * ========================================================================== */
(function (global) {
  'use strict';

  var D = global.MpData, K = global.MpCalc, U = global.MpUI;
  var $ = U.$, $$ = U.$$, esc = U.esc, fmt = U.fmt, fmt0 = U.fmt0, dcls = U.dcls, pct = U.pct;

  var S = { m: null, kind: 'sga', unit: 'M', open: {}, upload: false };

  function uf(v) {
    if (v == null || isNaN(v)) return '–';
    return S.unit === 'M' ? fmt(v) : fmt0(v * 1e6);
  }
  function us(v) {
    if (v == null || isNaN(v)) return '–';
    var s = v > 0.005 ? '+' : v < -0.005 ? '−' : '';
    return s + (S.unit === 'M' ? fmt(Math.abs(v)) : fmt0(Math.abs(v) * 1e6));
  }
  function admin() { return MpAuth.isAdmin(); }

  function flash(msg, err) {
    var el = $('#erpSave');
    el.className = 'chip ' + (err ? 'warn' : 'ok');
    el.textContent = msg;
    clearTimeout(flash.t);
    flash.t = setTimeout(function () { el.className = 'chip'; el.textContent = '—'; }, 2600);
  }

  /* 적요 정규화 — 월·일자만 다른 같은 건을 한 항목으로 묶는다.
     화면에는 원문을 보이고, 묶는 데만 쓴다. */
  function normDesc(s) {
    return String(s || '')
      .replace(/\d{4}[-.\/]\d{1,2}[-.\/]\d{1,2}/g, '@일자@')
      .replace(/\d{1,2}\s*\/\s*\d{1,2}/g, '@일자@')
      .replace(/\d{1,2}\s*월/g, '@월@')
      .replace(/\s+/g, ' ').trim();
  }

  /* ==========================================================================
   * 화면
   * ======================================================================== */
  function render() {
    var m = S.m;

    U.tabs($('#erpMonth'), monthTabs(), m, function (v) {
      S.m = v; S.open = {};
      D.loadErp(v).then(render).catch(render);
    });
    U.tabs($('#erpUnit'), [{ id: 'M', label: '백만원' }, { id: 'W', label: '원' }],
      S.unit, function (v) { S.unit = v; render(); });
    U.tabs($('#erpKind'), [{ id: 'sga', label: '판관비 명세' }, { id: 'rev', label: '매출 명세' }],
      S.kind, function (v) { S.kind = v; render(); });

    $('#erpUpCard').classList.toggle('hide', !(admin() && S.upload));
    $('#btnErpUp').classList.toggle('hide', !admin());
    $('#btnErpUp').textContent = S.upload ? 'ERP 올리기 닫기' : 'ERP 확정본 올리기';

    var meta = D.S.erpMeta[m];
    var st = $('#erpState');
    if (!meta) {
      st.className = 'chip warn';
      st.textContent = D.yOf(m) + '년 ' + D.moOf(m) + '월 — 확정본 없음';
      $('#erpBody').classList.add('hide');
      $('#erpEmpty').classList.remove('hide');
      $('#erpEmpty').innerHTML = '<b>' + D.moOf(m) + '월</b> ERP 확정본이 아직 올라오지 않았습니다. ' +
        '매출현황·판관비 엑셀은 그 달 마지막 OL 이 끝난 뒤 다음 달 초에 나옵니다.' +
        (admin() ? ' 위 <b>ERP 확정본 올리기</b> 로 등록하세요.' : ' 경영지원팀이 등록하면 여기에 표시됩니다.');
      renderClose();
      return;
    }
    st.className = 'chip ok';
    st.innerHTML = D.yOf(m) + '년 ' + D.moOf(m) + '월 확정 · 매출 <b>' + meta.rev_cnt +
      '</b>건 / 판관비 <b>' + meta.sga_cnt + '</b>건';
    $('#erpEmpty').classList.add('hide');
    $('#erpBody').classList.remove('hide');

    var ag = D.erpAgg(m);
    if (!ag) { $('#erpKpi').innerHTML = '<div class="note info">명세를 불러오는 중입니다…</div>'; return; }

    renderRecon(m);
    $('#erpSga').classList.toggle('hide', S.kind !== 'sga');
    $('#erpRev').classList.toggle('hide', S.kind !== 'rev');
    if (S.kind === 'sga') renderSga(m); else renderRev(m);
    renderClose();
  }

  function monthTabs() {
    var out = [];
    for (var mo = 1; mo <= 12; mo++) {
      var m = D.mOf(2026, mo), has = !!D.S.erpMeta[m];
      out.push({ id: m, label: mo + '월', dim: !has,
                 mark: D.isFinal(m) ? '🔒' : (has ? '●' : ''),
                 title: has ? 'ERP 확정본 등록됨' : '확정본 없음' });
    }
    return out;
  }

  /* ---------- 대사 : 최종 OL vs 확정 ---------- */
  var RECON = [
    ['매출', '합계', '매출'],
    ['매출원가', '합계', '매출원가'],
    ['매출이익', '합계', '매출이익'],
    ['판관비', '합계', '판관비'],
    ['영업이익', '계', '영업이익'],
    ['공판', '계', '공판'],
    ['공판후영업이익', '계', '공판후영업이익']
  ];

  function renderRecon(m) {
    var a = K.act(m, D.TOTAL), o = K.metrics(m, D.TOTAL, 'ol'), p = K.metrics(m, D.TOTAL, 'plan');
    var fk = K.finalK(m, D.TEAMS[0]);
    $('#erpSub').textContent = '최종 OL = ' + (fk >= 0 ? (fk + 1) + '주' : '미기입') +
      ' · 개발비는 ERP 에 없어 최종 OL 값을 그대로 씁니다';

    $('#erpKpi').innerHTML =
      kpi('확정 매출', uf(a.rev), [['최종 OL', uf(o.rev), o.rev == null ? null : a.rev - o.rev],
                                   ['달성률', o.rev ? pct(a.rev / o.rev) : '–', null]]) +
      kpi('확정 매출이익', uf(a.gp), [['최종 OL', uf(o.gp), o.gp == null ? null : a.gp - o.gp],
                                     ['이익률', a.rev ? pct(a.gp / a.rev) : '–', null]]) +
      kpi('확정 판관비', uf(a.sga), [['최종 OL', uf(o.sga), o.sga == null ? null : a.sga - o.sga],
                                    ['집행률', o.sga ? pct(a.sga / o.sga) : '–', null]]) +
      kpi('공판후영업이익', uf(a.op2), [['최종 OL', uf(o.op2), o.op2 == null ? null : a.op2 - o.op2],
                                       ['월간계획', uf(p.op2), p.op2 == null ? null : a.op2 - p.op2]]);

    var key = { '매출': 'rev', '매출원가': 'cost', '매출이익': 'gp', '판관비': 'sga',
                '영업이익': 'op', '공판': 'gongpan', '공판후영업이익': 'op2' };
    /* 차이 사유는 마감 뒤에 쓰는 항목이라 달이 잠겨도 막지 않는다 — RLS 도 같다.
       이 표는 사업부 합계 기준이라 팀장은 쓸 자리가 없다. */
    var can = admin();
    var h = '<thead><tr><th style="width:150px">항목</th><th class="n" style="width:96px">월간계획</th>' +
      '<th class="n" style="width:96px">최종 OL</th><th class="n cur" style="width:100px">확정</th>' +
      '<th class="n" style="width:104px">OL 차이</th><th class="n" style="width:74px">달성률</th>' +
      '<th>차이 사유</th></tr></thead><tbody>';
    RECON.forEach(function (r) {
      var sec = r[0], item = r[1], label = r[2], kk = key[label];
      var pv = p[kk], ov = o[kk], av = a[kk];
      var d = (av == null || ov == null) ? null : av - ov;
      var n = D.findNote('erpdiff', m, D.TOTAL, sec, item, null);
      var body = n ? n.body : '';
      var big = d != null && ov && Math.abs(d / ov) >= 0.05;
      h += '<tr' + (label === '공판후영업이익' ? ' class="grand"' : '') + '>' +
        '<td><b>' + label + '</b></td>' +
        '<td class="n gs">' + uf(pv) + '</td><td class="n">' + uf(ov) + '</td>' +
        '<td class="n cur"><b>' + uf(av) + '</b></td>' +
        '<td class="n ' + dcls(d) + '">' + us(d) + (big ? ' <span class="bdg">5%↑</span>' : '') + '</td>' +
        '<td class="n">' + (ov ? pct(av / ov) : '–') + '</td>' +
        '<td class="txt">' + (can
          ? '<textarea rows="1" class="na" data-en="' + esc(sec + '~' + item) + '" placeholder="' +
            (big ? '차이가 5% 를 넘습니다 — 사유를 적어 주세요' : '차이 사유') + '">' + esc(body) + '</textarea>'
          : (body ? esc(body) : '<span class="zero">–</span>')) + '</td></tr>';

      /* 개발비를 따로 세워 둔다. 이게 없으면 매출 − 매출원가 가 매출이익과 맞지 않아
         보는 사람이 계산을 의심하게 된다. 연구소에 주는 고정비라 ERP 에는 없다. */
      if (label === '매출이익') {
        var dev = a.dev || 0;
        h += '<tr class="devrow"><td class="txt">└ 개발비 <span class="bdg">ERP 미계상</span></td>' +
          '<td class="n gs">' + uf(K.PL(m, D.TOTAL, '매출이익', '개발비')) + '</td>' +
          '<td class="n">' + uf(dev) + '</td><td class="n cur">' + uf(dev) + '</td>' +
          '<td class="n flat">0.0</td><td class="n">–</td>' +
          '<td class="txt q">ERP 에 계상되지 않아 최종 OL 값을 그대로 반영합니다. ' +
          '매출이익 = 매출 − 매출원가 + 개발비.</td></tr>';
      }
    });
    $('#tblErpRecon').innerHTML = h + '</tbody>';
    bindNotes(m);

    /* 팀별 대사 */
    var th = '<thead><tr><th>팀</th>' +
      '<th class="n">OL 매출</th><th class="n cur">확정 매출</th><th class="n">차이</th>' +
      '<th class="n">OL 판관비</th><th class="n cur">확정 판관비</th><th class="n">차이</th>' +
      '<th class="n">확정 공판후영업이익</th></tr></thead><tbody>';
    D.TEAMS.forEach(function (t) {
      var ta = K.act(m, t), to = K.metrics(m, t, 'ol');
      if (!ta) return;
      var dr = to.rev == null ? null : ta.rev - to.rev;
      var ds = to.sga == null ? null : ta.sga - to.sga;
      th += '<tr><td>' + esc(D.teamName(t)) + '</td>' +
        '<td class="n">' + uf(to.rev) + '</td><td class="n cur"><b>' + uf(ta.rev) + '</b></td>' +
        '<td class="n ' + dcls(dr) + '">' + us(dr) + '</td>' +
        '<td class="n">' + uf(to.sga) + '</td><td class="n cur"><b>' + uf(ta.sga) + '</b></td>' +
        '<td class="n ' + dcls(ds) + '">' + us(ds) + '</td>' +
        '<td class="n">' + uf(ta.op2) + '</td></tr>';
    });
    th += '<tr class="grand"><td>사업부 합계</td>' +
      '<td class="n">' + uf(o.rev) + '</td><td class="n cur">' + uf(a.rev) + '</td>' +
      '<td class="n ' + dcls(o.rev == null ? null : a.rev - o.rev) + '">' + us(o.rev == null ? null : a.rev - o.rev) + '</td>' +
      '<td class="n">' + uf(o.sga) + '</td><td class="n cur">' + uf(a.sga) + '</td>' +
      '<td class="n ' + dcls(o.sga == null ? null : a.sga - o.sga) + '">' + us(o.sga == null ? null : a.sga - o.sga) + '</td>' +
      '<td class="n">' + uf(a.op2) + '</td></tr>';
    $('#tblErpTeam').innerHTML = th + '</tbody>';

    /* 팀에 배분되지 않은 판관비 — 조직 매핑이 빠지면 여기 남는다 */
    var ag = D.erpAgg(m), assigned = 0;
    D.TEAMS.forEach(function (t) { assigned += ag.byTeam[t].sga; });
    var un = ag.sga - assigned;
    if (Math.abs(un) < 0.05) $('#erpUnmapped').className = 'hide';
    else {
      $('#erpUnmapped').className = 'note warn';
      $('#erpUnmapped').innerHTML = '판관비 <b>' + uf(un) + '</b>' + (S.unit === 'M' ? '백만원' : '원') +
        ' 이 어느 팀에도 붙지 않았습니다. ERP 조직명이 <b>조직 매핑</b>에 없다는 뜻입니다. ' +
        '사업부 합계에는 들어가지만 팀별 표에는 <b>미배분</b>으로 남습니다.';
    }
  }

  function bindNotes(m) {
    $$('#tblErpRecon textarea.na').forEach(function (ta) {
      var fit = function () { ta.style.height = 'auto'; ta.style.height = Math.max(24, ta.scrollHeight) + 'px'; };
      fit(); ta.oninput = fit;
      ta.onblur = function () {
        var a = this.dataset.en.split('~');
        D.setNote('erpdiff', m, D.TOTAL, a[0], a[1], null, this.value)
          .then(function () { flash('저장됨'); })
          .catch(function (e) { flash(e.message, true); });
      };
    });
  }

  function kpi(label, val, rows) {
    return '<div class="kpi"><div class="lb">' + esc(label) + ' <span class="chip on">확정</span></div>' +
      '<div class="vl">' + val + '<small>' + (S.unit === 'M' ? '백만' : '원') + '</small></div>' +
      rows.map(function (r) {
        return '<div class="row"><span>' + esc(r[0]) + '</span><b>' + r[1] + '</b>' +
          '<span class="d ' + (r[2] == null ? '' : dcls(r[2])) + '">' + (r[2] == null ? '' : us(r[2])) + '</span></div>';
      }).join('') + '</div>';
  }

  /* ---------- 판관비 명세 ---------- */
  function byTeamCat(m) {
    var out = {};
    (D.S.erpSga[m] || []).forEach(function (r) {
      var org6 = D.S.orgMap[r.mg] || D.S.orgMap[r.team_raw] || null;
      var t = org6 ? (D.ORG2TEAM[org6] || null) : null;
      var key = t || '미배분';
      var o = out[key] || (out[key] = { total: 0, cat: {}, desc: {} });
      var a = Number(r.amt) / 1e6;
      o.total += a;
      var c = r.cat || '미분류';
      o.cat[c] = (o.cat[c] || 0) + a;
      var nd = normDesc(r.descr) || ('(' + (r.acct || c) + ')');
      var d = o.desc[nd] || (o.desc[nd] = { amt: 0, raw: r.descr || nd, cat: c });
      d.amt += a;
    });
    return out;
  }

  function renderSga(m) {
    var ag = D.erpAgg(m);
    var prevM = m - 1, hasPrev = !!D.S.erpMeta[prevM] && !!D.S.erpSga[prevM];
    var tc = byTeamCat(m), pc = hasPrev ? byTeamCat(prevM) : null;
    var keys = Object.keys(tc).sort(function (a, b) { return tc[b].total - tc[a].total; });

    $('#sgaPrev').innerHTML = hasPrev
      ? '전월(' + D.moOf(prevM) + '월) 확정본과 비교합니다. 규모 막대는 <b>증감률</b> 크기입니다 — 금액이 아닙니다.'
      : '<b>' + D.moOf(prevM) + '월 확정본이 없어</b> 전월 비교는 비어 있습니다. 당월 금액과 최종 OL 대비만 나옵니다.';

    /* 규모 막대는 증감률 크기다. 금액이 아니다 —
       팀마다 판관비 규모가 달라서 금액으로 그리면 큰 팀만 눈에 띈다. */
    var maxRate = 0;
    keys.forEach(function (t) {
      if (!pc || !pc[t] || !pc[t].total) return;
      var r = Math.abs((tc[t].total - pc[t].total) / pc[t].total);
      if (r > maxRate) maxRate = r;
    });

    var h = '<thead><tr><th style="width:170px">팀</th>' +
      '<th class="n" style="width:96px">' + (hasPrev ? D.moOf(prevM) + '월' : '전월') + '</th>' +
      '<th class="n cur" style="width:96px">' + D.moOf(m) + '월</th>' +
      '<th class="n" style="width:92px">증감액</th><th class="n" style="width:78px">증감률</th>' +
      '<th class="c" style="width:112px">규모</th><th>' +
      (hasPrev ? '주요 증감 원인' : '금액이 큰 항목 (당월)') + '</th></tr></thead><tbody>';
    var tot = 0, ptot = 0;
    keys.forEach(function (t) {
      var c = tc[t].total, p = pc && pc[t] ? pc[t].total : null;
      var d = p == null ? null : c - p;
      var rate = (p == null || !p) ? null : d / Math.abs(p);
      tot += c; if (p != null) ptot += p;
      h += '<tr class="trow" data-t="' + esc(t) + '">' +
        '<td class="tname"><span class="cv">' + (S.open[t] ? '▾' : '▸') + '</span>' +
        esc(t === '미배분' ? '미배분 (조직 매핑 없음)' : D.teamName(t)) + '</td>' +
        '<td class="n">' + (p == null ? '<span class="zero">–</span>' : uf(p)) + '</td>' +
        '<td class="n cur"><b>' + uf(c) + '</b></td>' +
        '<td class="n ' + dcls(d) + '">' + us(d) + '</td>' +
        '<td class="n ' + dcls(d) + '">' + (rate == null ? '–' : ((rate > 0 ? '+' : '−') + Math.abs(rate * 100).toFixed(1) + '%')) + '</td>' +
        '<td class="c">' + rateBar(rate, maxRate) + '</td>' +
        '<td class="cz">' + causes(tc[t], pc && pc[t], 2, hasPrev) + '</td></tr>';
      if (S.open[t]) h += panel(tc[t], pc && pc[t], hasPrev);
    });
    var dt = hasPrev ? (tot - ptot) : null;
    h += '<tr class="grand"><td>합 계</td><td class="n">' + (hasPrev ? uf(ptot) : '–') + '</td>' +
      '<td class="n cur"><b>' + uf(tot) + '</b></td>' +
      '<td class="n ' + dcls(dt) + '">' + us(dt) + '</td><td class="n"></td><td></td><td></td></tr>';
    $('#tblSgaTeam').innerHTML = h + '</tbody>';

    $$('#tblSgaTeam tr.trow').forEach(function (tr) {
      tr.onclick = function () { var t = this.dataset.t; S.open[t] = !S.open[t]; renderSga(m); };
    });

    /* 비목별 — 최종 OL 과 비교 */
    var ch = '<thead><tr><th>비목</th><th class="n" style="width:100px">최종 OL</th>' +
      '<th class="n cur" style="width:100px">확정</th><th class="n" style="width:96px">차이</th>' +
      '<th class="n" style="width:78px">집행률</th><th class="c" style="width:140px">금액 비중</th></tr></thead><tbody>';
    var cats = D.ITEMS['판관비'].slice();
    Object.keys(ag.sgaCat).forEach(function (c) { if (cats.indexOf(c) < 0) cats.push(c); });
    var maxA = 0; cats.forEach(function (c) { maxA = Math.max(maxA, ag.sgaCat[c] || 0); });
    cats.forEach(function (cat) {
      var a = ag.sgaCat[cat] || 0;
      var known = D.ITEMS['판관비'].indexOf(cat) >= 0;
      var o = known ? K.OL(m, D.TOTAL, '판관비', cat) : null;
      var d = o == null ? null : a - o;
      ch += '<tr><td>' + esc(cat) + (known ? '' : ' <span class="bdg">미분류</span>') + '</td>' +
        '<td class="n">' + uf(o) + '</td><td class="n cur"><b>' + uf(a) + '</b></td>' +
        '<td class="n ' + dcls(d) + '">' + us(d) + '</td>' +
        '<td class="n">' + (o ? pct(a / o) : '–') + '</td>' +
        '<td class="c"><span class="mbar one"><i style="width:' +
          (maxA ? (a / maxA * 100).toFixed(1) : 0) + '%"></i></span></td></tr>';
    });
    ch += '<tr class="grand"><td>합 계</td><td class="n">' + uf(K.OL(m, D.TOTAL, '판관비', '합계')) + '</td>' +
      '<td class="n cur"><b>' + uf(ag.sga) + '</b></td>' +
      '<td class="n ' + dcls(ag.sga - (K.OL(m, D.TOTAL, '판관비', '합계') || 0)) + '">' +
        us(K.OL(m, D.TOTAL, '판관비', '합계') == null ? null : ag.sga - K.OL(m, D.TOTAL, '판관비', '합계')) + '</td>' +
      '<td class="n"></td><td></td></tr>';
    $('#tblSgaCat').innerHTML = ch + '</tbody>';
  }

  /* 0 을 가운데 두고 좌우로 뻗는 막대 */
  function rateBar(rate, max) {
    /* 비교 대상이 없으면 빈 막대를 그리지 않는다 — 0 처럼 보인다 */
    if (rate == null || !(max > 0)) return '';
    var w = Math.min(50, Math.abs(rate) / max * 50);
    var cls = rate > 0.005 ? 'up' : rate < -0.005 ? 'down' : 'flat';
    var st = rate >= 0 ? ('left:50%;width:' + w.toFixed(1) + '%') : ('right:50%;width:' + w.toFixed(1) + '%');
    return '<span class="mbar"><i class="' + cls + '" style="' + st + '"></i></span>';
  }

  /**
   * 주요 증감 원인.
   * 증감액 절대값으로 뽑은 뒤 신규 → 기존 → 소멸 순으로 배열한다.
   * 그룹 순으로 정렬해 앞에서 자르면 소멸(당월 0) 항목이 영영 올라오지 못한다.
   */
  function topCauses(cur, prv, n) {
    var names = {}, raw = {}, cat = {};
    if (cur) Object.keys(cur.desc).forEach(function (d) { names[d] = 1; raw[d] = cur.desc[d].raw; cat[d] = cur.desc[d].cat; });
    if (prv) Object.keys(prv.desc).forEach(function (d) {
      names[d] = 1; raw[d] = raw[d] || prv.desc[d].raw; cat[d] = cat[d] || prv.desc[d].cat;
    });
    var arr = Object.keys(names).map(function (d) {
      var c = cur && cur.desc[d] ? cur.desc[d].amt : 0;
      var p = prv ? (prv.desc[d] ? prv.desc[d].amt : 0) : null;
      return { d: d, raw: raw[d], cat: cat[d], c: c, p: p, v: prv ? (c - p) : c,
               isNew: !!prv && p === 0 && c !== 0, gone: !!prv && c === 0 && p !== 0 };
    }).filter(function (r) { return Math.abs(r.v) >= 0.0005; });

    arr.sort(function (a, b) { return Math.abs(b.v) - Math.abs(a.v); });
    var top = arr.slice(0, n || 3);
    var rank = function (r) { return r.isNew ? 0 : (r.gone ? 2 : 1); };
    top.sort(function (a, b) { return rank(a) - rank(b) || Math.abs(b.v) - Math.abs(a.v); });
    return { top: top, more: Math.max(0, arr.length - top.length) };
  }

  function causes(cur, prv, n, hasPrev) {
    var r = topCauses(cur, prv, n);
    if (!r.top.length) return '<span class="q">—</span>';
    return r.top.map(function (x) {
      var nm = x.raw || x.d;
      if (nm.length > 26) nm = nm.slice(0, 26) + '…';
      /* 전월이 없으면 부호를 붙이지 않는다 — 증감이 아니라 당월 금액이다 */
      return '<span class="czi" title="' + esc(x.raw || x.d) + '"><b' + (hasPrev ? ' class="' + dcls(x.v) + '"' : '') + '>' +
        (hasPrev ? us(x.v) : uf(x.c)) + '</b> ' +
        esc(nm) + (x.isNew ? ' <span class="bdg">신규</span>' : x.gone ? ' <span class="bdg">당월 없음</span>' : '') + '</span>';
    }).join('') + (r.more ? ' <span class="q">외 ' + r.more + '건</span>' : '');
  }

  /* 팀 펼침 — 비목별 요약 + 적요 상세 */
  function panel(cur, prv, hasPrev) {
    var cats = Object.keys(cur.cat).sort(function (a, b) { return cur.cat[b] - cur.cat[a]; });
    var chips = cats.map(function (c) {
      var d = prv ? (cur.cat[c] - (prv.cat[c] || 0)) : null;
      return '<span class="chip">' + esc(c) + ' <b>' + uf(cur.cat[c]) + '</b>' +
        (d == null ? '' : ' <span class="' + dcls(d) + '">' + us(d) + '</span>') + '</span>';
    }).join(' ');

    var r = topCauses(cur, prv, 15);
    var rows = r.top.map(function (x) {
      return '<tr><td class="txt">' + esc(x.raw || x.d) +
        (x.isNew ? ' <span class="bdg">신규</span>' : x.gone ? ' <span class="bdg">당월 없음</span>' : '') + '</td>' +
        '<td class="q">' + esc(x.cat || '') + '</td>' +
        (hasPrev ? '<td class="n">' + (x.p == null ? '<span class="zero">–</span>' : uf(x.p)) + '</td>' : '') +
        '<td class="n cur"><b>' + uf(x.c) + '</b></td>' +
        (hasPrev ? '<td class="n ' + dcls(x.v) + '">' + us(x.v) + '</td>' : '') + '</tr>';
    }).join('');

    return '<tr class="prow"><td colspan="7"><div class="pcell">' +
      '<div class="pttl">비목별</div><div class="pchips">' + chips + '</div>' +
      '<div class="pttl">적요별 상위 ' + r.top.length + '건' + (r.more ? ' (외 ' + r.more + '건)' : '') + '</div>' +
      '<table class="t sub"><thead><tr><th>적요</th><th style="width:92px">비목</th>' +
      (hasPrev ? '<th class="n" style="width:92px">전월</th>' : '') +
      '<th class="n" style="width:92px">당월</th>' +
      (hasPrev ? '<th class="n" style="width:92px">증감</th>' : '') +
      '</tr></thead><tbody>' + rows + '</tbody></table>' +
      '</div></td></tr>';
  }

  /* ---------- 매출 명세 ---------- */
  function renderRev(m) {
    var byT = {};
    (D.S.erpRev[m] || []).forEach(function (r) {
      var t = D.ORG2TEAM[r.team] || r.team;
      var o = byT[t] || (byT[t] = { rev: 0, cost: 0, proj: {} });
      var a = Number(r.amt) / 1e6, c = Number(r.cost || 0) / 1e6;
      o.rev += a; o.cost += c;
      var pn = r.pname || '(프로젝트명 없음)';
      var p = o.proj[pn] || (o.proj[pn] = { rev: 0, cost: 0, n: 0 });
      p.rev += a; p.cost += c; p.n++;
    });

    var h = '<thead><tr><th>영업그룹 · 프로젝트</th><th class="n" style="width:56px">건</th>' +
      '<th class="n" style="width:96px">최종 OL</th><th class="n cur" style="width:104px">확정 매출</th>' +
      '<th class="n" style="width:96px">차이</th><th class="n" style="width:96px">확정 원가</th>' +
      '<th class="n" style="width:96px">매출이익</th><th class="n" style="width:70px">이익률</th></tr></thead><tbody>';
    Object.keys(byT).sort(function (a, b) { return byT[b].rev - byT[a].rev; }).forEach(function (t) {
      var o = byT[t];
      var olv = K.OL(m, t, '매출', '합계');
      var d = olv == null ? null : o.rev - olv;
      var pk = Object.keys(o.proj), gp = o.rev - o.cost;
      h += '<tr class="trow" data-t="' + esc(t) + '"><td class="tname"><span class="cv">' +
        (S.open['r:' + t] ? '▾' : '▸') + '</span><b>' + esc(D.teamName(t)) + '</b></td>' +
        '<td class="n q">' + pk.length + '</td>' +
        '<td class="n">' + uf(olv) + '</td><td class="n cur"><b>' + uf(o.rev) + '</b></td>' +
        '<td class="n ' + dcls(d) + '">' + us(d) + '</td>' +
        '<td class="n">' + uf(o.cost) + '</td><td class="n">' + uf(gp) + '</td>' +
        '<td class="n">' + (o.rev ? pct(gp / o.rev) : '–') + '</td></tr>';
      if (S.open['r:' + t]) {
        pk.sort(function (a, b) { return o.proj[b].rev - o.proj[a].rev; }).forEach(function (pn) {
          var p = o.proj[pn], pgp = p.rev - p.cost;
          h += '<tr class="proj"><td class="txt pn">' + esc(pn) + '</td>' +
            '<td class="n q">' + p.n + '</td><td class="n"><span class="zero">–</span></td>' +
            '<td class="n cur">' + uf(p.rev) + '</td><td class="n"><span class="zero">–</span></td>' +
            '<td class="n">' + uf(p.cost) + '</td><td class="n">' + uf(pgp) + '</td>' +
            '<td class="n">' + (p.rev ? pct(pgp / p.rev) : '–') + '</td></tr>';
        });
      }
    });
    var ag = D.erpAgg(m), olT = K.OL(m, D.TOTAL, '매출', '합계');
    h += '<tr class="grand"><td>합 계</td><td class="n"></td>' +
      '<td class="n">' + uf(olT) + '</td><td class="n cur"><b>' + uf(ag.rev) + '</b></td>' +
      '<td class="n ' + dcls(olT == null ? null : ag.rev - olT) + '">' + us(olT == null ? null : ag.rev - olT) + '</td>' +
      '<td class="n">' + uf(ag.cost) + '</td><td class="n">' + uf(ag.rev - ag.cost) + '</td>' +
      '<td class="n">' + (ag.rev ? pct((ag.rev - ag.cost) / ag.rev) : '–') + '</td></tr>';
    $('#tblRevTeam').innerHTML = h + '</tbody>';

    $$('#tblRevTeam tr.trow').forEach(function (tr) {
      tr.onclick = function () { var t = 'r:' + this.dataset.t; S.open[t] = !S.open[t]; renderRev(m); };
    });
    $('#revNote').innerHTML = '프로젝트에는 대응하는 OL 금액이 없어 확정치만 표시합니다. ' +
      '여기 매출이익에는 <b>개발비가 빠져 있습니다</b> — ERP 에 계상되지 않기 때문입니다. ' +
      '개발비를 더한 값은 위 대사표에서 보십시오.';
  }

  /* ==========================================================================
   * F6 — 마감 확정
   * ======================================================================== */
  function ready(m) {
    var meta = D.S.erpMeta[m];
    return !!(meta && meta.rev_cnt > 0 && meta.sga_cnt > 0);
  }
  function renderClose() {
    var m = S.m, box = $('#erpClose');
    if (!admin()) { box.className = 'hide'; return; }
    if (D.isFinal(m)) {
      var p = D.periodOf(m);
      box.className = 'note ok';
      box.innerHTML = '<b>' + D.moOf(m) + '월 최종확정</b> — 최종 OL ' +
        (p.final_k == null ? '?' : (p.final_k + 1)) + '주 · ' + esc(p.final_src || '') +
        '. 값 수정이 잠겨 있습니다. 풀려면 <b>설정 · 데이터 관리</b>에서 사유를 남기세요.';
      return;
    }
    if (!ready(m)) {
      box.className = 'note info';
      box.innerHTML = '마감 확정은 <b>매출현황과 판관비가 모두</b> 올라온 뒤에 할 수 있습니다. ' +
        '판관비만 올라온 상태는 그 달의 마감이 끝난 것이 아닙니다.';
      return;
    }
    var meta = D.S.erpMeta[m], fk = K.finalK(m, D.TEAMS[0]);
    box.className = 'note warn';
    box.innerHTML = '<b>' + D.moOf(m) + '월 ERP 확정본이 모두 등록되었습니다</b> — 매출 ' + meta.rev_cnt +
      '건 / 판관비 ' + meta.sga_cnt + '건. 최종 OL 은 ' + (fk >= 0 ? (fk + 1) + '주' : '미기입') + '입니다. ' +
      '이제 이 달을 마감 확정할 수 있습니다. ' +
      '<button class="btn red" id="btnErpClose" style="margin-left:6px">' + D.moOf(m) + '월 마감 확정</button>';
    $('#btnErpClose').onclick = function () { closeMonth(m); };
  }
  function closeMonth(m) {
    var k = K.finalK(m, D.TEAMS[0]);
    var use = k >= 0 ? k : (D.weeksOf(m) - 1);
    var meta = D.S.erpMeta[m], before = D.stateOf(m);
    if (!window.confirm(
      D.moOf(m) + '월을 마감 확정합니다.\n\n' +
      'ERP 확정 : 매출 ' + meta.rev_cnt + '건 / 판관비 ' + meta.sga_cnt + '건\n' +
      '최종 OL  : ' + (use + 1) + '주\n\n' +
      '확정하면 이 달은 잠깁니다. 값 수정 · 상세 · 변동 사유가 모두 차단되고,\n' +
      '풀려면 사유를 남겨 확정을 해제해야 합니다.')) return;
    D.setPeriod(m, { state: 'final', final_k: use,
                     final_src: 'ERP 마감 · 매출 ' + meta.rev_cnt + '건 / 판관비 ' + meta.sga_cnt + '건' })
      .then(function () {
        return D.audit('ERP 마감 확정', { m: m, ref: '월 상태', before: before, after: '최종확정 · ' + (use + 1) + '주' });
      })
      .then(function () { K.bust(); flash(D.moOf(m) + '월을 마감 확정했습니다'); render(); })
      .catch(function (e) { flash(e.message, true); });
  }

  /* ==========================================================================
   * ERP 확정본 업로드 (경영지원팀)
   * 파일은 브라우저에서 바로 읽는다. 어디에도 올리지 않는다.
   * ======================================================================== */
  var UP = { rev: null, sga: null, m: null };

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
  function ymFromKey(k) { var a = String(k).split('-'); return parseInt(a[0], 10) * 12 + parseInt(a[1], 10) - 1; }

  function upLog(msg, cls) {
    var el = document.createElement('div');
    el.className = 'lg' + (cls ? ' ' + cls : '');
    el.innerHTML = msg;
    $('#erpUpLog').appendChild(el);
    $('#erpUpLog').scrollTop = 1e6;
  }

  function analyze() {
    var fr = $('#fErpRev').files[0], fs = $('#fErpSga').files[0];
    UP = { rev: null, sga: null, m: null };
    $('#erpUpLog').innerHTML = '';
    $('#btnErpSave').disabled = true;
    $('#btnErpSave').textContent = '확정본 등록';
    if (!fr && !fs) { upLog('파일을 고르세요.', 'er'); return; }

    loadXlsx()
      .then(function () { return fr ? MpImport.readFile(fr) : null; })
      .then(function (wb) {
        if (wb) {
          UP.rev = MpImport.parseRevBook(wb);
          upLog('매출현황 — 시트 <b>' + esc(UP.rev.sheet) + '</b> · <b>' + UP.rev.rows.length + '</b>건 · 기준 ' +
            esc(UP.rev.ymKeys.join(', ')));
          if (UP.rev.excl.cnt) {
            upLog('사업부 밖 영업그룹 <b>' + UP.rev.excl.cnt + '</b>건 제외 — ' +
              esc(Object.keys(UP.rev.excl.groups).slice(0, 6).join(', ')), 'wn');
          }
        }
        return fs ? MpImport.readFile(fs) : null;
      })
      .then(function (wb) {
        if (wb) {
          UP.sga = MpImport.parseSgaBook(wb);
          upLog('판관비 — 시트 <b>' + esc(UP.sga.sheet) + '</b> · <b>' + UP.sga.rows.length + '</b>건 · 기준 ' +
            esc(UP.sga.ymKeys.join(', ')));
        }
        check();
      })
      .catch(function (e) { upLog('실패 — ' + esc(e.message), 'er'); });
  }

  /**
   * 기준월을 정한다.
   * ERP 원장에는 전월 정정 전표가 몇 건씩 섞여 들어온다. 그것만으로 파일을 거절하면
   * 매달 손으로 잘라내야 한다. 그래서 압도적 다수(90% 이상)인 달을 기준으로 삼고
   * 나머지는 잘라낸 뒤 몇 건을 버렸는지 알린다. 어느 달도 다수가 아니면 그때 거절한다.
   */
  function dominantYM(parsed, dateField, label) {
    var dist = parsed.ymDist || {}, keys = Object.keys(dist);
    if (!keys.length) { upLog(label + ' 파일에서 읽을 수 있는 날짜가 없습니다.', 'er'); return null; }
    var tot = 0, best = keys[0];
    keys.forEach(function (k) { tot += dist[k]; if (dist[k] > dist[best]) best = k; });
    if (dist[best] / tot < 0.9) {
      upLog(label + ' 파일에 여러 달이 섞여 있습니다 — ' +
        keys.map(function (k) { return k + ' ' + dist[k] + '건'; }).join(' · ') +
        '. 한 달치만 올리세요.', 'er');
      return null;
    }
    if (keys.length > 1) {
      var drop = parsed.rows.filter(function (r) { return String(r[dateField] || '').slice(0, 7) !== best; });
      parsed.rows = parsed.rows.filter(function (r) { return String(r[dateField] || '').slice(0, 7) === best; });
      upLog(label + ' — 기준월 <b>' + best + '</b> 밖의 ' + drop.length + '건을 제외했습니다 (' +
        esc(keys.filter(function (k) { return k !== best; }).join(', ')) + ').', 'wn');
    }
    return ymFromKey(best);
  }

  function check() {
    var ms = [];
    if (UP.rev) {
      var mr = dominantYM(UP.rev, 'sdate', '매출현황');
      if (mr == null) return;
      ms.push(mr);
    }
    if (UP.sga) {
      var msg = dominantYM(UP.sga, 'adate', '판관비');
      if (msg == null) return;
      ms.push(msg);
    }
    if (ms.length === 2 && ms[0] !== ms[1]) {
      upLog('매출과 판관비의 기준월이 다릅니다 — ' + D.moOf(ms[0]) + '월 / ' + D.moOf(ms[1]) + '월. 같은 달끼리 올리세요.', 'er');
      return;
    }
    UP.m = ms[0];
    if (D.yOf(UP.m) !== 2026) { upLog('2026년 자료가 아닙니다 — ' + D.yOf(UP.m) + '년.', 'er'); return; }

    /* 비목·조직 매핑에서 빠지는 건은 미리 알린다 — 올린 뒤에 알면 늦다 */
    if (UP.sga) {
      var un = {};
      UP.sga.rows.forEach(function (r) { if (!r.cat) un[r.acct] = 1; });
      var ks = Object.keys(un);
      if (ks.length) upLog('비목이 비어 있는 계정 <b>' + ks.length + '</b>종 — ' + esc(ks.slice(0, 6).join(', ')) +
        '. <b>미분류</b>로 들어갑니다. 원본 엑셀의 «이동계획» 열을 채워 다시 올리세요.', 'wn');
      var org = {};
      UP.sga.rows.forEach(function (r) {
        var o6 = D.S.orgMap[r.mg] || D.S.orgMap[r.team_raw];
        if (!o6 || !D.ORG2TEAM[o6]) org[r.mg || r.team_raw || '(빈칸)'] = 1;
      });
      var ok = Object.keys(org);
      if (ok.length) upLog('팀에 붙지 않는 조직 <b>' + ok.length + '</b>종 — ' + esc(ok.slice(0, 6).join(', ')) +
        '. 사업부 합계에는 들어가지만 팀별 표에는 <b>미배분</b>으로 남습니다.', 'wn');
    }

    var ex = D.S.erpMeta[UP.m];
    if (ex) upLog('이미 ' + D.moOf(UP.m) + '월 확정본이 있습니다 (매출 ' + ex.rev_cnt + ' · 판관비 ' + ex.sga_cnt +
      '건). 올리면 <b>이번 파일로 바뀝니다</b>.', 'wn');
    if (D.isFinal(UP.m)) {
      upLog(D.moOf(UP.m) + '월은 <b>최종확정</b>되어 있습니다. 먼저 <b>설정 · 데이터 관리</b>에서 확정을 해제하세요.', 'er');
      return;
    }
    upLog('<b>' + D.moOf(UP.m) + '월</b>로 등록할 준비가 되었습니다.', 'ok');
    $('#btnErpSave').disabled = false;
    $('#btnErpSave').textContent = D.moOf(UP.m) + '월 확정본 등록';
  }

  function post(table, rows, onConflict) {
    if (!rows.length) return Promise.resolve(0);
    var CH = 500, done = 0;
    var step = function (i) {
      if (i >= rows.length) return Promise.resolve(done);
      var part = rows.slice(i, i + CH);
      return MpAuth.rest(table + (onConflict ? '?on_conflict=' + onConflict : ''), {
        method: 'POST',
        headers: { Prefer: (onConflict ? 'resolution=merge-duplicates,' : '') + 'return=minimal' },
        body: JSON.stringify(part)
      }).then(function (r) {
        if (!r.ok) return r.text().then(function (t) { throw new Error(table + ' ' + r.status + ' — ' + t.slice(0, 200)); });
        done += part.length;
        return step(i + CH);
      });
    };
    return step(0);
  }
  function del(path) {
    return MpAuth.rest(path, { method: 'DELETE', headers: { Prefer: 'return=minimal' } })
      .then(function (r) { if (!r.ok) return r.text().then(function (t) { throw new Error('DELETE ' + path + ' — ' + t.slice(0, 160)); }); });
  }

  function save() {
    var m = UP.m, b = $('#btnErpSave');
    if (m == null) return;
    if (!window.confirm(
      D.moOf(m) + '월 ERP 확정본을 등록합니다.\n\n' +
      (UP.rev ? '매출현황 ' + UP.rev.rows.length + '건\n' : '') +
      (UP.sga ? '판관비 ' + UP.sga.rows.length + '건\n' : '') +
      '\n기존 ' + D.moOf(m) + '월 확정본이 있으면 이 파일로 바뀝니다.')) return;

    b.disabled = true; b.textContent = '등록 중…';
    var rev = UP.rev ? UP.rev.rows.map(function (r) { var o = {}; for (var k in r) o[k] = r[k]; o.m = m; return o; }) : null;
    var sga = UP.sga ? UP.sga.rows.map(function (r) { var o = {}; for (var k in r) o[k] = r[k]; o.m = m; return o; }) : null;

    Promise.resolve()
      .then(function () { return rev ? del('mp_erp_rev?m=eq.' + m).then(function () { return post('mp_erp_rev', rev); }) : 0; })
      .then(function (n) {
        if (rev) upLog('매출현황 <b>' + n + '</b>건 등록', 'ok');
        return sga ? del('mp_erp_sga?m=eq.' + m).then(function () { return post('mp_erp_sga', sga); }) : 0;
      })
      .then(function (n) {
        if (sga) upLog('판관비 <b>' + n + '</b>건 등록', 'ok');
        var ex = D.S.erpMeta[m] || { rev_cnt: 0, sga_cnt: 0 };
        return post('mp_erp_meta', [{ m: m,
          rev_cnt: rev ? rev.length : ex.rev_cnt,
          sga_cnt: sga ? sga.length : ex.sga_cnt,
          rev_excl: UP.rev ? UP.rev.excl : (ex.rev_excl || null),
          sga_excl: null }], 'm');
      })
      .then(function () {
        return D.audit('ERP 확정본 등록', { m: m, ref: 'ERP',
          after: (rev ? '매출 ' + rev.length + '건 ' : '') + (sga ? '판관비 ' + sga.length + '건' : '') });
      })
      .then(function () {
        delete D.S.erpRev[m]; delete D.S.erpSga[m];
        return D.load(2026);
      })
      .then(function () { return D.loadErp(m); })
      .then(function () {
        K.bust();
        upLog('<b>등록 완료</b> — 아래 대사표가 갱신되었습니다.', 'ok');
        b.textContent = '등록 완료';
        S.m = m; S.open = {};
        flash(D.moOf(m) + '월 확정본을 등록했습니다');
        render();
      })
      .catch(function (e) {
        upLog('실패 — ' + esc(e.message), 'er');
        b.disabled = false; b.textContent = '다시 시도';
      });
  }

  function bindUpload() {
    if (bindUpload.done) return;
    bindUpload.done = true;
    $('#btnErpUp').onclick = function () { S.upload = !S.upload; render(); };
    $('#btnErpAnalyze').onclick = analyze;
    $('#btnErpSave').onclick = save;
  }

  global.MpErp = {
    S: S,
    open: function (m) {
      bindUpload();
      var months = D.erpMonths();
      if (m != null && D.S.erpMeta[m]) S.m = m;
      else if (S.m == null) S.m = months.length ? months[months.length - 1] : (m || D.mOf(2026, 7));
      D.loadErp(S.m).then(render).catch(render);
    },
    render: render
  };
})(window);
