/* ============================================================================
 * mp-import.js — 이동계획 · ERP 엑셀 파싱
 *
 * 엑셀은 입력 수단이 아니라 결과물이다. 다만 두 가지에는 계속 필요하다.
 *   ① 기존 데이터 이관 (일회성)
 *   ② ERP 확정본 등록 (매월, 경영지원팀)
 *
 * 파일은 사용자 PC 에서 브라우저로 바로 읽는다. 어디에도 올리지 않는다.
 *
 * 파생값은 만들지 않는다 — 합계 · 매출이익(개발비 제외) · 영업이익 · 공판후영업이익 ·
 * 사업부합계 · 누적은 화면이 계산한다.
 * ========================================================================== */
(function (global) {
  'use strict';

  var TEAMS = ['광역교통지원팀', '택시지원파트', '리페어팀', '수도권버스지원팀', 'AFC지원파트', '실공통'];

  /* 저장하는 리프 항목만 나열한다 */
  var SEC_ITEMS = {
    '매출':     ['제품', '상품', '유지보수', '유상서비스', '공사', '영업수수료'],
    '매출원가': ['제품', '상품', '유지보수', '유상서비스', '공사', '영업수수료', '개발비'],
    '매출이익': ['개발비'],
    '판관비':   ['인건비', '지급수수료', '차량유지비', '여비교통비', '운반비', '기타경비'],
    '공판':     ['계']
  };

  /* 이동계획 원본의 팀 블록 표기 (엑셀은 아직 "Repair팀" 이다) */
  var TEAM_ALIAS = {
    'Repair팀': '리페어팀', 'Repair 팀': '리페어팀', 'repair팀': '리페어팀',
    '광역버스사업팀': '광역교통지원팀', '택시지원팀': '택시지원파트',
    '고객지원사업부': '사업부합계',      /* 계산값이므로 버린다 */
    '사업부': '실공통'
  };

  var M0 = 2026 * 12;
  function ymIdx(y, mo) { return y * 12 + (mo - 1); }

  function norm(v) { return v == null ? null : (typeof v === 'string' ? v.replace(/\s/g, '') : v); }
  function num(v) { return (typeof v === 'number' && isFinite(v)) ? Math.round(v * 10000) / 10000 : null; }
  function txt(v) { return v == null ? '' : String(v).trim(); }

  function rowsOf(wb, sn) {
    return XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: null });
  }

  /* ---------- 파일 읽기 ---------- */
  function readFile(file) {
    return new Promise(function (res, rej) {
      if (!/\.(xlsx|xlsm|xls)$/i.test(file.name)) return rej(new Error('엑셀 파일만 읽을 수 있습니다 — ' + file.name));
      if (file.size > 30 * 1024 * 1024) return rej(new Error('파일이 너무 큽니다(30MB 초과) — ' + file.name));
      var fr = new FileReader();
      fr.onload = function (e) {
        try { res(XLSX.read(new Uint8Array(e.target.result), { type: 'array' })); }
        catch (err) { rej(new Error('엑셀을 읽을 수 없습니다. 손상되었거나 암호가 걸려 있습니다.')); }
      };
      fr.onerror = function () { rej(new Error('파일 읽기에 실패했습니다.')); };
      fr.readAsArrayBuffer(file);
    });
  }

  /* ---------- 이동계획 월 시트 파싱 ---------- */
  function parseMonthSheet(wb, sn) {
    var rows = rowsOf(wb, sn);
    var titles = [];
    rows.forEach(function (r, i) {
      var a = r && r[0];
      if (typeof a === 'string' && a.indexOf('이동계획') >= 0) {
        var m = a.trim().match(/^(.+?)\s*\d+월\s*이동계획/);
        if (m) titles.push({ i: i, name: m[1].trim() });
      }
    });

    var out = {};
    titles.forEach(function (t, ti) {
      var end = ti + 1 < titles.length ? titles[ti + 1].i : rows.length;
      var key = TEAM_ALIAS[t.name] || t.name;
      if (TEAMS.indexOf(key) < 0) return;          /* 사업부합계는 계산값 */

      var pl = {}, cur = null;
      for (var i = t.i; i < end; i++) {
        var r = rows[i] || [], a = norm(r[0]), b = norm(r[1]);
        var vals = [num(r[2]), num(r[3])];         /* [월간계획, 금주] */
        if (typeof a === 'string' && SEC_ITEMS[a]) cur = a;
        if (a === '공판') { pl['공판'] = { '계': vals }; cur = null; continue; }
        if (a === '영업이익' || a === '공판후영업이익') { cur = null; continue; }
        if (cur && typeof b === 'string' && SEC_ITEMS[cur].indexOf(b) >= 0) {
          (pl[cur] = pl[cur] || {})[b] = vals;
        }
      }

      /* 매출현황 상세 — 헤더에 '비고'가 있는 줄을 찾아 그 아래를 읽는다 */
      var detail = [], hr = -1, hc = null;
      for (var i2 = t.i; i2 < Math.min(end, t.i + 6); i2++) {
        var rr = rows[i2] || [];
        for (var c = 5; c < rr.length; c++) if (norm(rr[c]) === '비고') { hr = i2; break; }
        if (hr >= 0) {
          hc = {};
          (rows[hr] || []).forEach(function (v, ci) {
            var nv = norm(v);
            if (['구분', '항목', '매출액', '원가', '이익', '비고'].indexOf(nv) >= 0 && ci >= 5 && hc[nv] == null) hc[nv] = ci;
          });
          break;
        }
      }
      if (hr >= 0 && hc && hc['항목'] != null) {
        var grp = '';
        for (var i3 = hr + 1; i3 < end; i3++) {
          var r3 = rows[i3] || [];
          var g = hc['구분'] != null ? txt(r3[hc['구분']]) : '';
          if (g) grp = g;
          var item = txt(r3[hc['항목']]);
          if (!item || item === '소계') continue;   /* 소계는 항상 재계산한다 */
          var rev = hc['매출액'] != null ? num(r3[hc['매출액']]) : null;
          var cost = hc['원가'] != null ? num(r3[hc['원가']]) : null;
          var note = hc['비고'] != null ? txt(r3[hc['비고']]) : '';
          if (rev == null && cost == null && !note) continue;
          detail.push({ grp: grp, item: item, rev: rev, cost: cost, note: note, sort: detail.length });
        }
      }
      out[key] = { pl: pl, detail: detail };
    });
    return out;
  }

  /**
   * 이동계획 통합본을 읽는다.
   * @returns {{ year, months: {1..12: {team: {pl, detail}}}, aux: [{name, rows, merges}] }}
   */
  function parsePlanBook(wb, year) {
    year = year || 2026;
    var months = {}, found = 0;
    for (var mo = 1; mo <= 12; mo++) {
      var sn = null;
      for (var i = 0; i < wb.SheetNames.length; i++) {
        if (new RegExp('^\\s*' + mo + '월').test(wb.SheetNames[i])) { sn = wb.SheetNames[i]; break; }
      }
      if (!sn) continue;
      months[mo] = parseMonthSheet(wb, sn);
      found++;
    }
    if (!found) throw new Error('"N월" 형식의 월 시트를 찾지 못했습니다.');

    /* 부속 시트 — 값과 병합 구조만 보존한다 */
    var aux = [];
    wb.SheetNames.forEach(function (sn) {
      if (/^\s*\d{1,2}월/.test(sn)) return;
      var ws = wb.Sheets[sn];
      if (!ws || !ws['!ref']) return;
      aux.push({ name: sn, rows: wsToRows(ws), merges: (ws['!merges'] || []).map(function (r) { return XLSX.utils.encode_range(r); }) });
    });

    return { year: year, months: months, aux: aux };
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function wsToRows(ws) {
    var rg = XLSX.utils.decode_range(ws['!ref']);
    var out = [];
    for (var r = 0; r <= rg.e.r; r++) {
      var row = [];
      for (var c = 0; c <= rg.e.c; c++) {
        var cl = ws[XLSX.utils.encode_cell({ r: r, c: c })];
        if (!cl) { row.push(null); continue; }
        if (cl.t === 'e') { row.push(cl.w || '#ERR'); continue; }
        /* 날짜는 표시 서식이 아니라 값으로 남긴다. 시간(00:00:00)은 붙이지 않는다. */
        if (cl.t === 'n' && cl.w && /^\d{1,4}[\/\-.]\d{1,2}[\/\-.]\d{1,4}$/.test(cl.w)) {
          var d = XLSX.SSF.parse_date_code(cl.v);
          row.push(d ? (d.y + '-' + pad2(d.m) + '-' + pad2(d.d)) : cl.w);
          continue;
        }
        row.push(cl.v == null ? null : cl.v);
      }
      out.push(row);
    }
    while (out.length && out[out.length - 1].every(function (v) { return v == null; })) out.pop();
    return out;
  }

  /* ---------- 이동계획차이 ---------- */
  /** @returns [{mo, item, note}] — 사유가 적힌 '금주' 행만 */
  function parseDiffBook(wb) {
    var sn = wb.SheetNames[0];
    var rows = rowsOf(wb, sn);
    var out = [], curMo = null, curItem = null;
    rows.forEach(function (r) {
      if (!r) return;
      var mo = r[0], item = r[1], kind = r[2], note = r[5];
      if (typeof mo === 'string' && /(\d+)월/.test(mo)) curMo = parseInt(mo.match(/(\d+)월/)[1], 10);
      if (typeof item === 'string' && item.trim()) curItem = item.trim();
      if (txt(kind) === '금주' && txt(note) && curMo && curItem) {
        out.push({ mo: curMo, item: curItem, note: txt(note) });
      }
    });
    return out;
  }

  /* ---------- ERP ---------- */
  function findHeader(rows, need) {
    for (var i = 0; i < Math.min(rows.length, 12); i++) {
      var r = (rows[i] || []).map(function (c) { return String(c == null ? '' : c).replace(/\s/g, ''); });
      var ok = need.every(function (k) { return r.some(function (c) { return c.indexOf(k) >= 0; }); });
      if (ok) return { i: i, cols: r };
    }
    return null;
  }
  function colIdx(cols, names) {
    for (var i = 0; i < cols.length; i++) for (var j = 0; j < names.length; j++) if (cols[i].indexOf(names[j]) >= 0) return i;
    return -1;
  }

  /**
   * 필수 열을 가진 시트가 여럿일 때(가공본은 피벗과 상세를 함께 담는다) 어느 쪽이 원장인지 고른다.
   * findHeader 가 부분 문자열 매칭이라 피벗의 '합계 : 원화금액'도 '원화금액'에 걸린다.
   * 그래서 첫 매치를 쓰지 않고, 날짜 열까지 가진 시트 > 데이터가 많은 시트 순으로 고른다.
   */
  function pickSheet(wb, need, dateNames) {
    var cands = [];
    wb.SheetNames.forEach(function (sn) {
      var rows = rowsOf(wb, sn);
      var h = findHeader(rows, need);
      if (!h) return;
      cands.push({ sn: sn, rows: rows, h: h, iDate: colIdx(h.cols, dateNames), n: Math.max(0, rows.length - h.i - 1) });
    });
    if (!cands.length) return null;
    cands.sort(function (a, b) {
      if ((a.iDate >= 0) !== (b.iDate >= 0)) return (a.iDate >= 0) ? -1 : 1;
      return b.n - a.n;
    });
    return cands[0];
  }

  function isoDate(v) {
    if (v == null) return null;
    if (typeof v === 'number') {
      var d = XLSX.SSF.parse_date_code(v);
      return d && d.y > 1900 ? (d.y + '-' + pad2(d.m) + '-' + pad2(d.d)) : null;
    }
    var s = String(v).trim().replace(/\//g, '-');
    var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    return m ? (m[1] + '-' + pad2(+m[2]) + '-' + pad2(+m[3])) : null;
  }

  /** 날짜 분포로 기준 연월을 정한다. 화면에서 보던 월을 쓰지 않는다. */
  function scanYM(rows, iDate) {
    var dist = {};
    rows.forEach(function (r) {
      var iso = isoDate(r && r[iDate]);
      if (iso) dist[iso.slice(0, 7)] = (dist[iso.slice(0, 7)] || 0) + 1;
    });
    var keys = Object.keys(dist).sort();
    return { keys: keys, dist: dist };
  }

  var REV_GROUPS = ['리페어팀', 'AFC지원파트', 'AFC지원센터', '광역교통지원팀', '광역버스사업팀',
                    '대전센터', '수도권버스지원팀', '강남센터', '강북센터', '강서센터', '자재센터',
                    '택시지원팀', '택시지원파트', '고객지원사업부', '고객지원실'];

  /**
   * 사업부 안의 영업그룹인지 가른다.
   * 조직 매핑(mp_org_map)이 있으면 그것을 쓴다 — 조직명이 바뀌어도 매핑만 고치면 된다.
   * 매핑을 못 받았을 때만 위 목록으로 물러난다.
   */
  function inScope(team, orgMap) {
    if (orgMap && Object.keys(orgMap).length) return !!orgMap[team];
    return REV_GROUPS.indexOf(team) >= 0;
  }

  function parseRevBook(wb, orgMap) {
    var f = pickSheet(wb, ['원화금액', '영업그룹'], ['매출일자', '일자']);
    if (!f) throw new Error('필수 열(원화금액 · 영업그룹)을 찾지 못했습니다.');
    var c = f.h.cols;
    var iAmt = colIdx(c, ['원화금액']), iTeam = colIdx(c, ['영업그룹']), iName = colIdx(c, ['프로젝트명']),
        iCost = colIdx(c, ['표준원가']), iDate = colIdx(c, ['매출일자', '일자']), iNo = colIdx(c, ['매출번호']),
        iItem = colIdx(c, ['품목']), iVno = colIdx(c, ['전표번호']), iVat = colIdx(c, ['부가세']),
        iSum = colIdx(c, ['합계']), iPc = colIdx(c, ['프로젝트코드']);
    if (iDate < 0) throw new Error('매출일자 열을 찾지 못했습니다. 기준 연월을 정할 수 없습니다.');

    var body = f.rows.slice(f.h.i + 1);
    var scan = scanYM(body, iDate);
    if (!scan.keys.length) throw new Error('읽을 수 있는 매출일자가 없습니다.');

    var rows = [], excl = { cnt: 0, amt: 0, groups: {} }, src = { cnt: 0, amt: 0 };
    body.forEach(function (r) {
      var amt = Number(r[iAmt]);
      if (!isFinite(amt) || r[iAmt] == null) return;
      var team = txt(r[iTeam]);
      if (!team || team.indexOf('요약') >= 0 || team.indexOf('총합계') >= 0) return;
      src.cnt++; src.amt += amt;
      if (!inScope(team, orgMap)) {
        excl.cnt++; excl.amt += amt;
        excl.groups[team] = (excl.groups[team] || 0) + 1;
        return;
      }
      rows.push({
        no: txt(r[iNo]), vno: txt(r[iVno]), sdate: isoDate(r[iDate]), item: txt(r[iItem]),
        amt: amt, vat: iVat >= 0 ? (Number(r[iVat]) || 0) : 0, sum: iSum >= 0 ? (Number(r[iSum]) || 0) : 0,
        cost: iCost >= 0 ? (Number(r[iCost]) || 0) : 0, team: team,
        pcode: txt(r[iPc]), pname: txt(r[iName])
      });
    });
    return { sheet: f.sn, ymKeys: scan.keys, ymDist: scan.dist, rows: rows, excl: excl, src: src };
  }

  function parseSgaBook(wb) {
    var f = pickSheet(wb, ['차변금액', '계정명'], ['회계일자', '일자']);
    if (!f) throw new Error('필수 열(차변금액 · 계정명)을 찾지 못했습니다.');
    var c = f.h.cols;
    var iDate = colIdx(c, ['회계일자', '일자']), iVno = colIdx(c, ['전표번호']), iCat = colIdx(c, ['이동계획']),
        iAcct = colIdx(c, ['계정명']), iDesc = colIdx(c, ['적요']), iAmt = colIdx(c, ['차변금액']),
        iTeam = colIdx(c, ['팀명']), iMg = colIdx(c, ['관리항목명1']), iDept = colIdx(c, ['작성부서']),
        iEmp = colIdx(c, ['작성사원']), iW = colIdx(c, ['작성일자']);
    if (iDate < 0) throw new Error('회계일자 열을 찾지 못했습니다. 기준 연월을 정할 수 없습니다.');

    var body = f.rows.slice(f.h.i + 1);
    var scan = scanYM(body, iDate);
    if (!scan.keys.length) throw new Error('읽을 수 있는 회계일자가 없습니다.');

    var rows = [], src = { cnt: 0, amt: 0 };
    body.forEach(function (r) {
      var amt = Number(r[iAmt]);
      if (!isFinite(amt) || r[iAmt] == null) return;
      var acct = txt(r[iAcct]);
      if (!acct || acct.indexOf('요약') >= 0 || acct.indexOf('총합계') >= 0) return;
      src.cnt++; src.amt += amt;
      rows.push({
        adate: isoDate(r[iDate]), vno: txt(r[iVno]), cat: iCat >= 0 ? txt(r[iCat]) : '',
        acct: acct, descr: txt(r[iDesc]), amt: amt,
        team_raw: txt(r[iTeam]), mg: iMg >= 0 ? txt(r[iMg]) : '',
        dept: txt(r[iDept]), emp: txt(r[iEmp]), wdate: iW >= 0 ? isoDate(r[iW]) : null
      });
    });
    return { sheet: f.sn, ymKeys: scan.keys, ymDist: scan.dist, rows: rows, src: src };
  }

  global.MpImport = {
    TEAMS: TEAMS, SEC_ITEMS: SEC_ITEMS, M0: M0, ymIdx: ymIdx,
    readFile: readFile,
    parsePlanBook: parsePlanBook,
    parseDiffBook: parseDiffBook,
    parseRevBook: parseRevBook,
    parseSgaBook: parseSgaBook,
    pickSheet: pickSheet, isoDate: isoDate, wsToRows: wsToRows
  };
})(window);
