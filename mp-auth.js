/* ============================================================================
 * mp-auth.js — ATEC 이동계획 인증 모듈
 *
 * 사내 atec-auth.js(통합 관제 포털)와 같은 구조에 2단계 인증을 얹었다.
 *
 * 이 파일이 하는 일
 *  · 가입 / 로그인 / 로그아웃을 Supabase Auth 로 처리한다.
 *  · Google Authenticator(TOTP) 등록과 검증을 처리한다.
 *  · 토큰을 붙여 데이터 요청을 보낸다(authFetch). 만료되면 자동 갱신.
 *  · 화면 진입 가드(requireAuth)를 제공한다.
 *
 * 중요
 *  화면에서 하는 권한 확인은 "메뉴를 보여줄지" 판단용일 뿐이다.
 *  실제 차단은 서버(RLS)가 한다 — sessionStorage 를 위조해도 데이터는 안 나온다.
 *
 *  그리고 이동계획의 RLS 는 aal2(2단계 인증 통과)를 요구한다.
 *  비밀번호만으로 얻은 토큰(aal1)으로는 한 줄도 읽지 못한다.
 *
 * 로그인 단계
 *   1) login(email, pw)        → aal1 토큰
 *   2) mfaState()              → 'none'(미등록) | 'need'(입력 필요) | 'ok'
 *   3) enroll() → verify(code) → 최초 1회 등록
 *      또는 verify(code)       → 이후 매 로그인
 *   4) 통과하면 토큰이 aal2 로 승격되고 그때부터 데이터가 보인다
 * ========================================================================== */
(function (global) {
  'use strict';

  var SB_URL = 'https://eiyksjcqntenmetmhmij.supabase.co';
  // publishable(anon) 키 — 공개되어도 되는 값이다. 실제 권한은 로그인 토큰과 RLS 가 정한다.
  var SB_KEY = 'sb_publishable_9xO2pBxLIpMvxbFmQPw1hQ_qtHN5Rm5';

  var PERM = 'moveplan';                 // profiles.perms 에 들어갈 이 시스템의 이름

  var K_AT = 'mp_at';                    // access token
  var K_RT = 'mp_rt';                    // refresh token
  var K_ME = 'mp_session';               // 화면 표시용 — 신뢰 대상 아님
  var K_FA = 'mp_factor';                // 진행 중인 TOTP factor id

  /* ---------- 저장소 (탭을 닫으면 로그아웃되는 기존 동작 유지) ---------- */
  function get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }
  function del(k) { try { sessionStorage.removeItem(k); } catch (e) {} }

  function me() { try { return JSON.parse(get(K_ME) || 'null'); } catch (e) { return null; } }
  function saveMe(p) { set(K_ME, JSON.stringify(p)); }

  /* ---------- 공통 요청 ---------- */
  function headers(extra) {
    var h = Object.assign({ apikey: SB_KEY, 'Content-Type': 'application/json' }, extra || {});
    var t = get(K_AT);
    h.Authorization = 'Bearer ' + (t || SB_KEY);
    return h;
  }

  function storeTokens(j) {
    if (j && j.access_token) set(K_AT, j.access_token);
    if (j && j.refresh_token) set(K_RT, j.refresh_token);
    startAutoRefresh();
  }

  /* 액세스 토큰은 1시간 뒤 만료된다. 손익표를 오래 열어 둔 채 저장을 눌러도
     실패하지 않도록 45분마다, 그리고 탭으로 돌아올 때 미리 갱신해 둔다. */
  var refreshTimer = null;
  function startAutoRefresh() {
    if (refreshTimer || !get(K_RT)) return;
    refreshTimer = setInterval(function () {
      if (get(K_RT)) refresh(); else { clearInterval(refreshTimer); refreshTimer = null; }
    }, 45 * 60 * 1000);
  }
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && get(K_RT)) refresh();
  });

  function refresh() {
    var rt = get(K_RT);
    if (!rt) return Promise.resolve(false);
    return fetch(SB_URL + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: rt })
    }).then(function (r) {
      if (!r.ok) return false;
      return r.json().then(function (j) { storeTokens(j); return true; });
    }).catch(function () { return false; });
  }

  /** 토큰을 붙여 요청. 401/403 이면 한 번 갱신 후 재시도한다. */
  function authFetch(url, opts) {
    opts = opts || {};
    var send = function () {
      var o = Object.assign({}, opts);
      o.headers = headers(opts.headers);
      return fetch(url, o);
    };
    return send().then(function (r) {
      if (r.status !== 401 && r.status !== 403) return r;
      return refresh().then(function (ok) { return ok ? send() : r; });
    });
  }

  /** REST 편의 함수 — 테이블 경로만 넘긴다. 예: rest('mp_week?m=eq.24320') */
  function rest(path, opts) {
    return authFetch(SB_URL + '/rest/v1/' + path, opts);
  }

  /* ---------- 토큰 들여다보기 ---------- */
  function claims() {
    var t = get(K_AT);
    if (!t) return null;
    try {
      var b = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      var json = decodeURIComponent(atob(b).split('').map(function (c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));
      return JSON.parse(json);
    } catch (e) { return null; }
  }
  function myUserId() { var c = claims(); return (c && c.sub) || null; }

  /** 지금 토큰이 2단계 인증까지 통과했는가. RLS 가 이 값을 본다. */
  function aal() { var c = claims(); return (c && c.aal) || 'aal1'; }
  function isAal2() { return aal() === 'aal2'; }

  /* ---------- 프로필 ---------- */
  /* 반드시 내 id 로 걸러야 한다 — 관리자는 모든 계정이 보이기 때문에
     조건 없이 첫 줄을 가져오면 남의 이름·권한이 잡힌다. */
  function loadProfile() {
    var uid = myUserId();
    if (!uid) return Promise.resolve(null);
    return rest('profiles?select=id,email,name,role,status,perms&id=eq.' + uid)
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) {
        var p = rows && rows[0];
        if (!p) return null;
        var info = {
          id: p.id, email: p.email, name: p.name || p.email,
          role: p.role, status: p.status,
          perms: Array.isArray(p.perms) ? p.perms : [],
          team: null, mpRole: null
        };
        // 이동계획 소속 팀·역할은 별도 테이블에 있다 (공용 profiles 를 건드리지 않는다)
        return rest('mp_members?select=team,mp_role&user_id=eq.' + uid)
          .then(function (r2) { return r2.ok ? r2.json() : []; })
          .then(function (mr) {
            if (mr && mr[0]) { info.team = mr[0].team; info.mpRole = mr[0].mp_role; }
            saveMe(info);
            return info;
          });
      });
  }

  /* ---------- 가입 / 로그인 ---------- */
  function signup(email, password, name) {
    email = (email || '').trim().toLowerCase();
    return fetch(SB_URL + '/auth/v1/signup', {
      method: 'POST',
      headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, password: password, data: { name: name || '' } })
    }).then(function (r) {
      return r.json().then(function (j) {
        if (r.ok) return { ok: true };
        var m = (j && (j.msg || j.message || j.error_description)) || '';
        if (/registered|exists/i.test(m)) return { error: '이미 가입된 이메일입니다.' };
        return { error: m || '가입에 실패했습니다.' };
      });
    }).catch(function () { return { error: '서버에 연결하지 못했습니다.' }; });
  }

  function login(email, password) {
    email = (email || '').trim().toLowerCase();
    return fetch(SB_URL + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, password: password })
    }).then(function (r) {
      if (!r.ok) return { error: '이메일 또는 비밀번호가 올바르지 않습니다.' };
      return r.json().then(function (j) {
        storeTokens(j);
        return loadProfile().then(function (p) {
          if (!p) { logout(); return { error: '계정 정보를 불러오지 못했습니다.' }; }
          if (p.status === 'pending')  { logout(); return { error: '아직 관리자 승인 대기 중인 계정입니다.' }; }
          if (p.status === 'rejected') { logout(); return { error: '승인이 거부된 계정입니다. 관리자에게 문의하세요.' }; }
          /* 이동계획 접근 여부는 mp_members 가 정한다.
             공용 profiles.perms 를 건드리지 않기 위해서다 — 다른 시스템에 영향이 간다.
             여기서 막는 건 안내일 뿐이고, 실제 차단은 RLS 가 한다
             (mp_members 행이 없으면 mp_my_role() 이 null 이라 한 줄도 안 나온다). */
          if (!p.mpRole) {
            logout();
            return { error: '이동계획 시스템에 등록되지 않은 계정입니다. 경영지원팀에 소속 팀 지정을 요청하세요.' };
          }
          return { ok: true, profile: p };
        });
      });
    }).catch(function () {
      return { error: '서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.' };
    });
  }

  function logout() {
    var t = get(K_AT);
    if (t) {
      fetch(SB_URL + '/auth/v1/logout', {
        method: 'POST', headers: { apikey: SB_KEY, Authorization: 'Bearer ' + t }
      }).catch(function () {});
    }
    del(K_AT); del(K_RT); del(K_ME); del(K_FA);
  }

  /* ==========================================================================
   * 2단계 인증 (TOTP · Google Authenticator)
   * ======================================================================== */

  /** 등록된 TOTP 수단을 가져온다. */
  function factors() {
    return authFetch(SB_URL + '/auth/v1/user')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (u) {
        var list = (u && u.factors) || [];
        return list.filter(function (f) { return f.factor_type === 'totp'; });
      })
      .catch(function () { return []; });
  }

  /**
   * 지금 무엇을 해야 하는가.
   *   'ok'   — 이미 2단계까지 통과했다. 바로 들어가면 된다.
   *   'need' — 수단이 등록돼 있다. 6자리를 받아 verify() 하면 된다.
   *   'none' — 아직 등록된 수단이 없다. enroll() 부터 해야 한다.
   */
  function mfaState() {
    if (isAal2()) return Promise.resolve('ok');
    return factors().then(function (list) {
      var v = list.filter(function (f) { return f.status === 'verified'; });
      if (v.length) { set(K_FA, v[0].id); return 'need'; }
      return 'none';
    });
  }

  /**
   * TOTP 등록을 시작한다.
   * 돌려주는 uri 를 QR 로 그려 Google Authenticator 로 찍게 한다.
   * 그 뒤 verify(6자리) 를 부르면 등록이 확정된다.
   */
  function enroll(label) {
    // 이전에 만들다 만 미확정 수단이 있으면 지우고 새로 만든다
    return factors().then(function (list) {
      var stale = list.filter(function (f) { return f.status !== 'verified'; });
      var chain = stale.reduce(function (p, f) {
        return p.then(function () {
          return authFetch(SB_URL + '/auth/v1/factors/' + f.id, { method: 'DELETE' })
            .catch(function () {});
        });
      }, Promise.resolve());

      return chain.then(function () {
        return authFetch(SB_URL + '/auth/v1/factors', {
          method: 'POST',
          body: JSON.stringify({
            factor_type: 'totp',
            friendly_name: label || ('이동계획 ' + new Date().getFullYear())
          })
        });
      });
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) return { error: (j && (j.msg || j.message)) || '등록을 시작하지 못했습니다.' };
        set(K_FA, j.id);
        var t = j.totp || {};
        return { ok: true, id: j.id, uri: t.uri, secret: t.secret, qr: t.qr_code };
      });
    }).catch(function () { return { error: '서버에 연결하지 못했습니다.' }; });
  }

  /**
   * 6자리 코드를 검증한다. 통과하면 토큰이 aal2 로 승격된다.
   * 등록 직후에도, 이후 매 로그인에도 같은 함수를 쓴다.
   */
  function verify(code) {
    var fid = get(K_FA);
    if (!fid) return Promise.resolve({ error: '인증 수단을 찾지 못했습니다. 다시 로그인해 주세요.' });
    code = String(code || '').replace(/\D/g, '');
    if (code.length !== 6) return Promise.resolve({ error: '6자리 숫자를 입력해 주세요.' });

    return authFetch(SB_URL + '/auth/v1/factors/' + fid + '/challenge', { method: 'POST' })
      .then(function (r) {
        return r.json().then(function (cj) {
          if (!r.ok) return { error: (cj && (cj.msg || cj.message)) || '인증을 시작하지 못했습니다.' };
          return authFetch(SB_URL + '/auth/v1/factors/' + fid + '/verify', {
            method: 'POST',
            body: JSON.stringify({ challenge_id: cj.id, code: code })
          }).then(function (vr) {
            return vr.json().then(function (vj) {
              if (!vr.ok) {
                var m = (vj && (vj.msg || vj.message)) || '';
                if (/invalid|incorrect/i.test(m)) return { error: '코드가 맞지 않습니다. 앱의 현재 숫자를 확인해 주세요.' };
                return { error: m || '인증에 실패했습니다.' };
              }
              storeTokens(vj);            // 여기서 aal2 토큰으로 바뀐다
              del(K_FA);
              return loadProfile().then(function (p) { return { ok: true, profile: p }; });
            });
          });
        });
      }).catch(function () { return { error: '서버에 연결하지 못했습니다.' }; });
  }

  /* ---------- 권한 (화면 표시용) ---------- */
  function isAdmin() { var m = me(); return !!(m && (m.mpRole === 'admin' || m.role === 'admin')); }
  function isLead()  { var m = me(); return !!(m && m.mpRole === 'lead'); }
  function myTeam()  { var m = me(); return m ? m.team : null; }

  /** 이 팀의 값을 내가 고칠 수 있는가 — 화면에서 입력칸을 열지 말지 판단용.
      실제 차단은 RLS 의 mp_can_write() 가 한다. */
  function canWriteTeam(team) {
    if (isAdmin()) return true;
    return isLead() && team === myTeam();
  }

  /**
   * 화면 진입 가드.
   * 토큰이 살아 있는지, 승인됐는지, 2단계까지 통과했는지 서버에 확인한다.
   * sessionStorage 를 위조해도 통과할 수 없다.
   */
  function requireAuth() {
    if (!get(K_AT)) { location.replace('index.html'); return Promise.reject(); }
    if (!isAal2())  { location.replace('index.html'); return Promise.reject(); }
    return loadProfile().then(function (p) {
      if (!p || p.status !== 'approved') { logout(); location.replace('index.html'); return Promise.reject(); }
      if (!p.mpRole) {
        alert('이동계획 시스템에 소속 팀이 지정되지 않았습니다.\n경영지원팀에 요청해 주세요.');
        logout(); location.replace('index.html'); return Promise.reject();
      }
      return p;
    }).catch(function (e) {
      if (e) { logout(); location.replace('index.html'); }
      return Promise.reject(e);
    });
  }

  startAutoRefresh();

  global.MpAuth = {
    SB_URL: SB_URL, SB_KEY: SB_KEY, PERM: PERM,
    signup: signup, login: login, logout: logout,
    mfaState: mfaState, enroll: enroll, verify: verify, factors: factors,
    me: me, loadProfile: loadProfile, myUserId: myUserId,
    aal: aal, isAal2: isAal2,
    isAdmin: isAdmin, isLead: isLead, myTeam: myTeam, canWriteTeam: canWriteTeam,
    requireAuth: requireAuth, authFetch: authFetch, rest: rest,
    token: function () { return get(K_AT); }
  };
})(window);
