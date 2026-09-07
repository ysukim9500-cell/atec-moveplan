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

  var D = global.MpData, K = global.MpCalc, U = global.MpUI, G = global.MpSga;
  var $ = U.$, $$ = U.$$, esc = U.esc, fmt = U.fmt, fmt0 = U.fmt0, dcls = U.dcls, pct = U.pct;

  var S = { m: null, kind: 'sga', unit: 'M', open: {}, upload: false,
            cat: {},          /* 팀|비목 → 적요 상세 펼침 */
            th: 100,          /* 세부 변동 표시기준 (만원) — v20 기본값 */
            fold: false,      /* 비목·적요 전체 상세 접기 */
            matchOpen: false };

  /* 확정된 매칭이 바뀌면 대사 결과를 다시 만들어야 한다 */
  var MATCH_VER = 0;
  var MATCH = {};                       /* m|team|cat|side → {mode,to} */
  var MATCH_READY = null;

  function uf(v) {
    if (v == null || isNaN(v)) return '–';
    return S.unit === 'M' ? fmt(v) : fmt0(v * 1e6);
  }
  function us(v) {
    if (v == null || isNaN(v)) return '–';
    var s = v > 0.005 ? '+' : v < -0.005 ? '−' : '';
    return s + (S.unit === 'M' ? fmt(Math.abs(v)) : fmt0(Math.abs(v) * 1e6));
  }
  /* 폰에서는 사유 입력칸과 업로드를 열지 않는다 — 보기 전용이다 */
  function admin() { return MpAuth.isAdmin() && !MpAuth.viewOnly(); }

  function flash(msg, err) {
    var el = $('#erpSave');
    el.className = 'chip ' + (err ? 'warn' : 'ok');
    el.textContent = msg;
    clearTimeout(flash.t);
    flash.t = setTimeout(function () { el.className = 'chip'; el.textContent = '—'; }, 2600);
  }


  /* ==========================================================================
   * 적요 매칭 확정 — 서버에 둔다
   * v20 은 브라우저에 저장했다. 그러면 사람마다 다른 숫자를 보게 된다.
   * ======================================================================== */
  function mkey(m, team, cat, side) { return m + '|' + team + '|' + cat + '|' + side; }
  function matchGet(m, team, cat, side) { return MATCH[mkey(m, team, cat, side)] || null; }

  function loadMatch(m) {
    return MpAuth.rest('mp_desc_match?select=m,team,cat,side,mode,to_key&m=eq.' + m)
      .then(function (r) { if (!r.ok) throw new Error('x'); return r.json(); })
      .then(function (rows) {
        MATCH_READY = true;
        rows.forEach(function (x) { MATCH[mkey(x.m, x.team, x.cat, x.side)] = { mode: x.mode, to: x.to_key }; });
        MATCH_VER++;
      })
      .catch(function () { MATCH_READY = false; });   /* 표가 아직 없어도 화면은 뜬다 */
  }

  function setMatch(m, team, cat, side, mode, to) {
    var me = MpAuth.me() || {};
    return MpAuth.rest('mp_desc_match?on_conflict=m,team,cat,side', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([{ m: m, team: team, cat: cat, side: side, mode: mode,
                              to_key: to || null, decided_at: new Date().toISOString(),
                              decided_by: me.id || null, email: me.email || null }])
    }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error(t.slice(0, 160)); });
      MATCH[mkey(m, team, cat, side)] = { mode: mode, to: to || null };
      MATCH_VER++;
    });
  }

  function clearMatch(m) {
    return MpAuth.rest('mp_desc_match?m=eq.' + m, { method: 'DELETE', headers: { Prefer: 'return=minimal' } })
      .then(function (r) {
        if (!r.ok) return r.text().then(function (t) { throw new Error(t.slice(0, 160)); });
        Object.keys(MATCH).forEach(function (k) { if (k.indexOf(m + '|') === 0) delete MATCH[k]; });
        MATCH_VER++;
      });
  }

  /* ---------- ③ 적요 매칭 검토 ---------- */
  function renderSgaMatch(m, cur, prv, hasPrev) {
    var list = [];
    if (hasPrev) {
      eachGroup(cur, prv, hasPrev, function (t, c, C, P) {
        rcOf(m, t, c, C, P, hasPrev).review.forEach(function (r) { list.push(r); });
      });
      list.sort(function (a, b) {
        return Math.max(Math.abs(b.prev || 0), Math.abs(b.curr || 0)) -
               Math.max(Math.abs(a.prev || 0), Math.abs(a.curr || 0));
      });
    }
    $('#sgaMatchN').textContent = list.length;
    /* 매칭 확정은 관리자와 팀장만 한다. 폰에서는 아무도 못 한다. */
    var canMatch = !MpAuth.viewOnly() && (MpAuth.isAdmin() || MpAuth.isLead());
    $('#btnSgaMatch').className = 'btn ' + (list.length ? 'red' : 'ghost');
    $('#btnSgaMatch').classList.toggle('hide', !canMatch);
    $('#btnSgaMatchReset').classList.toggle('hide', !MpAuth.isAdmin() || MpAuth.viewOnly());
    var card = $('#sgaMatchCard');
    card.className = (S.matchOpen && canMatch) ? 'card' : 'hide';
    if (!S.matchOpen || !canMatch) return;

    if (MATCH_READY === false) {
      $('#tblSgaMatch').innerHTML = '<tbody><tr><td class="txt">매칭 확정을 저장할 표(mp_desc_match)가 아직 없습니다. ' +
        'db/003_desc_match.sql 을 실행하면 확정한 결과가 모두에게 남습니다.</td></tr></tbody>';
      return;
    }
    if (!list.length) {
      $('#tblSgaMatch').innerHTML = '<tbody><tr><td class="txt q">' +
        (hasPrev ? '확인이 필요한 적요가 없습니다.' : '전월 확정본이 없어 매칭할 대상이 없습니다.') + '</td></tr></tbody>';
      return;
    }
    var h = '<thead><tr><th style="width:110px">팀 · 비목</th><th>전월 적요</th><th>당월 후보</th>' +
      '<th class="n" style="width:88px">전월</th><th class="n" style="width:88px">당월</th>' +
      '<th style="width:210px">결정</th></tr></thead><tbody>';
    list.slice(0, 200).forEach(function (r, i) {
      var pv = r.prevDesc ? G.prettyDesc(r.prevDesc, r.prevRaw) : '—';
      var opts = r.cands.map(function (c, j) {
        return '<option value="' + esc(c.key) + '">' + esc(G.prettyDesc(c.nd, c.raw)) +
               ' (' + Math.round(c.s * 100) + '%)</option>';
      }).join('');
      h += '<tr' + (r.conflict ? ' class="pend"' : '') + '><td class="q">' + esc(D.teamName(r.team)) + '<br>' + esc(r.cat) + '</td>' +
        '<td class="txt">' + esc(pv) + (r.conflict ? ' <span class="bdg pend">확정 상대 없음</span>' : '') + '</td>' +
        '<td class="txt">' + (r.cands.length
            ? '<select class="sel" data-c="' + i + '">' + opts + '</select>'
            : (r.currDesc ? esc(G.prettyDesc(r.currDesc, r.currRaw)) : '<span class="q">후보 없음</span>')) + '</td>' +
        '<td class="n">' + (r.prev == null ? '–' : uf(r.prev / 1e6)) + '</td>' +
        '<td class="n cur">' + (r.curr == null ? '–' : uf(r.curr / 1e6)) + '</td>' +
        /* 팀장은 자기 팀만 정할 수 있다. RLS 가 그렇고, 버튼도 그래야 한다. */
        '<td>' + (MpAuth.canWriteTeam(r.team)
          ? '<button class="btn sm" data-mg="' + i + '">같은 항목</button> ' +
            '<button class="btn sm" data-kp="' + i + '">다른 항목</button>'
          : '<span class="q">' + esc(D.teamName(r.team)) + ' 담당자만</span>') + '</td></tr>';
    });
    $('#tblSgaMatch').innerHTML = h + '</tbody>';

    $$('#tblSgaMatch button[data-mg]').forEach(function (b) {
      b.onclick = function () {
        var r = list[+this.dataset.mg];
        var sel = $('#tblSgaMatch select[data-c="' + this.dataset.mg + '"]');
        var to = sel ? sel.value : r.currKey;
        if (!to) { flash('당월 후보가 없습니다', true); return; }
        decide(m, r, 'merge', to);
      };
    });
    $$('#tblSgaMatch button[data-kp]').forEach(function (b) {
      b.onclick = function () {
        var r = list[+this.dataset.kp];
        decide(m, r, 'keep', null);
      };
    });
  }

  function decide(m, r, mode, to) {
    var side = r.prevKey ? r.prevKey : ('CURR:' + r.currKey);
    setMatch(m, r.team, r.cat, side, mode, to)
      .then(function () {
        return D.audit('적요 매칭 확정', { m: m, team: r.team, ref: r.cat,
          before: G.prettyDesc(r.prevDesc || r.currDesc, r.prevRaw || r.currRaw).slice(0, 60),
          after: mode === 'merge' ? '같은 항목' : '다른 항목' });
      })
      .then(function () { flash('확정했습니다'); render(); })
      .catch(function (e) { flash(e.message, true); });
  }

  /* ==========================================================================
   * 화면
   * ======================================================================== */
  function render() {
    var m = S.m;

    U.tabs($('#erpMonth'), monthTabs(), m, function (v) {
      S.m = v; S.open = {};
      Promise.all([D.loadErp(v), D.loadErp(v - 1), loadMatch(v)]).then(render).catch(render);
    });
    U.tabs($('#erpUnit'), [{ id: 'M', label: '백만원' }, { id: 'W', label: '전체금액' }],
      S.unit, function (v) { S.unit = v; render(); });
    /* 전체금액은 자릿수가 많아 숫자열을 넓혀야 한다 */
    $('#p-erp').classList.toggle('won', S.unit !== 'M');
    U.tabs($('#erpKind'), [{ id: 'sga', label: '판관비 명세' }, { id: 'rev', label: '매출 명세' }],
      S.kind, function (v) { S.kind = v; render(); });

    $('#erpUpCard').classList.toggle('hide', !(admin() && S.upload));
    $('#btnErpUp').classList.toggle('hide', !admin());
    $('#btnErpUp').textContent = S.upload ? 'ERP 올리기 닫기' : 'ERP 확정본 올리기';

    var meta = D.S.erpMeta[m];
    var st = $('#erpState'), pv = $('#erpPrev');
    var prevM = m - 1, hasPrev = !!D.S.erpMeta[prevM] && !!D.S.erpSga[prevM];
    /* 전월 비교가 되는 달인지 머리줄에서 먼저 밝힌다 — 표를 다 보고 나서
       «왜 증감이 비어 있지» 하고 되짚게 만들지 않는다. */
    $$('#btnSgaProc,#btnRevProc,#btnErpXlsx').forEach(function (b) { b.disabled = !meta; });
    if (!meta) {
      st.className = 'chip warn';
      st.textContent = D.yOf(m) + '년 ' + D.moOf(m) + '월 확정 데이터 없음';
      /* 당월이 없으면 전월 비교를 말할 자리가 아니다 */
      pv.className = 'chip hide'; pv.innerHTML = '';
      /* 숨기기만 하면 옛 달 표가 그대로 남는다. 비워 둔다. */
      ['#erpKpi', '#erpKpi2', '#sgaValid', '#tblErpRecon', '#tblErpTeam', '#tblSgaTeam', '#sgaDetail',
       '#tblSgaCat', '#chSga', '#tblRevTeam', '#tblSgaMatch', '#tblErpNote'].forEach(function (sel) {
        var e = $(sel); if (e) e.innerHTML = '';
      });
      $('#erpBody').classList.add('hide');
      $('#erpEmpty').classList.remove('hide');
      $('#erpEmptyMsg').innerHTML = '경영지원팀이 ' + D.moOf(m) + '월 ERP 확정 엑셀(판관비 / 매출현황)을 올리면 이 화면이 열립니다. ' +
        '그 파일은 마지막 OL 이 끝난 뒤 다음 달 초에 나옵니다.';
      $('#btnErpEmptyUp').classList.toggle('hide', !admin());
      $('#btnErpEmptyUp').onclick = function () { S.upload = true; render(); };
      renderClose();
      return;
    }
    st.className = 'chip ok';
    /* 전월 비교가 되는 달인지 머리줄에서 먼저 밝힌다 — 표를 다 보고 나서
       «왜 증감이 비어 있지» 하고 되짚게 만들지 않는다. */
    pv.className = 'chip ' + (hasPrev ? '' : 'warn');
    pv.innerHTML = hasPrev
      ? '전월 비교 · <b>' + D.yOf(prevM) + '년 ' + D.moOf(prevM) + '월</b>'
      : '전월(' + D.moOf(prevM) + '월) 확정 데이터 없음 — 전월 대비 분석 불가';
    st.innerHTML = D.yOf(m) + '년 ' + D.moOf(m) + '월 마감 · 매출 <b>' + meta.rev_cnt +
      '</b>건 / 판관비 <b>' + meta.sga_cnt + '</b>건';
    $('#erpEmpty').classList.add('hide');
    $('#erpBody').classList.remove('hide');

    var ag = D.erpAgg(m);
    if (!ag) { $('#erpKpi').innerHTML = '<div class="note info">명세를 불러오는 중입니다…</div>'; return; }

    renderRecon(m);
    $('#erpSga').classList.toggle('hide', S.kind !== 'sga');
    $('#erpRev').classList.toggle('hide', S.kind !== 'rev');
    if (S.kind === 'sga') renderSga(m); else renderRev(m);
    renderErpNote(m);
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
    var fk = K.lastFilledK(m);
    $('#erpSub').textContent = '최종 OL = ' + (fk >= 0 ? (fk + 1) + '주' : '미기입') +
      ' · 개발비는 ERP 에 없어 최종 OL 값을 그대로 씁니다';

    renderKpi(m, a, o, p);

    var key = { '매출': 'rev', '매출원가': 'cost', '매출이익': 'gp', '판관비': 'sga',
                '영업이익': 'op', '공판': 'gongpan', '공판후영업이익': 'op2' };
    /* 차이 사유는 마감 뒤에 쓰는 항목이라 달이 잠겨도 막지 않는다 — RLS 도 같다.
       이 표는 사업부 합계 기준이라 팀장은 쓸 자리가 없다. */
    var can = admin();
    var U = (S.unit === 'M' ? '백만원' : '전체금액'), W = (S.unit !== 'M'), mw = W ? 128 : 100;

    /* 열 색은 판관비 화면과 같은 규칙 : 계획은 회색 · 최종 OL 은 노랑 · 확정은 분홍.
       세 값이 각각 어디서 온 것인지 색으로 먼저 알려 준다. */
    var h = '<colgroup><col style="width:150px"><col style="width:' + mw + 'px">' +
      '<col style="width:' + mw + 'px"><col style="width:' + (mw + 10) + 'px">' +
      '<col style="width:' + (mw + 4) + 'px"><col style="width:76px"><col></colgroup>' +
      '<thead><tr><th rowspan="2">항목</th>' +
      '<th colspan="3" class="c grphead bl">금액 (' + U + ')</th>' +
      '<th colspan="2" class="c grphead bl">최종 OL 대비</th>' +
      '<th rowspan="2" class="bl">차이 사유</th></tr><tr>' +
      '<th class="n bl plancol">월간계획</th><th class="n olcol">최종 OL</th>' +
      '<th class="n curcol">확정</th>' +
      '<th class="n bl">차이</th><th class="n">달성률</th></tr></thead><tbody>';
    RECON.forEach(function (r) {
      var sec = r[0], item = r[1], label = r[2], kk = key[label];
      var pv = p[kk], ov = o[kk], av = a[kk];
      var d = (av == null || ov == null) ? null : av - ov;
      var n = D.findNote('erpdiff', m, D.TOTAL, sec, item, null);
      var body = n ? n.body : '';
      var big = d != null && ov && Math.abs(d / ov) >= 0.05;
      h += '<tr' + (label === '공판후영업이익' ? ' class="grand"' : '') + '>' +
        '<td class="sec"><b>' + label + '</b></td>' +
        '<td class="n bl plancol">' + uf(pv) + '</td>' +
        '<td class="n olcol">' + uf(ov) + '</td>' +
        '<td class="n curcol"><b>' + uf(av) + '</b></td>' +
        '<td class="n bl delta ' + dcls(d) + '">' + us(d) + (big ? ' <span class="bdg">5%↑</span>' : '') + '</td>' +
        '<td class="n">' + (ov ? pct(av / ov) : '–') + '</td>' +
        '<td class="txt bl">' + (can
          ? '<textarea rows="1" class="na" data-en="' + esc(sec + '~' + item) + '" placeholder="' +
            (big ? '차이가 5% 를 넘습니다 — 사유를 적어 주세요' : '차이 사유') + '">' + esc(body) + '</textarea>'
          : (body ? esc(body) : '<span class="zero">–</span>')) + '</td></tr>';

      /* 개발비를 따로 세워 둔다. 이게 없으면 매출 − 매출원가 가 매출이익과 맞지 않아
         보는 사람이 계산을 의심하게 된다. 연구소에 주는 고정비라 ERP 에는 없다. */
      if (label === '매출이익') {
        var dev = a.dev || 0;
        h += '<tr class="devrow"><td class="txt">└ 개발비 <span class="bdg">ERP 미계상</span></td>' +
          '<td class="n bl plancol">' + uf(K.PL(m, D.TOTAL, '매출이익', '개발비')) + '</td>' +
          '<td class="n olcol">' + uf(dev) + '</td><td class="n curcol">' + uf(dev) + '</td>' +
          '<td class="n bl delta flat">' + us(0) + '</td><td class="n">–</td>' +
          '<td class="txt bl q">ERP 에 계상되지 않아 최종 OL 값을 그대로 반영합니다. ' +
          '매출이익 = 매출 − 매출원가 + 개발비.</td></tr>';
      }
    });
    $('#tblErpRecon').innerHTML = h + '</tbody>';
    bindNotes(m);

    /* ---------- 팀별 대사 ----------
       매출과 판관비를 열 묶음으로 갈라 놓는다. 한 줄에 여섯 숫자가 나란히 있으면
       어느 셋이 매출이고 어느 셋이 판관비인지 매번 헤더로 되짚어야 한다. */
    var th = '<colgroup><col style="width:150px">' +
      '<col style="width:' + mw + 'px"><col style="width:' + (mw + 10) + 'px"><col style="width:' + mw + 'px">' +
      '<col style="width:' + mw + 'px"><col style="width:' + (mw + 10) + 'px"><col style="width:' + mw + 'px">' +
      '<col style="width:' + (mw + 14) + 'px"></colgroup>' +
      '<thead><tr><th rowspan="2" class="stick s1">팀</th>' +
      '<th colspan="3" class="c grphead bl">매출 (' + U + ')</th>' +
      '<th colspan="3" class="c grphead bl">판관비 (' + U + ')</th>' +
      '<th rowspan="2" class="n bl">확정 공판후영업이익</th></tr><tr>' +
      '<th class="n bl olcol">최종 OL</th><th class="n curcol">확정</th><th class="n">차이</th>' +
      '<th class="n bl olcol">최종 OL</th><th class="n curcol">확정</th><th class="n">차이</th>' +
      '</tr></thead><tbody>';
    D.TEAMS.forEach(function (t) {
      var ta = K.act(m, t), to = K.metrics(m, t, 'ol');
      if (!ta) return;
      var dr = to.rev == null ? null : ta.rev - to.rev;
      var ds = to.sga == null ? null : ta.sga - to.sga;
      th += '<tr><td class="sec stick s1">' + esc(D.teamName(t)) + '</td>' +
        '<td class="n bl olcol">' + uf(to.rev) + '</td>' +
        '<td class="n curcol"><b>' + uf(ta.rev) + '</b></td>' +
        '<td class="n delta ' + dcls(dr) + '">' + us(dr) + '</td>' +
        '<td class="n bl olcol">' + uf(to.sga) + '</td>' +
        '<td class="n curcol"><b>' + uf(ta.sga) + '</b></td>' +
        '<td class="n delta ' + dcls(ds) + '">' + us(ds) + '</td>' +
        '<td class="n bl">' + uf(ta.op2) + '</td></tr>';
    });
    th += '<tr class="grand"><td class="stick s1">사업부 합계</td>' +
      '<td class="n bl">' + uf(o.rev) + '</td><td class="n"><b>' + uf(a.rev) + '</b></td>' +
      '<td class="n delta ' + dcls(o.rev == null ? null : a.rev - o.rev) + '">' +
        us(o.rev == null ? null : a.rev - o.rev) + '</td>' +
      '<td class="n bl">' + uf(o.sga) + '</td><td class="n"><b>' + uf(a.sga) + '</b></td>' +
      '<td class="n delta ' + dcls(o.sga == null ? null : a.sga - o.sga) + '">' +
        us(o.sga == null ? null : a.sga - o.sga) + '</td>' +
      '<td class="n bl">' + uf(a.op2) + '</td></tr>';
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

  /**
   * KPI 는 보고 있는 구분에 따라 다르다 (v20 과 같다).
   *   판관비 : 당월 판관비 · 전월 판관비 · 전월 대비 증감액 · 전월 대비 증감률
   *   매출   : 매출 · 원가 · 이익 · 마진율  (각각 전월과 최종 OL 을 함께)
   * 한 벌로 고정해 두면 지금 보고 있는 표와 KPI 가 따로 놀아 눈이 두 번 간다.
   */
  function renderKpi(m, a, o, p) {
    var prevM = m - 1, pa = D.S.erpMeta[prevM] ? K.act(prevM, D.TOTAL) : null;
    /* 두 구분이 같은 이야기를 같은 순서로 한다 — 주인공 → 비교 기준 → 변화.
       판관비는 «당월 판관비», 매출은 «당월 매출» 이 주인공일 뿐 배치는 같다. */
    $('#erpKpi').innerHTML = (S.kind === 'sga') ? sgaKpi(a, o, pa, prevM) : revKpi(a, o, pa, prevM);
    var k2 = $('#erpKpi2');
    k2.classList.toggle('hide', S.kind !== 'rev');
    k2.innerHTML = (S.kind === 'rev') ? revKpi2(a, o, pa) : '';
  }

  function sgaKpi(a, o, pa, prevM) {
    var sC = a.sga, sP = pa ? pa.sga : null, sO = o.sga;
    var dP = (sP == null) ? null : sC - sP;
    var dO = (sO == null) ? null : sC - sO;
    return kpi('당월 판관비', uf(sC), [['최종 OL', uf(sO), dO]], 'hero') +
      kpi('전월 판관비', uf(sP), [['기준', sP == null ? '데이터 없음' : ymFull(prevM), null]], 'quiet') +
      kpi('전월 대비 증감액', dP == null ? '–' : us(dP), [['OL 대비', dO == null ? '–' : us(dO), dO]], 'big diff', dP) +
      kpi('전월 대비 증감률',
          (sP && dP != null) ? pctS(dP / Math.abs(sP)) : '–',
          [['OL 달성률', sO ? pctS(sC / sO - 0) : '–', null]], 'big diff', dP);
  }

  /**
   * 매출 KPI 윗줄 — 판관비와 같은 배치.
   *   hero  당월 매출   quiet 전월 매출   diff 전월 대비 증감액 · 증감률
   * 원가 · 이익 · 마진율은 아랫줄(revKpi2)로 내린다. 넷을 같은 무게로 늘어놓으면
   * 이 화면이 무엇을 보는 화면인지 사라진다.
   */
  function revKpi(a, o, pa, prevM) {
    var rC = a.rev, rP = pa ? pa.rev : null, rO = o.rev;
    var dP = (rP == null) ? null : rC - rP;
    var dO = (rO == null) ? null : rC - rO;
    return kpi('당월 매출', uf(rC), [['최종 OL', uf(rO), dO]], 'hero') +
      kpi('전월 매출', uf(rP), [['기준', rP == null ? '데이터 없음' : ymFull(prevM), null]], 'quiet') +
      kpi('전월 대비 증감액', dP == null ? '–' : us(dP), [['OL 대비', dO == null ? '–' : us(dO), dO]], 'big diff', dP) +
      kpi('전월 대비 증감률',
          (rP && dP != null) ? pctS(dP / Math.abs(rP)) : '–',
          [['OL 달성률', rO ? pctS(rC / rO) : '–', null]], 'big diff', dP);
  }

  /** 매출 KPI 아랫줄 — 원가 · 이익 · 마진율. 각각 전월과 최종 OL 을 함께 본다. */
  function revKpi2(a, o, pa) {
    var mgC = a.rev ? (a.rev - a.cost) / a.rev : null;
    var mgP = (pa && pa.rev) ? (pa.rev - pa.cost) / pa.rev : null;
    var mgO = o.rev ? ((o.rev - o.cost) / o.rev) : null;
    var row = function (lb, c, pv, ov, isPct, note) {
      var f = isPct ? function (v) { return v == null ? '–' : pct(v); } : uf;
      var sf = isPct ? function (v) { return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v * 100).toFixed(1) + '%p'; } : us;
      var dP = (pv == null || c == null) ? null : c - pv;
      var dO = (ov == null || c == null) ? null : c - ov;
      return kpi(lb, f(c), [
        ['전월', pv == null ? '–' : f(pv), dP == null ? null : (isPct ? dP * 100 : dP), dP == null ? null : sf(dP)],
        ['최종 OL', ov == null ? '–' : f(ov), dO == null ? null : (isPct ? dO * 100 : dO), dO == null ? null : sf(dO)]
      ], '', undefined, note);
    };
    return row('원가', a.cost, pa ? pa.cost : null, o.cost) +
           row('이익', a.rev - a.cost, pa ? (pa.rev - pa.cost) : null,
               (o.rev == null || o.cost == null) ? null : (o.rev - o.cost), false,
               '매출 − 원가 (개발비 제외)') +
           row('마진율', mgC, mgP, mgO, true);
  }

  /**
   * KPI 카드 (v20 마크업).
   *   hero  당월 판관비 — 이 화면의 주인공이라 배경째 채운다
   *   quiet 전월 — 비교 대상일 뿐이라 한 단계 낮춘다
   *   diff  증감 — 파란 배경으로 «달라진 값» 임을 표시한다
   * olrow 는 최종 OL 줄. 점선으로 나눠 «계획 대비» 임을 눈으로 가른다.
   */
  function kpi(label, val, rows, cls, signOf, note) {
    var unit = (String(val).indexOf('%') >= 0 || val === '–') ? '' :
               '<small>' + (S.unit === 'M' ? '백만원' : '전체금액') + '</small>';
    /* «확정» 은 ERP 원본 값에만 붙인다. 전월·증감 카드는 계산해서 나온 값이다. */
    var tag = (cls && /quiet|diff/.test(cls)) ? '' : ' <span class="tag act">확정</span>';
    return '<div class="card kpi ' + (cls || '') + '">' +
      '<div class="lb">' + esc(label) + tag + '</div>' +
      '<div class="vl ' + (signOf === undefined ? '' : 'delta ' + dcls(signOf)) + '">' + val + unit + '</div>' +
      rows.map(function (r) {
        var txt = (r[3] !== undefined && r[3] !== null) ? r[3] : (r[2] == null ? '' : us(r[2]));
        return '<div class="kpirow' + (/OL/.test(r[0]) ? ' olrow' : '') + '">' +
          '<span>' + esc(r[0]) + '</span><b class="num">' + r[1] +
          (txt ? ' <i class="delta ' + (r[2] == null ? '' : dcls(r[2])) + '">' + txt + '</i>' : '') +
          '</b></div>';
      }).join('') +
      (note ? '<div class="hint" style="margin-top:6px">' + esc(note) + '</div>' : '') + '</div>';
  }

  /* ==========================================================================
   * 판관비 — v20 포털의 구조를 그대로 따른다
   *
   *   ① 검산 배너      원본 총액 = 분석 반영 총액. 1원이라도 다르면 부적합
   *   ② 팀별 비교      전월 대비 · 세부 변동 표시기준(만원)
   *   ③ 적요 매칭 검토 «확신할 수 없는» 짝은 사람이 정한다
   *   ④ 비목·적요 전체 상세
   *   ⑤ 비목별 증감 · 비목별 비교(최종 OL 대비)
   * ======================================================================== */

  /** ERP 판관비 원장을 팀 × 비목 × 정규화적요로 접는다. 금액은 원 단위 그대로. */
  function foldSga(m) {
    var out = {};
    (D.S.erpSga[m] || []).forEach(function (r) {
      var org6 = D.S.orgMap[r.mg] || D.S.orgMap[r.team_raw] || null;
      var t = org6 ? (D.ORG2TEAM[org6] || null) : null;
      var team = t || '미배분';
      var cat = r.cat || '미분류';
      var nd = G.normDesc(r.descr);
      var key = G.matchKeyOf(r.descr);
      var T = out[team] || (out[team] = {});
      var C = T[cat] || (T[cat] = { total: 0, desc: {} });
      var o = C.desc[key] || (C.desc[key] = { nd: nd, raw: r.descr || nd, amt: 0, n: 0, acct: {} });
      var amt = Number(r.amt) || 0;
      o.amt += amt; o.n++;
      if (r.acct) o.acct[r.acct] = (o.acct[r.acct] || 0) + amt;
      C.total += amt;
    });
    return out;
  }

  /* 대사 결과는 월·확정버전마다 다시 만든다 */
  var RC = {}, RC_TAG = '';
  function rcOf(m, team, cat, cur, prv, hasPrev) {
    var tag = m + '|' + MATCH_VER;
    if (tag !== RC_TAG) { RC = {}; RC_TAG = tag; }
    var ck = team + '||' + cat + '||' + (hasPrev ? 1 : 0);
    if (RC[ck]) return RC[ck];
    var dec = function (side) { return matchGet(m, team, cat, side); };
    RC[ck] = G.reconcileGroup(team, cat, cur, prv, hasPrev, dec);
    return RC[ck];
  }

  function eachGroup(cur, prv, hasPrev, fn) {
    var teams = {};
    Object.keys(cur).forEach(function (t) { teams[t] = 1; });
    if (hasPrev) Object.keys(prv).forEach(function (t) { teams[t] = 1; });
    Object.keys(teams).forEach(function (t) {
      var C = cur[t] || {}, P = hasPrev ? (prv[t] || {}) : {}, cats = {};
      Object.keys(C).forEach(function (c) { cats[c] = 1; });
      if (hasPrev) Object.keys(P).forEach(function (c) { cats[c] = 1; });
      Object.keys(cats).forEach(function (c) { fn(t, c, C[c], P[c]); });
    });
  }

  function renderSga(m) {
    var ag = D.erpAgg(m);
    var prevM = m - 1;
    var hasPrev = !!D.S.erpMeta[prevM] && !!D.S.erpSga[prevM];
    var cur = foldSga(m), prv = hasPrev ? foldSga(prevM) : {};

    $('#sgaPrev').innerHTML = hasPrev
      ? '전월(' + D.moOf(prevM) + '월) 확정본과 비교합니다. 규모 막대는 <b>증감률</b> 크기입니다 — 금액이 아닙니다.'
      : '<b>' + D.moOf(prevM) + '월 확정본이 없어</b> 전월 비교는 비어 있습니다. 당월 금액과 최종 OL 대비만 나옵니다.';

    renderSgaValid(m, cur, prv, hasPrev);
    renderSgaTeam(m, cur, prv, hasPrev);
    renderSgaMatch(m, cur, prv, hasPrev);
    renderSgaDetail(m, cur, prv, hasPrev);
    renderSgaCat(m, ag, cur, prv, hasPrev);
  }

  /* ---------- ① 검산 ---------- */
  function renderSgaValid(m, cur, prv, hasPrev) {
    var v = { prevRaw: 0, currRaw: 0, prevAcc: 0, currAcc: 0, groups: 0, review: 0, bad: 0 };
    eachGroup(cur, prv, hasPrev, function (t, c, C, P) {
      var rc = rcOf(m, t, c, C, P, hasPrev);
      v.groups++; v.review += rc.review.length;
      var x = rc.validation;
      v.prevRaw += x.prevRaw; v.currRaw += x.currRaw;
      v.prevAcc += x.prevAcc; v.currAcc += x.currAcc;
      if (!x.ok) v.bad++;
    });
    var ok = Math.abs(v.currRaw - v.currAcc) < 1 && (!hasPrev || Math.abs(v.prevRaw - v.prevAcc) < 1);
    var cd = v.currRaw - v.currAcc, pd = v.prevRaw - v.prevAcc;
    var h = '<div class="vbox ' + (ok ? 'ok' : 'bad') + '">' +
      '<b>' + (ok ? '검산 통과' : '검산 부적합 — 완료 처리 보류') + '</b>' +
      '<span>당월 원본 ' + fmt0(Math.round(v.currRaw)) + '원 · 분석 반영 ' + fmt0(Math.round(v.currAcc)) + '원' +
      (Math.abs(cd) >= 1 ? ' · 차이 ' + fmt0(Math.round(cd)) + '원' : '') + '</span>';
    if (hasPrev) h += '<span>전월 원본 ' + fmt0(Math.round(v.prevRaw)) + '원 · 분석 반영 ' + fmt0(Math.round(v.prevAcc)) + '원' +
      (Math.abs(pd) >= 1 ? ' · 차이 ' + fmt0(Math.round(pd)) + '원' : '') + '</span>';
    h += '<span>대사 그룹 ' + fmt0(v.groups) + '개' + (hasPrev ? ' · 확인 필요 ' + fmt0(v.review) + '건' : '') + '</span>';
    $('#sgaValid').innerHTML = h + '</div>';
    return v;
  }

  /* ---------- ② 팀별 비교 ----------
     v20 배치 : 팀 → ① 계정별 변동 요약 칩 ② 이동계획(비목)별 변동 + 주요 원인 TOP3
                    → ③ 비목 행을 누르면 적요별 전월·당월·증감 전체 상세
     한 번에 다 펼치지 않는다. 위에서 아래로 좁혀 들어가야 원인이 눈에 남는다. */
  function renderSgaTeam(m, cur, prv, hasPrev) {
    var teams = {};
    Object.keys(cur).forEach(function (t) { teams[t] = 1; });
    if (hasPrev) Object.keys(prv).forEach(function (t) { teams[t] = 1; });
    var keys = D.TEAMS.filter(function (t) { return teams[t]; })
      .concat(Object.keys(teams).filter(function (t) { return D.TEAMS.indexOf(t) < 0; }).sort());

    /* 규모 막대는 증감액 크기를 0 기준 좌우로 나타낸다 (v20 문구 그대로) */
    var maxD = 0;
    keys.forEach(function (t) {
      if (!hasPrev) return;
      var d = Math.abs(totOf(cur[t]) - totOf(prv[t]));
      if (d > maxD) maxD = d;
    });

    var W = (S.unit !== 'M');
    var h = '<colgroup><col style="width:186px"><col style="width:' + (W ? 134 : 104) + 'px">' +
      '<col style="width:' + (W ? 148 : 118) + 'px"><col style="width:' + (W ? 134 : 104) + 'px">' +
      '<col style="width:82px"><col style="width:112px"><col></colgroup>' +
      '<thead><tr><th>팀명</th>' +
      '<th class="n prevcol">' + (hasPrev ? ymFull(m - 1) : '전월') + '</th>' +
      '<th class="n curcol">' + ymFull(m) + '</th>' +
      '<th class="n">증감액</th><th class="n">증감률</th><th class="c">규모</th>' +
      '<th>주요 증감 원인</th></tr></thead><tbody>';

    var tc = 0, tp = 0;
    keys.forEach(function (t) {
      var c = totOf(cur[t]), p = hasPrev ? totOf(prv[t]) : null;
      var d = (p == null) ? null : c - p;
      var rt = (p == null || p === 0) ? null : d / Math.abs(p);
      tc += c; if (p != null) tp += p;
      var miss = (c === 0 && hasPrev && p > 0);

      var cz;
      if (hasPrev) {
        var tops = teamTop(m, t, cur, prv, 2);
        cz = tops.length ? tops.map(function (r) {
          var nm = G.prettyDesc(r.desc, r.raw);
          var sh = nm.length > 32 ? nm.slice(0, 32) + '…' : nm;
          return '<span class="czi" title="' + esc(nm) + '"><b class="delta ' + dcls(r.v) + '">' +
            us(r.v / 1e6) + '</b>' + esc(sh) + (r.pend ? ' <span class="bdg pend">확인</span>' : '') + '</span>';
        }).join('') : '<span class="q">적요 단위 변동 없음</span>';
      } else cz = '<span class="q">전월 데이터 없음</span>';

      var open = !!S.open[t];
      h += '<tr class="trow' + (open ? ' on' : '') + '" data-t="' + esc(t) + '">' +
        '<td class="sec tname"><span class="cv">' + (open ? '▾' : '▸') + '</span>' +
        esc(t === '미배분' ? '미배분 (조직 매핑 없음)' : D.teamName(t)) +
        (miss ? ' <span class="bdg miss">미계상</span>' : '') + '</td>' +
        '<td class="n prevcol">' + (p == null ? '–' : uf(p / 1e6)) + '</td>' +
        '<td class="n curcol"><b>' + uf(c / 1e6) + '</b></td>' +
        '<td class="n delta ' + dcls(d) + '">' + (d == null ? '–' : us(d / 1e6)) + '</td>' +
        '<td class="n delta ' + dcls(d) + '">' + pctS(rt) + '</td>' +
        '<td class="c">' + magBar(d, maxD) + '</td>' +
        '<td class="cz">' + cz + '</td></tr>' +
        '<tr class="prow"' + (open ? '' : ' style="display:none"') + '><td colspan="7" class="pcell">' +
        (open ? sgaPanel(m, t, cur, prv, hasPrev) : '') + '</td></tr>';
    });

    var tdt = hasPrev ? (tc - tp) : null, trt = (hasPrev && tp) ? tdt / Math.abs(tp) : null;
    h += '<tr class="grand"><td>합 계</td>' +
      '<td class="n prevcol">' + (hasPrev ? uf(tp / 1e6) : '–') + '</td>' +
      '<td class="n curcol"><b>' + uf(tc / 1e6) + '</b></td>' +
      '<td class="n delta ' + dcls(tdt) + '">' + (tdt == null ? '–' : us(tdt / 1e6)) + '</td>' +
      '<td class="n delta ' + dcls(tdt) + '">' + pctS(trt) + '</td><td></td><td></td></tr>';

    var tbl = $('#tblSgaTeam');
    tbl.className = 't sgaSum';
    tbl.innerHTML = h + '</tbody>';

    $('#sgaTeamNote').innerHTML =
      '팀명을 클릭하면 <b>계정별 변동 요약</b>과 <b>이동계획(비목)별 변동</b>이 펼쳐지고, ' +
      '비목 행을 누르면 <b>적요별 전월·당월·증감 전체 상세</b>까지 내려갑니다.' +
      (hasPrev ? ' 규모 막대는 전월 대비 <b>증감액 크기</b>를 0 기준 좌우로 나타냅니다.'
               : ' 전월 확정 데이터가 없어 증감·규모는 표시하지 않습니다.');

    $$('#tblSgaTeam tr.trow').forEach(function (tr) {
      tr.onclick = function () { var t = this.dataset.t; S.open[t] = !S.open[t]; render(); };
    });
    $$('#tblSgaTeam tr.catrow').forEach(function (tr) {
      tr.onclick = function (e) {
        e.stopPropagation();
        var ck = this.dataset.ck;
        S.cat[ck] = !S.cat[ck];
        render();
      };
    });
    $('#sgaThIn').value = S.th;
  }

  function ymFull(m) { return D.yOf(m) + '년 ' + D.moOf(m) + '월'; }
  function ymShort(m) { var v = D.moOf(m); return (v < 10 ? '0' : '') + v + '월'; }
  function pctS(r) {
    if (r == null || isNaN(r) || !isFinite(r)) return '–';
    var v = Math.round(r * 1000) / 10;
    return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1) + '%';
  }
  /* 0 을 가운데 두고 좌우로 뻗는 막대 — 증감액 크기다 */
  function magBar(v, max) {
    if (v == null || !(max > 0)) return '';
    var w = Math.min(50, Math.abs(v) / max * 50);
    var cls = dcls(v);
    var st = v >= 0 ? ('left:50%;width:' + w.toFixed(1) + '%') : ('right:50%;width:' + w.toFixed(1) + '%');
    return '<span class="mbar"><i class="' + cls + '" style="' + st + '"></i></span>';
  }

  function totOf(T) {
    var s = 0;
    if (!T) return 0;
    Object.keys(T).forEach(function (c) { s += T[c].total; });
    return s;
  }

  /** 그 팀 전체에서 변동이 큰 적요 n 건 */
  function teamTop(m, t, cur, prv, n) {
    var items = [], C = cur[t] || {}, P = prv[t] || {}, cats = {};
    Object.keys(C).forEach(function (c) { cats[c] = 1; });
    Object.keys(P).forEach(function (c) { cats[c] = 1; });
    Object.keys(cats).forEach(function (c) {
      G.itemsOf(rcOf(m, t, c, C[c], P[c], true), true).forEach(function (r) { items.push(r); });
    });
    return items.filter(function (r) { return Math.abs(r.v) >= 1; })
      .sort(function (x, y) { return Math.abs(y.v) - Math.abs(x.v); }).slice(0, n || 2);
  }

  /* ---------- 팀 패널 ---------- */
  function sgaPanel(m, t, cur, prv, hasPrev) {
    var C = cur[t] || {}, P = hasPrev ? (prv[t] || {}) : {};
    var names = {};
    Object.keys(C).forEach(function (c) { names[c] = 1; });
    if (hasPrev) Object.keys(P).forEach(function (c) { names[c] = 1; });
    var all = D.ITEMS['판관비'];
    var cats = all.filter(function (c) { return names[c]; })
      .concat(Object.keys(names).filter(function (c) { return all.indexOf(c) < 0; }).sort());

    var rows = cats.map(function (c) {
      var cc = C[c] ? C[c].total : 0, pp = hasPrev ? (P[c] ? P[c].total : 0) : null;
      return { cat: c, c: cc, p: pp, v: hasPrev ? (cc - pp) : cc,
               rt: (hasPrev && pp) ? (cc - pp) / Math.abs(pp) : null };
    });
    var sumC = 0, sumP = 0;
    rows.forEach(function (x) { sumC += x.c; sumP += (x.p || 0); });

    var h = '<div class="tpanel">';
    h += '<div class="pn-h">' + esc(D.teamName(t)) + ' · 계정별 변동 요약</div><div class="chips">';
    if (!rows.length) h += '<span class="hint">해당 팀의 판관비 발생 내역이 없습니다.</span>';
    rows.forEach(function (x) {
      h += '<span class="cchip">' + esc(x.cat) + ' <b class="delta ' + (hasPrev ? dcls(x.v) : 'flat') + '">' +
        (hasPrev ? us(x.v / 1e6) : uf(x.c / 1e6)) + '</b></span>';
    });
    h += '</div>';

    h += '<div class="pn-h2"><span>' + esc(D.teamName(t)) +
      ' · 이동계획(비목)별 변동 — 행을 누르면 적요별 상세</span>' +
      '<span class="pn-note">상세 표시 기준 ' + (S.th > 0 ? fmt0(S.th) + '만원 이상' : '전체') + '</span></div>';

    h += '<table class="t pnT"><colgroup><col class="c-cat"><col class="c-n"><col class="c-n">' +
      '<col class="c-n"><col class="c-r"><col></colgroup><thead><tr><th>이동계획</th>' +
      '<th class="n prevcol">' + (hasPrev ? ymShort(m - 1) : '전월') + '</th>' +
      '<th class="n curcol">' + ymShort(m) + '</th><th class="n">증감액</th><th class="n">증감률</th>' +
      '<th>주요 증감 원인 (TOP3)</th></tr></thead><tbody>';

    rows.forEach(function (x) {
      var ck = t + '|' + x.cat, open = !!S.cat[ck];
      var items = G.itemsOf(rcOf(m, t, x.cat, C[x.cat], hasPrev ? P[x.cat] : null, hasPrev), hasPrev);
      var fl = G.filterItems(items, hasPrev, S.th);
      var nPend = items.filter(function (r) { return r.pend; }).length;
      var top = items.filter(function (r) { return hasPrev ? Math.abs(r.v) >= 1 : r.c !== 0; })
        .sort(function (p, q) { return Math.abs(hasPrev ? q.v : q.c) - Math.abs(hasPrev ? p.v : p.c); })
        .slice(0, 3);

      h += '<tr class="catrow' + (open ? ' on' : '') + '" data-ck="' + esc(ck) + '">' +
        '<td class="sec"><span class="cv">' + (open ? '▾' : '▸') + '</span>' + esc(x.cat) + '</td>' +
        '<td class="n prevcol">' + (hasPrev ? uf(x.p / 1e6) : '–') + '</td>' +
        '<td class="n curcol"><b>' + uf(x.c / 1e6) + '</b></td>' +
        '<td class="n delta ' + (hasPrev ? dcls(x.v) : 'flat') + '">' + (hasPrev ? us(x.v / 1e6) : '–') + '</td>' +
        '<td class="n delta ' + (hasPrev ? dcls(x.v) : 'flat') + '">' + pctS(x.rt) + '</td>' +
        '<td class="why">';
      if (!top.length) h += '<span class="hint">' + (hasPrev ? '변동 없음' : '내역 없음') + '</span>';
      top.forEach(function (r, i) {
        var nm = G.prettyDesc(r.desc, r.raw);
        h += '<div class="wrow"><span class="rk">' + (i + 1) + '</span>' +
          '<span class="wn" title="' + esc(nm) + '">' + esc(nm) + '</span>' +
          (r.pend ? '<span class="bdg pend">확인 필요</span>' : '') +
          (r.neu ? '<span class="bdg new">신규</span>' : '') +
          (r.gone ? '<span class="bdg gone">당월 없음</span>' : '') +
          '<span class="wv">' +
          (hasPrev ? '<span class="q">' + uf(r.p / 1e6) + ' → ' + uf(r.c / 1e6) + '</span>' : '') +
          '<b class="delta ' + (hasPrev ? dcls(r.v) : 'flat') + '">' +
          (hasPrev ? us(r.v / 1e6) : uf(r.c / 1e6)) + '</b></span></div>';
      });
      h += '<div class="pn-more">' + (open ? '▾ 적요 상세 펼침' : '▸ 적요 상세 보기') +
        ' · 표시 ' + fl.rows.length + '건' +
        (fl.hidN ? ' · 기준 미만 ' + fl.hidN + '건 숨김' : '') +
        (nPend ? ' · <b class="pendtx">매칭 확인 필요 ' + nPend + '건</b>' : '') + '</div></td></tr>';
      h += '<tr class="detrow"' + (open ? '' : ' style="display:none"') + '><td colspan="6" class="dcell">' +
        (open ? descTable(fl, hasPrev, 300) : '') + '</td></tr>';
    });

    h += '</tbody><tfoot><tr class="pnsum"><td>' + esc(D.teamName(t)) +
      ' 합계 <span class="q">전액 기준</span></td>' +
      '<td class="n prevcol">' + (hasPrev ? uf(sumP / 1e6) : '–') + '</td>' +
      '<td class="n curcol"><b>' + uf(sumC / 1e6) + '</b></td>' +
      '<td class="n delta ' + (hasPrev ? dcls(sumC - sumP) : 'flat') + '">' +
      (hasPrev ? us((sumC - sumP) / 1e6) : '–') + '</td>' +
      '<td class="n"></td><td class="q">표시 기준과 무관하게 전액 합계입니다</td></tr></tfoot></table></div>';
    return h;
  }


  /* ---------- 적요 상세표 (v20 descTableO) ----------
     전월 · 당월 · 증감 · 구분(기존/신규/당월없음/확인필요)을 한 줄에 놓는다.
     맨 아래에 표시 건수와 숨긴 건수를 적어, 지금 보는 것이 전부가 아님을 밝힌다. */
  function descTable(fl, hasPrev, cap) {
    var list = fl.rows;
    if (!list.length) {
      return '<div class="hint" style="padding:9px 12px">표시 기준 이상의 적요가 없습니다.' +
        (fl.hidN ? ' — 기준 미만 ' + fmt0(fl.hidN) + '건(합계 ' + us(fl.hidSum / 1e6) +
          ') 숨김. 기준을 낮추거나 <b>전체 보기</b>를 누르세요.' : '') + '</div>';
    }
    cap = cap || 300;
    var show = list.slice(0, cap), sc = 0, sp = 0;
    var h = '<table class="t sub descT"><colgroup><col><col class="d-acct"><col class="d-n">' +
      '<col class="d-n"><col class="d-n"><col class="d-tag"></colgroup>' +
      '<thead><tr><th>적요</th><th>계정명</th><th class="n prevcol">전월</th>' +
      '<th class="n curcol">당월</th><th class="n">증감</th><th class="c">구분</th></tr></thead><tbody>';
    show.forEach(function (r) {
      sc += r.c; sp += (r.p || 0);
      var tag = r.pend ? '<span class="bdg pend" title="' + esc(r.note || '') + '">확인 필요</span>'
        : r.neu ? '<span class="bdg new">신규</span>'
        : r.gone ? '<span class="bdg gone">당월 없음</span>'
        : (r.merged ? '<span class="bdg">합치기 확정</span>' : '<span class="q">기존</span>');
      var lbl;
      if (r.pend) {
        if (r.prevDesc && r.currDesc)
          lbl = '<div>' + esc(G.prettyDesc(r.prevDesc, r.prevRaw)) + '</div>' +
                '<div class="q2">↳ 당월 후보 : ' + esc(G.prettyDesc(r.currDesc, r.currRaw)) + '</div>';
        else if (r.prevDesc)
          lbl = '<div>' + esc(G.prettyDesc(r.prevDesc, r.prevRaw)) + '</div><div class="q2">↳ 당월 유사 후보 다수</div>';
        else
          lbl = '<div>' + esc(G.prettyDesc(r.currDesc, r.currRaw)) + '</div><div class="q2">↳ 전월 유사 후보 다수</div>';
      } else lbl = descHtml(r);
      h += '<tr class="' + (r.pend ? 'pend' : (r.gone ? 'gone' : '')) + '"><td class="txt">' + lbl + '</td>' +
        '<td class="txt q">' + esc(G.acctLabel(r.acct)) + '</td>' +
        '<td class="n prevcol">' + (hasPrev ? uf(r.p / 1e6) : '–') + '</td>' +
        '<td class="n curcol">' + uf(r.c / 1e6) + '</td>' +
        '<td class="n delta ' + (hasPrev ? dcls(r.v) : 'flat') + '">' + (hasPrev ? us(r.v / 1e6) : '–') + '</td>' +
        '<td class="c">' + tag + '</td></tr>';
    });
    h += '</tbody></table><div class="dsum"><span>표시 ' + fmt0(show.length) + '건 · 전월 <b>' +
      (hasPrev ? uf(sp / 1e6) : '–') + '</b> → 당월 <b>' + uf(sc / 1e6) + '</b>' +
      (hasPrev ? ' · 증감 <b>' + us((sc - sp) / 1e6) + '</b>' : '') + '</span>';
    if (fl.hidN) h += '<span>기준 미만 숨김 ' + fmt0(fl.hidN) + '건 · ' + us(fl.hidSum / 1e6) + '</span>';
    if (list.length > cap) h += '<span>외 ' + fmt0(list.length - cap) + '건 — 변동액 큰 순 ' + cap + '건까지</span>';
    return h + '</div>';
  }

  /** 같은 카테고리는 공통 앞부분을 굵게 — 비슷한 적요가 줄줄이 있을 때 눈이 덜 미끄러진다 */
  function descHtml(o) {
    var t = G.prettyDesc(o.desc, o.raw), c = G.descCat(t);
    if (c && c !== t && t.indexOf(c) === 0) return '<b>' + esc(c) + '</b>' + esc(t.slice(c.length));
    return esc(t);
  }

  /* ---------- ④ 비목 · 적요 전체 상세 ----------
     v20 배치 : 팀 블록 → 비목 아코디언 → 펼치면 그 비목의 적요 상세표.
     한 표에 전부 쏟으면 어느 팀 어느 비목이 움직였는지가 사라진다. */
  var DET = {};                       /* 팀||비목 → 펼칠 때 그릴 적요 목록 */

  function renderSgaDetail(m, cur, prv, hasPrev) {
    var host = $('#sgaDetail');
    $('#btnSgaFold').textContent = S.fold ? '펼치기' : '접기';
    $('#sgaDetailNote').innerHTML = (hasPrev
      ? (S.th > 0 ? '전월 대비 <b>' + fmt0(S.th) + '만원 이상</b> 변동한 비목 · 적요만 표시합니다.'
                  : '증감이 있는 비목 · 적요를 <b>전부</b> 표시합니다.')
      : '전월 확정 데이터가 없어 증감 대신 <b>당월 구성</b>으로 표시합니다.') +
      ' 비목 행을 누르면 적요별 전월 · 당월 · 증감 전체가 펼쳐집니다. 표시 기준은 <b>화면 필터일 뿐</b>이며 ' +
      'ERP 총액 · 팀 합계 · 비목 합계 · 검산 금액에는 영향이 없습니다.';
    if (S.fold) {
      host.innerHTML = '<div class="hint" style="padding:12px">전 팀 비목 · 적요 상세가 접혀 있습니다 — <b>펼치기</b>를 누르세요.</div>';
      return;
    }

    var thAmt = S.th * 1e4;                                   /* 만원 → 원 */
    var names = {};
    Object.keys(cur).forEach(function (t) { names[t] = 1; });
    if (hasPrev) Object.keys(prv).forEach(function (t) { names[t] = 1; });
    var order = D.TEAMS.filter(function (t) { return names[t]; })
      .concat(Object.keys(names).filter(function (t) { return D.TEAMS.indexOf(t) < 0; }).sort());
    var allCat = D.ITEMS['판관비'];

    var teams = order.map(function (t) {
      var C = cur[t] || {}, P = hasPrev ? (prv[t] || {}) : {}, nm = {};
      Object.keys(C).forEach(function (c) { nm[c] = 1; });
      if (hasPrev) Object.keys(P).forEach(function (c) { nm[c] = 1; });
      var cs = allCat.filter(function (c) { return nm[c]; })
        .concat(Object.keys(nm).filter(function (c) { return allCat.indexOf(c) < 0; }).sort());
      var sum = 0, psum = 0;
      var all = cs.map(function (c) {
        var cc = C[c] ? C[c].total : 0, pp = hasPrev ? (P[c] ? P[c].total : 0) : 0;
        sum += cc; psum += pp;
        var items = G.itemsOf(rcOf(m, t, c, C[c], hasPrev ? P[c] : null, hasPrev), hasPrev);
        return { cat: c, c: cc, p: hasPrev ? pp : null, v: hasPrev ? (cc - pp) : cc,
                 items: items, fl: G.filterItems(items, hasPrev, S.th),
                 pend: items.filter(function (r) { return r.pend; }).length };
      });
      /* 기준에 걸리지 않는 비목은 접는다 — 다만 «확인 필요» 는 기준과 무관하게 남긴다 */
      var vis = all.filter(function (x) {
        if (!hasPrev) return x.c !== 0;
        return x.pend > 0 || Math.abs(x.v) >= Math.max(thAmt, 1) || x.fl.rows.length > 0;
      });
      vis.sort(function (a, b) { return Math.abs(b.v) - Math.abs(a.v); });
      return { team: t, all: all, cats: vis, sum: sum, psum: hasPrev ? psum : null,
               d: hasPrev ? (sum - psum) : null, miss: (sum === 0 && hasPrev && psum > 0) };
    });

    var shown = teams.filter(function (x) { return x.cats.length; });
    var hidden = teams.filter(function (x) { return !x.cats.length; });
    shown.sort(function (a, b) { return Math.abs(hasPrev ? b.d : b.sum) - Math.abs(hasPrev ? a.d : a.sum); });
    var maxAbs = 0;
    shown.forEach(function (x) { x.cats.forEach(function (c) { if (Math.abs(c.v) > maxAbs) maxAbs = Math.abs(c.v); }); });

    DET = {};
    var h = '';
    shown.forEach(function (x) {
      h += '<div class="tblock"><div class="tblock-hd">' +
        '<div class="tb-name">' + esc(x.team === '미배분' ? '미배분 (조직 매핑 없음)' : D.teamName(x.team)) +
        (x.miss ? ' <span class="bdg miss">미계상</span>' : '') + '</div>' +
        '<div class="tb-fig">' + (hasPrev
          ? '<span class="q">' + uf(x.psum / 1e6) + '</span> → <b>' + uf(x.sum / 1e6) + '</b>'
          : '<b>' + uf(x.sum / 1e6) + '</b>') + '</div>' +
        (hasPrev ? '<div class="tb-d delta ' + dcls(x.d / 1e6) + '">' + us(x.d / 1e6) + '</div>'
                 : '<div class="tb-d"></div>') +
        '</div><div class="tblock-bd">';
      x.cats.forEach(function (c) {
        var dk = x.team + '||' + c.cat;
        DET[dk] = { fl: c.fl, hasPrev: hasPrev };
        var rt = reasonText(c.fl.rows, hasPrev);
        h += '<details class="acc" data-dk="' + esc(dk) + '"><summary>' +
          '<span class="ac-name">' + esc(c.cat) + '</span>' +
          '<span class="ac-bar">' + diffBar(c.v, maxAbs) + '</span>' +
          '<span class="ac-val num">' + (hasPrev ? uf(c.p / 1e6) : '') + '</span>' +
          '<span class="ac-cur num"><b>' + uf(c.c / 1e6) + '</b></span>' +
          '<span class="ac-d num delta ' + (hasPrev ? dcls(c.v / 1e6) : 'flat') + '">' +
            (hasPrev ? us(c.v / 1e6) : '') + '</span>' +
          '<span class="ac-why" title="' + esc(rt) + '">' + esc(rt) +
            (c.pend ? ' <span class="bdg pend">확인 ' + c.pend + '</span>' : '') + '</span></summary>' +
          '<div class="dbody"></div></details>';
      });
      h += '</div></div>';
    });

    if (hidden.length) h += '<div class="hint" style="margin-top:8px">그 외 ' + hidden.length + '개 팀은 ' +
      (hasPrev ? (S.th > 0 ? fmt0(S.th) + '만원 이상 변동 항목 없음' : '변동 항목 없음') : '당월 판관비 없음') +
      ' — ' + hidden.map(function (x) { return esc(D.teamName(x.team)); }).join(' · ') + '</div>';

    /* 기준을 높여 전부 가려진 경우 — 왜 비었는지와 되돌리는 방법을 함께 적는다 */
    if (!shown.length) {
      h = '<div class="emptybox"><div class="eh">' +
        (hasPrev ? (S.th > 0 ? '전월 대비 ' + fmt0(S.th) + '만원 이상 변동한 비목이 없습니다.'
                             : '전월 대비 변동이 있는 비목이 없습니다.')
                 : '당월 판관비 데이터가 없습니다.') + '</div>' +
        (hasPrev && S.th > 0
          ? '<div class="ed">기준을 낮추거나 <b>전체 보기</b>를 누르면 더 작은 변동까지 볼 수 있습니다.</div>' : '') +
        (hidden.length ? '<div class="ed">대상 팀 ' + hidden.length + '개 — ' +
          hidden.map(function (x) { return esc(D.teamName(x.team)); }).join(' · ') + '</div>' : '') + '</div>';
    }

    /* 검산 — 표시 기준을 바꿔도 ERP 총액과 총증감은 그대로다 */
    var shownSum = 0, hidN = 0, hidSum = 0, totC = 0, totP = 0;
    teams.forEach(function (x) {
      var vis = {}; x.cats.forEach(function (c) { vis[c.cat] = 1; });
      totC += x.sum; totP += (x.psum || 0);
      x.all.forEach(function (c) {
        if (vis[c.cat]) {
          c.fl.rows.forEach(function (r) { shownSum += (hasPrev ? r.v : r.c); });
          hidN += c.fl.hidN; hidSum += c.fl.hidSum;
        } else {
          c.items.forEach(function (r) { hidN++; hidSum += (hasPrev ? r.v : r.c); });
        }
      });
    });
    h += '<div class="dsum"><span>검산 · 당월 ERP 판관비 총액 <b>' + uf(totC / 1e6) +
      '</b> (표시 기준과 무관하게 고정)</span>' +
      (hasPrev ? '<span>전월 대비 총증감 <b>' + us((totC - totP) / 1e6) + '</b></span>' : '') +
      '<span>표시된 상세 ' + (hasPrev ? '증감 합계' : '금액 합계') + ' <b>' + us(shownSum / 1e6) + '</b></span>' +
      '<span>기준 미만 상세 생략 <b>' + fmt0(hidN) + '건</b> · ' + us(hidSum / 1e6) + '</span></div>';

    host.innerHTML = h;
    /* 적요 상세표는 펼칠 때 그린다 — 전 팀 것을 한 번에 그리면 화면이 멈춘다 */
    $$('#sgaDetail details.acc').forEach(function (dt) {
      dt.ontoggle = function () {
        if (!dt.open) return;
        var bd = dt.querySelector('.dbody');
        if (!bd || bd.getAttribute('data-done')) return;
        var d = DET[dt.getAttribute('data-dk')];
        bd.innerHTML = d ? descTable(d.fl, d.hasPrev, 300) : '';
        bd.setAttribute('data-done', '1');
      };
    });
  }

  /** 이 비목이 왜 움직였는지 한 줄로 — 큰 것 둘과 나머지 건수 */
  function reasonText(rows, hasPrev) {
    var s = rows.filter(function (r) { return Math.abs(hasPrev ? r.v : r.c) >= 1; });
    if (!s.length) return hasPrev ? '변동 없음' : '';
    var top = s.slice(0, 2).map(function (r) {
      var nm = G.prettyDesc(r.desc, r.raw);
      if (nm.length > 20) nm = nm.slice(0, 20) + '…';
      return nm + ' ' + us((hasPrev ? r.v : r.c) / 1e6);
    });
    return top.join('  ·  ') + (s.length > 2 ? '  외 ' + (s.length - 2) + '건' : '');
  }

  /** 왼쪽에서 자라는 단순 막대 — 길이는 가장 큰 절대값 대비. 빨강 증가 / 파랑 감소 */
  function diffBar(v, max) {
    var w = max > 0 ? Math.min(100, Math.abs(v) / max * 100) : 0;
    return '<span class="dbar"><i class="' + dcls(v / 1e6) + '" style="width:' + w.toFixed(1) + '%"></i></span>';
  }

  /* ---------- ⑤ 비목별 증감 · 비목별 비교 ---------- */
  function renderSgaCat(m, ag, cur, prv, hasPrev) {
    var cats = D.ITEMS['판관비'].slice();
    Object.keys(ag.sgaCat).forEach(function (c) { if (cats.indexOf(c) < 0) cats.push(c); });

    var cSum = {}, pSum = {};
    Object.keys(cur).forEach(function (t) {
      Object.keys(cur[t]).forEach(function (c) { cSum[c] = (cSum[c] || 0) + cur[t][c].total; });
    });
    if (hasPrev) Object.keys(prv).forEach(function (t) {
      Object.keys(prv[t]).forEach(function (c) { pSum[c] = (pSum[c] || 0) + prv[t][c].total; });
    });

    /* 전월이 있으면 증감액을, 없으면 당월 확정 금액을 그린다.
       비교할 게 없다고 빈 칸을 두면 그 달은 아무것도 못 본다 — v20 과 같다. */
    var rows = cats.map(function (c) {
      var cc = (cSum[c] || 0) / 1e6, pp = hasPrev ? (pSum[c] || 0) / 1e6 : null;
      var o = D.ITEMS['판관비'].indexOf(c) >= 0 ? K.OL(m, D.TOTAL, '판관비', c) : null;
      return { name: c, v: hasPrev ? (cc - pp) : cc,
               tip: '당월 확정 ' + uf(cc) + (hasPrev ? ' · 전월 ' + uf(pp) : '') + ' · 최종 OL ' + uf(o) };
    });
    zeroBars($('#chSga'), rows);
    $('#sgaBarNote').textContent = (hasPrev ? '전월 대비 증감액' : '당월 확정 금액') +
      ' · 빨강 증가 / 파랑 감소 · 가장 큰 절대값을 100%로 본 상대 길이';

    /* 비목별 비교 — v20 열 : 전월 · 최종 OL · 당월 확정 · 전월 대비 · OL 대비.
       계획(최종 OL)에서 온 열은 노란 계열, 확정에서 온 열은 분홍 계열로 출처를 나눈다. */
    var ch = '<colgroup><col style="width:15%"><col style="width:17%"><col style="width:17%">' +
      '<col style="width:17%"><col style="width:17%"><col style="width:17%"></colgroup>' +
      '<thead><tr><th>비목</th>' +
      '<th class="n prevcol">' + (hasPrev ? '전월' : '전월') + '</th>' +
      '<th class="n olcol">최종 OL</th>' +
      '<th class="n curcol">당월 확정</th>' +
      '<th class="n bl">전월 대비</th>' +
      '<th class="n olcol">OL 대비</th></tr></thead><tbody>';
    var so = 0, sc = 0, sp = 0, hasOl = false;
    cats.forEach(function (cat) {
      var cc = (cSum[cat] || 0) / 1e6, pp = hasPrev ? (pSum[cat] || 0) / 1e6 : null;
      var known = D.ITEMS['판관비'].indexOf(cat) >= 0;
      var o = known ? K.OL(m, D.TOTAL, '판관비', cat) : null;
      if (o != null) { so += o; hasOl = true; }
      sc += cc; if (pp != null) sp += pp;
      var dP = (pp == null) ? null : cc - pp;
      var dO = (o == null) ? null : cc - o;
      ch += '<tr><td class="sec">' + esc(cat) +
        (known ? '' : ' <span class="bdg">미분류</span>') + '</td>' +
        '<td class="n prevcol">' + (hasPrev ? uf(pp) : '–') + '</td>' +
        '<td class="n olcol">' + uf(o) + '</td>' +
        '<td class="n curcol"><b>' + uf(cc) + '</b></td>' +
        '<td class="n bl delta ' + (dP == null ? 'flat' : dcls(dP)) + '">' + (dP == null ? '–' : us(dP)) + '</td>' +
        '<td class="n olcol delta ' + (dO == null ? 'flat' : dcls(dO)) + '">' + (dO == null ? '–' : us(dO)) + '</td></tr>';
    });
    var olT = K.OL(m, D.TOTAL, '판관비', '합계');
    if (olT == null && hasOl) olT = so;
    ch += '<tr class="grand"><td>합 계</td>' +
      '<td class="n prevcol">' + (hasPrev ? uf(sp) : '–') + '</td>' +
      '<td class="n">' + uf(olT) + '</td>' +
      '<td class="n"><b>' + uf(sc) + '</b></td>' +
      '<td class="n bl delta ' + (hasPrev ? dcls(sc - sp) : 'flat') + '">' +
        (hasPrev ? us(sc - sp) : '–') + '</td>' +
      '<td class="n delta ' + dcls(olT == null ? null : sc - olT) + '">' +
        us(olT == null ? null : sc - olT) + '</td></tr>';
    $('#tblSgaCat').innerHTML = ch + '</tbody>';
  }

  /**
   * 0 을 가운데 축으로 두고 좌우로 뻗는 가로 막대 (v20 divBars).
   * 이름은 왼쪽에, 값은 막대 끝에 붙인다 — 값이 고정 열에 있으면 막대 길이와 눈이 따로 논다.
   * 값 표기는 언제나 백만원 정수다. 여기서 보는 것은 «크기 비교» 이지 금액 조회가 아니다.
   */
  function zeroBars(host, rows) {
    if (!host) return;
    if (!rows.length) { host.innerHTML = '<div class="note info" style="margin:0">표시할 비목이 없습니다.</div>'; return; }
    var W = host.clientWidth || 520, rh = 28, H = rows.length * rh + 12, lw = 74;
    var mx = 1;
    rows.forEach(function (r) { if (Math.abs(r.v) > mx) mx = Math.abs(r.v); });
    var half = (W - lw - 44) / 2, cx = lw + half;
    var g = '<line x1="' + cx + '" x2="' + cx + '" y1="4" y2="' + (H - 8) + '" stroke="#D9DDE0" stroke-width="1"/>';
    rows.forEach(function (r, i) {
      var y = i * rh + 8, w = Math.max(half * Math.abs(r.v) / mx, 1), pos = r.v >= 0;
      var sign = r.v > 0.005 ? '+' : (r.v < -0.005 ? '−' : '');
      var lab = sign + Math.round(Math.abs(r.v));
      g += '<text x="0" y="' + (y + 13) + '" class="ax">' + esc(r.name) + '</text>' +
        '<rect x="' + (pos ? cx : cx - w) + '" y="' + (y + 3) + '" width="' + w.toFixed(1) +
          '" height="13" rx="3" fill="' + (pos ? '#990033' : '#2461a8') + '"><title>' +
          esc(r.name + ' — ' + r.tip) + '</title></rect>' +
        '<text x="' + (pos ? cx + w + 6 : cx - w - 6) + '" y="' + (y + 14) + '" class="vlab" text-anchor="' +
          (pos ? 'start' : 'end') + '">' + lab + '</text>';
    });
    host.innerHTML = '<svg class="zbar" viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '">' + g + '</svg>';
  }

  /* ---------- 차이 원인 · 검토 의견 (판관비 · 매출 공통) ----------
     v20 과 같은 자리다. 팀별로 최종 OL 대비 차이를 나란히 놓고 그 옆에 사유를 적는다.
     사유는 mp_notes(kind=erpdiff) 한 자리에만 남고, 대시보드 · 리포트 · 비교표 엑셀이 같은 값을 읽는다. */
  function renderErpNote(m) {
    var ag = D.erpAgg(m);
    if (!ag) { $('#tblErpNote').innerHTML = ''; return; }
    $('#erpNoteDesc').innerHTML = '최종 OL 대비 <b>+</b> 는 계획보다 많이 판(쓴) 것입니다. ' +
      '매출 · 원가는 매출현황, 판관비는 판관비 확정본에서 옵니다. ' +
      (MpAuth.viewOnly() ? '<b>화면이 좁아 보기 전용입니다</b> — 사유 입력은 PC 에서 하세요.'
                         : '사유는 칸을 벗어나면 바로 저장됩니다.');
    var h = '<colgroup><col style="width:12%"><col style="width:18%"><col style="width:18%">' +
      '<col style="width:18%"><col style="width:34%"></colgroup><thead><tr><th>팀</th>' +
      '<th class="n">매출 OL 대비</th><th class="n">원가 OL 대비</th><th class="n">판관비 OL 대비</th>' +
      '<th>차이 원인 · 검토 의견</th></tr></thead><tbody>';
    D.TEAMS.forEach(function (t) {
      var a = K.act(m, t), o = K.metrics(m, t, 'ol');
      if (!a) return;
      var dr = (o.rev == null) ? null : a.rev - o.rev;
      var dc = (o.cost == null) ? null : a.cost - o.cost;
      var ds = (o.sga == null) ? null : a.sga - o.sga;
      var nt = D.findNote('erpdiff', m, t, null, null, null);
      var body = nt ? nt.body : '';
      /* 팀장은 자기 팀만 쓴다 — RLS 가 그렇고, 칸도 그래야 한다 */
      var can = MpAuth.canWriteTeam(t) && !MpAuth.viewOnly();
      h += '<tr><td class="sec">' + esc(D.teamName(t)) + '</td>' +
        '<td class="n delta ' + dcls(dr) + '">' + us(dr) + '</td>' +
        '<td class="n delta ' + dcls(dc) + '">' + us(dc) + '</td>' +
        '<td class="n delta ' + dcls(ds) + '">' + us(ds) + '</td>' +
        '<td class="txt">' + (can
          ? '<textarea rows="1" class="na" data-et="' + esc(t) + '" placeholder="차이 원인을 입력하세요">' +
            esc(body) + '</textarea>'
          : (body ? esc(body) : '<span class="q">' + esc(D.teamName(t)) + ' 담당자만 적을 수 있습니다</span>')) +
        '</td></tr>';
    });
    $('#tblErpNote').innerHTML = h + '</tbody>';

    $$('#tblErpNote textarea.na').forEach(function (ta) {
      var fit = function () { ta.style.height = 'auto'; ta.style.height = Math.max(24, ta.scrollHeight) + 'px'; };
      fit(); ta.oninput = fit;
      ta.onblur = function () {
        var t = this.dataset.et;
        D.setNote('erpdiff', m, t, null, null, null, this.value)
          .then(function () { flash('저장됨'); })
          .catch(function (e) { flash(e.message, true); });
      };
    });
  }

  /* ==========================================================================
   * 매출 명세 — v20 «영업그룹별 비교 및 변동 프로젝트»
   *   팀 합계 행에서만 전월 · 최종 OL 과 비교한다.
   *   프로젝트 단위에는 대응하는 OL 금액이 아예 없다 — 없는 것을 0 으로 그리지 않는다.
   *   프로젝트는 신규 → 변동 → 당월 없음 순으로, 그 안에서 변동이 큰 것부터 세운다.
   * ======================================================================== */
  function projMap(m) {
    var o = {};
    (D.S.erpRev[m] || []).forEach(function (r) {
      var t = D.ORG2TEAM[r.team] || r.team;
      var nm = r.pname || '(프로젝트명 없음)';
      var k = t + '||' + nm;
      var x = o[k] || (o[k] = { team: t, name: nm, rev: 0, cost: 0, n: 0 });
      x.rev += Number(r.amt) / 1e6;
      x.cost += Number(r.cost || 0) / 1e6;
      x.n++;
    });
    return o;
  }

  function renderRev(m) {
    var prevM = m - 1, hasPrev = !!D.S.erpMeta[prevM] && !!D.S.erpRev[prevM];
    var ag = D.erpAgg(m), pg = hasPrev ? D.erpAgg(prevM) : null;
    var pc = projMap(m), pp = hasPrev ? projMap(prevM) : {};

    var W = (S.unit !== 'M'), mw = W ? 130 : 106;
    var h = '<colgroup><col style="width:132px"><col class="projname">' +
      '<col style="width:' + mw + 'px"><col style="width:' + mw + 'px">' +
      '<col style="width:' + (mw + 14) + 'px"><col style="width:' + mw + 'px">' +
      '<col style="width:' + mw + 'px"></colgroup>' +
      '<thead><tr><th rowspan="2" class="stick s1">영업그룹</th><th rowspan="2">프로젝트</th>' +
      '<th colspan="3" class="c grphead bl">금액 (' + (S.unit === 'M' ? '백만원' : '전체금액') + ')</th>' +
      '<th colspan="2" class="c grphead bl">증감</th></tr><tr>' +
      '<th class="n bl prevcol">전월</th><th class="n olcol">최종 OL</th><th class="n curcol">당월 확정</th>' +
      '<th class="n bl">전월 대비</th><th class="n olcol">OL 대비</th></tr></thead><tbody>';

    var tot = { p: 0, o: 0, c: 0 }, hasOl = false;
    D.TEAMS.forEach(function (t) {
      var cRev = ag.byTeam[t] ? ag.byTeam[t].rev : 0;
      var pRev = (hasPrev && pg && pg.byTeam[t]) ? pg.byTeam[t].rev : null;
      var oRev = K.OL(m, t, '매출', '합계');

      var names = {};
      Object.keys(pc).forEach(function (k) { if (pc[k].team === t) names[pc[k].name] = 1; });
      Object.keys(pp).forEach(function (k) { if (pp[k].team === t) names[pp[k].name] = 1; });
      var rows = Object.keys(names).map(function (nm) {
        var c = (pc[t + '||' + nm] || {}).rev || 0, p = (pp[t + '||' + nm] || {}).rev || 0;
        return { name: nm, c: c, p: p, d: c - p, gone: (c === 0 && p > 0), neu: (p === 0 && c > 0) };
      }).filter(function (r) { return hasPrev ? (Math.abs(r.d) > 0.0005 || r.c > 0) : r.c > 0; });
      rows.sort(function (a, b) {
        var ga = a.gone ? 2 : (a.neu ? 0 : 1), gb = b.gone ? 2 : (b.neu ? 0 : 1);
        if (ga !== gb) return ga - gb;
        return Math.abs(b.d || b.c) - Math.abs(a.d || a.c);
      });

      tot.c += cRev;
      if (pRev != null) tot.p += pRev;
      if (oRev != null) { tot.o += oRev; hasOl = true; }
      var dP = (pRev == null) ? null : cRev - pRev;
      var dO = (oRev == null) ? null : cRev - oRev;
      var span = Math.max(1, rows.length) + 1;

      h += '<tr class="teamsum"><td class="sec stick s1" rowspan="' + span + '">' +
        esc(D.teamName(t)) + '</td><td class="b">팀 합계</td>' +
        '<td class="n bl prevcol">' + (hasPrev ? uf(pRev) : '–') + '</td>' +
        '<td class="n olcol">' + uf(oRev) + '</td>' +
        '<td class="n curcol"><b>' + uf(cRev) + '</b></td>' +
        '<td class="n bl delta ' + dcls(dP) + '">' + us(dP) + '</td>' +
        '<td class="n olcol delta ' + dcls(dO) + '">' + us(dO) + '</td></tr>';
      if (!rows.length) {
        h += '<tr><td colspan="6" class="zero">해당 영업그룹의 확정 매출이 없습니다.</td></tr>';
      }
      rows.forEach(function (r) {
        h += '<tr class="projrow' + (r.gone ? ' gone' : '') + '">' +
          '<td class="projname" title="' + esc(r.name) + '">' + esc(r.name) +
            (r.neu && hasPrev ? ' <span class="bdg new">신규</span>' : '') +
            (r.gone ? ' <span class="bdg gone">당월 없음</span>' : '') + '</td>' +
          '<td class="n bl prevcol">' + (hasPrev ? uf(r.p) : '–') + '</td>' +
          '<td class="n olcol zero">–</td>' +
          '<td class="n curcol">' + uf(r.c) + '</td>' +
          '<td class="n bl delta ' + (hasPrev ? dcls(r.d) : 'flat') + '">' + (hasPrev ? us(r.d) : '–') + '</td>' +
          '<td class="n olcol zero">–</td></tr>';
      });
    });

    var tdP = hasPrev ? (tot.c - tot.p) : null;
    var tdO = hasOl ? (tot.c - tot.o) : null;
    h += '<tr class="grand"><td class="stick s1">합 계</td><td class="b">전 영업그룹</td>' +
      '<td class="n bl">' + (hasPrev ? uf(tot.p) : '–') + '</td>' +
      '<td class="n">' + (hasOl ? uf(tot.o) : '–') + '</td>' +
      '<td class="n"><b>' + uf(tot.c) + '</b></td>' +
      '<td class="n bl delta ' + dcls(tdP) + '">' + us(tdP) + '</td>' +
      '<td class="n delta ' + dcls(tdO) + '">' + us(tdO) + '</td></tr>';
    $('#tblRevTeam').innerHTML = h + '</tbody>';

    $('#revNote').innerHTML = '팀 합계 행에서 전월 · 최종 OL 과 비교하고, 그 아래에서 프로젝트별 실제 변동을 봅니다. ' +
      '<b>프로젝트 단위에는 대응하는 OL 금액이 없어</b> 확정치만 표시합니다.' +
      (hasPrev ? '' : ' 전월(' + D.moOf(prevM) + '월) 확정본이 없어 전월 대비는 비어 있습니다.');
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
    var meta = D.S.erpMeta[m], fk = K.lastFilledK(m);
    box.className = 'note warn';
    box.innerHTML = '<b>' + D.moOf(m) + '월 ERP 확정본이 모두 등록되었습니다</b> — 매출 ' + meta.rev_cnt +
      '건 / 판관비 ' + meta.sga_cnt + '건. 최종 OL 은 ' + (fk >= 0 ? (fk + 1) + '주' : '미기입') + '입니다. ' +
      '이제 이 달을 마감 확정할 수 있습니다. ' +
      '<button class="btn red" id="btnErpClose" style="margin-left:6px">' + D.moOf(m) + '월 마감 확정</button>';
    $('#btnErpClose').onclick = function () { closeMonth(m); };
  }
  function closeMonth(m) {
    var k = K.lastFilledK(m);
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

    /* 먼저 지우고 넣으면, 중간에 끊겼을 때 그 달 원장이 반쯤 사라진 채 남는다.
       트랜잭션이 없으므로 순서를 뒤집는다 — 새 행을 다 넣은 뒤에 옛 행을 지운다.
       구분은 id 로 한다. 넣기 전 최대 id 이하가 옛 행이다. */
    var maxRev = 0, maxSga = 0;
    Promise.resolve()
      .then(function () { return rev ? lastId('mp_erp_rev', m) : 0; })
      .then(function (x) { maxRev = x; return sga ? lastId('mp_erp_sga', m) : 0; })
      .then(function (x) { maxSga = x; return rev ? post('mp_erp_rev', rev) : 0; })
      .then(function (n) {
        if (rev) upLog('매출현황 <b>' + n + '</b>건 등록', 'ok');
        return sga ? post('mp_erp_sga', sga) : 0;
      })
      .then(function (n) {
        if (sga) upLog('판관비 <b>' + n + '</b>건 등록', 'ok');
        /* 새 행이 다 들어갔다. 이제 옛 행을 지운다. */
        return rev ? del('mp_erp_rev?m=eq.' + m + '&id=lte.' + maxRev) : null;
      })
      .then(function () { return sga ? del('mp_erp_sga?m=eq.' + m + '&id=lte.' + maxSga) : null; })
      .then(function () {
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
        /* 실패했으면 방금 넣은 새 행을 걷어내고 옛 원장을 그대로 둔다.
           그리고 화면이 옛 숫자를 «성공한 것처럼» 계속 보여 주지 않게 다시 읽는다. */
        upLog('실패 — ' + esc(e.message), 'er');
        upLog('넣다 만 행을 걷어내는 중…', 'wn');
        var undo = Promise.resolve();
        if (rev) undo = undo.then(function () { return del('mp_erp_rev?m=eq.' + m + '&id=gt.' + maxRev); });
        if (sga) undo = undo.then(function () { return del('mp_erp_sga?m=eq.' + m + '&id=gt.' + maxSga); });
        undo.then(function () { upLog('원래 상태로 되돌렸습니다. 그 달 확정본은 그대로입니다.', 'ok'); })
          .catch(function (e2) {
            upLog('되돌리기도 실패했습니다 — ' + esc(e2.message) + '. 이 달을 다시 올려 주세요.', 'er');
          })
          .then(function () {
            delete D.S.erpRev[m]; delete D.S.erpSga[m];
            return D.load(2026).then(function () { return D.loadErp(m); });
          })
          .then(function () { K.bust(); render(); })
          .catch(function () {})
          .then(function () { b.disabled = false; b.textContent = '다시 시도'; });
      });
  }

  /** 그 달 그 표의 마지막 id. 넣기 전에 재 두면 «옛 행» 과 «새 행» 을 가를 수 있다. */
  function lastId(table, m) {
    return MpAuth.rest(table + '?select=id&m=eq.' + m + '&order=id.desc&limit=1')
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) { return (rows[0] && rows[0].id) || 0; });
  }

  /* ==========================================================================
   * 내려받기 — v20 의 세 가지
   *   판관비 가공본 : 상세(Sheet1) · 계정매핑(Sheet2) · 피벗(Sheet3) · 미분류
   *   매출현황 가공본 : 피벗(Sheet2) · 상세(Sheet1)
   *   비교표 : 팀별 대사 · 판관비 대사 · 프로젝트 집계
   *
   * 가공본은 상세 총합과 피벗 총합이 1원 단위로 맞을 때만 만든다.
   * 어긋난 파일을 내보내면 받는 쪽이 그걸 정답지로 쓴다.
   * ======================================================================== */
  var SGA_COLS = ['회계일자', '전표번호', '이동계획', '계정명', '적요', '차변금액',
                  '팀명', '관리항목명1', '작성부서', '작성사원', '작성일자'];
  var REV_COLS = ['매출번호', '전표번호', '매출일자', '품목', '원화금액', '부가세', '합계',
                  '표준원가- 금액', '영업그룹', '프로젝트코드', '프로젝트명'];

  /** 가공본에는 원장 전 열이 필요하다. 평소엔 안 읽으므로 누를 때 받아 온다. */
  function fullRows(table, m, cols) {
    return MpAuth.rest(table + '?select=' + cols + '&m=eq.' + m + '&order=id')
      .then(function (r) {
        if (!r.ok) return r.text().then(function (t) { throw new Error(t.slice(0, 140)); });
        return r.json();
      });
  }
  function ws(aoa, w) {
    var x = XLSX.utils.aoa_to_sheet(aoa);
    x['!cols'] = (w || []).map(function (n) { return { wch: n }; });
    return x;
  }
  function save(wb, name) { XLSX.writeFile(wb, name); }

  /** 미분류가 남아 있으면 그 금액이 빠진 채로 만들어진다는 것을 먼저 알린다 */
  function guardProc(m, fn) {
    var un = {}, org = {};
    (D.S.erpSga[m] || []).forEach(function (r) {
      if (!r.cat) un[r.acct || '(계정없음)'] = 1;
      var o6 = D.S.orgMap[r.mg] || D.S.orgMap[r.team_raw];
      if (!o6 || !D.ORG2TEAM[o6]) org[r.mg || r.team_raw || '(빈칸)'] = 1;
    });
    var nn = Object.keys(un).length + Object.keys(org).length;
    if (nn && !window.confirm('미분류 항목이 ' + nn + '건 있습니다.\n' +
        '해당 금액은 집계에서 제외된 채 가공본이 만들어집니다.\n\n그래도 내려받겠습니까?')) return;
    fn();
  }

  function procSga() {
    var m = S.m, b = $('#btnSgaProc');
    b.disabled = true;
    MpXlsx.loadXlsx()
      .then(function () { return fullRows('mp_erp_sga', m, 'adate,vno,cat,acct,descr,amt,team_raw,mg,dept,emp,wdate'); })
      .then(function (rows) {
        if (!rows.length) throw new Error(D.moOf(m) + '월 ERP 판관비 데이터가 없습니다.');
        var det = rows.filter(function (r) { return r.cat; });
        var un = rows.filter(function (r) { return !r.cat; });
        var piv = {}, tot = 0, pivSum = 0;
        det.forEach(function (r) {
          var t = teamOf(r);
          piv[t] = piv[t] || {};
          piv[t][r.cat] = (piv[t][r.cat] || 0) + Number(r.amt || 0);
          tot += Number(r.amt || 0);
        });
        var p = [[], [], ['합계 : 차변금액'], ['팀명', '이동계획', '요약']];
        var order = D.TEAMS.map(function (t) { return t; })
          .concat(Object.keys(piv).filter(function (t) { return D.TEAMS.indexOf(t) < 0; }).sort());
        order.forEach(function (t) {
          if (!piv[t]) return;
          var sub = 0, first = true;
          Object.keys(piv[t]).sort().forEach(function (c) {
            sub += piv[t][c]; pivSum += piv[t][c];
            p.push([first ? D.teamName(t) : null, c, piv[t][c]]); first = false;
          });
          p.push([D.teamName(t) + ' 요약', null, sub]);
        });
        p.push(['총합계', null, tot]);
        if (Math.abs(pivSum - tot) > 0.5) {
          throw new Error('검산 불일치 — 상세 ' + fmt0(tot) + ' vs 피벗 ' + fmt0(pivSum) + '. 가공본을 만들지 않습니다.');
        }
        var d = [SGA_COLS];
        det.forEach(function (r) {
          d.push([r.adate, r.vno, r.cat, r.acct, r.descr, Number(r.amt || 0), r.team_raw, r.mg, r.dept, r.emp, r.wdate]);
        });
        var mp = [['계정명', '이동계획']];
        Object.keys(D.S.acctMap || {}).sort().forEach(function (k) { mp.push([k, D.S.acctMap[k]]); });
        var wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws(p, [20, 14, 18]), 'Sheet3');
        XLSX.utils.book_append_sheet(wb, ws(d, [12, 18, 11, 22, 46, 14, 16, 14, 16, 10, 12]), 'Sheet1');
        XLSX.utils.book_append_sheet(wb, ws(mp, [24, 14]), 'Sheet2');
        if (un.length) {
          var a4 = [['⚠ 미분류 계정 — 비목이 지정되지 않아 집계에서 제외된 행'], [], SGA_COLS];
          un.forEach(function (r) {
            a4.push([r.adate, r.vno, '', r.acct, r.descr, Number(r.amt || 0), r.team_raw, r.mg, r.dept, r.emp, r.wdate]);
          });
          XLSX.utils.book_append_sheet(wb, ws(a4, [12, 18, 11, 22, 46, 14, 16, 14, 16, 10, 12]), '미분류');
        }
        save(wb, D.yOf(m) + '-' + p2(D.moOf(m)) + '_판관비.xlsx');
        flash('판관비 가공본을 내려받았습니다');
      })
      .catch(function (e) { flash(e.message, true); })
      .then(function () { b.disabled = false; });
  }

  function procRev() {
    var m = S.m, b = $('#btnRevProc');
    b.disabled = true;
    MpXlsx.loadXlsx()
      .then(function () { return fullRows('mp_erp_rev', m, 'no,vno,sdate,item,amt,vat,sum,cost,team,pcode,pname'); })
      .then(function (rows) {
        if (!rows.length) throw new Error(D.moOf(m) + '월 ERP 매출 데이터가 없습니다.');
        var piv = {}, tr = 0, tc = 0, pr = 0, pc = 0;
        rows.forEach(function (r) {
          var t = r.team || '미상';
          piv[t] = piv[t] || {};
          var o = piv[t][r.pname || '미상'] = piv[t][r.pname || '미상'] || { r: 0, c: 0 };
          o.r += Number(r.amt || 0); o.c += Number(r.cost || 0);
          tr += Number(r.amt || 0); tc += Number(r.cost || 0);
        });
        var p = [[], [], [null, null, '데이터'], ['영업그룹', '프로젝트명', '합계 : 원화금액', '합계 : 표준원가- 금액']];
        Object.keys(piv).sort().forEach(function (t) {
          var sr = 0, sc = 0, first = true;
          Object.keys(piv[t]).sort().forEach(function (nm) {
            var o = piv[t][nm]; sr += o.r; sc += o.c; pr += o.r; pc += o.c;
            p.push([first ? t : null, nm, o.r, o.c]); first = false;
          });
          p.push([t + ' 요약', null, sr, sc]);
        });
        p.push(['총합계', null, tr, tc]);
        if (Math.abs(pr - tr) > 0.5 || Math.abs(pc - tc) > 0.5) {
          throw new Error('검산 불일치 — 상세와 피벗 합계가 다릅니다. 가공본을 만들지 않습니다.');
        }
        var d = [REV_COLS];
        rows.forEach(function (r) {
          d.push([r.no, r.vno || '', r.sdate, r.item, Number(r.amt || 0), Number(r.vat || 0),
                  Number(r.sum || 0), Number(r.cost || 0), r.team, r.pcode || '', r.pname]);
        });
        var wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws(p, [20, 44, 18, 22]), 'Sheet2');
        XLSX.utils.book_append_sheet(wb, ws(d, [18, 18, 12, 12, 14, 12, 14, 14, 16, 14, 44]), 'Sheet1');
        save(wb, D.yOf(m) + '-' + p2(D.moOf(m)) + '_매출현황.xlsx');
        flash('매출현황 가공본을 내려받았습니다');
      })
      .catch(function (e) { flash(e.message, true); })
      .then(function () { b.disabled = false; });
  }

  function teamOf(r) {
    var o6 = D.S.orgMap[r.mg] || D.S.orgMap[r.team_raw] || null;
    return (o6 && D.ORG2TEAM[o6]) || '미배분';
  }
  function p2(x) { return (x < 10 ? '0' : '') + x; }

  /** 비교표 — 팀별 대사 · 판관비 대사 · 프로젝트 집계 */
  function xlsxErp() {
    var m = S.m, b = $('#btnErpXlsx'), ag = D.erpAgg(m);
    if (!ag) { flash('해당 월 ERP 데이터가 없습니다', true); return; }
    b.disabled = true;
    MpXlsx.loadXlsx().then(function () {
      var lb = D.yOf(m) + '년 ' + D.moOf(m) + '월';
      var n1 = function (v) { return v == null ? null : Math.round(v * 10) / 10; };
      var a1 = [[lb + ' 이동계획(OL) vs ERP 확정 대사'], ['단위 : 백만원'], [],
        ['팀', '매출_계획', '매출_OL', '매출_ERP', '매출_Δ', '원가_OL', '원가_ERP', '원가_Δ',
         '판관비_OL', '판관비_ERP', '판관비_Δ', '차이 사유']];
      D.TEAMS.forEach(function (t) {
        var pl = K.metrics(m, t, 'plan'), o = K.metrics(m, t, 'ol'), e = ag.byTeam[t] || { rev: 0, cost: 0, sga: 0 };
        var nt = D.findNote('erpdiff', m, t, null, null, null);
        a1.push([D.teamName(t), n1(pl.rev), n1(o.rev), n1(e.rev), n1(e.rev - (o.rev || 0)),
                 n1(o.cost), n1(e.cost), n1(e.cost - (o.cost || 0)),
                 n1(o.sga), n1(e.sga), n1(e.sga - (o.sga || 0)), nt ? nt.body : '']);
      });
      if (ag.unassigned && (Math.abs(ag.unassigned.rev) >= 0.05 || Math.abs(ag.unassigned.sga) >= 0.05)) {
        a1.push(['미배분(조직 매핑 없음)', null, null, n1(ag.unassigned.rev), null,
                 null, n1(ag.unassigned.cost), null, null, n1(ag.unassigned.sga), null, '']);
      }
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws(a1, [16, 11, 11, 11, 10, 11, 11, 10, 11, 11, 10, 50]), '팀별 대사');
      var a2 = [['판관비 계정별 대사'], [], ['계정', '최종 OL', 'ERP 확정', 'Δ']];
      D.ITEMS['판관비'].forEach(function (c) {
        var pl = K.OL(m, D.TOTAL, '판관비', c) || 0, er = ag.sgaCat[c] || 0;
        a2.push([c, n1(pl), n1(er), n1(er - pl)]);
      });
      XLSX.utils.book_append_sheet(wb, ws(a2, [14, 12, 12, 10]), '판관비 대사');
      var byT = {};
      (D.S.erpRev[m] || []).forEach(function (r) {
        var t = D.ORG2TEAM[r.team] || r.team, nm = r.pname || '(이름 없음)';
        var o = (byT[t] = byT[t] || {})[nm] = byT[t][nm] || { cnt: 0, rev: 0, cost: 0 };
        o.cnt++; o.rev += Number(r.amt) / 1e6; o.cost += Number(r.cost || 0) / 1e6;
      });
      var a3 = [['프로젝트별 ERP 집계 (백만원)'], [], ['팀', '프로젝트', '건수', '매출', '원가', '이익']];
      Object.keys(byT).forEach(function (t) {
        Object.keys(byT[t]).forEach(function (nm) {
          var o = byT[t][nm];
          a3.push([D.teamName(t), nm, o.cnt, n1(o.rev), n1(o.cost), n1(o.rev - o.cost)]);
        });
      });
      XLSX.utils.book_append_sheet(wb, ws(a3, [16, 46, 7, 11, 11, 11]), '프로젝트 집계');
      save(wb, 'ATEC_ERP_Recon_' + D.yOf(m) + p2(D.moOf(m)) + '_' + U.ymd(null, '') + '.xlsx');
      flash('비교표를 내려받았습니다');
    }).catch(function (e) { flash(e.message, true); })
      .then(function () { b.disabled = false; });
  }

  function bindUpload() {
    if (bindUpload.done) return;
    bindUpload.done = true;
    $('#btnErpUp').onclick = function () { S.upload = !S.upload; render(); };
    $('#btnSgaTh').onclick = function () {
      var v = parseFloat($('#sgaThIn').value);
      if (!(v >= 0)) { flash('0 이상 숫자를 넣어 주세요', true); return; }
      S.th = v; render();
    };
    $('#sgaThIn').onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); $('#btnSgaTh').click(); } };
    $('#btnSgaThAll').onclick = function () { S.th = 0; render(); flash('증감이 있는 상세를 전부 표시합니다'); };
    $('#btnSgaMatch').onclick = function () { S.matchOpen = !S.matchOpen; render(); };
    $('#btnSgaMatchClose').onclick = function () { S.matchOpen = false; render(); };
    $('#btnSgaMatchReset').onclick = function () {
      if (!MpAuth.isAdmin()) { flash('경영지원팀만 초기화할 수 있습니다', true); return; }
      var n = Object.keys(MATCH).filter(function (k) { return k.indexOf(S.m + '|') === 0; }).length;
      if (!window.confirm(D.moOf(S.m) + '월의 적요 매칭 확정 이력 ' + n + '건을 모두 지웁니다.\n' +
        '사람이 판단한 결과가 사라지고 다시 «확인 필요» 상태로 돌아갑니다.')) return;
      clearMatch(S.m)
        .then(function () { return D.audit('적요 매칭 초기화', { m: S.m, ref: '확정 이력', before: n + '건', after: '전부 삭제' }); })
        .then(function () { flash('확정 이력을 지웠습니다'); render(); })
        .catch(function (e) { flash(e.message, true); });
    };
    $('#btnSgaFold').onclick = function () { S.fold = !S.fold; render(); };
    $('#btnSgaProc').onclick = function () { guardProc(S.m, procSga); };
    $('#btnRevProc').onclick = function () { guardProc(S.m, procRev); };
    $('#btnErpXlsx').onclick = xlsxErp;
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
      /* 전월도 같이 읽어야 비교가 된다 */
      Promise.all([D.loadErp(S.m), D.loadErp(S.m - 1), loadMatch(S.m)]).then(render).catch(render);
    },
    render: render
  };
})(window);
