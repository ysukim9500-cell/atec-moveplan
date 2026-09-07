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
  var TEAM_LABEL = { '실공통': '고객지원사업부', '사업부합계': '사업부 합계' };

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
    /* 공판은 매출 × 공판율이라 파생값이다. 저장 리프에서 뺀다 —
       계획·OL 은 사람이 친 숫자, 확정은 계산값이라 두 정의가 갈려 있었다.
       (이관된 값 115건이 전부 매출×4.3% 와 일치해 숫자는 달라지지 않는다) */
    '매출이익': ['개발비'], '판관비': ITEMS['판관비'], '공판': []
  };

  /* ERP 보고조직(6) → 이동계획 팀 */
  var ORG2TEAM = {
    'AFC지원파트': 'AFC지원파트', '광역교통지원팀': '광역버스사업팀', '리페어팀': '리페어팀',
    '수도권버스지원팀': '수도권버스지원팀', '택시지원파트': '택시지원팀', '고객지원사업부': '실공통'
  };
  /* ERP 매출의 영업그룹은 이미 이동계획 팀명과 같다 */

  var S = {
    year: null, periods: {}, plan: {}, week: {}, detail: [], notes: [],
    erpMeta: {}, erpRev: {}, erpSga: {}, orgMap: {}, acctMap: {}, config: {}, submit: {}, submitReady: null
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
  /**
   * PostgREST 기본 상한을 넘길 수 있으므로 나눠 받는다.
   *
   * 두 가지를 지켜야 한다.
   *  · 정렬이 없으면 Postgres 가 장마다 같은 순서를 보장하지 않아
   *    행이 중복되거나 빠진다. 부르는 쪽이 반드시 order 를 붙인다.
   *  · 서버 상한(db-max-rows)이 1000 보다 작으면 첫 장이 STEP 미만으로 와서
   *    «다 받았다»고 착각한다. 그래서 받은 만큼만 나아가고, 빈 장이 올 때 끝낸다.
   */
  function getAll(path) {
    /* limit 을 스스로 건 조회는 나눠 받지 않는다.
       Range 를 겹쳐 보내면 PostgREST 가 음수 limit 으로 계산해 416 을 준다. */
    if (path.indexOf('limit=') >= 0) {
      return MpAuth.rest(path).then(function (r) {
        if (!r.ok) return r.text().then(function (t) { throw new Error(path.split('?')[0] + ' ' + r.status + ' — ' + t.slice(0, 140)); });
        return r.json();
      });
    }
    if (path.indexOf('order=') < 0) {
      console.warn('getAll: 정렬 없이 페이징한다 — ' + path.split('?')[0]);
    }
    var out = [], STEP = 1000, guard = 0;
    var step = function (from) {
      return MpAuth.rest(path, { headers: { Range: from + '-' + (from + STEP - 1) } })
        .then(function (r) {
          if (!r.ok) return r.text().then(function (t) { throw new Error(path.split('?')[0] + ' ' + r.status + ' — ' + t.slice(0, 140)); });
          return r.json().then(function (rows) {
            out = out.concat(rows);
            if (!rows.length || ++guard > 200) return out;
            return step(from + rows.length);
          });
        });
    };
    return step(0);
  }

  function load(year) {
    S.year = year;
    S.submitReady = null;
    var lo = mOf(year, 1), hi = mOf(year, 12);
    var range = 'm=gte.' + lo + '&m=lte.' + hi;

    return Promise.all([
      getAll('mp_periods?select=m,state,weeks,final_k,final_src&' + range + '&order=m'),
      getAll('mp_plan?select=m,team,sec,item,val&' + range + '&order=m,team,sec,item'),
      getAll('mp_week?select=m,team,sec,item,k,val&' + range + '&order=m,team,sec,item,k'),
      getAll('mp_detail?select=id,m,team,k,grp,item,rev,cost,note,sort&' + range + '&order=m,team,sort,id'),
      getAll('mp_notes?select=id,kind,m,team,sec,item,k,body,updated_at&' + range + '&order=id'),
      getAll('mp_erp_meta?select=m,rev_cnt,sga_cnt&' + range + '&order=m'),
      getAll('mp_org_map?select=org,org6&order=org'),
      /* 판관비 가공본의 계정매핑 시트에 쓴다 */
      getAll('mp_acct_map?select=acct,cat&order=acct'),
      getAll('mp_config?select=key,val&order=key'),
      /* 이 표는 나중에 추가됐다. 아직 없는 환경에서도 나머지는 떠야 한다. */
      getAll('mp_submit?select=m,team,k,submitted_at,email,sig&' + range + '&order=m,team,k')
        .catch(function () { S.submitReady = false; return []; })
    ]).then(function (r) {
      S.periods = {}; r[0].forEach(function (p) { S.periods[p.m] = p; });
      /* NULL 은 «값 없음»이다. Number(null) 은 0 이라 그대로 쓰면 빈 칸이 0 이 되고,
         그 주차가 기입된 것으로 잡혀 최종 OL 이 엉뚱한 주차로 간다. */
      S.plan = {}; r[1].forEach(function (x) { if (x.val != null) S.plan[key(x.m, x.team, x.sec, x.item)] = Number(x.val); });
      S.week = {}; r[2].forEach(function (x) { if (x.val != null) S.week[key(x.m, x.team, x.sec, x.item, x.k)] = Number(x.val); });
      S.detail = r[3];
      S.notes = r[4];
      S.erpMeta = {}; r[5].forEach(function (x) { S.erpMeta[x.m] = x; });
      S.orgMap = {}; r[6].forEach(function (x) { S.orgMap[x.org] = x.org6; });
      S.acctMap = {}; (r[7] || []).forEach(function (x) { S.acctMap[x.acct] = x.cat; });
      S.config = {}; r[8].forEach(function (x) { S.config[x.key] = x.val; });
      S.submit = {}; (r[9] || []).forEach(function (x) { S.submit[key(x.m, x.team, x.k)] = x; });
      if (S.submitReady !== false) S.submitReady = true;
      return S;
    });
  }

  /* ERP 명세는 월 단위로 필요할 때만 읽는다 (수백 건씩이라 미리 다 받지 않는다) */
  function loadErp(m) {
    if (S.erpRev[m] && S.erpSga[m]) return Promise.resolve(true);
    if (!S.erpMeta[m]) return Promise.resolve(false);
    return Promise.all([
      getAll('mp_erp_rev?select=amt,cost,team,pname&m=eq.' + m + '&order=id'),
      getAll('mp_erp_sga?select=amt,cat,acct,mg,team_raw,descr&m=eq.' + m + '&order=id')
    ]).then(function (r) { S.erpRev[m] = r[0]; S.erpSga[m] = r[1]; return true; });
  }

  /** ERP 확정 집계 — 백만원 단위로 돌려준다 */
  function erpAgg(m) {
    if (!S.erpRev[m] || !S.erpSga[m]) return null;
    /* unassigned : 조직 매핑이 없어 어느 팀에도 붙지 않은 금액.
       사업부합계에는 들어 있으므로 이걸 따로 보여 줘야 «6팀 합 + 미배분 = 사업부합계» 가 된다. */
    var out = { rev: 0, cost: 0, sga: 0, byTeam: {}, sgaCat: {},
                unassigned: { rev: 0, cost: 0, sga: 0 } };
    TEAMS.forEach(function (t) { out.byTeam[t] = { rev: 0, cost: 0, sga: 0 }; });

    S.erpRev[m].forEach(function (r) {
      var t = ORG2TEAM[r.team] || r.team;
      var a = Number(r.amt) / 1e6, c = Number(r.cost || 0) / 1e6;
      out.rev += a; out.cost += c;
      if (out.byTeam[t]) { out.byTeam[t].rev += a; out.byTeam[t].cost += c; }
      else { out.unassigned.rev += a; out.unassigned.cost += c; }
    });
    S.erpSga[m].forEach(function (r) {
      var org6 = S.orgMap[r.mg] || S.orgMap[r.team_raw] || null;
      var t = org6 ? (ORG2TEAM[org6] || null) : null;
      var a = Number(r.amt) / 1e6;
      out.sga += a;
      if (t && out.byTeam[t]) out.byTeam[t].sga += a;
      else out.unassigned.sga += a;
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

  /* ---------- 작성 완료(제출) ----------
     값은 입력하는 즉시 저장된다. 이건 «다 썼다»는 선언이다. */
  function submitOf(m, team, k) { return S.submit[key(m, team, k)] || null; }

  function setSubmit(m, team, k, sig) {
    var me = MpAuth.me() || {};
    var row = { m: m, team: team, k: k, submitted_at: new Date().toISOString(),
                submitted_by: me.id || null, email: me.email || null, sig: sig || null };
    return send('mp_submit?on_conflict=m,team,k', {
      method: 'POST', headers: PREF, body: JSON.stringify([row])
    }).then(function () { S.submit[key(m, team, k)] = row; return row; });
  }

  function unsubmit(m, team, k) {
    var old = S.submit[key(m, team, k)];
    delete S.submit[key(m, team, k)];
    return sendOne('mp_submit?m=eq.' + m + '&team=eq.' + encodeURIComponent(team) + '&k=eq.' + k,
      { method: 'DELETE' })
      .catch(function (e) { if (old) S.submit[key(m, team, k)] = old; throw e; });
  }

  function gpRate() {
    var v = S.config['gongpan_rate'];
    return (typeof v === 'number' && isFinite(v) && v >= 0) ? v : 0.043;
  }

  /* ==========================================================================
   * 쓰기
   * 화면 상태를 먼저 바꾸고 서버에 보낸다. 실패하면 되돌리고 알린다.
   * 실제 차단은 RLS 가 한다 — 여기서 막는 건 사용자 편의일 뿐이다.
   * ======================================================================== */
  function send(path, opts) {
    return MpAuth.rest(path, opts).then(function (r) {
      if (r.ok) return r;
      return r.text().then(function (t) {
        var msg = t;
        try { var j = JSON.parse(t); msg = j.message || j.hint || t; } catch (e) {}
        if (r.status === 401 || r.status === 403 ||
            /row-level security|violates/i.test(msg)) {
          throw new Error('권한이 없거나 잠긴 달입니다. 서버가 거부했습니다.');
        }
        throw new Error(msg.slice(0, 160));
      });
    });
  }
  var PREF = { Prefer: 'resolution=merge-duplicates,return=minimal' };

  /**
   * 반드시 무언가를 바꿔야 하는 요청.
   *
   * PostgREST 는 RLS 가 걸러 0행을 고쳐도 204 를 준다. r.ok 만 보면
   * «저장됨» 이 뜨고 화면에서는 사라졌는데 서버는 그대로다 —
   * 새로고침하면 되살아나고, 그동안 사용자는 지운 줄 알고 다음 작업을 한다.
   * 그래서 바뀐 행을 돌려받아 정말 바뀌었는지 본다.
   */
  function sendOne(path, opts) {
    opts = opts || {};
    var h = {};
    Object.keys(opts.headers || {}).forEach(function (k) { h[k] = opts.headers[k]; });
    h.Prefer = 'return=representation';
    var o = { method: opts.method, headers: h };
    if (opts.body) o.body = opts.body;
    return send(path, o).then(function (r) {
      return r.json().then(function (rows) {
        if (!rows || !rows.length) {
          throw new Error('서버가 아무 행도 바꾸지 않았습니다. 권한이 없거나, 그 사이 다른 사람이 지웠을 수 있습니다. 새로고침해 확인해 주세요.');
        }
        return rows;
      });
    });
  }

  function setPlan(m, team, sec, item, val) {
    var k = key(m, team, sec, item), old = S.plan[k];
    if (val == null) delete S.plan[k]; else S.plan[k] = val;
    var undo = function (e) { if (old == null) delete S.plan[k]; else S.plan[k] = old; throw e; };
    if (val == null) {
      return send('mp_plan?m=eq.' + m + '&team=eq.' + encodeURIComponent(team) +
                  '&sec=eq.' + encodeURIComponent(sec) + '&item=eq.' + encodeURIComponent(item),
        { method: 'DELETE', headers: { Prefer: 'return=minimal' } }).catch(undo);
    }
    return send('mp_plan?on_conflict=m,team,sec,item', {
      method: 'POST', headers: PREF,
      body: JSON.stringify([{ m: m, team: team, sec: sec, item: item, val: val }])
    }).catch(undo);
  }

  function setWeek(m, team, sec, item, wk, val) {
    var k = key(m, team, sec, item, wk), old = S.week[k];
    if (val == null) delete S.week[k]; else S.week[k] = val;
    var undo = function (e) { if (old == null) delete S.week[k]; else S.week[k] = old; throw e; };
    /* 비우면 행을 지운다. val=null 행을 남겨 두면 그 주차가 «기입됨»으로 잡힌다. */
    if (val == null) {
      return send('mp_week?m=eq.' + m + '&team=eq.' + encodeURIComponent(team) +
                  '&sec=eq.' + encodeURIComponent(sec) + '&item=eq.' + encodeURIComponent(item) +
                  '&k=eq.' + wk,
        { method: 'DELETE', headers: { Prefer: 'return=minimal' } }).catch(undo);
    }
    return send('mp_week?on_conflict=m,team,sec,item,k', {
      method: 'POST', headers: PREF,
      body: JSON.stringify([{ m: m, team: team, sec: sec, item: item, k: wk, val: val }])
    }).catch(undo);
  }

  /* 항목 행의 전주대비 변동 내용. 자리마다 한 줄만 둔다. */
  function findNote(kind, m, team, sec, item, wk) {
    for (var i = 0; i < S.notes.length; i++) {
      var n = S.notes[i];
      if (n.kind === kind && n.m === m && n.team === team &&
          (n.sec || '') === (sec || '') && (n.item || '') === (item || '') &&
          (n.k == null ? -1 : n.k) === (wk == null ? -1 : wk)) return n;
    }
    return null;
  }
  function setNote(kind, m, team, sec, item, wk, body) {
    body = (body || '').trim();
    var ex = findNote(kind, m, team, sec, item, wk);
    if (ex) {
      var old = ex.body, stamp = ex.updated_at;
      ex.body = body;
      /* 사업부합계 사유는 관리자 여럿이 같은 칸을 쓴다. 내가 읽은 뒤에 남이 고쳤으면
         덮어쓰지 않고 알린다 — 조용히 지워지면 쓴 사람도 모른다. */
      var cond = 'mp_notes?id=eq.' + ex.id +
                 (stamp ? '&updated_at=eq.' + encodeURIComponent(stamp) : '');
      var clash = function (e) {
        ex.body = old;
        if (/아무 행도 바꾸지 않았습니다/.test(e.message)) {
          return refreshNote(kind, m, team, sec, item, wk).then(function (cur) {
            throw new Error('그 사이 다른 사람이 이 사유를 고쳤습니다. 저장하지 않았습니다.' +
              (cur && cur.body ? ' 현재 내용 : ' + cur.body.slice(0, 60) : ''));
          });
        }
        throw e;
      };
      if (!body) {
        return sendOne(cond, { method: 'DELETE' })
          .then(function () { S.notes = S.notes.filter(function (n) { return n.id !== ex.id; }); })
          .catch(clash);
      }
      return sendOne(cond, { method: 'PATCH', body: JSON.stringify({ body: body, updated_at: new Date().toISOString() }) })
        .then(function (rows) { ex.updated_at = rows[0].updated_at; })
        .catch(clash);
    }
    if (!body) return Promise.resolve();
    return MpAuth.rest('mp_notes', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify([{ kind: kind, m: m, team: team, sec: sec || null, item: item || null, k: wk, body: body }])
    }).then(function (r) {
      if (r.ok) return r.json().then(function (rows) { if (rows[0]) S.notes.push(rows[0]); });
      return r.text().then(function (t) {
        /* 내 화면에는 없었는데 서버에는 이미 있다 — 그 사이 다른 사람이 먼저 썼다.
           유니크 인덱스가 식(coalesce)이라 on_conflict 를 못 쓰므로 다시 읽어 고친다. */
        if (r.status === 409 || /duplicate key|23505/.test(t)) {
          return refreshNote(kind, m, team, sec, item, wk).then(function () {
            return setNote(kind, m, team, sec, item, wk, body);
          });
        }
        throw new Error(t.slice(0, 160));
      });
    });
  }

  /** 그 자리의 사유를 서버에서 다시 읽어 캐시에 맞춘다 */
  function refreshNote(kind, m, team, sec, item, wk) {
    var q = 'mp_notes?select=id,kind,m,team,sec,item,k,body,updated_at' +
      '&kind=eq.' + encodeURIComponent(kind) + '&m=eq.' + m +
      '&team=eq.' + encodeURIComponent(team) +
      (sec ? '&sec=eq.' + encodeURIComponent(sec) : '&sec=is.null') +
      (item ? '&item=eq.' + encodeURIComponent(item) : '&item=is.null') +
      (wk == null ? '&k=is.null' : '&k=eq.' + wk);
    return MpAuth.rest(q).then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) {
        S.notes = S.notes.filter(function (x) { return x.id !== (rows[0] && rows[0].id); });
        var old = findNote(kind, m, team, sec, item, wk);
        if (old) S.notes = S.notes.filter(function (x) { return x !== old; });
        if (rows[0]) S.notes.push(rows[0]);
        return rows[0] || null;
      });
  }

  /* 변경 이력 — 남기기만 하고 고치거나 지우지 못한다 */
  function audit(action, o) {
    o = o || {};
    var me = MpAuth.me() || {};
    return MpAuth.rest('mp_audit', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify([{
        user_id: me.id || null, email: me.email || null, action: action,
        m: o.m == null ? null : o.m, team: o.team || null, ref: o.ref || null,
        before: o.before == null ? null : String(o.before),
        after: o.after == null ? null : String(o.after),
        via: o.via || 'web'
      }])
    }).catch(function () { /* 이력 실패가 본 작업을 막지는 않는다 */ });
  }

  /**
   * 월 개폐 · 확정.
   *
   * 예전에는 캐시에 있던 행 전체를 다시 써서, 그 사이 다른 관리자가 바꾼 주차 수를
   * 옛 값으로 되돌렸다. 캐시에 그 달이 아예 없으면 기본값(1주)으로 덮어써
   * 2~6주 입력칸이 통째로 사라지기도 했다. 넘겨받은 항목만 고친다.
   */
  function setPeriod(m, patch) {
    var body = {};
    ['state', 'weeks', 'final_k', 'final_src', 'unlock_reason'].forEach(function (k) {
      if (patch[k] !== undefined) body[k] = patch[k];
    });
    return send('mp_periods?m=eq.' + m, {
      method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(body)
    }).then(function (r) { return r.json(); })
      .then(function (rows) {
        if (rows && rows.length) { S.periods[m] = rows[0]; return rows[0]; }
        /* 그 달 행이 아직 없다 — 만든다 */
        var full = { m: m, state: 'closed', weeks: 1, final_k: null, final_src: null, unlock_reason: null };
        Object.keys(body).forEach(function (k) { full[k] = body[k]; });
        return send('mp_periods', {
          method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify([full])
        }).then(function (r) { return r.json(); })
          .then(function (rr) { S.periods[m] = rr[0] || full; return S.periods[m]; });
      });
  }

  /* 이동계획 팀원 */
  function loadMembers() {
    return Promise.all([
      getAll('profiles?select=id,email,name,role,status&order=name,id'),
      getAll('mp_members?select=user_id,team,mp_role&order=user_id')
    ]).then(function (r) {
      var by = {}; r[1].forEach(function (x) { by[x.user_id] = x; });
      return r[0].map(function (p) {
        var mm = by[p.id];
        return { id: p.id, email: p.email, name: p.name || p.email, status: p.status,
                 team: mm ? mm.team : null, mpRole: mm ? mm.mp_role : null };
      });
    });
  }
  function setMember(userId, team, role) {
    return send('mp_members?on_conflict=user_id', {
      method: 'POST', headers: PREF,
      body: JSON.stringify([{ user_id: userId, team: team, mp_role: role }])
    });
  }
  function removeMember(userId) {
    return send('mp_members?user_id=eq.' + userId, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
  }

  function setConfig(k, val) {
    S.config[k] = val;
    return send('mp_config?on_conflict=key', {
      method: 'POST', headers: PREF, body: JSON.stringify([{ key: k, val: val }])
    });
  }

  function loadAudit(n) {
    return getAll('mp_audit?select=at,email,action,m,team,ref,before,after,via&order=at.desc&limit=' + (n || 60));
  }

  /* 매출현황 상세 */
  function addDetail(row) {
    return MpAuth.rest('mp_detail', {
      method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify([row])
    }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error(t.slice(0, 160)); });
      return r.json().then(function (rows) { if (rows[0]) S.detail.push(rows[0]); return rows[0]; });
    });
  }
  function patchDetail(id, patch) {
    var d = null;
    S.detail.forEach(function (x) { if (x.id === id) d = x; });
    var old = {};
    if (d) Object.keys(patch).forEach(function (k) { old[k] = d[k]; d[k] = patch[k]; });
    return sendOne('mp_detail?id=eq.' + id, {
      method: 'PATCH', body: JSON.stringify(patch)
    }).catch(function (e) { if (d) Object.keys(old).forEach(function (k) { d[k] = old[k]; }); throw e; });
  }
  function delDetail(id) {
    var keep = S.detail.slice();
    S.detail = S.detail.filter(function (x) { return x.id !== id; });
    return sendOne('mp_detail?id=eq.' + id, { method: 'DELETE' })
      .catch(function (e) { S.detail = keep; throw e; });
  }

  global.MpData = {
    TEAMS: TEAMS, TOTAL: TOTAL, TEAM_LABEL: TEAM_LABEL,
    setPlan: setPlan, setWeek: setWeek,
    findNote: findNote, setNote: setNote,
    addDetail: addDetail, patchDetail: patchDetail, delDetail: delDetail,
    audit: audit, setPeriod: setPeriod,
    loadMembers: loadMembers, setMember: setMember, removeMember: removeMember,
    setConfig: setConfig, loadAudit: loadAudit,
    SEC_ORDER: SEC_ORDER, ITEMS: ITEMS, LEAF: LEAF, ORG2TEAM: ORG2TEAM,
    S: S, load: load, loadErp: loadErp, erpAgg: erpAgg,
    mOf: mOf, moOf: moOf, yOf: yOf,
    periodOf: periodOf, weeksOf: weeksOf, stateOf: stateOf, isFinal: isFinal, isOpen: isOpen,
    planVal: planVal, weekVal: weekVal, detailOf: detailOf, notesOf: notesOf,
    submitOf: submitOf, setSubmit: setSubmit, unsubmit: unsubmit,
    gpRate: gpRate,
    teamName: function (t) { return TEAM_LABEL[t] || t; },
    erpMonths: function () { return Object.keys(S.erpMeta).map(Number).sort(function (a, b) { return a - b; }); }
  };
})(window);
