/* ============================================================================
 * mp-plan.js — 월별 이동계획 (팀장이 숫자를 넣는 화면)
 *
 * 승인받은 개편 세 가지가 여기 들어간다.
 *   F1  매출 상세를 손익표 안에 펼치고 [+]/[−] 로 항목을 늘리고 줄인다. 소계 자동.
 *   F2  '계획(최종)' 열을 '전주 대비 [증감 · 변동 내용]' 으로 바꾼다.
 *   F3  당월달성율 · 누적 3열은 ⊕ 로 접는다.
 *
 * 상세가 있는 항목은 소계가 그 항목의 기준 주차 값을 결정한다.
 * 다만 잠긴 달에는 적용하지 않는다 — 확정된 과거 숫자를 화면이 바꿔선 안 된다.
 * ========================================================================== */
(function (global) {
  'use strict';

  var D = global.MpData, K = global.MpCalc, U = global.MpUI;
  var $ = U.$, $$ = U.$$, esc = U.esc, fmt = U.fmt, sgn = U.sgn, dcls = U.dcls, pct = U.pct;

  /* 손익 항목 → 매출현황 상세의 구분 */
  var ITEM2GRP = {
    '제품': '제품', '상품': '상품', '유지보수': '유지보수',
    '유상서비스': '유상', '공사': '공사', '영업수수료': '영업수수료'
  };
  var TAIL = [['영업이익', '영 업 이 익'], ['공판', '공 판'], ['공판후영업이익', '공판후 영업이익']];

  var S = { m: null, team: null, week: 0, cum: false, open: {}, busy: false };
  var OPEN = {};          /* 펼친 '섹션|항목' — 화면 상태라 저장하지 않는다 */

  function canEdit() {
    return D.isOpen(S.m) && MpAuth.canWriteTeam(S.team) && S.team !== D.TOTAL;
  }
  /* 월간계획 열은 관리자만 고친다. 팀 소속과 무관하므로 canWriteTeam 을 타지 않는데,
     그래서 폰에서 보기 전용으로 막는 것도 여기서 따로 해 줘야 한다. */
  function canEditPlan() {
    return MpAuth.isAdmin() && !MpAuth.viewOnly() && !D.isFinal(S.m) && S.team !== D.TOTAL;
  }
  function expandable(sec, item) {
    if (S.team === D.TOTAL) return false;
    if (sec !== '매출' && sec !== '매출원가') return false;
    return !!ITEM2GRP[item];
  }
  function kidsOf(sec, item) {
    var g = ITEM2GRP[item];
    if (!g) return [];
    return D.detailOf(S.m, S.team, S.week).filter(function (d) { return (d.grp || '').trim() === g; })
      .sort(function (a, b) { return (a.sort || 0) - (b.sort || 0); });
  }
  function fieldOf(sec) { return sec === '매출' ? 'rev' : 'cost'; }
  function subtotal(sec, item) {
    var f = fieldOf(sec), kids = kidsOf(sec, item), s = 0, any = false;
    kids.forEach(function (d) { if (d[f] != null) { s += Number(d[f]); any = true; } });
    return any ? Math.round(s * 10000) / 10000 : null;
  }

  /* ---------- 그리기 ---------- */
  function render() {
    var m = S.m, team = S.team;
    var nW = D.weeksOf(m);
    if (S.week >= nW) S.week = nW - 1;
    if (S.week < 0) S.week = 0;

    /* 필터 */
    U.tabs($('#plMonth'), monthTabs(), m, function (v) {
      S.m = v; S.week = Math.max(0, K.finalK(v, S.team)); render();
      D.loadErp(v).then(function (got) { if (got) { K.bust(); render(); } }).catch(function () {});
    });
    U.tabs($('#plTeam'), [{ id: D.TOTAL, label: '사업부 합계' }].concat(
      D.TEAMS.map(function (t) {
        /* 이 주차를 낸 팀은 표시해 둔다 — 취합하는 쪽이 한눈에 본다 */
        var sb = D.submitOf(m, t, S.week);
        return { id: t, label: D.teamName(t), mark: sb ? '✓' : '',
                 title: sb ? U.ymdhm(sb.submitted_at) + ' 제출' : '미제출' };
      })
    ), team, function (v) { S.team = v; render(); });

    var wl = [];
    for (var i = 0; i < nW; i++) {
      var sb = (team === D.TOTAL) ? null : D.submitOf(m, team, i);
      wl.push({ id: i, label: (i + 1) + '주',
                mark: sb ? '✓' : (i === K.finalK(m, team) ? '●' : ''),
                title: sb ? U.ymdhm(sb.submitted_at) + ' 제출' : '' });
    }
    U.tabs($('#plWeek'), wl, S.week, function (v) { S.week = v; render(); });

    /* 상태 */
    var st = D.stateOf(m);
    var chip = $('#plState');
    chip.className = 'chip ' + (st === 'final' ? 'lock' : st === 'open' ? 'ok' : '');
    chip.innerHTML = st === 'final' ? '🔒 최종확정 · 수정 잠금'
      : st === 'open' ? ('작성 가능 · 기준 <b>' + (S.week + 1) + '주</b>')
      : '마감 · 수정하려면 관리자가 이 달을 다시 열어야 합니다';

    var note = $('#plNote');
    if (team === D.TOTAL) {
      note.className = 'note info';
      note.innerHTML = '<b>사업부 합계</b>는 6개 팀을 더한 값입니다. 여기서는 수정할 수 없습니다 — 팀을 골라 주세요.';
    } else if (MpAuth.viewOnly()) {
      /* 권한이 없어서가 아니라 화면이 좁아서 막힌 것이다. 이유를 바로 말해 준다. */
      note.className = 'note info';
      note.innerHTML = '폰에서는 <b>보기 전용</b>입니다. 손익표는 열이 20개가 넘어 폰으로는 제대로 채울 수 없습니다. 입력은 PC 에서 해 주세요.';
    } else if (!canEdit() && st === 'open') {
      note.className = 'note warn';
      note.innerHTML = '읽기 전용입니다. <b>' + esc(D.teamName(team)) + '</b> 값은 그 팀 담당자와 경영지원팀만 수정할 수 있습니다.';
    } else if (st !== 'open') {
      note.className = 'note info';
      note.innerHTML = st === 'final'
        ? '<b>최종확정</b>된 달입니다. ERP 확정본과 대사가 끝나 잠겼습니다.'
        : '<b>마감</b>된 달입니다. 고치려면 경영지원팀이 이 달을 다시 열어야 하고, 그 사실이 기록됩니다.';
      note.className += '';
    } else {
      note.className = 'hide';
    }

    $('#plTitle').textContent = D.teamName(team) + ' · ' + D.yOf(m) + '년 ' + D.moOf(m) + '월 이동계획';
    renderSubmit();
    buildTable(m, team, nW);
    bind();
    bindRevMap();
    renderRevMap();
    watchFocus();
  }


  /* ==========================================================================
   * ERP 매출 프로젝트 매칭 (관리자 전용)
   *
   * 판관비는 ERP 엑셀의 «이동계획» 열이 비목을 알려 준다. 매출에는 그 열이 없다.
   * 프로젝트명이 제품인지 유지보수인지는 사람만 알기에, 여기서 사람이 정한다.
   *
   * 지난 달 매칭은 «첫 값» 으로만 쓴다 — 추천이지 규칙이 아니다.
   * 그 달에서 고친 값은 그 달에만 남는다. 다른 달은 애초에 다른 행이다.
   * ======================================================================== */
  var REV_ITEMS = ['제품', '상품', '유지보수', '유상서비스', '공사', '영업수수료'];

  function rmCanEdit() { return MpAuth.isAdmin() && !MpAuth.viewOnly(); }

  function renderRevMap() {
    var card = $('#rmCard');
    var m = S.m, team = S.team;
    /* 그 달 ERP 매출이 없으면 매칭할 것도 없다 */
    var has = !!(D.S.erpMeta[m] && D.S.erpRev[m]);
    card.classList.toggle('hide', !(has && rmCanEdit()));
    if (!has || !rmCanEdit()) return;

    if (D.S.revMapReady === false) {
      $('#tblRevMap').innerHTML = '<tbody><tr><td class="txt">매칭을 저장할 표(mp_rev_map)가 아직 없습니다. ' +
        'db/007_rev_map.sql 을 실행하면 정한 결과가 모두에게 남습니다.</td></tr></tbody>';
      $('#rmDesc').textContent = '';
      $('#rmState').className = 'chip warn'; $('#rmState').textContent = '표 없음';
      $('#btnRmSeed').disabled = true; $('#btnRmDone').disabled = true;
      return;
    }
    $('#btnRmSeed').disabled = false; $('#btnRmDone').disabled = false;

    var list = D.revProjects(m, team === D.TOTAL ? null : team);
    var done = D.revDoneOf(m);
    var all = D.revProjects(m, null);
    var left = all.filter(function (p) { return !p.item; }).length;

    $('#rmDesc').innerHTML = 'ERP 매출은 프로젝트명만 있고 이동계획 항목이 없습니다 — ' +
      '여기서 정한 것이 위 표의 <b>확정실적</b> 을 항목별로 가릅니다. ' +
      '지난 달에 정한 것이 있으면 <b>추천</b> 으로 먼저 보여 주지만, ' +
      '<b>이 달에서 고친 값은 이 달에만</b> 남습니다.';
    $('#rmState').className = 'chip ' + (left ? 'warn' : 'ok');
    $('#rmState').innerHTML = done
      ? ('매칭 완료 · ' + esc(U.ymdhm(done.done_at)) + (done.email ? ' · ' + esc(done.email) : ''))
      : (left ? ('남은 프로젝트 <b>' + left + '</b>건') : '전부 매칭됨 — 완료를 눌러 주세요');
    $('#btnRmDone').textContent = done ? '매칭 완료 취소' : '매칭 작성 완료';
    $('#btnRmDone').className = 'btn sm' + (done ? ' ghost' : '');

    var h = '<colgroup><col style="width:132px"><col><col style="width:104px">' +
      '<col style="width:104px"><col style="width:150px"><col style="width:190px"></colgroup>' +
      '<thead><tr><th>팀</th><th>프로젝트</th><th class="n">확정 매출</th><th class="n">확정 원가</th>' +
      '<th>이동계획 항목</th><th>근거</th></tr></thead><tbody>';
    if (!list.length) {
      h += '<tr><td colspan="6" class="txt q">이 달 이 팀의 ERP 매출이 없습니다.</td></tr>';
    }
    list.forEach(function (p, i) {
      var val = p.item || '';
      var opts = '<option value="">— 아직 안 정함 —</option>' + REV_ITEMS.map(function (it) {
        return '<option value="' + esc(it) + '"' + (it === val ? ' selected' : '') + '>' + esc(it) + '</option>';
      }).join('');
      var why;
      if (p.item && p.src === 'auto') why = '<span class="bdg">지난 달에서 자동</span>';
      else if (p.item) why = '<span class="bdg new">사람이 정함</span>';
      else if (p.suggest) why = '<span class="bdg pend">추천 : ' + esc(p.suggest) + '</span> ' +
        '<span class="q">(' + D.moOf(p.suggestM) + '월)</span>';
      else why = '<span class="q">참고할 이력 없음</span>';
      h += '<tr class="' + (p.item ? '' : 'pend') + '"><td class="sec">' + esc(D.teamName(p.team)) + '</td>' +
        '<td class="txt" title="' + esc(p.pname) + '">' + esc(p.pname) +
          ' <span class="q">' + p.n + '건</span></td>' +
        '<td class="n">' + fmt(p.rev) + '</td><td class="n">' + fmt(p.cost) + '</td>' +
        '<td><select class="sel rmsel" data-i="' + i + '">' + opts + '</select></td>' +
        '<td class="txt">' + why + '</td></tr>';
    });
    var sr = 0, sc = 0; list.forEach(function (p) { sr += p.rev; sc += p.cost; });
    h += '<tr class="grand"><td>합 계</td><td class="q">' + list.length + '개 프로젝트</td>' +
      '<td class="n">' + fmt(sr) + '</td><td class="n">' + fmt(sc) + '</td><td></td><td></td></tr>';
    $('#tblRevMap').innerHTML = h + '</tbody>';

    $$('#tblRevMap select.rmsel').forEach(function (sel) {
      sel.onchange = function () {
        var p = list[+this.dataset.i], v = this.value;
        this.disabled = true;
        D.setRevItem(m, p.team, p.pname, v || null)
          .then(function () { K.bust(); flash('저장됨'); render(); })
          .catch(fail);
      };
    });
  }

  function bindRevMap() {
    if (bindRevMap.done) return;
    bindRevMap.done = true;
    $('#btnRmSeed').onclick = function () {
      var m = S.m;
      U.ask(D.moOf(m) + '월 · 지난 달 매칭 불러오기',
        '아직 정하지 않은 프로젝트만 채웁니다.\n' +
        '이미 정해 둔 값은 그대로 둡니다 — 사람이 정한 것을 덮지 않습니다.', '불러오기')
        .then(function (ok) {
          if (!ok) return;
          return D.seedRevMap(m).then(function (nn) {
            K.bust(); flash(nn ? (nn + '건을 불러왔습니다') : '불러올 이력이 없습니다'); render();
          }).catch(fail);
        });
    };
    $('#btnRmDone').onclick = function () {
      var m = S.m, done = D.revDoneOf(m);
      var left = D.revProjects(m, null).filter(function (p) { return !p.item; }).length;
      if (done) {
        U.ask(D.moOf(m) + '월 매칭 완료 취소', '완료 표시만 지웁니다. 매칭 값은 그대로 남습니다.', '취소하기', true)
          .then(function (ok) { if (ok) D.setRevDone(m, false).then(function () { flash('완료를 취소했습니다'); render(); }).catch(fail); });
        return;
      }
      U.ask(D.moOf(m) + '월 매칭 작성 완료',
        (left ? ('아직 정하지 않은 프로젝트가 ' + left + '건 있습니다.\n그 금액은 항목별 확정실적에 들어가지 않습니다.\n\n') : '') +
        '완료로 표시하면 다음 달 업로드 때 이 달 매칭을 물려받습니다.', '작성 완료')
        .then(function (ok) {
          if (ok) D.setRevDone(m, true).then(function () { flash('매칭을 완료했습니다'); render(); }).catch(fail);
        });
    };
  }

  function monthTabs() {
    var out = [];
    for (var mo = 1; mo <= 12; mo++) {
      var m = D.mOf(2026, mo), st = D.stateOf(m);
      out.push({ id: m, label: mo + '월', dim: st === 'closed',
                 mark: st === 'final' ? '🔒' : (st === 'open' ? '●' : ''),
                 title: st === 'final' ? '최종확정 · 잠금' : (st === 'open' ? '작성 가능' : '마감') });
    }
    return out;
  }

  /* ---------- 표 ---------- */
  function buildTable(m, team, nW) {
    var hasErp = !!D.erpAgg(m);
    var ed = canEdit(), edP = canEditPlan();
    var pk = K.prevWeek(m, team, S.week);

    /* 열 구성 */
    var cg = '<colgroup><col style="width:74px"><col style="width:150px"><col style="width:82px">';
    for (var i = 0; i < nW; i++) cg += '<col style="width:74px">';
    cg += '<col style="width:78px"><col style="width:190px">' +          /* 전주 대비 */
          '<col style="width:82px"><col style="width:78px"><col style="width:170px">';  /* ERP */
    if (S.cum) cg += '<col style="width:70px"><col style="width:84px"><col style="width:84px"><col style="width:70px">';
    cg += '<col style="width:36px"></colgroup>';

    var h = cg + '<thead><tr>' +
      '<th rowspan="2">구 분</th><th rowspan="2">항목</th>' +
      '<th rowspan="2" class="n">월간<br>계획</th>' +
      '<th colspan="' + nW + '" class="c gh">주차별 OL</th>' +
      '<th colspan="2" class="c gh prvh">전주 대비</th>' +
      '<th colspan="3" class="c gh acth">ERP 확정실적 비교</th>';
    if (S.cum) h += '<th rowspan="2" class="n">당월<br>달성율</th><th rowspan="2" class="n">누적계획</th>' +
      '<th rowspan="2" class="n">누적실적</th><th rowspan="2" class="n">누적<br>달성율</th>';
    h += '<th rowspan="2" class="c cumtg"><button type="button" class="cumbtn" id="btnCum" title="' +
      (S.cum ? '달성율 · 누적 접기' : '달성율 · 누적 펼치기') + '">' + (S.cum ? '⊖' : '⊕') + '</button></th>' +
      '</tr><tr>';
    for (var k = 0; k < nW; k++) {
      h += '<th class="n wkcol' + (k === S.week ? ' cur' : '') + '">' + (k + 1) + '주' +
           (k === K.finalK(m, team) ? '<span class="mini">최종</span>' : '') + '</th>';
    }
    h += '<th class="n prvc">증감</th><th class="prvc">변동 내용</th>' +
         '<th class="n actc">확정실적</th><th class="n actc">차이</th><th class="actc">차이 사유</th>';
    h += '</tr></thead><tbody>';

    D.SEC_ORDER.forEach(function (sec) {
      var items = D.ITEMS[sec].concat(['합계']);
      /* 구분 셀 rowspan — 펼친 항목의 상세 행과 소계 행까지 세어야 표가 어긋나지 않는다 */
      var span = items.length;
      items.forEach(function (it) {
        if (expandable(sec, it) && OPEN[sec + '|' + it]) span += kidsOf(sec, it).length + 1;
      });

      items.forEach(function (it, ii) {
        var isSum = it === '합계';
        var leaf = K.isLeaf(sec, it) && !isSum;
        var exp = expandable(sec, it) && !isSum;
        var isOpen = exp && !!OPEN[sec + '|' + it];
        var kids = exp ? kidsOf(sec, it) : [];

        h += '<tr' + (isSum ? ' class="sum"' : '') + '>';
        if (ii === 0) h += '<td class="sec" rowspan="' + span + '">' + sec + '</td>';
        h += '<td class="itc' + (isSum ? ' b' : '') + '">' +
          (exp ? '<button type="button" class="cv" data-exp="' + esc(sec + '|' + it) + '">' + (isOpen ? '▾' : '▸') + '</button>' : '') +
          esc(it) +
          (isOpen && ed ? '<button type="button" class="rowbtn add" data-add="' + esc(sec + '|' + it) + '" title="상세 항목 추가">+</button>' : '') +
          (exp && kids.length ? '<span class="kidn">' + kids.length + '</span>' : '') +
          '</td>';

        /* 월간계획 */
        var pv = K.PL(m, team, sec, it);
        h += '<td class="n gs">' + (leaf && edP ? inp('p', [sec, it].join('~'), pv) : cell(pv)) + '</td>';

        /* 주차 */
        for (var kk = 0; kk < nW; kk++) {
          var v = K.V(m, team, sec, it, kk);
          var lockedBySub = isOpen && kids.length && kk === S.week && D.isOpen(m);
          var editable = leaf && ed && !lockedBySub;
          h += '<td class="n wkcol' + (kk === S.week ? ' cur' : '') + '">' +
            (editable ? inp('w', [sec, it, kk].join('~'), v) : cell(v)) + '</td>';
        }

        /* 전주 대비 */
        h += prvCells(m, team, sec, it, pk, leaf && ed);

        /* ERP */
        h += actCells(m, team, sec, it, hasErp);

        if (S.cum) {
          var ov = K.OL(m, team, sec, it);
          var cp = K.cum(m, team, sec, it, false), ca = K.cum(m, team, sec, it, true);
          h += '<td class="n gs">' + ((pv && ov != null) ? pct(ov / pv) : '–') + '</td>' +
               '<td class="n">' + fmt(cp) + '</td><td class="n">' + fmt(ca) + '</td>' +
               '<td class="n">' + (cp ? pct(ca / cp) : '–') + '</td>';
        }
        h += '<td class="cumtg"></td></tr>';

        /* ----- 상세 행 + 소계 ----- */
        if (isOpen) {
          var f = fieldOf(sec);
          kids.forEach(function (d) {
            h += '<tr class="dtl"><td class="itc dtlname"><span class="tw">└</span>' +
              esc(d.item || '(이름 없음)') +
              (ed ? '<button type="button" class="rowbtn del" data-del="' + esc(d.id) + '" title="이 항목 삭제">−</button>' : '') +
              '</td>';
            h += '<td class="n gs"><span class="zero">–</span></td>';   /* 월간계획 상세는 원본에 없다 */
            for (var kx = 0; kx < nW; kx++) {
              var cur = kx === S.week;
              h += '<td class="n wkcol' + (cur ? ' cur' : '') + '">' +
                (cur ? (ed ? inp('d', [d.id, f].join('~'), d[f]) : cell(d[f])) : '<span class="zero">–</span>') + '</td>';
            }
            h += '<td class="n prvc"><span class="zero">–</span></td>' +
              '<td class="prvc txt">' + (ed
                ? '<textarea rows="1" class="na" data-dn="' + esc(d.id) + '" placeholder="변동 내용">' + esc(d.note || '') + '</textarea>'
                : (d.note ? esc(d.note) : '<span class="zero">–</span>')) + '</td>';
            h += '<td class="n actc"><span class="zero">–</span></td><td class="n actc"><span class="zero">–</span></td>' +
              '<td class="actc"><span class="zero">–</span></td>';
            if (S.cum) h += '<td class="n"></td><td class="n"></td><td class="n"></td><td class="n"></td>';
            h += '<td class="cumtg"></td></tr>';
          });

          var sub = subtotal(sec, it);
          h += '<tr class="dtl dsub"><td class="itc dtlname"><span class="tw">└</span><b>소계</b></td>' +
            '<td class="n gs"><span class="zero">–</span></td>';
          for (var ks = 0; ks < nW; ks++) {
            h += '<td class="n wkcol' + (ks === S.week ? ' cur' : '') + '">' +
              (ks === S.week ? '<b>' + fmt(sub) + '</b>' : '<span class="zero">–</span>') + '</td>';
          }
          h += '<td class="n prvc"><span class="zero">–</span></td><td class="prvc"></td>' +
            '<td class="n actc"><span class="zero">–</span></td><td class="n actc"><span class="zero">–</span></td>' +
            '<td class="actc"><span class="zero">–</span></td>';
          if (S.cum) h += '<td class="n"></td><td class="n"></td><td class="n"></td><td class="n"></td>';
          h += '<td class="cumtg"></td></tr>';
        }
      });
    });

    /* 영업이익 · 공판 · 공판후 */
    TAIL.forEach(function (p) {
      /* 공판은 매출 × 공판율로 계산한다. 입력칸을 열면 쳐 넣어도 무시되어
         «저장했는데 안 바뀐다» 가 된다. 공판율은 설정 화면에서 바꾼다. */
      var sec = p[0], leaf = false;
      var pv = K.PL(m, team, sec, '계');
      h += '<tr class="' + (sec === '공판' ? '' : 'op') + '"><td class="sec">' + p[1] + '</td>' +
        '<td class="itc">' + (sec === '공판' ? '소계' : '') + '</td>' +
        '<td class="n gs">' + (leaf && canEditPlan() ? inp('p', [sec, '계'].join('~'), pv) : cell(pv)) + '</td>';
      for (var kt = 0; kt < nW; kt++) {
        var v = K.V(m, team, sec, '계', kt);
        h += '<td class="n wkcol' + (kt === S.week ? ' cur' : '') + '">' +
          (leaf ? inp('w', [sec, '계', kt].join('~'), v) : cell(v)) + '</td>';
      }
      h += prvCells(m, team, sec, '계', pk, leaf);
      h += actCells(m, team, sec, '계', hasErp);
      if (S.cum) {
        var ov2 = K.OL(m, team, sec, '계');
        var cp2 = K.cum(m, team, sec, '계', false), ca2 = K.cum(m, team, sec, '계', true);
        h += '<td class="n gs">' + ((pv && ov2 != null) ? pct(ov2 / pv) : '–') + '</td>' +
          '<td class="n">' + fmt(cp2) + '</td><td class="n">' + fmt(ca2) + '</td>' +
          '<td class="n">' + (cp2 ? pct(ca2 / cp2) : '–') + '</td>';
      }
      h += '<td class="cumtg"></td></tr>';
    });

    $('#tblPlan').innerHTML = h + '</tbody>';
  }

  function cell(v) { return v === 0 ? '<span class="zero">0.0</span>' : fmt(v); }
  function inp(kind, key, v) {
    return '<input class="ce" data-' + kind + '="' + esc(key) + '" value="' +
      (v == null ? '' : fmt(v)) + '" inputmode="decimal">';
  }

  /* F2 — 전주 대비 [증감 · 변동 내용] */
  function prvCells(m, team, sec, item, pk, editable) {
    var cur = K.V(m, team, sec, item, S.week);
    var prv = pk < 0 ? null : K.V(m, team, sec, item, pk);
    var d = (cur == null || prv == null) ? null : Math.round((cur - prv) * 10000) / 10000;
    var n = D.findNote('item', m, team, sec, item, S.week);
    var body = n ? n.body : '';
    var hint = pk < 0 ? '비교할 이전 주차가 없습니다' : ((pk + 1) + '주 → ' + (S.week + 1) + '주');
    return '<td class="n prvc gs" title="' + esc(hint) + '"><b class="' + dcls(d) + '">' + sgn(d) + '</b></td>' +
      '<td class="prvc txt">' + (editable
        ? '<textarea rows="1" class="na" data-in="' + esc([sec, item].join('~')) + '" placeholder="변동 내용">' + esc(body) + '</textarea>'
        : (body ? esc(body) : '<span class="zero">–</span>')) + '</td>';
  }

  /* ERP 확정실적 3열 — 미마감 달에도 열은 남긴다 */
  function actCells(m, team, sec, item, hasErp) {
    if (!hasErp) {
      return '<td class="n actc"><span class="zero">–</span></td><td class="n actc"><span class="zero">–</span></td>' +
        '<td class="actc"><span class="zero">ERP 미마감</span></td>';
    }
    /* 판관비 비목은 ERP 엑셀의 «이동계획» 열이 알려 준다.
       매출·매출원가 항목은 근거가 없어, 관리자가 아래 카드에서 정해 준 매칭을 쓴다. */
    var a = K.act(m, team), av = null, mapped = false;
    if (a) {
      if (sec === '매출' && item === '합계') av = a.rev;
      else if (sec === '매출원가' && item === '합계') av = a.cost;
      else if (sec === '매출이익' && item === '합계') av = a.gp;
      else if (sec === '판관비' && item === '합계') av = a.sga;
      else if (sec === '영업이익') av = a.op;
      else if (sec === '공판') av = a.gongpan;
      else if (sec === '공판후영업이익') av = a.op2;
      else if (sec === '판관비' && item !== '합계') {
        /* 판관비 비목은 ERP 엑셀의 «이동계획» 열이 알려 준다 — 사람이 정할 것이 없다 */
        var ag = D.erpAgg(m);
        var pot = ag && (team === D.TOTAL ? ag.sgaCat : (ag.byTeam[team] || {}).cat);
        if (pot && pot[item] != null) av = Math.round(pot[item] * 10000) / 10000;
      }
      else if ((sec === '매출' || sec === '매출원가') && ITEM2GRP[item] && team !== D.TOTAL) {
        var bi = D.revByItem(m, team).item[item];
        if (bi) { av = Math.round((sec === '매출' ? bi.rev : bi.cost) * 10000) / 10000; mapped = true; }
      }
    }
    if (av == null) {
      var why = (sec === '매출' || sec === '매출원가') && ITEM2GRP[item] && team !== D.TOTAL
        ? '매칭된 프로젝트 없음'
        : (sec === '판관비' ? '이 달 이 비목의 지출 없음' : 'ERP에 항목 구분 근거 없음');
      return '<td class="n actc"><span class="zero">–</span></td><td class="n actc"><span class="zero">–</span></td>' +
        '<td class="actc"><span class="zero">' + why + '</span></td>';
    }
    var ov = K.OL(m, team, sec, item);
    var d = ov == null ? null : Math.round((av - ov) * 10000) / 10000;
    var n = D.findNote('erpdiff', m, team, sec, item, null);
    var body = n ? n.body : '';
    var canNote = MpAuth.canWriteTeam(team) && team !== D.TOTAL;
    return '<td class="n actc gs"><b>' + fmt(av) + '</b>' +
      (mapped ? ' <span class="bdg" title="관리자가 정한 프로젝트 매칭에서 나온 값">매칭</span>' : '') + '</td>' +
      '<td class="n actc ' + dcls(d) + '">' + sgn(d) + '</td>' +
      '<td class="actc txt">' + (canNote
        ? '<textarea rows="1" class="na" data-en="' + esc([sec, item].join('~')) + '" placeholder="차이 사유">' + esc(body) + '</textarea>'
        : (body ? esc(body) : '<span class="zero">–</span>')) + '</td>';
  }

  /* ---------- 입력 ---------- */
  function num(s) {
    var raw = String(s == null ? '' : s).replace(/[,\s]/g, '').replace(/−/g, '-');
    if (raw === '') return { ok: true, v: null };
    var v = parseFloat(raw);
    return isNaN(v) ? { ok: false } : { ok: true, v: v };
  }
  function flash(msg, err) {
    var el = $('#plSave');
    el.className = 'chip ' + (err ? 'warn' : 'ok');
    el.textContent = msg;
    clearTimeout(flash.t);
    flash.t = setTimeout(function () { el.className = 'chip'; el.textContent = '저장됨'; }, 2200);
  }
  function fail(e) { flash(e.message || '저장 실패', true); render(); }

  /**
   * 저장이 끝났을 때의 다시 그리기.
   *
   * 표를 innerHTML 로 통째로 갈아 끼우므로, 그 순간 다른 칸에 타이핑 중이면
   * 그 값이 저장도 화면 표시도 없이 사라진다. 빠르게 채우는 사람일수록 자주 겪는다.
   * 그래서 표 안에 포커스가 있으면 미뤘다가, 표를 벗어날 때 그린다.
   */
  var pending = false;
  function renderSoon() {
    var t = $('#tblPlan'), a = document.activeElement;
    if (t && a && a !== document.body && t.contains(a)) { pending = true; return; }
    pending = false;
    render();
  }
  /* 표 밖으로 포커스가 나가면 밀어 둔 그리기를 처리한다 */
  function watchFocus() {
    if (watchFocus.done) return;
    watchFocus.done = true;
    document.addEventListener('focusout', function () {
      setTimeout(function () {
        if (!pending) return;
        var t = $('#tblPlan'), a = document.activeElement;
        if (t && a && a !== document.body && t.contains(a)) return;   /* 아직 표 안이다 */
        pending = false;
        render();
      }, 0);
    });
  }

  /* ==========================================================================
   * 작성 완료 (제출)
   *
   * 값은 칸을 떠날 때마다 이미 저장된다. 이 버튼은 «다 썼다»는 선언이다.
   * 취합하는 쪽은 숫자가 들어왔는지가 아니라 팀장이 끝냈다고 했는지를 알아야 한다.
   * ======================================================================== */

  /** 제출 당시 값의 지문. 제출한 뒤 숫자가 바뀌면 달라진다. */
  function weekSig(m, team, k) {
    var parts = [];
    D.SEC_ORDER.concat(['공판']).forEach(function (sec) {
      (D.LEAF[sec] || []).forEach(function (it) {
        var v = D.weekVal(m, team, sec, it, k);
        if (v != null) parts.push(sec + '.' + it + '=' + v);
      });
    });
    var s = parts.join('|'), h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return parts.length + ':' + (h >>> 0).toString(36);
  }

  /** 제출할 수 있는 상태인가 — 최소한 매출과 판관비는 채워져 있어야 한다 */
  function ready(m, team, k) {
    return K.V(m, team, '매출', '합계', k) != null &&
           K.V(m, team, '판관비', '합계', k) != null;
  }

  function submitState() {
    var m = S.m, team = S.team, k = S.week;
    if (team === D.TOTAL || D.S.submitReady === false) return { hide: true };
    var sub = D.submitOf(m, team, k);
    var mine = MpAuth.canWriteTeam(team) && D.isOpen(m);
    if (!ready(m, team, k)) {
      return { label: '작성 완료', on: false, sub: sub,
               why: '매출과 판관비를 채우면 누를 수 있습니다' };
    }
    if (!sub) return { label: '작성 완료', on: mine, cls: 'red', sub: null };
    if (sub.sig && sub.sig !== weekSig(m, team, k)) {
      return { label: '다시 제출', on: mine, cls: 'red', changed: true, sub: sub };
    }
    return { label: '제출 취소', on: mine, cls: 'dark', done: true, sub: sub };
  }

  function renderSubmit() {
    var box = $('#plSubmit'), btn = $('#btnPlSubmit'), st = submitState();
    if (st.hide) { box.className = 'hide'; return; }
    box.className = 'subbar';
    btn.textContent = st.label;
    btn.className = 'btn ' + (st.cls || '');
    btn.disabled = !st.on;
    btn.title = st.why || '';

    var info = $('#plSubmitInfo');
    if (!st.sub) {
      info.className = 'sinfo';
      info.textContent = st.why || '아직 제출하지 않았습니다';
    } else if (st.changed) {
      info.className = 'sinfo chg';
      info.innerHTML = '<b>제출 후 값이 바뀌었습니다</b> · 마지막 제출 ' +
        U.ymdhm(st.sub.submitted_at) + ' (' + U.ago(st.sub.submitted_at) + ')' +
        (st.sub.email ? ' · ' + esc(st.sub.email) : '');
    } else {
      info.className = 'sinfo ok';
      info.innerHTML = '<b>작성 완료</b> · ' + U.ymdhm(st.sub.submitted_at) +
        ' (' + U.ago(st.sub.submitted_at) + ')' +
        (st.sub.email ? ' · ' + esc(st.sub.email) : '');
    }
    btn.onclick = function () { if (st.done) cancelSubmit(); else doSubmit(st.changed); };
  }

  function doSubmit(again) {
    var m = S.m, team = S.team, k = S.week;
    var f = function (x) { return x == null ? '–' : U.fmt(x); };
    U.ask(D.teamName(team) + ' · ' + D.moOf(m) + '월 ' + (k + 1) + '주',
      (again ? '수정한 내용으로 다시 제출합니다.\n' : '작성 완료로 제출합니다.\n') +
      '\n  매출            ' + f(K.V(m, team, '매출', '합계', k)) +
      '\n  매출이익        ' + f(K.V(m, team, '매출이익', '합계', k)) +
      '\n  판관비          ' + f(K.V(m, team, '판관비', '합계', k)) +
      '\n  공판후영업이익  ' + f(K.V(m, team, '공판후영업이익', '계', k)) +
      '\n\n제출 시각이 기록되고 경영지원팀이 확인합니다.\n' +
      '제출한 뒤에도 달이 열려 있는 동안은 고칠 수 있습니다.', again ? '다시 제출' : '작성 완료')
      .then(function (ok) { if (ok) sendSubmit(m, team, k, again); });
  }

  function sendSubmit(m, team, k, again) {
    D.setSubmit(m, team, k, weekSig(m, team, k))
      .then(function () {
        return D.audit('작성 완료', { m: m, team: team, ref: (k + 1) + '주', after: again ? '재제출' : '제출' });
      })
      .then(function () { flash('제출했습니다'); render(); })
      .catch(fail);
  }

  function cancelSubmit() {
    var m = S.m, team = S.team, k = S.week;
    U.ask(D.teamName(team) + ' · ' + D.moOf(m) + '월 ' + (k + 1) + '주',
      '작성 완료를 취소합니다. 기록된 제출 시각이 지워집니다.', '취소하기', true)
      .then(function (ok) {
        if (!ok) return;
        return D.unsubmit(m, team, k)
          .then(function () {
            return D.audit('작성 완료 취소', { m: m, team: team, ref: (k + 1) + '주', after: '취소' });
          })
          .then(function () { flash('제출을 취소했습니다'); render(); })
          .catch(fail);
      });
  }

  /* 상세를 고치면 그 항목의 기준 주차 값도 소계로 맞춘다 */
  function syncSub(sec, item) {
    return syncAt(S.m, S.team, S.week, sec, item);
  }
  /**
   * 어느 달·팀·주차에 쓸지를 «부를 때» 정한다.
   * 응답을 기다리는 동안 사용자가 탭을 바꿀 수 있는데, 그때 S.m/S.team/S.week 를
   * 다시 읽으면 방금 고친 곳이 아니라 지금 보고 있는 곳에 쓴다.
   */
  function syncAt(m, team, wk, sec, item) {
    var save = { m: S.m, t: S.team, w: S.week };
    S.m = m; S.team = team; S.week = wk;
    var sub = subtotal(sec, item);                 /* kidsOf 가 S 를 본다 */
    S.m = save.m; S.team = save.t; S.week = save.w;
    return D.setWeek(m, team, sec, item, wk, sub);
  }

  function bind() {
    $$('#tblPlan .ce').forEach(function (el, idx) {
      el.onfocus = function () { this.value = this.value.replace(/,/g, ''); this.select(); };
      el.onblur = function () {
        var r = num(this.value);
        if (!r.ok) { flash('숫자만 입력할 수 있습니다', true); render(); return; }
        var p;
        if (this.dataset.p != null) {
          var a = this.dataset.p.split('~');
          p = D.setPlan(S.m, S.team, a[0], a[1], r.v);
        } else if (this.dataset.w != null) {
          var b = this.dataset.w.split('~');
          p = D.setWeek(S.m, S.team, b[0], b[1], +b[2], r.v);
        } else if (this.dataset.d != null) {
          var c = this.dataset.d.split('~');
          var d = null; D.S.detail.forEach(function (x) { if (x.id === c[0]) d = x; });
          if (!d) return;
          var patch = {}; patch[c[1]] = r.v;
          var pm = S.m, pt = S.team, pw = S.week;
          p = D.patchDetail(c[0], patch).then(function () {
            return syncAt(pm, pt, pw, secOfGrp(d.grp, c[1]), itemOfGrp(d.grp));
          });
        }
        if (!p) return;
        p.then(function () { K.bust(); flash('저장됨'); renderSoon(); }).catch(fail);
      };
      el.onkeydown = function (e) {
        if (e.key === 'Escape') { render(); return; }
        var mv = e.key === 'Enter' ? (e.shiftKey ? -1 : 1) : (e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0);
        if (!mv) return;
        e.preventDefault(); this.blur();
        setTimeout(function () { var l = $$('#tblPlan .ce'); if (l[idx + mv]) l[idx + mv].focus(); }, 30);
      };
    });

    $$('#tblPlan textarea.na').forEach(function (ta) {
      grow(ta);
      ta.oninput = function () { grow(this); };
      ta.onblur = function () {
        var v = this.value.trim(), p;
        if (this.dataset.in != null) {
          var a = this.dataset.in.split('~');
          p = D.setNote('item', S.m, S.team, a[0], a[1], S.week, v);
        } else if (this.dataset.en != null) {
          var b = this.dataset.en.split('~');
          p = D.setNote('erpdiff', S.m, S.team, b[0], b[1], null, v);
        } else if (this.dataset.dn != null) {
          p = D.patchDetail(this.dataset.dn, { note: v });
        }
        if (p) p.then(function () { flash('저장됨'); }).catch(fail);
      };
    });

    $$('#tblPlan button[data-exp]').forEach(function (b) {
      b.onclick = function () { var k = this.dataset.exp; OPEN[k] = !OPEN[k]; render(); };
    });
    $$('#tblPlan button[data-add]').forEach(function (b) {
      b.onclick = function () {
        var a = this.dataset.add.split('|'), sec = a[0], item = a[1];
        var nm = (window.prompt(item + ' 에 추가할 항목 이름', '') || '').trim();
        if (!nm) return;
        var kids = kidsOf(sec, item);
        D.addDetail({ m: S.m, team: S.team, k: S.week, grp: ITEM2GRP[item], item: nm,
                      rev: null, cost: null, note: null, sort: kids.length })
          .then(function () { K.bust(); flash('항목을 추가했습니다'); render(); })
          .catch(fail);
      };
    });
    $$('#tblPlan button[data-del]').forEach(function (b) {
      b.onclick = function () {
        var id = this.dataset.del, d = null;
        D.S.detail.forEach(function (x) { if (x.id === id) d = x; });
        if (!d) return;
        var sec = secOfGrp(d.grp, 'rev'), item = itemOfGrp(d.grp);
        /* 지우는 행이 원가를 갖고 있었거나, 남은 상세 중 원가를 가진 것이 있을 때만
           매출원가 소계를 다시 쓴다. 그렇지 않으면 상세와 무관하게 손으로 넣어 둔
           매출원가 주차 값을 지워 버린다. */
        var hadCost = (d.cost != null) ||
          kidsOf(sec, item).some(function (x) { return x.id !== id && x.cost != null; });
        var m = S.m, team = S.team, wk = S.week;   /* 응답이 온 뒤에 읽으면 다른 주차를 쓴다 */
        U.ask('「' + d.item + '」 항목 삭제',
          '입력한 금액과 변동 내용이 함께 지워지고 소계가 다시 계산됩니다.', '삭제', true)
          .then(function (ok) {
            if (!ok) return;
            return D.delDetail(id)
              .then(function () { return syncAt(m, team, wk, sec, item); })
              .then(function () { return hadCost ? syncAt(m, team, wk, '매출원가', item) : null; })
              .then(function () { K.bust(); flash('삭제했습니다'); render(); })
              .catch(fail);
          });
      };
    });
    var cb = $('#btnCum');
    if (cb) cb.onclick = function () { S.cum = !S.cum; render(); };
  }

  function grow(ta) { ta.style.height = 'auto'; ta.style.height = Math.max(24, ta.scrollHeight) + 'px'; }
  function itemOfGrp(g) {
    var out = null;
    Object.keys(ITEM2GRP).forEach(function (it) { if (ITEM2GRP[it] === g) out = it; });
    return out;
  }
  function secOfGrp(g, field) { return field === 'cost' ? '매출원가' : '매출'; }

  global.MpPlan = {
    S: S,
    open: function (m, team) {
      S.m = m != null ? m : S.m;
      S.team = (team && team !== D.TOTAL) ? team : (MpAuth.myTeam() && MpAuth.myTeam() !== '*' ? MpAuth.myTeam() : D.TEAMS[0]);
      if (S.m == null) S.m = D.mOf(2026, 9);
      S.week = Math.max(0, K.finalK(S.m, S.team));
      render();
      /* ERP 명세는 월 단위로 따로 읽는다. 도착하면 매칭 카드와 항목별 확정실적이 채워진다. */
      D.loadErp(S.m).then(function (got) { if (got) { K.bust(); render(); } }).catch(function () {});
    },
    render: render
  };
})(window);
