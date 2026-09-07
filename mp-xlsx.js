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
  /* 광역교통지원팀은 원본 엑셀도 이 이름으로 통일한다 (옛 표기 : 광역버스사업팀) */
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
    var k = K.lastFilledK(m);
    if (k < 0) k = 0;
    var mo = D.moOf(m);
    var aoa = [];
    /* 원본 1행의 개발비(−75)는 팀 개발비 합이 그만큼 모자란다는 표시였다.
       근거를 알 수 없는 값을 채워 넣지 않는다. 월 번호만 남긴다. */
    aoa.push([mo]);
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
      if (K.lastFilledK(m) >= 0 || K.PL(m, D.TOTAL, '매출', '합계') != null) out.push(m);
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


  /* ==========================================================================
   * 이동계획 · 이동계획차이 — 템플릿에 값만 얹는다
   *
   * 원본 월 시트에는 병합 · 테두리 · 인쇄영역 · 누적 수식(전월 시트 참조)이 들어 있다.
   * 새로 그리면 그 전부가 사라진다. 그래서 원본을 열어 «사람이 넣는 칸» 만 덮어쓴다.
   *
   * 좌표는 박아 두지 않는다. 월마다 레이아웃이 달라서(7월 B4:AH78 · 8월 B3:AJ50 …)
   * 라벨을 읽어 그 자리에 쓴다 — 업로드 파서(parseMonthSheet)가 하는 일의 반대다.
   * ======================================================================== */

  /** 시트 XML 에서 «값이 든 칸» 을 좌표와 함께 읽는다 */
  function readCells(xml, strs) {
    var out = {};
    xml.replace(/<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, function (_, col, row, attr, body) {
      var t = /t="(\w+)"/.exec(attr);
      var hasF = body ? /<f[ >]/.test(body) : false;
      var v = body ? (/<v>([\s\S]*?)<\/v>/.exec(body) || [])[1] : null;
      var val = v;
      if (t && t[1] === 's' && v != null) val = strs[+v];
      else if (t && t[1] === 'inlineStr' && body) val = (/<t[^>]*>([\s\S]*?)<\/t>/.exec(body) || [])[1];
      out[col + row] = { c: col, r: +row, v: val, f: hasF };
      return _;
    });
    return out;
  }
  function sharedStrings(Z) {
    var p = Z['xl/sharedStrings.xml'];
    if (!p) return [];
    var s = MpTpl.txt(p), out = [];
    s.replace(/<si>([\s\S]*?)<\/si>/g, function (_, b) {
      var t = ''; b.replace(/<t[^>]*>([\s\S]*?)<\/t>/g, function (_, v) { t += v; }); out.push(t);
    });
    return out;
  }
  /** 공백을 지우고 견준다 — 원본은 «제         품» 처럼 칸을 맞추려고 공백을 넣는다 */
  function norm(v) { return v == null ? '' : String(v).replace(/\s/g, ''); }

  /**
   * 월 시트에서 팀 블록의 시작 행을 찾는다.
   * 제목 칸이 «… N월 이동계획» 이다. 값이든 수식 결과든 그 문자열이 들어 있다.
   */
  function blockRows(cells) {
    var out = [];
    Object.keys(cells).forEach(function (ref) {
      var x = cells[ref];
      if (typeof x.v !== 'string') return;
      var mm = /^(.+?)\s*\d+월\s*이동계획\s*$/.exec(x.v.trim());
      if (mm) out.push({ row: x.r, col: x.c, name: mm[1].trim() });
    });
    return out.sort(function (a, b) { return a.row - b.row; });
  }

  /** 블록 안에서 «구분/항목» 라벨이 있는 행을 찾아 (섹션,항목) → 행 으로 만든다 */
  function itemRows(cells, from, to) {
    var byRow = {};
    Object.keys(cells).forEach(function (ref) {
      var x = cells[ref];
      if (x.r < from || x.r > to) return;
      (byRow[x.r] = byRow[x.r] || {})[x.c] = x;
    });
    var map = {}, sec = null;
    Object.keys(byRow).map(Number).sort(function (a, b) { return a - b; }).forEach(function (r) {
      var row = byRow[r];
      var a = null, b = null;
      Object.keys(row).forEach(function (c) {
        if (typeof row[c].v !== 'string') return;
        if (a === null) a = row[c]; else if (b === null && row[c].r === r) b = row[c];
      });
      /* 열 순서로 다시 잡는다 (객체 키 순서를 믿지 않는다) */
      var cols = Object.keys(row).sort(function (p, q) { return MpTpl.colIdx(p) - MpTpl.colIdx(q); });
      a = null; b = null;
      for (var i = 0; i < cols.length; i++) {
        var x = row[cols[i]];
        if (typeof x.v !== 'string' || !x.v.trim()) continue;
        if (a === null) a = x; else { b = x; break; }
      }
      var an = norm(a && a.v), bn = norm(b && b.v);
      if (SEC_SET[an]) sec = SEC_KEY[an];
      if (an === '영업이익' || an === '영업이익'.replace(/\s/g, '') || an === '공판후영업이익') { sec = null; return; }
      if (an === '공판') { map['공판|계'] = { row: r, labelCol: (b || a).c }; sec = null; return; }
      var key = ITEM_KEY[bn] || (sec && ITEM_KEY[an]);
      if (sec && key) map[sec + '|' + key] = { row: r, labelCol: (b || a).c };
    });
    return map;
  }

  /* 라벨 ↔ 내부 이름 (공백 제거 기준) */
  var SEC_KEY = { '매출': '매출', '매출원가': '매출원가', '매출이익': '매출이익', '판관비': '판관비' };
  var SEC_SET = SEC_KEY;
  var ITEM_KEY = {};
  ['제품', '상품', '유지보수', '유상서비스', '공사', '영업수수료', '개발비', '합계',
   '인건비', '지급수수료', '차량유지비', '여비교통비', '운반비', '기타경비', '계']
    .forEach(function (k) { ITEM_KEY[k] = k; });

  /** 그 달 시트 하나를 채운다 */
  function fillMonth(Z, m, k, strs) {
    var name = D.moOf(m) + '월 (2)';
    var paths = MpTpl.sheetPaths(Z).filter(function (s) { return s.name === name; });
    if (!paths.length) return { sheet: name, ok: false, why: '템플릿에 시트 없음' };
    var path = paths[0].path;
    var xml = MpTpl.txt(Z[path]);
    var cells = readCells(xml, strs);
    var blocks = blockRows(cells);
    if (!blocks.length) return { sheet: name, ok: false, why: '팀 블록을 찾지 못함' };

    var patch = {}, wrote = 0, skipped = [];
    blocks.forEach(function (bk, bi) {
      var end = (bi + 1 < blocks.length ? blocks[bi + 1].row : 100000) - 1;
      var team = TEAM_OF_TITLE(bk.name);
      if (!team) { skipped.push(bk.name); return; }
      var map = itemRows(cells, bk.row, end);
      Object.keys(map).forEach(function (key) {
        var a = key.split('|'), sec = a[0], item = a[1];
        var pos = map[key];
        /* C = 월간계획, D = 금주. 라벨 칸 오른쪽 두 칸이다. */
        var lc = MpTpl.colIdx(pos.labelCol);
        var cPlan = MpTpl.colName(lc + 1) + pos.row;
        var cCur  = MpTpl.colName(lc + 2) + pos.row;
        var pv = (sec === '공판') ? K.PL(m, team, '공판', '계') : K.PL(m, team, sec, item);
        var cv = (sec === '공판') ? K.V(m, team, '공판', '계', k) : K.V(m, team, sec, item, k);
        if (!cells[cPlan] || !cells[cPlan].f) { if (pv != null) { patch[cPlan] = r2(pv); wrote++; } }
        if (!cells[cCur]  || !cells[cCur].f)  { if (cv != null) { patch[cCur]  = r2(cv); wrote++; } }
      });
    });
    Z[path] = MpTpl.bin(MpTpl.patchCells(xml, patch));
    return { sheet: name, ok: true, wrote: wrote, blocks: blocks.length, skipped: skipped };
  }

  /** 원본 제목의 팀 표기 → 내부 팀 키 */
  function TEAM_OF_TITLE(t) {
    var n = norm(t);
    if (n === '고객지원사업부') return D.TOTAL;
    if (n === '사업부') return '실공통';
    if (n === 'Repair팀'.replace(/\s/g, '') || n === '리페어팀') return '리페어팀';
    if (n === '광역버스사업팀' || n === '광역교통지원팀') return '광역교통지원팀';
    if (n === '택시지원팀' || n === '택시지원파트') return '택시지원파트';
    var hit = D.TEAMS.filter(function (x) { return norm(x) === n || norm(D.teamName(x)) === n; })[0];
    return hit || null;
  }

  /** 이동계획 원본 서식 그대로 · 선택한 달들을 채워 내려받는다 */
  function planFile(months, k) {
    var Z, strs, log = [];
    return MpTpl.load('plan').then(function (z) {
      Z = MpTpl.copy(z);
      strs = sharedStrings(Z);
      (months || liveMonths()).forEach(function (m) {
        log.push(fillMonth(Z, m, k == null ? Math.max(0, K.finalK(m, D.TOTAL)) : k, strs));
      });
      /* 파일을 열 때 수식을 다시 계산하게 한다 — 누적·합계가 새 값으로 맞춰진다 */
      forceCalc(Z);
      var nm = '★' + D.yOf((months || liveMonths())[0] || D.mOf(2026, 1)) + '년 고객지원사업부 이동계획_' +
        U.ymd(null, '').slice(2) + '.xlsx';
      MpTpl.build(Z, nm);
      return log;
    });
  }

  /** 이동계획차이 — 원본 1시트에 값만 얹는다 */
  function diffFile(rows) {
    var Z, strs;
    return MpTpl.load('diff').then(function (z) {
      Z = MpTpl.copy(z); strs = sharedStrings(Z);
      var path = MpTpl.sheetPaths(Z)[0].path;
      var xml = MpTpl.txt(Z[path]);
      var cells = readCells(xml, strs);

      /* 원본은 B열부터 : B=월, C=항목, D=구분(계획/전주/금주), E=금액, F=차이, G=사유 */
      var byM = {};
      rows.forEach(function (r) { (byM[r.m] = byM[r.m] || {})[r.item] = r; });
      var months = Object.keys(byM).map(Number).sort(function (a, b) { return a - b; });

      var patch = {}, r0 = 2, n = 0;
      months.forEach(function (m) {
        var mStart = r0;
        DIFF_SEC.forEach(function (sec) {
          var x = byM[m][sec] || {}, iStart = r0;
          [['계획', x.plan, null, null], ['전주', x.prev, null, null],
           ['금주', x.cur, x.dPrev, x.note]].forEach(function (t) {
            if (r0 === mStart) patch['B' + r0] = D.moOf(m) + '월';
            if (r0 === iStart) patch['C' + r0] = sec;
            patch['D' + r0] = t[0];
            if (t[1] != null) patch['E' + r0] = Math.round(t[1]);
            if (t[2] != null) patch['F' + r0] = Math.round(t[2]);
            if (t[3]) patch['G' + r0] = t[3];
            r0++; n++;
          });
        });
      });
      Z[path] = MpTpl.bin(MpTpl.patchCells(xml, patch));
      forceCalc(Z);
      MpTpl.build(Z, '이동계획차이_' + U.ymd(null, '').slice(2) + '.xlsx');
      return { rows: n, months: months.length };
    });
  }

  /** 열 때 전체 재계산 — 우리가 값만 바꿨으므로 합계·누적 수식이 다시 돌아야 한다 */
  function forceCalc(Z) {
    var p = 'xl/workbook.xml';
    if (!Z[p]) return;
    var s = MpTpl.txt(Z[p]);
    if (/<calcPr[^>]*\/>/.test(s)) s = s.replace(/<calcPr[^>]*\/>/, '<calcPr calcId="0" fullCalcOnLoad="1"/>');
    else s = s.replace(/<\/workbook>/, '<calcPr calcId="0" fullCalcOnLoad="1"/></workbook>');
    Z[p] = MpTpl.bin(s);
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
    monthSheet: monthSheet, liveMonths: liveMonths, lbl: lbl,
    /* 템플릿 기반 — 원본 서식 · 수식 · 인쇄설정을 그대로 두고 값만 얹는다 */
    planFile: planFile, diffFile: diffFile
  };
})(window);
