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
  function canEditPlan() {
    return MpAuth.isAdmin() && !D.isFinal(S.m) && S.team !== D.TOTAL;
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
    });
    U.tabs($('#plTeam'), [{ id: D.TOTAL, label: '사업부 합계' }].concat(
      D.TEAMS.map(function (t) { return { id: t, label: D.teamName(t) }; })
    ), team, function (v) { S.team = v; render(); });

    var wl = [];
    for (var i = 0; i < nW; i++) {
      wl.push({ id: i, label: (i + 1) + '주', mark: i === K.finalK(m, team) ? '●' : '' });
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
    buildTable(m, team, nW);
    bind();
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
      var sec = p[0], leaf = (sec === '공판') && canEdit();
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
    /* 항목 단위 확정치는 매출·매출원가 합계와 판관비 합계에서만 근거가 있다 */
    var a = K.act(m, team), av = null;
    if (a) {
      if (sec === '매출' && item === '합계') av = a.rev;
      else if (sec === '매출원가' && item === '합계') av = a.cost;
      else if (sec === '매출이익' && item === '합계') av = a.gp;
      else if (sec === '판관비' && item === '합계') av = a.sga;
      else if (sec === '영업이익') av = a.op;
      else if (sec === '공판') av = a.gongpan;
      else if (sec === '공판후영업이익') av = a.op2;
    }
    if (av == null) {
      return '<td class="n actc"><span class="zero">–</span></td><td class="n actc"><span class="zero">–</span></td>' +
        '<td class="actc"><span class="zero">ERP에 항목 구분 근거 없음</span></td>';
    }
    var ov = K.OL(m, team, sec, item);
    var d = ov == null ? null : Math.round((av - ov) * 10000) / 10000;
    var n = D.findNote('erpdiff', m, team, sec, item, null);
    var body = n ? n.body : '';
    var canNote = MpAuth.canWriteTeam(team) && team !== D.TOTAL;
    return '<td class="n actc gs"><b>' + fmt(av) + '</b></td>' +
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

  /* 상세를 고치면 그 항목의 기준 주차 값도 소계로 맞춘다 */
  function syncSub(sec, item) {
    var sub = subtotal(sec, item);
    return D.setWeek(S.m, S.team, sec, item, S.week, sub);
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
          p = D.patchDetail(c[0], patch).then(function () { return syncSub(secOfGrp(d.grp, c[1]), itemOfGrp(d.grp)); });
        }
        if (!p) return;
        p.then(function () { K.bust(); flash('저장됨'); render(); }).catch(fail);
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
        if (!window.confirm('「' + d.item + '」 항목을 삭제합니다.\n입력한 금액과 변동 내용이 함께 지워지고 소계가 다시 계산됩니다.')) return;
        var sec = secOfGrp(d.grp, 'rev'), item = itemOfGrp(d.grp);
        D.delDetail(id)
          .then(function () { return syncSub(sec, item); })
          .then(function () { return syncSub('매출원가', item); })
          .then(function () { K.bust(); flash('삭제했습니다'); render(); })
          .catch(fail);
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
    },
    render: render
  };
})(window);
