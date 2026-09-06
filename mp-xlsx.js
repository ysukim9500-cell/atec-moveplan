/* ============================================================================
 * mp-xlsx.js — 원본 엑셀 모양 그대로 내보내기
 *
 * 받는 사람은 지금까지 «★2026년 고객지원사업부 이동계획.xlsx» 와
 * «이동계획차이.xlsx» 를 봐 왔다. 웹이 자기 편한 표를 내보내면
 * 받는 쪽이 매번 옮겨 적어야 한다. 그래서 원본 배치를 그대로 따른다.
 *
 * 두 가지를 만든다.
 *   planBook  월 시트 — 사업부 블록 + 6개 팀 블록, 38행 간격.
 *             오른쪽(I~N)에 매출현황 상세.
 *   diffBook  이동계획차이 — B열부터 시작. 월(9행 병합) × 항목(3행 병합) ×
 *             계획/전주/금주, F열 차이, G열 사유.
 *
 * 항목 이름의 공백('제 품', '유 지 보 수')까지 원본을 따른다 —
 * 붙여 넣고 비교할 때 글자가 어긋나면 쓸모가 없다.
 * ========================================================================== */
(function (global) {
  'use strict';

  var D = global.MpData, K = global.MpCalc, U = global.MpUI;

  /* 원본 표기 그대로 */
  /* 원본은 칸을 맞추려고 글자 사이에 공백을 넣는다. 그대로 따라야 붙여 넣고 비교가 된다. */
  var LBL = {
    '제품': '제         품', '상품': '상         품', '유지보수': '유 지 보 수',
    '유상서비스': '유상서비스', '공사': '공         사', '영업수수료': '영업수수료',
    '개발비': '개발비', '합계': '합       계',
    '인건비': '인건비', '지급수수료': '지급수수료', '차량유지비': '차량유지비',
    '여비교통비': '여비교통비', '운반비': '운반비', '기타경비': '기타경비'
  };
  /* 엑셀 원본은 아직 옛 팀명을 쓴다. 붙여 넣을 곳이 그쪽이므로 그쪽 표기로 내보낸다. */
  var XLS_TEAM = { '리페어팀': 'Repair팀', '실공통': '사업부' };
  function xteam(t) { return XLS_TEAM[t] || t; }
  function lbl(x) { return LBL[x] || x; }

  var MIN_BLOCK = 38;   /* 원본의 최소 간격. 상세가 길면 그만큼 늘어난다 (원본도 38~39로 들쭉날쭉하다) */
  var SEC_ROWS = [
    { sec: '매출',     items: ['제품', '상품', '유지보수', '유상서비스', '공사', '영업수수료', '합계'] },
    { sec: '매출원가', items: ['제품', '상품', '유지보수', '유상서비스', '공사', '영업수수료', '개발비', '합계'] },
    { sec: '매출이익', items: ['제품', '상품', '유지보수', '유상서비스', '공사', '영업수수료', '개발비', '합계'] },
    { sec: '판관비',   items: ['인건비', '지급수수료', '차량유지비', '여비교통비', '운반비', '기타경비', '합계'] }
  ];

  function r2(v) { return (v == null || isNaN(v)) ? null : Math.round(v * 100) / 100; }

  /* ==========================================================================
   * 이동계획 월 시트
   * ======================================================================== */

  /** 한 블록(사업부 또는 한 팀)을 aoa 에 그린다. top 은 제목 행 인덱스(0-based). */
  function block(aoa, top, m, team, k, title) {
    function put(r, c, v) {
      while (aoa.length <= r) aoa.push([]);
      var row = aoa[r];
      while (row.length <= c) row.push(null);
      row[c] = v;
    }
    put(top, 0, title);
    put(top, 6, '(단위 : 백만원)');
    put(top, 8, '▶ 매출현황');

    put(top + 1, 0, '구 분'); put(top + 1, 2, '월간계획'); put(top + 1, 3, '매출액');
    put(top + 1, 4, '누적계획'); put(top + 1, 5, '누적실적'); put(top + 1, 6, '달성율');
    put(top + 1, 8, '구분'); put(top + 1, 9, '항목'); put(top + 1, 10, '매출액');
    put(top + 1, 11, '원가'); put(top + 1, 12, '이익'); put(top + 1, 13, '비고');
    put(top + 2, 3, '금주');

    var r = top + 3;
    SEC_ROWS.forEach(function (S) {
      S.items.forEach(function (it, i) {
        var plan = K.PL(m, team, S.sec, it);
        var cur = K.V(m, team, S.sec, it, k);
        var cp = K.cum(m, team, S.sec, it, false);   /* 누적계획 */
        var ca = K.cum(m, team, S.sec, it, true);    /* 누적실적(최종 OL 기준) */
        if (i === 0) put(r, 0, S.sec);
        put(r, 1, lbl(it));
        put(r, 2, r2(plan)); put(r, 3, r2(cur));
        put(r, 4, r2(cp)); put(r, 5, r2(ca));
        put(r, 6, (cp ? r2(ca / cp) : 0));
        r++;
      });
    });
    /* 영업이익 · 공판 · 공판후영업이익 — 항목 칸이 없거나 '소계' 다 */
    [['영업이익', '영 업 이 익', ''], ['공판', '공판', '소계'], ['공판후영업이익', '공판후 영업이익', '']]
      .forEach(function (t) {
        var sec = t[0];
        var plan = K.PL(m, team, sec, '계'), cur = K.V(m, team, sec, '계', k);
        var cp = K.cum(m, team, sec, '계', false), ca = K.cum(m, team, sec, '계', true);
        put(r, 0, t[1]);
        if (t[2]) put(r, 1, t[2]);
        put(r, 2, r2(plan)); put(r, 3, r2(cur));
        put(r, 4, r2(cp)); put(r, 5, r2(ca));
        put(r, 6, (cp ? r2(ca / cp) : 0));
        r++;
      });

    /* 오른쪽 매출현황 상세 — 구분별로 묶고 소계를 붙인다 */
    if (team !== D.TOTAL) {
      var dr = top + 2, tot = { rev: 0, cost: 0, gp: 0 };
      var det = D.detailOf(m, team, k);
      var grps = {};
      det.forEach(function (d) { (grps[d.grp || '기타'] = grps[d.grp || '기타'] || []).push(d); });
      Object.keys(grps).forEach(function (g) {
        var s = { rev: 0, cost: 0 };
        put(dr, 8, g);
        grps[g].forEach(function (d) {
          put(dr, 9, d.item); put(dr, 10, r2(d.rev)); put(dr, 11, r2(d.cost));
          put(dr, 12, r2((d.rev || 0) - (d.cost || 0)));
          if (d.note) put(dr, 13, d.note);
          s.rev += (d.rev || 0); s.cost += (d.cost || 0);
          dr++;
        });
        put(dr, 9, '소계'); put(dr, 10, r2(s.rev)); put(dr, 11, r2(s.cost));
        put(dr, 12, r2(s.rev - s.cost));
        dr++;
        tot.rev += s.rev; tot.cost += s.cost;
      });
      put(dr, 8, '합계'); put(dr, 10, r2(tot.rev)); put(dr, 11, r2(tot.cost));
      put(dr, 12, r2(tot.rev - tot.cost));
      if (dr + 1 > r) r = dr + 1;      /* 상세가 손익표보다 길면 그만큼 밀린다 */
    }
    return r;
  }

  /** 한 달 시트 */
  function monthSheet(m) {
    var k = K.finalK(m, D.TEAMS[0]);
    if (k < 0) k = 0;
    var mo = D.moOf(m);
    var aoa = [];
    aoa.push([mo, '개발비', r2(K.PL(m, D.TOTAL, '매출이익', '개발비'))]);
    aoa.push([]);
    var end = block(aoa, 2, m, D.TOTAL, k, '고객지원사업부 ' + mo + '월 이동계획');
    /* 원본은 사업부 블록 뒤에 5행을 비우고(간격 41) 팀부터는 38행 간격이다.
       상세가 길면 그만큼 밀린다 — 원본도 38~39로 들쭉날쭉하다. */
    var top = 2, gap = 41;
    D.TEAMS.forEach(function (t) {
      top = Math.max(top + gap, end + 2);
      gap = MIN_BLOCK;
      end = block(aoa, top, m, t, k, xteam(t) + ' ' + mo + '월 이동계획');
    });
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 12 }, { wch: 13 }, { wch: 11 }, { wch: 11 }, { wch: 12 }, { wch: 12 }, { wch: 10 },
                   { wch: 2 }, { wch: 11 }, { wch: 24 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 34 }];
    return ws;
  }

  /**
   * 이동계획 형식 통째로.
   * months 를 주면 그 달만, 없으면 값이 있는 달 전부.
   */
  function planBook(months) {
    var wb = XLSX.utils.book_new();
    (months || liveMonths()).forEach(function (m) {
      XLSX.utils.book_append_sheet(wb, monthSheet(m), D.moOf(m) + '월');
    });
    return wb;
  }
  function liveMonths() {
    var out = [];
    for (var mo = 1; mo <= 12; mo++) {
      var m = D.mOf(2026, mo);
      if (K.finalK(m, D.TEAMS[0]) >= 0 || K.PL(m, D.TOTAL, '매출', '합계') != null) out.push(m);
    }
    return out;
  }

  /* ==========================================================================
   * 이동계획차이
   *
   * 원본은 B열부터 시작한다. A열은 비운다.
   * 월 셀은 9행, 항목 셀은 3행 병합한다.
   * ======================================================================== */
  var DIFF_SEC = ['매출', '매출이익', '판관비'];

  /** rows: [{m, item, plan, prev, cur, dPrev, note}] — 월마다 3항목 × 3행 */
  function diffBook(rows) {
    var aoa = [[]], merges = [];
    aoa[0][5] = '차이';                       /* F1 */

    var byM = {};
    rows.forEach(function (r) { (byM[r.m] = byM[r.m] || {})[r.item] = r; });
    var months = Object.keys(byM).map(Number).sort(function (a, b) { return a - b; });

    var r = 1;                                 /* 0-based → 엑셀 2행 */
    months.forEach(function (m) {
      var m0 = r;
      DIFF_SEC.forEach(function (sec) {
        var x = byM[m][sec] || {};
        var i0 = r;
        [['계획', x.plan, null, null],
         ['전주', x.prev, null, null],
         ['금주', x.cur, x.dPrev, x.note]].forEach(function (t) {
          var row = [];
          row[0] = null;                       /* A 비움 */
          row[1] = (r === m0) ? (D.moOf(m) + '월') : null;
          row[2] = (r === i0) ? sec : null;
          row[3] = t[0];
          row[4] = (t[1] == null) ? null : Math.round(t[1]);
          row[5] = (t[2] == null) ? null : Math.round(t[2]);
          row[6] = t[3] || null;
          aoa[r] = row;
          r++;
        });
        merges.push({ s: { r: i0, c: 2 }, e: { r: i0 + 2, c: 2 } });   /* 항목 3행 */
      });
      merges.push({ s: { r: m0, c: 1 }, e: { r: m0 + 8, c: 1 } });      /* 월 9행 */
    });

    var ws = XLSX.utils.aoa_to_sheet(aoa);
    /* 원본은 B열부터 시작한다. A열을 범위에서 뺀다. */
    var rg = XLSX.utils.decode_range(ws['!ref']);
    rg.s.c = 1;
    ws['!ref'] = XLSX.utils.encode_range(rg);
    ws['!merges'] = merges;
    ws['!cols'] = [{ wch: 2 }, { wch: 8 }, { wch: 11 }, { wch: 8 }, { wch: 10 }, { wch: 8 }, { wch: 52 }];
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    return wb;
  }

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

  global.MpXlsx = {
    loadXlsx: loadXlsx, planBook: planBook, diffBook: diffBook,
    monthSheet: monthSheet, liveMonths: liveMonths, lbl: lbl
  };
})(window);
