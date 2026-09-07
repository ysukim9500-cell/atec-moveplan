/* ============================================================================
 * mp-tpl.js — 가공본 엑셀을 «템플릿에서» 만든다
 *
 * 왜 새로 만들지 않는가.
 *   가공본에는 피벗테이블 · 숨김시트 · 인쇄영역 · 병합 · 테두리 · 표시형식이 들어 있다.
 *   SheetJS 로 새 워크북을 만들면 그 중 어느 것도 따라오지 않는다 —
 *   피벗은 사라지고 서식 없는 덤프가 남는다. 실제로 그렇게 되어 있었다.
 *
 * 그래서 원본 xlsx 를 그대로 열어 «데이터가 든 시트만» 갈아끼운다.
 *   · 손대지 않은 파트는 원본 바이트 그대로 다시 담는다.
 *     피벗 · 서식 · 인쇄설정은 우리가 건드리지 않으므로 깨질 수가 없다.
 *   · 피벗 캐시는 refreshOnLoad 를 켜 둔다. 파일을 열 때 엑셀이 스스로 새로 집계한다.
 *     우리가 캐시 레코드를 흉내 내 쓰는 것보다 이쪽이 안전하다.
 *
 * 문자열은 sharedStrings 를 쓰지 않고 인라인(t="inlineStr")으로 넣는다.
 * 공유 문자열 표를 다시 쓰면 손대지 않은 시트의 인덱스가 어긋난다.
 * ========================================================================== */
(function (global) {
  'use strict';

  /* 서식 파일에는 실제 경영 데이터가 들어 있다. 공개 저장소에 두면 그대로 열리므로
     로그인한 사람만 받을 수 있는 곳(Supabase Storage)에 둔다. */
  var BUCKET = 'tpl';
  var CACHE = {};

  function loadZip(name) {
    if (CACHE[name]) return Promise.resolve(CACHE[name]);
    return MpAuth.storage('object/' + BUCKET + '/' + name + '.xlsx')
      .then(function (r) {
        if (!r.ok) throw new Error('가공본 서식 파일을 불러오지 못했습니다 (' + name + '.xlsx · ' + r.status +
          '). 설정 · 데이터 관리에서 서식 파일을 올려 주세요.');
        return r.arrayBuffer();
      })
      .then(function (buf) {
        var z = fflate.unzipSync(new Uint8Array(buf));
        CACHE[name] = z;
        return z;
      });
  }

  /* 원본을 건드리지 않도록 얕은 복사본에 작업한다 */
  function copyOf(z) {
    var o = {};
    Object.keys(z).forEach(function (k) { o[k] = z[k]; });
    return o;
  }

  var dec = new TextDecoder('utf-8');
  var enc = new TextEncoder();
  function txt(u8) { return dec.decode(u8); }
  function bin(s) { return enc.encode(s); }

  function esc(v) {
    return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      /* 엑셀이 못 읽는 제어문자는 버린다 — 있으면 «복구 필요» 경고가 뜬다 */
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  }

  /** 0 → A, 25 → Z, 26 → AA */
  function colName(i) {
    var s = '';
    for (i = i + 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s;
    return s;
  }
  function colIdx(a) {
    var n = 0;
    for (var i = 0; i < a.length; i++) n = n * 26 + (a.charCodeAt(i) - 64);
    return n - 1;
  }

  /* ---------- 워크북에서 시트 파일 경로 찾기 ---------- */
  function sheetPaths(z) {
    var wb = txt(z['xl/workbook.xml']);
    var rels = txt(z['xl/_rels/workbook.xml.rels']);
    var byId = {};
    rels.replace(/<Relationship\b([^>]*)>/g, function (_, a) {
      var id = /Id="([^"]*)"/.exec(a), tg = /Target="([^"]*)"/.exec(a);
      if (id && tg) byId[id[1]] = tg[1].replace(/^\/?xl\//, '').replace(/^\//, '');
    });
    var out = [];
    wb.replace(/<sheet\b([^>]*?)\/?>/g, function (_, a) {
      var nm = /name="([^"]*)"/.exec(a), rid = /r:id="([^"]*)"/.exec(a);
      var st = /state="([^"]*)"/.exec(a);
      out.push({ name: nm ? nm[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') : '',
                 path: rid && byId[rid[1]] ? 'xl/' + byId[rid[1]] : null,
                 state: st ? st[1] : 'visible' });
    });
    return out;
  }
  function pathOf(z, sheetName) {
    var s = sheetPaths(z).filter(function (x) { return x.name === sheetName; })[0];
    if (!s || !s.path || !z[s.path]) throw new Error('템플릿에 시트가 없습니다 : ' + sheetName);
    return s.path;
  }

  /* ---------- 시트 XML 만들기 ----------
     템플릿 시트의 «머리»(cols · sheetPr · sheetFormatPr · autoFilter · pageSetup …)는
     그대로 두고 sheetData 만 갈아끼운다. 그래야 열 너비 · 필터 · 인쇄영역이 남는다. */
  function styleMap(sheetXml) {
    /* 1행(머리글)과 2행(첫 데이터)의 열별 s= 를 기억해 두었다가 새 행에 그대로 물린다.
       표시형식 · 테두리 · 정렬이 여기에 붙어 있다. */
    var head = {}, body = {};
    var r1 = /<row r="1"[^>]*>([\s\S]*?)<\/row>/.exec(sheetXml);
    var r2 = /<row r="2"[^>]*>([\s\S]*?)<\/row>/.exec(sheetXml);
    var grab = function (blk, into) {
      if (!blk) return;
      blk.replace(/<c r="([A-Z]+)\d+"([^>]*)>/g, function (_, col, attr) {
        var s = /\bs="(\d+)"/.exec(attr);
        into[colIdx(col)] = s ? +s[1] : null;
      });
    };
    grab(r1 && r1[1], head); grab(r2 && r2[1], body);
    return { head: head, body: body };
  }

  function cellXml(ref, v, s) {
    var sa = (s == null ? '' : ' s="' + s + '"');
    if (v == null || v === '') return '<c r="' + ref + '"' + sa + '/>';
    if (typeof v === 'number' && isFinite(v)) return '<c r="' + ref + '"' + sa + '><v>' + v + '</v></c>';
    return '<c r="' + ref + '"' + sa + ' t="inlineStr"><is><t xml:space="preserve">' + esc(v) + '</t></is></c>';
  }

  /**
   * aoa 를 시트 XML 로 바꾼다.
   * @param cur   템플릿의 그 시트 XML (머리 · 스타일을 물려받는다)
   * @param aoa   [[값,…],…]  1행은 머리글
   * @param opt   {at:'A1'} 시작 셀. 기본 A1
   */
  function putSheet(cur, aoa, opt) {
    opt = opt || {};
    var sm = styleMap(cur);
    var at = opt.at || 'A1';
    var m = /^([A-Z]+)(\d+)$/.exec(at);
    var c0 = colIdx(m[1]), r0 = +m[2];

    var rows = [], maxC = 0;
    aoa.forEach(function (row, ri) {
      var rn = r0 + ri, cells = '';
      (row || []).forEach(function (v, ci) {
        if (v == null || v === '') return;
        var ref = colName(c0 + ci) + rn;
        var st = (ri === 0 && opt.head !== false) ? sm.head[c0 + ci] : sm.body[c0 + ci];
        cells += cellXml(ref, v, st == null ? undefined : st);
        if (c0 + ci > maxC) maxC = c0 + ci;
      });
      rows.push('<row r="' + rn + '">' + cells + '</row>');
    });

    var dim = at + ':' + colName(Math.max(maxC, c0)) + (r0 + Math.max(aoa.length, 1) - 1);
    var out = cur;
    /* dimension 은 힌트일 뿐이지만 맞춰 두면 엑셀이 범위를 바로 잡는다 */
    out = out.replace(/<dimension ref="[^"]*"\/>/, '<dimension ref="' + dim + '"/>');
    /* sheetData 통째 교체 */
    if (/<sheetData\s*\/>/.test(out)) out = out.replace(/<sheetData\s*\/>/, '<sheetData>' + rows.join('') + '</sheetData>');
    else out = out.replace(/<sheetData>[\s\S]*?<\/sheetData>/, '<sheetData>' + rows.join('') + '</sheetData>');
    /* 자동필터도 새 범위로 — 옛 범위가 남으면 필터가 데이터를 덜 잡는다 */
    out = out.replace(/<autoFilter ref="[^"]*"\/>/, '<autoFilter ref="' + dim + '"/>');
    return out;
  }

  /** 이미 있는 셀의 값만 바꾼다 (서식 · 수식 손대지 않음). {'C7':123, …} */
  function patchCells(cur, map) {
    Object.keys(map).forEach(function (ref) {
      var v = map[ref];
      var re = new RegExp('<c r="' + ref + '"([^>]*?)(\\/>|>[\\s\\S]*?<\\/c>)');
      var hit = re.exec(cur);
      var attr = hit ? hit[1] : '';
      /* 수식이 있던 칸은 건드리지 않는다 — 템플릿의 계산을 살려 둔다 */
      if (hit && /<f[ >]/.test(hit[0])) return;
      var s = /\bs="(\d+)"/.exec(attr);
      var cell = cellXml(ref, v, s ? +s[1] : undefined);
      if (hit) cur = cur.replace(re, cell);
      else {
        /* 없던 칸이면 그 행에 끼워 넣는다 */
        var rn = /\d+$/.exec(ref)[0];
        var rowRe = new RegExp('(<row r="' + rn + '"[^>]*>)([\\s\\S]*?)(<\\/row>)');
        if (rowRe.test(cur)) cur = cur.replace(rowRe, function (_, a, b, c) { return a + b + cell + c; });
      }
    });
    return cur;
  }

  /* ---------- 피벗 ----------
     원본 범위를 이번 달 데이터에 맞추고, 열 때 다시 집계하도록 표시해 둔다.
     캐시 레코드를 우리가 다시 쓰지는 않는다 — 틀리면 조용히 잘못된 합계가 나온다. */
  function refreshPivots(z, srcSheet, lastRow, lastCol) {
    Object.keys(z).forEach(function (p) {
      if (!/^xl\/pivotCache\/pivotCacheDefinition\d+\.xml$/.test(p)) return;
      var s = txt(z[p]);
      s = s.replace(/<worksheetSource([^>]*)\/>/, function (_, a) {
        var b = a.replace(/ref="[^"]*"/, 'ref="A1:' + lastCol + Math.max(lastRow, 2) + '"');
        if (!/sheet="/.test(b)) b += ' sheet="' + srcSheet + '"';
        else b = b.replace(/sheet="[^"]*"/, 'sheet="' + srcSheet + '"');
        return '<worksheetSource' + b + '/>';
      });
      s = s.replace(/<pivotCacheDefinition([^>]*)>/, function (_, a) {
        var b = a.replace(/\srefreshOnLoad="[^"]*"/, '');
        return '<pivotCacheDefinition' + b + ' refreshOnLoad="1">';
      });
      z[p] = bin(s);
    });
  }

  /* ---------- 쓰기 ---------- */
  function build(z, name) {
    /* 저장(STORE)이 아니라 압축으로 담는다. 원본과 같은 방식이라 엑셀이 그대로 읽는다. */
    var out = fflate.zipSync(z, { level: 6, mtime: new Date() });
    var blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    return out.length;
  }

  global.MpTpl = {
    load: loadZip, copy: copyOf, txt: txt, bin: bin,
    sheetPaths: sheetPaths, pathOf: pathOf,
    putSheet: putSheet, patchCells: patchCells,
    refreshPivots: refreshPivots, colName: colName, colIdx: colIdx,
    build: build
  };
})(window);
