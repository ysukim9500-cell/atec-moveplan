/* ============================================================================
 * mp-calc.js — 파생 계산
 *
 * 저장하는 값은 리프뿐이다. 아래는 전부 여기서 만든다.
 *   합계 = Σ 하위 항목
 *   매출이익 항목 = 매출 − 매출원가   (개발비만 입력값)
 *   영업이익 = 매출이익 합계 − 판관비 합계
 *   공판후영업이익 = 영업이익 − 공판
 *   사업부합계 = Σ 6팀
 *   누적계획 = Σ 월간계획(1..m) · 누적실적 = Σ 최종OL(1..m)
 *
 * 저장하면 반드시 어긋난다. 계산이 유일한 진실이다.
 * ========================================================================== */
(function (global) {
  'use strict';

  var D = global.MpData;
  var CACHE = {};
  function bust() { CACHE = {}; }

  function r4(v) { return Math.round(v * 10000) / 10000; }

  /**
   * 그 달 그 팀의 최종 OL 주차.
   *
   * 확정된 달의 final_k 는 «여기까지만 인정한다»는 상한이지, 모든 팀이 그 주차를
   * 썼다는 뜻이 아니다. 상한을 그대로 돌려주면 일찍 끝낸 팀은 그 주차가 비어 있어
   * 값이 통째로 사라진다. 그래서 상한 안에서 그 팀이 마지막으로 쓴 주차를 찾는다.
   */
  function finalK(m, team) {
    var p = D.periodOf(m);
    var ck = 'FK|' + m + '|' + team;
    if (ck in CACHE) return CACHE[ck];
    var nW = D.weeksOf(m);
    var cap = (p.final_k != null) ? Math.min(p.final_k, nW - 1) : nW - 1;
    var idx = -1;
    for (var k = 0; k <= cap; k++) {
      if (V(m, team, '매출', '합계', k) != null ||
          V(m, team, '판관비', '합계', k) != null ||
          V(m, team, '매출원가', '합계', k) != null) idx = k;
    }
    CACHE[ck] = idx;
    return idx;
  }

  /** 그 달에 «누군가 마지막으로 쓴» 주차. 월을 확정할 때 상한으로 쓴다. */
  function lastFilledK(m) {
    var idx = -1;
    D.TEAMS.forEach(function (t) { var k = finalK(m, t); if (k > idx) idx = k; });
    return idx;
  }

  /** 기입된 주차 목록 */
  function filledWeeks(m, team) {
    var out = [], n = D.weeksOf(m);
    for (var k = 0; k < n; k++) {
      if (V(m, team, '매출', '합계', k) != null || V(m, team, '판관비', '합계', k) != null) out.push(k);
    }
    return out;
  }

  /** k 보다 앞선 마지막 기입 주차. 없으면 -1 */
  function prevWeek(m, team, k) {
    var f = filledWeeks(m, team), idx = -1;
    f.forEach(function (x) { if (x < k) idx = x; });
    return idx;
  }

  function isLeaf(sec, item) {
    var l = D.LEAF[sec];
    return !!l && l.indexOf(item) >= 0;
  }

  function raw(m, team, sec, item, k) {
    return k == null ? D.planVal(m, team, sec, item) : D.weekVal(m, team, sec, item, k);
  }

  function sumItems(m, team, sec, k) {
    var any = false, s = 0;
    (D.ITEMS[sec] || []).forEach(function (it) {
      var v = V(m, team, sec, it, k);
      if (v != null) { s += v; any = true; }
    });
    return any ? r4(s) : null;
  }

  function calc(m, team, sec, item, k) {
    if (team === D.TOTAL) {
      var any = false, s = 0;
      D.TEAMS.forEach(function (t) {
        var v = V(m, t, sec, item, k);
        if (v != null) { s += v; any = true; }
      });
      return any ? r4(s) : null;
    }
    if (sec === '매출' || sec === '매출원가' || sec === '판관비') {
      return item === '합계' ? sumItems(m, team, sec, k) : raw(m, team, sec, item, k);
    }
    if (sec === '매출이익') {
      if (item === '합계') return sumItems(m, team, '매출이익', k);
      if (item === '개발비') return raw(m, team, '매출이익', '개발비', k);
      var a = V(m, team, '매출', item, k), b = V(m, team, '매출원가', item, k);
      if (a == null && b == null) return null;
      return r4((a || 0) - (b || 0));
    }
    if (sec === '영업이익') {
      var g = V(m, team, '매출이익', '합계', k), p = V(m, team, '판관비', '합계', k);
      return (g == null && p == null) ? null : r4((g || 0) - (p || 0));
    }
    /* 공판 = 매출 × 공판율. 저장된 값을 읽지 않는다 —
       계획·OL 과 확정 실적이 서로 다른 정의를 쓰면 «차이» 열이 무의미해진다.
       공판율을 바꾸면 계획·OL·실적이 함께 움직여야 한다. */
    if (sec === '공판') {
      var rv = V(m, team, '매출', '합계', k);
      return rv == null ? null : r4(rv * D.gpRate());
    }
    if (sec === '공판후영업이익') {
      var o = V(m, team, '영업이익', '계', k), gp = V(m, team, '공판', '계', k);
      return (o == null && gp == null) ? null : r4((o || 0) - (gp || 0));
    }
    return null;
  }

  /** 값 조회. k=null 이면 월간계획, k=0.. 이면 그 주차 */
  function V(m, team, sec, item, k) {
    var ck = m + '|' + team + '|' + sec + '|' + item + '|' + k;
    if (ck in CACHE) return CACHE[ck];
    var v = calc(m, team, sec, item, k);
    CACHE[ck] = v;
    return v;
  }

  function PL(m, team, sec, item) { return V(m, team, sec, item, null); }
  /**
   * 최종 OL.
   *
   * 사업부합계는 한 주차에서 6팀을 더하면 안 된다. 팀마다 마지막 주차가 다르므로
   * 그 주차를 안 쓴 팀이 통째로 빠져 «사업부합계 ≠ 6팀 합» 이 된다.
   * 각 팀의 최종 OL 을 더한다.
   */
  function OL(m, team, sec, item) {
    if (team === D.TOTAL) {
      var ck = 'OLT|' + m + '|' + sec + '|' + item;
      if (ck in CACHE) return CACHE[ck];
      var any = false, s = 0;
      D.TEAMS.forEach(function (t) {
        var v = OL(m, t, sec, item);
        if (v != null) { s += v; any = true; }
      });
      CACHE[ck] = any ? r4(s) : null;
      return CACHE[ck];
    }
    var k = finalK(m, team);
    return k < 0 ? null : V(m, team, sec, item, k);
  }

  /** 누적 — 그 해 1월부터 m 까지 */
  function cum(m, team, sec, item, useOL) {
    var ck = 'C|' + (useOL ? 'o' : 'p') + '|' + m + '|' + team + '|' + sec + '|' + item;
    if (ck in CACHE) return CACHE[ck];
    var any = false, s = 0, y0 = D.yOf(m) * 12;
    for (var i = y0; i <= m; i++) {
      var v = useOL ? OL(i, team, sec, item) : PL(i, team, sec, item);
      if (v != null) { s += v; any = true; }
    }
    var r = any ? r4(s) : null;
    CACHE[ck] = r;
    return r;
  }

  /** 지표 묶음. mode: 'plan' | 'ol' */
  function metrics(m, team, mode) {
    var f = mode === 'plan' ? PL : OL;
    return {
      rev: f(m, team, '매출', '합계'),
      cost: f(m, team, '매출원가', '합계'),
      gp: f(m, team, '매출이익', '합계'),
      sga: f(m, team, '판관비', '합계'),
      op: f(m, team, '영업이익', '계'),
      gongpan: f(m, team, '공판', '계'),
      op2: f(m, team, '공판후영업이익', '계')
    };
  }

  function sumMetrics(ms, team, mode) {
    var o = { rev: 0, cost: 0, gp: 0, sga: 0, op: 0, gongpan: 0, op2: 0 }, any = false;
    ms.forEach(function (m) {
      var x = metrics(m, team, mode);
      Object.keys(o).forEach(function (k) { if (x[k] != null) { o[k] += x[k]; any = true; } });
    });
    return any ? o : null;
  }

  /**
   * 확정 실적. ERP 가 올라온 달만 값이 있다.
   * 개발비는 연구소에 지급하는 고정비라 ERP 에 계상되지 않는다.
   * 그래서 확정 매출이익에도 OL 개발비를 그대로 더한다. (임시 규칙 — 원천 미확정)
   */
  function act(m, team) {
    var ag = D.erpAgg(m);
    if (!ag) return null;
    var rev, cost, sga;
    if (team === D.TOTAL) { rev = ag.rev; cost = ag.cost; sga = ag.sga; }
    else {
      var t = ag.byTeam[team];
      if (!t) return null;
      rev = t.rev; cost = t.cost; sga = t.sga;
    }
    var dev = OL(m, team, '매출이익', '개발비') || 0;
    var gp = r4(rev - cost + dev);
    var gongpan = r4(rev * D.gpRate());
    return {
      rev: r4(rev), cost: r4(cost), gp: gp, sga: r4(sga), dev: dev,
      op: r4(gp - sga), gongpan: gongpan, op2: r4(gp - sga - gongpan), src: 'ERP'
    };
  }

  /** 기간 합계 — 마감된 달은 실적, 아직인 달은 최종 OL 로 채운다 */
  function blend(ms, team) {
    var o = { rev: 0, cost: 0, gp: 0, sga: 0, op: 0, gongpan: 0, op2: 0 };
    var closed = [], open = [];
    ms.forEach(function (m) {
      var a = act(m, team), x = a || metrics(m, team, 'ol');
      (a ? closed : open).push(m);
      Object.keys(o).forEach(function (k) { if (x[k] != null) o[k] += x[k]; });
    });
    Object.keys(o).forEach(function (k) { o[k] = r4(o[k]); });
    o.closed = closed; o.open = open;
    o.mode = open.length === 0 ? 'act' : (closed.length === 0 ? 'ol' : 'mix');
    o.label = o.mode === 'act' ? '실적' : (o.mode === 'ol' ? '최종 OL' : '실적+계획');
    return o;
  }

  global.MpCalc = {
    bust: bust, V: V, PL: PL, OL: OL, cum: cum,
    finalK: finalK, lastFilledK: lastFilledK, filledWeeks: filledWeeks, prevWeek: prevWeek, isLeaf: isLeaf,
    metrics: metrics, sumMetrics: sumMetrics, act: act, blend: blend
  };
})(window);
