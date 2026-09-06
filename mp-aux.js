/* ============================================================================
 * mp-aux.js — 이동계획 부속 시트 (범용 그리드)
 *
 * 시트마다 서식이 제각각이다 — 워크숍은 43열 × 90행에 병합만 48개고,
 * 수수료는 계약 항목 표다. 전용 화면 여섯 개를 만드는 대신 그리드 하나로 받는다.
 *
 * 값과 병합 구조만 보존한다. 수식과 셀 서식(색 · 테두리 · 열폭)은 재현하지 않는다.
 *
 * 저장은 문서 통째로 덮어쓰기다. 그래서 남의 저장을 지우지 않도록
 * 불러온 시각을 조건에 걸어 쓴다 — 그 사이 누가 저장했으면 0행이 갱신되고,
 * 그때는 덮어쓰지 않고 알린다. (설계서 §10)
 * ========================================================================== */
(function (global) {
  'use strict';

  var D = global.MpData, U = global.MpUI;
  var $ = U.$, $$ = U.$$, esc = U.esc;

  var YEAR = 2026;
  var SPARE_ROWS = 3, SPARE_COLS = 2;   /* 늘려 쓸 수 있게 남겨 두는 빈 칸 */

  var S = {
    list: [], name: null, rows: [], merges: [], cols: 0,
    updatedAt: null, dirty: false, saving: false,
    a: null, b: null            /* 선택 : a = 앵커, b = 반대 모서리 */
  };

  /* ==========================================================================
   * A1 표기 — SheetJS 없이 읽고 쓴다. 보기만 하는데 881KB 를 받을 이유가 없다.
   * ======================================================================== */
  function colName(c) {
    var s = '';
    for (c += 1; c > 0;) { var m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = (c - m - 1) / 26; }
    return s;
  }
  function colNum(s) {
    var n = 0;
    for (var i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
    return n - 1;
  }
  function decRef(ref) {
    var m = /^\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/.exec(String(ref).toUpperCase());
    if (!m) return null;
    var r0 = +m[2] - 1, c0 = colNum(m[1]);
    var r1 = m[4] ? +m[4] - 1 : r0, c1 = m[3] ? colNum(m[3]) : c0;
    return { r0: Math.min(r0, r1), c0: Math.min(c0, c1), r1: Math.max(r0, r1), c1: Math.max(c0, c1) };
  }
  function encRef(m) {
    return colName(m.c0) + (m.r0 + 1) + ':' + colName(m.c1) + (m.r1 + 1);
  }

  /* ==========================================================================
   * 값
   * ======================================================================== */
  /** 화면 글자 → 저장 값. 숫자로 읽히는 것만 숫자로 둔다. */
  function parseVal(s) {
    s = String(s == null ? '' : s).replace(/ /g, ' ').trim();
    if (!s) return null;
    var t = s.replace(/,/g, '');
    /* 퍼센트는 문자로 남긴다 — 5% 가 5 인지 0.05 인지 파일만 보고는 알 수 없다 */
    if (/^-?\d+(\.\d+)?$/.test(t) && t.length < 16) return Number(t);
    return s;
  }
  function disp(v) {
    if (v == null || v === '') return '';
    if (typeof v === 'number') return v.toLocaleString('ko-KR', { maximumFractionDigits: 6 });
    return String(v);
  }
  function isNum(v) { return typeof v === 'number'; }

  function flash(msg, cls) {
    var el = $('#auxSave');
    el.className = 'chip ' + (cls || 'ok');
    el.textContent = msg;
    clearTimeout(flash.t);
    if (cls !== 'warn') flash.t = setTimeout(function () { mark(); }, 2600);
  }
  function mark() {
    var el = $('#auxSave');
    if (S.saving) { el.className = 'chip'; el.textContent = '저장 중…'; return; }
    el.className = 'chip' + (S.dirty ? ' warn' : ' ok');
    el.textContent = S.dirty ? '저장 안 됨' : '저장됨';
  }

  function canEdit() { return MpAuth.isAdmin() || MpAuth.isLead(); }

  /* ==========================================================================
   * 불러오기 · 저장
   * ======================================================================== */
  function loadList() {
    return MpAuth.rest('mp_aux?select=name,updated_at&year=eq.' + YEAR + '&order=name')
      .then(function (r) { return r.json(); })
      .then(function (rows) { S.list = rows; return rows; });
  }

  function loadSheet(name) {
    return MpAuth.rest('mp_aux?select=name,rows,merges,updated_at&year=eq.' + YEAR +
                       '&name=eq.' + encodeURIComponent(name))
      .then(function (r) { return r.json(); })
      .then(function (rows) {
        var a = rows[0];
        if (!a) throw new Error('시트를 찾지 못했습니다 — ' + name);
        S.name = a.name;
        S.merges = (a.merges || []).map(decRef).filter(Boolean);
        S.updatedAt = a.updated_at;
        S.rows = a.rows || [];
        normalize();
        S.dirty = false; S.a = null; S.b = null;
        return a;
      });
  }

  /** 모든 행을 같은 길이로 맞추고, 늘려 쓸 빈 칸을 남겨 둔다 */
  function normalize() {
    var cols = 0, rows = S.rows.length;
    S.rows.forEach(function (r) { if (r && r.length > cols) cols = r.length; });
    S.merges.forEach(function (m) {
      if (m.c1 + 1 > cols) cols = m.c1 + 1;
      if (m.r1 + 1 > rows) rows = m.r1 + 1;
    });
    cols += SPARE_COLS;
    rows += SPARE_ROWS;
    var out = [];
    for (var r = 0; r < rows; r++) {
      var src = S.rows[r] || [], row = new Array(cols);
      for (var c = 0; c < cols; c++) { var v = src[c]; row[c] = (v === '' ? null : (v == null ? null : v)); }
      out.push(row);
    }
    S.rows = out;
    S.cols = cols;
  }

  /** 저장 직전에 뒤쪽 빈 행·열을 잘라 낸다. 병합이 가리키는 범위는 남긴다. */
  function trimmed() {
    var lastR = -1, lastC = -1;
    S.rows.forEach(function (row, r) {
      row.forEach(function (v, c) {
        if (v != null && v !== '') { if (r > lastR) lastR = r; if (c > lastC) lastC = c; }
      });
    });
    S.merges.forEach(function (m) {
      if (m.r1 > lastR) lastR = m.r1;
      if (m.c1 > lastC) lastC = m.c1;
    });
    var out = [];
    for (var r = 0; r <= lastR; r++) out.push(S.rows[r].slice(0, lastC + 1));
    return out;
  }

  function save() {
    if (!S.dirty || S.saving || !canEdit()) return Promise.resolve();
    S.saving = true; mark();
    var stamp = new Date().toISOString();
    var body = { rows: trimmed(), merges: S.merges.map(encRef), updated_at: stamp };
    var me = MpAuth.me();
    if (me && me.id) body.updated_by = me.id;

    /* 불러온 시각을 조건에 건다. 그 사이 누가 저장했으면 아무 행도 안 맞는다. */
    return MpAuth.rest('mp_aux?year=eq.' + YEAR +
        '&name=eq.' + encodeURIComponent(S.name) +
        '&updated_at=eq.' + encodeURIComponent(S.updatedAt), {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(body)
    }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error(t.slice(0, 160)); });
      return r.json();
    }).then(function (rows) {
      S.saving = false;
      if (!rows.length) {
        /* 덮어쓰지 않는다. 내가 들고 있는 건 헌 것이다. */
        S.dirty = true;
        flash('다른 사람이 먼저 저장했습니다 — 덮어쓰지 않았습니다', 'warn');
        $('#auxConflict').className = 'note err';
        $('#auxConflict').innerHTML =
          '<b>이 시트를 다른 사람이 저장했습니다.</b> 지금 화면의 내용은 그 저장분을 지우게 되므로 보내지 않았습니다. ' +
          '고친 내용을 따로 복사해 두고 <b>다시 불러오기</b>를 누르십시오. ' +
          '<button class="btn" id="btnAuxReload" style="margin-left:6px">다시 불러오기</button>';
        $('#btnAuxReload').onclick = function () { open(S.name); };
        return;
      }
      S.updatedAt = rows[0].updated_at || stamp;
      S.dirty = false;
      $('#auxConflict').className = 'hide';
      mark();
      return D.audit('부속 시트 저장', { ref: S.name, after: S.rows.length + '행' });
    }).catch(function (e) {
      S.saving = false; S.dirty = true;
      flash(e.message, 'warn');
    });
  }

  var saveTimer = null;
  function touch() {
    S.dirty = true; mark();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 1500);
  }

  /* ==========================================================================
   * 병합
   * ======================================================================== */
  /** 이 셀을 덮고 있는 병합. 앵커면 그 자신을 돌려준다. */
  function mergeAt(r, c) {
    for (var i = 0; i < S.merges.length; i++) {
      var m = S.merges[i];
      if (r >= m.r0 && r <= m.r1 && c >= m.c0 && c <= m.c1) return m;
    }
    return null;
  }
  function skipMap() {
    var sk = {};
    S.merges.forEach(function (m) {
      for (var r = m.r0; r <= m.r1; r++) for (var c = m.c0; c <= m.c1; c++) {
        if (r !== m.r0 || c !== m.c0) sk[r + ',' + c] = 1;
      }
    });
    return sk;
  }

  /**
   * 행·열을 넣거나 빼면 병합 범위도 같이 움직여야 한다.
   * 이걸 안 하면 병합이 엉뚱한 칸을 덮어 표가 어긋난다.
   */
  function shiftMerges(axis, at, delta) {
    var f0 = axis === 'r' ? 'r0' : 'c0', f1 = axis === 'r' ? 'r1' : 'c1';
    var out = [];
    S.merges.forEach(function (m) {
      if (delta > 0) {                       /* 삽입 */
        if (m[f0] >= at) { m[f0]++; m[f1]++; }
        else if (m[f1] >= at) m[f1]++;
      } else {                               /* 삭제 */
        if (m[f0] > at) { m[f0]--; m[f1]--; }
        else if (m[f0] <= at && at <= m[f1]) m[f1]--;
      }
      /* 뒤집혔거나(A1:C0) 한 칸으로 쪼그라든 병합은 버린다.
         두 축을 따로 보면 안 된다 — 행이 뒤집혀도 열이 넓으면 살아남아
         엉뚱한 범위가 파일에 남는다. */
      if (m.r1 >= m.r0 && m.c1 >= m.c0 && (m.r1 > m.r0 || m.c1 > m.c0)) out.push(m);
    });
    S.merges = out;
  }

  /* ==========================================================================
   * 행 · 열 조작
   * ======================================================================== */
  function blankRow() { var r = []; for (var c = 0; c < S.cols; c++) r.push(null); return r; }

  function insRow(at) {
    S.rows.splice(at, 0, blankRow());
    shiftMerges('r', at, +1);
    touch(); render();
  }
  function delRow(at) {
    if (S.rows.length <= 1) return;
    S.rows.splice(at, 1);
    shiftMerges('r', at, -1);
    touch(); render();
  }
  function insCol(at) {
    S.rows.forEach(function (r) { r.splice(at, 0, null); });
    S.cols++;
    shiftMerges('c', at, +1);
    touch(); render();
  }
  function delCol(at) {
    if (S.cols <= 1) return;
    S.rows.forEach(function (r) { r.splice(at, 1); });
    S.cols--;
    shiftMerges('c', at, -1);
    touch(); render();
  }

  /* ==========================================================================
   * 선택
   * ======================================================================== */
  /** 선택 상자. 걸쳐 있는 병합까지 삼켜서 경계를 분명히 한다. */
  function box() {
    if (!S.a) return null;
    var b = S.b || S.a;
    var x = { r0: Math.min(S.a.r, b.r), r1: Math.max(S.a.r, b.r),
              c0: Math.min(S.a.c, b.c), c1: Math.max(S.a.c, b.c) };
    var grew = true;
    while (grew) {
      grew = false;
      S.merges.forEach(function (m) {
        if (m.r1 < x.r0 || m.r0 > x.r1 || m.c1 < x.c0 || m.c0 > x.c1) return;
        if (m.r0 < x.r0) { x.r0 = m.r0; grew = true; }
        if (m.r1 > x.r1) { x.r1 = m.r1; grew = true; }
        if (m.c0 < x.c0) { x.c0 = m.c0; grew = true; }
        if (m.c1 > x.c1) { x.c1 = m.c1; grew = true; }
      });
    }
    return x;
  }

  function doMerge() {
    var x = box();
    if (!x || (x.r0 === x.r1 && x.c0 === x.c1)) { flash('두 칸 이상 골라 주세요', 'warn'); return; }
    var keep = S.rows[x.r0][x.c0];
    /* 걸친 병합은 걷어내고 하나로 다시 만든다 */
    S.merges = S.merges.filter(function (m) {
      return m.r1 < x.r0 || m.r0 > x.r1 || m.c1 < x.c0 || m.c0 > x.c1;
    });
    for (var r = x.r0; r <= x.r1; r++) for (var c = x.c0; c <= x.c1; c++) S.rows[r][c] = null;
    S.rows[x.r0][x.c0] = keep;
    S.merges.push({ r0: x.r0, c0: x.c0, r1: x.r1, c1: x.c1 });
    touch(); render();
  }
  function doUnmerge() {
    var x = box();
    if (!x) return;
    var n = S.merges.length;
    S.merges = S.merges.filter(function (m) {
      return m.r1 < x.r0 || m.r0 > x.r1 || m.c1 < x.c0 || m.c0 > x.c1;
    });
    if (n === S.merges.length) { flash('푸를 병합이 없습니다', 'warn'); return; }
    touch(); render();
  }

  /* ==========================================================================
   * 그리기
   * ======================================================================== */
  function render() {
    var ed = canEdit(), sk = skipMap(), x = box();
    var h = '<thead><tr><th class="corner"></th>';
    for (var c = 0; c < S.cols; c++) {
      h += '<th class="ch' + (x && c >= x.c0 && c <= x.c1 ? ' insel' : '') +
        '" data-c="' + c + '">' + colName(c) + '</th>';
    }
    h += '</tr></thead><tbody>';

    for (var r = 0; r < S.rows.length; r++) {
      h += '<tr><th class="rh' + (x && r >= x.r0 && r <= x.r1 ? ' insel' : '') +
        '" data-r="' + r + '">' + (r + 1) + '</th>';
      for (var c2 = 0; c2 < S.cols; c2++) {
        if (sk[r + ',' + c2]) continue;
        var m = mergeAt(r, c2), v = S.rows[r][c2];
        var span = '';
        if (m) {
          if (m.r1 > m.r0) span += ' rowspan="' + (m.r1 - m.r0 + 1) + '"';
          if (m.c1 > m.c0) span += ' colspan="' + (m.c1 - m.c0 + 1) + '"';
        }
        var sel = x && r >= x.r0 && r <= x.r1 && c2 >= x.c0 && c2 <= x.c1;
        h += '<td class="cel' + (isNum(v) ? ' num' : '') + (sel ? ' sel' : '') + (m ? ' mg' : '') + '"' +
          span + ' data-r="' + r + '" data-c="' + c2 + '"' +
          (ed ? ' contenteditable="true"' : '') + '>' + esc(disp(v)) + '</td>';
      }
      h += '</tr>';
    }
    $('#gAux').innerHTML = h + '</tbody>';
    bindGrid();
    renderInfo(x);
  }

  function renderInfo(x) {
    var el = $('#auxSel');
    if (!x) { el.textContent = '셀을 고르면 여기에 위치가 나옵니다'; return; }
    var one = x.r0 === x.r1 && x.c0 === x.c1;
    var v = S.rows[x.r0][x.c0];
    el.innerHTML = '<b>' + (one ? colName(x.c0) + (x.r0 + 1) : encRef(x)) + '</b>' +
      (one ? '' : ' · ' + (x.r1 - x.r0 + 1) + '행 × ' + (x.c1 - x.c0 + 1) + '열') +
      (one && v != null ? ' · ' + (isNum(v) ? '숫자' : '문자') : '');
  }

  function cellEl(r, c) { return $('#gAux td[data-r="' + r + '"][data-c="' + c + '"]'); }

  /** 병합에 가려진 칸은 건너뛰며 이동한다 */
  function move(r, c, dr, dc) {
    var m = mergeAt(r, c);
    if (m) { r = dr > 0 ? m.r1 : m.r0; c = dc > 0 ? m.c1 : m.c0; }
    for (var i = 0; i < 400; i++) {
      r += dr; c += dc;
      if (r < 0 || c < 0 || r >= S.rows.length || c >= S.cols) return null;
      var mm = mergeAt(r, c);
      if (!mm) return { r: r, c: c };
      if (mm.r0 === r && mm.c0 === c) return { r: r, c: c };
      r = dr > 0 ? mm.r1 : (dr < 0 ? mm.r0 : r);
      c = dc > 0 ? mm.c1 : (dc < 0 ? mm.c0 : c);
    }
    return null;
  }
  function focusCell(r, c) {
    var td = cellEl(r, c);
    if (!td) return;
    S.a = { r: r, c: c }; S.b = null;
    paintSel();
    td.focus();
    var sel = window.getSelection(), rg = document.createRange();
    rg.selectNodeContents(td); rg.collapse(false);
    sel.removeAllRanges(); sel.addRange(rg);
  }

  /* 값만 바뀌는 경우엔 표를 다시 그리지 않는다 — 커서가 튄다 */
  function paintSel() {
    var x = box();
    $$('#gAux .sel').forEach(function (e) { e.classList.remove('sel'); });
    $$('#gAux .insel').forEach(function (e) { e.classList.remove('insel'); });
    if (!x) { renderInfo(null); return; }
    for (var r = x.r0; r <= x.r1; r++) for (var c = x.c0; c <= x.c1; c++) {
      var td = cellEl(r, c);
      if (td) td.classList.add('sel');
    }
    $$('#gAux th.ch').forEach(function (e) { if (+e.dataset.c >= x.c0 && +e.dataset.c <= x.c1) e.classList.add('insel'); });
    $$('#gAux th.rh').forEach(function (e) { if (+e.dataset.r >= x.r0 && +e.dataset.r <= x.r1) e.classList.add('insel'); });
    renderInfo(x);
  }

  function bindGrid() {
    $$('#gAux td.cel').forEach(function (td) {
      var r = +td.dataset.r, c = +td.dataset.c;

      td.onmousedown = function (e) {
        if (e.shiftKey) { e.preventDefault(); S.b = { r: r, c: c }; paintSel(); return; }
        S.a = { r: r, c: c }; S.b = null; paintSel();
      };
      td.onfocus = function () { this.dataset.was = this.textContent; };
      td.onblur = function () {
        if (this.textContent === this.dataset.was) return;
        var v = parseVal(this.textContent);
        S.rows[r][c] = v;
        this.textContent = disp(v);
        this.classList.toggle('num', isNum(v));
        touch();
      };
      td.onkeydown = function (e) {
        var k = e.key;
        if (k === 'Enter' && !e.shiftKey) { e.preventDefault(); this.blur(); var n = move(r, c, 1, 0); if (n) focusCell(n.r, n.c); return; }
        if (k === 'Tab') { e.preventDefault(); this.blur(); var n2 = move(r, c, 0, e.shiftKey ? -1 : 1); if (n2) focusCell(n2.r, n2.c); return; }
        if (k === 'Escape') { e.preventDefault(); this.textContent = this.dataset.was; this.blur(); return; }
        if (k === 'Delete' && !this.textContent) { e.preventDefault(); clearSel(); }
      };
      td.onpaste = function (e) { onPaste(e, r, c); };
    });

    $$('#gAux th.ch').forEach(function (th) {
      var c = +th.dataset.c;
      th.onmousedown = function (e) {
        if (e.shiftKey && S.a) { S.b = { r: S.rows.length - 1, c: c }; }
        else { S.a = { r: 0, c: c }; S.b = { r: S.rows.length - 1, c: c }; }
        paintSel();
      };
    });
    $$('#gAux th.rh').forEach(function (th) {
      var r = +th.dataset.r;
      th.onmousedown = function (e) {
        if (e.shiftKey && S.a) { S.b = { r: r, c: S.cols - 1 }; }
        else { S.a = { r: r, c: 0 }; S.b = { r: r, c: S.cols - 1 }; }
        paintSel();
      };
    });
  }

  function clearSel() {
    var x = box();
    if (!x) return;
    for (var r = x.r0; r <= x.r1; r++) for (var c = x.c0; c <= x.c1; c++) {
      S.rows[r][c] = null;
      var td = cellEl(r, c);
      if (td) { td.textContent = ''; td.classList.remove('num'); }
    }
    touch();
  }

  /**
   * 엑셀에서 복사한 것을 그대로 붙인다.
   * 붙이는 자리에 표가 모자라면 늘린다 — 붙여넣기가 잘리면 그게 더 나쁘다.
   */
  function onPaste(e, r0, c0) {
    var t = (e.clipboardData || window.clipboardData).getData('text/plain');
    if (!t || (t.indexOf('\t') < 0 && t.indexOf('\n') < 0)) return;   /* 한 칸짜리는 그냥 둔다 */
    e.preventDefault();
    var lines = t.replace(/\r/g, '').replace(/\n$/, '').split('\n');
    var grid = lines.map(function (l) { return l.split('\t'); });
    var needR = r0 + grid.length, needC = c0 + Math.max.apply(null, grid.map(function (g) { return g.length; }));
    while (S.rows.length < needR) S.rows.push(blankRow());
    if (needC > S.cols) {
      var add = needC - S.cols;
      S.rows.forEach(function (row) { for (var i = 0; i < add; i++) row.push(null); });
      S.cols = needC;
    }
    grid.forEach(function (g, i) {
      g.forEach(function (v, j) { S.rows[r0 + i][c0 + j] = parseVal(v); });
    });
    S.a = { r: r0, c: c0 }; S.b = { r: needR - 1, c: needC - 1 };
    touch(); render();
    flash(grid.length + '행 × ' + (needC - c0) + '열 붙여넣었습니다');
  }

  /* ==========================================================================
   * 시트 관리
   * ======================================================================== */
  function newSheet() {
    var name = (window.prompt('새 시트 이름을 적어 주세요.', '') || '').trim();
    if (!name) return;
    if (S.list.some(function (a) { return a.name === name; })) { flash('같은 이름이 이미 있습니다', 'warn'); return; }
    var rows = [];
    for (var r = 0; r < 20; r++) { var row = []; for (var c = 0; c < 10; c++) row.push(null); rows.push(row); }
    MpAuth.rest('mp_aux', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify([{ year: YEAR, name: name, rows: rows, merges: [], updated_at: new Date().toISOString() }])
    }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error(t.slice(0, 160)); });
      return D.audit('부속 시트 추가', { ref: name });
    }).then(function () { return loadList(); })
      .then(function () { open(name); flash('시트를 만들었습니다'); })
      .catch(function (e) { flash(e.message, 'warn'); });
  }

  function renameSheet() {
    var cur = S.name;
    var name = (window.prompt('시트 이름을 바꿉니다.', cur) || '').trim();
    if (!name || name === cur) return;
    if (S.list.some(function (a) { return a.name === name; })) { flash('같은 이름이 이미 있습니다', 'warn'); return; }
    save().then(function () {
      return MpAuth.rest('mp_aux?year=eq.' + YEAR + '&name=eq.' + encodeURIComponent(cur), {
        method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ name: name })
      });
    }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error(t.slice(0, 160)); });
      return D.audit('부속 시트 이름 변경', { ref: cur, before: cur, after: name });
    }).then(function () { return loadList(); })
      .then(function () { open(name); flash('이름을 바꿨습니다'); })
      .catch(function (e) { flash(e.message, 'warn'); });
  }

  function delSheet() {
    var cur = S.name;
    var typed = window.prompt('«' + cur + '» 시트를 지웁니다. 되돌릴 수 없습니다.\n' +
                              '지우려면 시트 이름을 그대로 적어 주세요.', '');
    if (typed == null) return;
    if (typed.trim() !== cur) { flash('이름이 달라 지우지 않았습니다', 'warn'); return; }
    MpAuth.rest('mp_aux?year=eq.' + YEAR + '&name=eq.' + encodeURIComponent(cur), {
      method: 'DELETE', headers: { Prefer: 'return=minimal' }
    }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error(t.slice(0, 160)); });
      return D.audit('부속 시트 삭제', { ref: cur, before: S.rows.length + '행', after: '삭제' });
    }).then(function () { return loadList(); })
      .then(function () {
        S.name = null;
        open(S.list.length ? S.list[0].name : null);
        flash('시트를 지웠습니다');
      })
      .catch(function (e) { flash(e.message, 'warn'); });
  }

  /* ---------- 엑셀 내보내기 ---------- */
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
    var b = $('#btnAuxXlsx');
    b.disabled = true; b.textContent = '준비 중…';
    var names = S.list.map(function (a) { return a.name; });
    loadXlsx()
      .then(function () {
        return Promise.all(names.map(function (n) {
          return MpAuth.rest('mp_aux?select=name,rows,merges&year=eq.' + YEAR + '&name=eq.' + encodeURIComponent(n))
            .then(function (r) { return r.json(); }).then(function (x) { return x[0]; });
        }));
      })
      .then(function (all) {
        var wb = XLSX.utils.book_new();
        all.filter(Boolean).forEach(function (a) {
          var ws = XLSX.utils.aoa_to_sheet(a.rows || []);
          ws['!merges'] = (a.merges || []).map(function (ref) {
            var m = decRef(ref);
            return m ? { s: { r: m.r0, c: m.c0 }, e: { r: m.r1, c: m.c1 } } : null;
          }).filter(Boolean);
          /* 엑셀 시트 이름은 31자 · 일부 기호 불가 */
          var sn = String(a.name).replace(/[\\\/\?\*\[\]:]/g, '_').slice(0, 31);
          XLSX.utils.book_append_sheet(wb, ws, sn);
        });
        XLSX.writeFile(wb, '이동계획_부속시트_' + YEAR + '_' +
          new Date().toISOString().slice(2, 10).replace(/-/g, '') + '.xlsx');
        b.disabled = false; b.textContent = '엑셀 내보내기';
      })
      .catch(function (e) { flash(e.message, 'warn'); b.disabled = false; b.textContent = '엑셀 내보내기'; });
  }

  /* ==========================================================================
   * 화면
   * ======================================================================== */
  function renderShell() {
    var ed = canEdit();
    U.tabs($('#auxTabs'), S.list.map(function (a) { return { id: a.name, label: a.name }; }),
      S.name, function (n) {
        if (n === S.name) return;
        (S.dirty ? save() : Promise.resolve()).then(function () { open(n); });
      });

    $('#auxMeta').innerHTML = S.name
      ? '<b>' + esc(S.name) + '</b> · ' + S.rows.length + '행 × ' + S.cols + '열 · 병합 ' + S.merges.length + ' · 최종 저장 ' +
        esc(String(S.updatedAt || '').replace('T', ' ').slice(0, 16))
      : '시트가 없습니다';

    $$('#auxTools button[data-need="edit"]').forEach(function (b) { b.disabled = !ed || !S.name; });
    $('#btnAuxDel').classList.toggle('hide', !MpAuth.isAdmin());
    $('#btnAuxNew').disabled = !ed;
    $('#auxRo').className = ed ? 'hide' : 'note info';
    if (!ed) $('#auxRo').innerHTML = '보기 전용입니다. 부속 시트는 <b>팀장 · 경영지원팀</b>이 고칠 수 있습니다.';
  }

  function open(name) {
    $('#auxConflict').className = 'hide';
    var go = function () {
      if (!S.list.length) {
        S.name = null; S.rows = []; S.merges = []; S.cols = 0;
        $('#gAux').innerHTML = '';
        $('#auxEmpty').className = 'note info';
        $('#auxEmpty').innerHTML = '부속 시트가 없습니다.' + (canEdit() ? ' <b>새 시트</b>로 만들어 보세요.' : '');
        renderShell(); mark();
        return Promise.resolve();
      }
      $('#auxEmpty').className = 'hide';
      var pick = name && S.list.some(function (a) { return a.name === name; }) ? name : S.list[0].name;
      return loadSheet(pick).then(function () { renderShell(); render(); mark(); });
    };
    return (S.list.length ? Promise.resolve() : loadList()).then(go)
      .catch(function (e) { $('#auxEmpty').className = 'note err'; $('#auxEmpty').textContent = e.message; });
  }

  function bind() {
    if (bind.done) return;
    bind.done = true;
    var act = {
      insRowUp:  function () { var x = box(); insRow(x ? x.r0 : 0); },
      insRowDn:  function () { var x = box(); insRow(x ? x.r1 + 1 : S.rows.length); },
      delRow:    function () { var x = box(); if (!x) return; for (var r = x.r1; r >= x.r0; r--) { S.rows.splice(r, 1); shiftMerges('r', r, -1); } S.a = null; S.b = null; touch(); render(); },
      insColL:   function () { var x = box(); insCol(x ? x.c0 : 0); },
      insColR:   function () { var x = box(); insCol(x ? x.c1 + 1 : S.cols); },
      delCol:    function () { var x = box(); if (!x) return; for (var c = x.c1; c >= x.c0; c--) { S.rows.forEach(function (row) { row.splice(c, 1); }); S.cols--; shiftMerges('c', c, -1); } S.a = null; S.b = null; touch(); render(); },
      merge:     doMerge,
      unmerge:   doUnmerge,
      clear:     clearSel
    };
    $$('#auxTools button[data-act]').forEach(function (b) {
      b.onclick = function () { var f = act[this.dataset.act]; if (f) f(); };
    });
    $('#btnAuxSave').onclick = function () { clearTimeout(saveTimer); save(); };
    $('#btnAuxNew').onclick = newSheet;
    $('#btnAuxRen').onclick = renameSheet;
    $('#btnAuxDel').onclick = delSheet;
    $('#btnAuxXlsx').onclick = exportXlsx;

    /* 저장 안 된 채로 나가지 않게 */
    window.addEventListener('beforeunload', function (e) {
      if (S.dirty) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  global.MpAux = {
    S: S,
    open: function () { bind(); loadList().then(function () { return open(S.name); }); },
    flush: function () { clearTimeout(saveTimer); return S.dirty ? save() : Promise.resolve(); },
    dirty: function () { return S.dirty; }
  };
})(window);
