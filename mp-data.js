/* ============================================================================
 * mp-data.js — 데이터 접근 계층
 *
 * 한 해치를 한 번에 읽어 메모리에 색인해 둔다. 화면은 여기만 본다.
 * 서버 왕복을 화면 코드에 흩뿌리지 않는다 — 나중에 실시간 동기화를 얹을 때
 * 이 파일만 고치면 되도록.
 * ========================================================================== */
(function (global) {
  'use strict';

  var TEAMS = ['광역버스사업팀', '택시지원팀', '리페어팀', '수도권버스지원팀', 'AFC지원파트', '실공통'];
  var TOTAL = '사업부합계';                       /* 계산값 — 저장하지 않는다 */
  var TEAM_LABEL = { '실공통': '고객지원사업부' };

  var SEC_ORDER = ['매출', '매출원가', '매출이익', '판관비'];
  var ITEMS = {
    '매출':     ['제품', '상품', '유지보수', '유상서비스', '공사', '영업수수료'],
    '매출원가': ['제품', '상품', '유지보수', '유상서비스', '공사', '영업수수료', '개발비'],
    '매출이익': ['제품', '상품', '유지보수', '유상서비스', '공사', '영업수수료', '개발비'],
    '판관비':   ['인건비', '지급수수료', '차량유지비', '여비교통비', '운반비', '기타경비']
  };
  /* 저장하는 리프 — 나머지는 전부 파생 */
  var LEAF = {
    '매출': ITEMS['매출'], '매출원가': ITEMS['매출원가'],
    '매출이익': ['개발비'], '판관비': ITEMS['판관비'], '공판': ['계']
  };

  /* ERP 보고조직(6) → 이동계획 팀 */
  var ORG2TEAM = {
    'AFC지원파트': 'AFC지원파트', '광역교통지원팀': '광역버스사업팀', '리페어팀': '리페어팀',
    '수도권버스지원팀': '수도권버스지원팀', '택시지원파트': '택시지원팀', '고객지원사업부': '실공통'
  };
  /* ERP 매출의 영업그룹은 이미 이동계획 팀명과 같다 */

  var S = {
    year: null, periods: {}, plan: {}, week: {}, detail: [], notes: [],
    erpMeta: {}, erpRev: {}, erpSga: {}, orgMap: {}, config: {}
  };

  function key() { return Array.prototype.join.call(arguments, '|'); }
  function mOf(y, mo) { return y * 12 + (mo - 1); }
  function moOf(m) { return (m % 12) + 1; }
  function yOf(m) { return Math.floor(m / 12); }

  function get(path) {
    return MpAuth.rest(path).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error(path.split('?')[0] + ' ' + r.status + ' — ' + t.slice(0, 140)); });
      return r.json();
    });
  }
  /* PostgREST 기본 상한을 넘길 수 있으므로 나눠 받는다 */
  function getAll(path) {
    var out = [], STEP = 1000;
    var step = function (from) {
      return MpAuth.rest(path, { headers: { Range: from + '-' + (from + STEP - 1) } })
        .then(function (r) {
          if (!r.ok) return r.text().then(function (t) { throw new Error(path.split('?')[0] + ' ' + r.status + ' — ' + t.slice(0, 140)); });
          return r.json().then(function (rows) {
            out = out.concat(rows);
            return rows.length < STEP ? out : step(from + STEP);
          });
        });
    };
    return step(0);
  }

  function load(year) {
    S.year = year;
    var lo = mOf(year, 1), hi = mOf(year, 12);
    var range = 'm=gte.' + lo + '&m=lte.' + hi;

    return Promise.all([
      getAll('mp_periods?select=m,state,weeks,final_k,final_src&' + range),
      getAll('mp_plan?select=m,team,sec,item,val&' + range),
      getAll('mp_week?select=m,team,sec,item,k,val&' + range),
      getAll('mp_detail?select=id,m,team,k,grp,item,rev,cost,note,sort&' + range + '&order=m,team,sort'),
      getAll('mp_notes?select=id,kind,m,team,sec,item,k,body&' + range),
      getAll('mp_erp_meta?select=m,rev_cnt,sga_cnt&' + range),
      getAll('mp_org_map?select=org,org6'),
      getAll('mp_config?select=key,val')
    ]).then(function (r) {
      S.periods = {}; r[0].forEach(function (p) { S.periods[p.m] = p; });
      S.plan = {}; r[1].forEach(function (x) { S.plan[key(x.m, x.team, x.sec, x.item)] = Number(x.val); });
      S.week = {}; r[2].forEach(function (x) { S.week[key(x.m, x.team, x.sec, x.item, x.k)] = Number(x.val); });
      S.detail = r[3];
      S.notes = r[4];
      S.erpMeta = {}; r[5].forEach(function (x) { S.erpMeta[x.m] = x; });
      S.orgMap = {}; r[6].forEach(function (x) { S.orgMap[x.org] = x.org6; });
      S.config = {}; r[7].forEach(function (x) { S.config[x.key] = x.val; });
      return S;
    });
  }

  /* ERP 명세는 월 단위로 필요할 때만 읽는다 (수백 건씩이라 미리 다 받지 않는다) */
  function loadErp(m) {
    if (S.erpRev[m] && S.erpSga[m]) return Promise.resolve(true);
    if (!S.erpMeta[m]) return Promise.resolve(false);
    return Promise.all([
      getAll('mp_erp_rev?select=amt,cost,team,pname&m=eq.' + m),
      getAll('mp_erp_sga?select=amt,cat,mg,team_raw,descr&m=eq.' + m)
    ]).then(function (r) { S.erpRev[m] = r[0]; S.erpSga[m] = r[1]; return true; });
  }

  /** ERP 확정 집계 — 백만원 단위로 돌려준다 */
  function erpAgg(m) {
    if (!S.erpRev[m] || !S.erpSga[m]) return null;
    var out = { rev: 0, cost: 0, sga: 0, byTeam: {}, sgaCat: {} };
    TEAMS.forEach(function (t) { out.byTeam[t] = { rev: 0, cost: 0, sga: 0 }; });

    S.erpRev[m].forEach(function (r) {
      var t = ORG2TEAM[r.team] || r.team;
      var a = Number(r.amt) / 1e6, c = Number(r.cost || 0) / 1e6;
      out.rev += a; out.cost += c;
      if (out.byTeam[t]) { out.byTeam[t].rev += a; out.byTeam[t].cost += c; }
    });
    S.erpSga[m].forEach(function (r) {
      var org6 = S.orgMap[r.mg] || S.orgMap[r.team_raw] || null;
      var t = org6 ? (ORG2TEAM[org6] || null) : null;
      var a = Number(r.amt) / 1e6;
      out.sga += a;
      if (t && out.byTeam[t]) out.byTeam[t].sga += a;
      if (r.cat) out.sgaCat[r.cat] = (out.sgaCat[r.cat] || 0) + a;
    });
    return out;
  }

  function periodOf(m) { return S.periods[m] || { m: m, state: 'closed', weeks: 1, final_k: null }; }
  function weeksOf(m) { return periodOf(m).weeks || 1; }
  function stateOf(m) { return periodOf(m).state; }
  function isFinal(m) { return stateOf(m) === 'final'; }
  function isOpen(m) { return stateOf(m) === 'open'; }

  function planVal(m, team, sec, item) { var v = S.plan[key(m, team, sec, item)]; return v == null ? null : v; }
  function weekVal(m, team, sec, item, k) { var v = S.week[key(m, team, sec, item, k)]; return v == null ? null : v; }

  function detailOf(m, team, k) {
    return S.detail.filter(function (d) {
      return d.m === m && d.team === team && (k == null || d.k === k);
    });
  }
  function notesOf(kind, m) {
    return S.notes.filter(function (n) { return n.kind === kind && (m == null || n.m === m); });
  }

  function gpRate() {
    var v = S.config['gongpan_rate'];
    return (typeof v === 'number' && isFinite(v) && v >= 0) ? v : 0.043;
  }

  global.MpData = {
    TEAMS: TEAMS, TOTAL: TOTAL, TEAM_LABEL: TEAM_LABEL,
    SEC_ORDER: SEC_ORDER, ITEMS: ITEMS, LEAF: LEAF, ORG2TEAM: ORG2TEAM,
    S: S, load: load, loadErp: loadErp, erpAgg: erpAgg,
    mOf: mOf, moOf: moOf, yOf: yOf,
    periodOf: periodOf, weeksOf: weeksOf, stateOf: stateOf, isFinal: isFinal, isOpen: isOpen,
    planVal: planVal, weekVal: weekVal, detailOf: detailOf, notesOf: notesOf,
    gpRate: gpRate,
    teamName: function (t) { return TEAM_LABEL[t] || t; },
    erpMonths: function () { return Object.keys(S.erpMeta).map(Number).sort(function (a, b) { return a - b; }); }
  };
})(window);
