/* ============================================================================
 * mp-sga.js — 판관비 적요 정규화 · 대사 엔진
 *
 * v20 포털(ATEC_이동계획_ERP실적_포털_v20.html)의 로직을 그대로 옮겨 왔다.
 * 화면에서 떼어 낸 이유는 하나다 — 이 부분은 눈으로 보고 고칠 수 없고
 * 표로 검증해야 하기 때문이다.
 *
 * 핵심 원칙 (v20 문구 그대로)
 *   "월·일자만 다른 적요는 자동으로 같은 항목으로 묶습니다.
 *    같은 항목이라고 확신할 수 없는 적요는 확정할 때까지
 *    신규/당월없음으로 임의 처리하거나 자동 병합하지 않습니다."
 *
 * 그래서 결과는 네 갈래다 — 기존 · 신규 · 당월없음 · **확인 필요**.
 * 확인 필요를 없애려고 아무 쪽으로 밀어 넣지 않는다. 사람이 정한다.
 *
 * 그리고 모든 그룹에서 원본 총액 = 분석 반영 총액이어야 한다.
 * 1원이라도 어긋나면 검산 부적합으로 세우고 완료 처리하지 않는다.
 * ========================================================================== */
(function (global) {
  'use strict';

  /* 같은 조직인데 표기가 다른 것들 — 매칭 키를 만들 때만 대표 표기로 바꾼다.
     화면에 보이는 라벨은 원문 그대로 둔다. */
  var FORCED_RENAMES = [['광역버스사업팀', '광역교통지원팀']];
  var TEAM_ALIASES = [['고객지원실', '고객지원사업부'], ['AFC지원센터', 'AFC지원파트'],
                      ['광역버스사업팀', '광역교통지원팀'], ['택시지원팀', '택시지원파트']];
  var SYNONYMS = [[['법인렌트카', '법인 렌트카', '법인렌터카', '렌트카'], '법인차량']];

  /**
   * 적요 정규화.
   * 월·일자·인원수처럼 «달마다 달라지는 것»만 지운다.
   * 무엇을 샀는지는 건드리지 않는다.
   */
  function normalizeDesc(s) {
    var d = String(s == null ? '' : s).trim();
    FORCED_RENAMES.forEach(function (p) { d = d.split(p[0]).join(p[1]); });
    d = d.replace(/^[,\s]+/, '');
    d = d.replace(/(\d{1,2})\s*,\s*\/\s*(\d{1,2})/g, '$1/$2');      /* "6,/25" → "6/25" */
    d = d.replace(/\d{4}\s*년\s*\d{1,2}\s*월/g, '@월@');
    d = d.replace(/\d{1,2}\s*월/g, '@월@');
    d = d.replace(/\d{1,2}\/\d{1,2}\s*~\s*\d{1,2}\/\d{1,2}/g, '@일자@');
    d = d.replace(/\d{1,2}\/\d{1,2}/g, '@일자@');
    d = d.replace(/@일자@\s*\d{1,2}(?![\d가-힣A-Za-z])/g, '@일자@');
    d = d.replace(/@일자@(\s*[,·]?\s*@일자@)+/g, '@일자@');
    d = d.replace(/@월@(\s*[,·]?\s*@월@)+/g, '@월@');
    d = d.replace(/\(\d+\s*명\)/g, '');                              /* (16명) 은 식별정보가 아니다 */
    d = d.replace(/\(([^)]*)\)/g, function (m, inner) {               /* 괄호 안 나열 순서 차이 제거 */
      var parts = inner.split(',').map(function (x) { return x.trim(); }).filter(Boolean).sort();
      return parts.length ? '(' + parts.join(',') + ')' : '';
    });
    var ph = [];
    d = d.replace(/\([^)]*\)/g, function (m) { ph.push(m); return '\u0001' + (ph.length - 1) + '\u0001'; });
    d = d.replace(/(\d{1,2})\s*,\s*\/\s*(\d{1,2})/g, '$1/$2');
    d = d.split(',').map(function (x) { return x.trim(); }).filter(function (seg) {
      if (seg === '') return false;
      if (/^\d{1,2}\/\d{1,2}$/.test(seg)) return false;               /* "6/10" 같은 작성일자 조각 */
      if (/^\/?\d{1,2}$/.test(seg)) return false;
      return true;
    }).join(',');
    d = d.replace(/\u0001(\d+)\u0001/g, function (m, i) { return ph[Number(i)]; });
    d = d.replace(/\s+/g, ' ').replace(/^[\d,\s]+(?=[가-힣A-Za-z(])/, '')
         .replace(/^,+|,+$/g, '').replace(/,+/g, ',').trim();
    return d;
  }
  function normDesc(v) { var d = normalizeDesc(v); return d || String(v || ''); }

  function parenTokens(s) {
    var out = [], re = /\(([^)]+)\)/g, m;
    while ((m = re.exec(String(s || '')))) out.push(m[1]);
    return out;
  }
  function canonTeams(s) {
    var d = String(s || '');
    TEAM_ALIASES.forEach(function (g) {
      var canon = g[g.length - 1];
      g.forEach(function (a) { if (a !== canon) d = d.split(a).join(canon); });
    });
    return d;
  }
  function applySyn(s) {
    var d = String(s || '');
    SYNONYMS.forEach(function (p) { p[0].forEach(function (f) { d = d.split(f).join(p[1]); }); });
    return d;
  }
  /** 매칭 키 — 공백·대소문자 차이를 무시한다 */
  function matchKeyOf(s) {
    return applySyn(canonTeams(normalizeDesc(s))).replace(/\s+/g, '').toLowerCase();
  }

  /* 문자 bigram 자카드 — 자동 매칭이 아니라 «확인 필요» 후보 판정에만 쓴다 */
  function bigrams(s) {
    var t = String(s || '').replace(/\s+/g, '').toLowerCase(), out = {};
    for (var i = 0; i < t.length - 1; i++) out[t.slice(i, i + 2)] = 1;
    if (t.length === 1) out[t] = 1;
    return out;
  }
  function similarity(a, b) {
    var A = bigrams(applySyn(a)), B = bigrams(applySyn(b));
    var ka = Object.keys(A), kb = Object.keys(B);
    if (!ka.length || !kb.length) return 0;
    var inter = 0;
    ka.forEach(function (x) { if (B[x]) inter++; });
    return inter / (ka.length + kb.length - inter);
  }

  /** 화면에 보일 적요 — 자리표시자를 걷어낸다 */
  function prettyDesc(norm, raw) {
    var d = String(norm || '').replace(/@월@/g, ' ').replace(/@일자@/g, ' ');
    d = d.replace(/\s{2,}/g, ' ').replace(/^[\s,·\-:/]+/, '').replace(/[\s,·\-:/]+$/, '').trim();
    if (d) return d;
    d = String(raw || '').replace(/\s{2,}/g, ' ').trim();
    return d || '(적요 없음)';
  }
  /** 비슷한 적요 묶기 — 구분자 앞부분을 카테고리로 */
  function descCat(v) {
    var s = String(v || ''), i = s.search(/[-(（\[:]/);
    return (i > 0 ? s.slice(0, i) : s).trim() || s;
  }
  /** 여러 계정이 섞이면 «가장 큰 것 외 N» */
  function acctLabel(o) {
    if (!o) return '';
    var k = Object.keys(o);
    if (!k.length) return '';
    k.sort(function (a, b) { return Math.abs(o[b]) - Math.abs(o[a]); });
    return k.length > 1 ? k[0] + ' 외 ' + (k.length - 1) : k[0];
  }

  /* ==========================================================================
   * 대사
   * ======================================================================== */

  /**
   * 한 그룹(팀 × 비목)의 전월 ↔ 당월을 맞춘다.
   *
   * decide(side) 는 사람이 이미 확정한 결정을 돌려준다 — {mode:'merge'|'keep', to}
   * 그 결정이 먼저고, 남은 것 중 «비슷한데 확신할 수 없는» 것만 review 로 세운다.
   */
  function reconcileGroup(team, cat, curC, prvC, hasPrev, decide) {
    var cd = (curC && curC.desc) || {}, pd = hasPrev ? ((prvC && prvC.desc) || {}) : {};
    var matched = [], ended = [], newItems = [], review = [], onlyPrev = [], onlyCurr = [], keys = {};
    decide = decide || function () { return null; };

    function ent(map, k) {
      var o = map[k];
      return { key: k, nd: o.nd || o.raw, raw: o.raw, amount: o.amt, account: acctLabel(o.acct), acct: o.acct };
    }
    Object.keys(pd).forEach(function (k) { keys[k] = 1; });
    Object.keys(cd).forEach(function (k) { keys[k] = 1; });
    Object.keys(keys).forEach(function (k) {
      var inP = Object.prototype.hasOwnProperty.call(pd, k);
      var inC = Object.prototype.hasOwnProperty.call(cd, k);
      if (inP && inC) matched.push({ key: k, nd: (cd[k].nd || pd[k].nd), raw: (cd[k].raw || pd[k].raw),
        account: acctLabel(cd[k].acct) || acctLabel(pd[k].acct), acct: cd[k].acct,
        prev: pd[k].amt, curr: cd[k].amt });
      else if (inP) onlyPrev.push(ent(pd, k));
      else onlyCurr.push(ent(cd, k));
    });

    var claimedPrev = {}, claimedCurr = {}, cIdx = {};
    onlyCurr.forEach(function (x, j) { cIdx[x.key] = j; });

    /* ① 사람이 이미 확정한 결정을 먼저 적용한다 (다음 달에도 그대로 쓰인다) */
    onlyPrev.forEach(function (lp, i) {
      var rec = decide(lp.key);
      if (!rec) return;
      if (rec.mode === 'merge') {
        var j = (rec.to != null) ? cIdx[rec.to] : undefined;
        if (j === undefined || claimedCurr[j]) return;      /* 상대가 당월에 없다 → 아래서 다시 묻는다 */
        var lc = onlyCurr[j];
        claimedPrev[i] = 1; claimedCurr[j] = 1;
        matched.push({ key: lc.key, nd: lc.nd, raw: lc.raw, account: lp.account || lc.account,
                       acct: lc.acct, prev: lp.amount, curr: lc.amount, merged: [lp.nd] });
        return;
      }
      if (rec.mode === 'keep') {
        claimedPrev[i] = 1;
        ended.push(lp);
        if (rec.to != null && cIdx[rec.to] !== undefined && !claimedCurr[cIdx[rec.to]]) {
          var j2 = cIdx[rec.to];
          claimedCurr[j2] = 1;
          newItems.push(onlyCurr[j2]);
        }
      }
    });
    onlyCurr.forEach(function (lc, j) {
      if (claimedCurr[j]) return;
      var rec = decide('CURR:' + lc.key);
      if (rec && rec.mode === 'keep') { claimedCurr[j] = 1; newItems.push(lc); }
    });

    /* ② 남은 것 중 «비슷한» 짝을 확인 필요로 세운다. 자동으로 합치지 않는다. */
    function isCandidate(lp, lc) {
      if (lc.nd.indexOf(lp.nd) === 0 || lp.nd.indexOf(lc.nd) === 0) return true;
      var pt1 = parenTokens(lp.nd), pt2 = parenTokens(lc.nd);
      if (pt1.length && pt1.some(function (t) { return pt2.indexOf(t) >= 0; })) return true;
      return similarity(lp.nd, lc.nd) >= 0.5;
    }
    function conflictOf(lp) {
      var rec = decide(lp.key);
      return !!(rec && rec.mode === 'merge');                /* 확정한 상대가 당월에 없다 */
    }
    onlyPrev.forEach(function (lp, i) {
      if (claimedPrev[i]) return;
      var cands = [];
      onlyCurr.forEach(function (lc, j) { if (!claimedCurr[j] && isCandidate(lp, lc)) cands.push({ lc: lc, j: j }); });
      if (!cands.length) return;
      var mk = function (x) {
        return { key: x.lc.key, nd: x.lc.nd, raw: x.lc.raw, amount: x.lc.amount, s: similarity(lp.nd, x.lc.nd) };
      };
      if (cands.length === 1) {
        claimedPrev[i] = 1; claimedCurr[cands[0].j] = 1;
        review.push({ team: team, cat: cat, account: lp.account, acct: lp.acct,
          prevKey: lp.key, currKey: cands[0].lc.key, prevDesc: lp.nd, currDesc: cands[0].lc.nd,
          prevRaw: lp.raw, currRaw: cands[0].lc.raw, prev: lp.amount, curr: cands[0].lc.amount,
          cands: [mk(cands[0])], conflict: conflictOf(lp), note: '적요 유사 — 확인 필요' });
      } else {
        claimedPrev[i] = 1;
        review.push({ team: team, cat: cat, account: lp.account, acct: lp.acct,
          prevKey: lp.key, currKey: null, prevDesc: lp.nd, currDesc: null, prevRaw: lp.raw,
          prev: lp.amount, curr: null,
          cands: cands.map(mk).sort(function (a, b) { return b.s - a.s; }),
          conflict: conflictOf(lp), note: '유사 후보 다수 — 확인 필요' });
      }
    });
    onlyCurr.forEach(function (lc, j) {
      if (claimedCurr[j]) return;
      var amb = onlyPrev.some(function (lp, i) { return !claimedPrev[i] && isCandidate(lp, lc); });
      if (!amb) return;
      claimedCurr[j] = 1;
      review.push({ team: team, cat: cat, account: lc.account, acct: lc.acct,
        prevKey: null, currKey: lc.key, prevDesc: null, currDesc: lc.nd, currRaw: lc.raw,
        prev: null, curr: lc.amount, cands: [], conflict: false, note: '유사 후보 다수 — 확인 필요' });
    });

    onlyPrev.forEach(function (lp, i) { if (!claimedPrev[i]) ended.push(lp); });
    onlyCurr.forEach(function (lc, j) { if (!claimedCurr[j]) newItems.push(lc); });

    /* ③ 검산 — 원본 총액과 분석 반영액이 1원이라도 다르면 부적합 */
    function sum(a) { var s = 0; a.forEach(function (x) { s += x; }); return s; }
    var prevRaw = sum(Object.keys(pd).map(function (k) { return pd[k].amt; }));
    var currRaw = sum(Object.keys(cd).map(function (k) { return cd[k].amt; }));
    var prevAcc = sum(matched.map(function (x) { return x.prev; })) +
                  sum(ended.map(function (x) { return x.amount; })) +
                  sum(review.map(function (x) { return x.prev || 0; }));
    var currAcc = sum(matched.map(function (x) { return x.curr; })) +
                  sum(newItems.map(function (x) { return x.amount; })) +
                  sum(review.map(function (x) { return x.curr || 0; }));

    return {
      matched: matched, ended: ended, newItems: newItems, review: review,
      validation: { prevRaw: prevRaw, currRaw: currRaw, prevAcc: prevAcc, currAcc: currAcc,
                    ok: (Math.abs(prevRaw - prevAcc) < 1 && Math.abs(currRaw - currAcc) < 1) }
    };
  }

  /** 대사 결과를 «표에 뿌릴 줄»로 편다 */
  function itemsOf(rc, hasPrev) {
    var out = [];
    rc.matched.forEach(function (x) {
      out.push({ desc: x.nd, raw: x.raw, acct: x.acct, p: x.prev, c: x.curr,
                 v: x.curr - x.prev, merged: !!x.merged });
    });
    rc.newItems.forEach(function (x) {
      out.push({ desc: x.nd, raw: x.raw, acct: x.acct, p: 0, c: x.amount, v: x.amount, neu: hasPrev });
    });
    rc.ended.forEach(function (x) {
      out.push({ desc: x.nd, raw: x.raw, acct: x.acct, p: x.amount, c: 0, v: -x.amount, gone: hasPrev });
    });
    rc.review.forEach(function (x) {
      out.push({ desc: x.currDesc || x.prevDesc, raw: x.currRaw || x.prevRaw, acct: x.acct,
                 p: x.prev || 0, c: x.curr || 0, v: (x.curr || 0) - (x.prev || 0),
                 pend: true, note: x.note,
                 prevDesc: x.prevDesc, currDesc: x.currDesc, prevRaw: x.prevRaw, currRaw: x.currRaw });
    });
    out.sort(function (a, b) {
      if (a.pend !== b.pend) return a.pend ? -1 : 1;      /* 확인 필요를 맨 위로 */
      return Math.abs(b.v) - Math.abs(a.v);
    });
    return out;
  }

  /**
   * 세부 변동 표시기준(만원) 필터.
   * 화면에 보일 상세만 걸러낸다 — 합계와 검산에는 쓰지 않는다.
   * 확인 필요 항목은 기준과 무관하게 항상 보인다.
   */
  function filterItems(items, hasPrev, thMan) {
    var th = (thMan || 0) * 1e4;                            /* 만원 → 원 */
    var rows = [], hidN = 0, hidSum = 0;
    items.forEach(function (r) {
      var keep;
      if (!hasPrev) keep = Math.abs(r.c) > 0;
      else if (r.pend) keep = true;
      else if (th > 0) keep = Math.abs(r.v) >= th;
      else keep = Math.abs(r.v) >= 1;
      if (keep) rows.push(r); else { hidN++; hidSum += (hasPrev ? r.v : r.c); }
    });
    return { rows: rows, hidN: hidN, hidSum: hidSum };
  }

  global.MpSga = {
    normalizeDesc: normalizeDesc, normDesc: normDesc, matchKeyOf: matchKeyOf,
    similarity: similarity, parenTokens: parenTokens,
    prettyDesc: prettyDesc, descCat: descCat, acctLabel: acctLabel,
    reconcileGroup: reconcileGroup, itemsOf: itemsOf, filterItems: filterItems
  };
})(window);
