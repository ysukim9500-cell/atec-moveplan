/* ============================================================================
 * mp-admin.js — 설정 · 데이터 관리 (경영지원팀)
 *
 * 여기서 하는 일은 전부 되돌리기 어렵거나 남의 작업에 영향을 준다.
 * 그래서 확인을 받고, 무엇을 왜 했는지 변경 이력에 남긴다.
 *
 * 월 상태
 *   open    작성 가능 — 팀장이 자기 팀 값을 쓸 수 있다
 *   closed  마감      — 아무도 못 쓴다. 다시 열 수 있다
 *   final   최종확정  — 잠금. 풀려면 사유를 남겨야 한다
 * ========================================================================== */
(function (global) {
  'use strict';

  var D = global.MpData, K = global.MpCalc, U = global.MpUI;
  var $ = U.$, $$ = U.$$, esc = U.esc, fmt = U.fmt, fmt0 = U.fmt0;

  var MEMBERS = [];

  function admin() { return MpAuth.isAdmin(); }

  function flash(msg, err) {
    var el = $('#adSave');
    el.className = 'chip ' + (err ? 'warn' : 'ok');
    el.textContent = msg;
    clearTimeout(flash.t);
    flash.t = setTimeout(function () { el.className = 'chip'; el.textContent = '—'; }, 2600);
  }
  function fail(e) { flash(e.message || '실패', true); }

  function render() {
    if (!admin()) {
      $('#adGate').className = 'note err';
      $('#adGate').innerHTML = '이 화면은 <b>경영지원팀(관리자)</b>만 볼 수 있습니다.';
      $('#adBody').classList.add('hide');
      return;
    }
    /* 폰에서는 열지 않는다. 월 확정과 팀원 해제는 되돌리기 어렵고,
       좁은 화면에서 잘못 누르기 쉬운 자리에 있다. */
    if (MpAuth.viewOnly()) {
      $('#adGate').className = 'note info';
      $('#adGate').innerHTML = '이 화면은 <b>PC 에서만</b> 씁니다. 월 확정 · 팀원 배정은 되돌리기 어려워 폰에서는 열지 않습니다.';
      $('#adBody').classList.add('hide');
      return;
    }
    $('#adGate').className = 'hide';
    $('#adBody').classList.remove('hide');
    renderPeriods();
    renderConfig();
    if (!MEMBERS.length) {
      D.loadMembers().then(function (r) { MEMBERS = r; renderMembers(); }).catch(fail);
    } else renderMembers();
    D.loadAudit(60).then(renderAudit).catch(function () {});
  }

  /* ---------- 월 운영 ---------- */
  function renderPeriods() {
    var h = '<thead><tr><th>월</th><th class="n">주차 수</th><th>상태</th>' +
      '<th class="n">최종 OL</th><th>근거</th><th style="width:280px">조작</th></tr></thead><tbody>';
    for (var mo = 1; mo <= 12; mo++) {
      var m = D.mOf(2026, mo), p = D.periodOf(m), st = p.state;
      var lb = st === 'open' ? '<span class="chip ok">작성 가능</span>'
        : st === 'final' ? '<span class="chip lock">🔒 최종확정</span>'
        : '<span class="chip">마감</span>';
      h += '<tr><td><b>' + mo + '월</b></td>' +
        '<td class="n"><input class="wkn" data-wk="' + m + '" type="number" min="1" max="6" value="' + p.weeks + '"></td>' +
        '<td>' + lb + '</td>' +
        '<td class="n">' + (p.final_k == null ? '<span class="zero">–</span>' : ((p.final_k + 1) + '주')) + '</td>' +
        '<td class="txt"><span class="q">' + esc(p.final_src || p.unlock_reason || '') + '</span></td>' +
        '<td>' + buttons(m, st) + '</td></tr>';
    }
    $('#tblPeriods').innerHTML = h + '</tbody>';

    $$('#tblPeriods button[data-act]').forEach(function (b) {
      b.onclick = function () { act(+this.dataset.m, this.dataset.act); };
    });
    $$('#tblPeriods input[data-wk]').forEach(function (i) {
      i.onchange = function () {
        var m = +this.dataset.wk, v = Math.max(1, Math.min(6, +this.value || 1));
        this.value = v;
        D.setPeriod(m, { weeks: v })
          .then(function () { return D.audit('주차 수 변경', { m: m, ref: '주차 수', after: v + '주' }); })
          .then(function () { K.bust(); flash('저장됨'); render(); }).catch(fail);
      };
    });
  }

  function buttons(m, st) {
    var b = '';
    if (st !== 'open') b += '<button class="btn" data-act="open" data-m="' + m + '">열기</button> ';
    if (st === 'open') b += '<button class="btn" data-act="close" data-m="' + m + '">마감</button> ';
    if (st !== 'final') b += '<button class="btn red" data-act="final" data-m="' + m + '">최종확정</button>';
    else b += '<button class="btn dark" data-act="unlock" data-m="' + m + '">확정 해제</button>';
    return b;
  }

  function act(m, what) {
    var mo = D.moOf(m);
    if (what === 'open') {
      if (D.isFinal(m) ) return;
      D.setPeriod(m, { state: 'open' })
        .then(function () { return D.audit('월 열기', { m: m, ref: '월 상태', before: '마감', after: '작성 가능' }); })
        .then(function () { K.bust(); flash(mo + '월을 열었습니다'); render(); }).catch(fail);
      return;
    }
    if (what === 'close') {
      D.setPeriod(m, { state: 'closed' })
        .then(function () { return D.audit('월 마감', { m: m, ref: '월 상태', before: '작성 가능', after: '마감' }); })
        .then(function () { K.bust(); flash(mo + '월을 마감했습니다'); render(); }).catch(fail);
      return;
    }
    if (what === 'final') {
      /* 한 팀만 보면 그 팀이 일찍 끝냈을 때 다른 팀의 뒷주차가 통째로 잘린다.
         전 팀 중 마지막으로 쓴 주차를 상한으로 삼는다. */
      var k = K.lastFilledK(m);
      var use = k >= 0 ? k : (D.weeksOf(m) - 1);
      U.ask(mo + '월 최종확정',
        '최종 OL = ' + (use + 1) + '주\n\n' +
        '확정하면 이 달은 잠깁니다. 값 수정 · 상세 · 변동사유가 모두 차단되고,\n' +
        '풀려면 사유를 남겨 확정을 해제해야 합니다.', '최종확정', true)
        .then(function (ok) {
          if (!ok) return;
          var was = D.stateOf(m);
          return D.setPeriod(m, { state: 'final', final_k: use, final_src: '관리자 확정 · ' + U.ymd() })
            .then(function () { return D.audit('최종 OL 확정', { m: m, ref: '월 상태', before: was, after: '최종확정 · ' + (use + 1) + '주' }); })
            .then(function () { K.bust(); flash(mo + '월을 확정했습니다'); render(); }).catch(fail);
        });
      return;
    }
    if (what === 'unlock') {
      var why = (window.prompt(mo + '월 확정을 해제합니다.\n사유를 적어 주세요. 변경 이력에 남습니다.', '') || '').trim();
      if (!why) { flash('사유가 없어 해제하지 않았습니다', true); return; }
      /* final_k 를 남겨 두면 해제한 뒤 새로 쓴 주차가 계속 무시된다 */
      D.setPeriod(m, { state: 'open', final_k: null, final_src: null, unlock_reason: why })
        .then(function () { return D.audit('확정 해제', { m: m, ref: '월 상태', before: '최종확정', after: '작성 가능', via: 'web:' + why }); })
        .then(function () { K.bust(); flash(mo + '월 확정을 해제했습니다'); render(); }).catch(fail);
    }
  }

  /* ---------- 팀원 ---------- */
  function renderMembers() {
    var ROLES = [['', '(접근 없음)'], ['lead', '팀장'], ['admin', '관리자'], ['viewer', '열람만']];
    var h = '<thead><tr><th>이름</th><th>이메일</th><th>승인</th>' +
      '<th style="width:150px">이동계획 역할</th><th style="width:170px">소속 팀</th></tr></thead><tbody>';
    MEMBERS.forEach(function (p) {
      h += '<tr><td><b>' + esc(p.name) + '</b></td><td class="q">' + esc(p.email) + '</td>' +
        '<td>' + (p.status === 'approved' ? '<span class="chip ok">승인</span>' : '<span class="chip warn">' + esc(p.status) + '</span>') + '</td>' +
        '<td><select class="sel" data-role="' + esc(p.id) + '">' +
          ROLES.map(function (r) {
            return '<option value="' + r[0] + '"' + ((p.mpRole || '') === r[0] ? ' selected' : '') + '>' + r[1] + '</option>';
          }).join('') + '</select></td>' +
        '<td><select class="sel" data-team="' + esc(p.id) + '"' + (p.mpRole ? '' : ' disabled') + '>' +
          [['*', '전체 (관리자)']].concat(D.TEAMS.map(function (t) { return [t, D.teamName(t)]; }))
            .map(function (t) {
              return '<option value="' + esc(t[0]) + '"' + ((p.team || '') === t[0] ? ' selected' : '') + '>' + esc(t[1]) + '</option>';
            }).join('') + '</select></td></tr>';
    });
    $('#tblMembers').innerHTML = h + '</tbody>';
    $('#memSub').textContent = MEMBERS.filter(function (p) { return p.mpRole; }).length +
      '명 접근 가능 / 전체 ' + MEMBERS.length + '명';

    $$('#tblMembers select').forEach(function (sel) {
      sel.onchange = function () {
        var id = this.dataset.role || this.dataset.team;
        var p = MEMBERS.filter(function (x) { return x.id === id; })[0];
        if (!p) return;
        var role = this.dataset.role != null ? this.value : (p.mpRole || '');
        var team = this.dataset.team != null ? this.value : (p.team || (role === 'admin' ? '*' : D.TEAMS[0]));
        if (!role) {
          U.ask(p.name + ' 의 이동계획 접근 해제',
            '이 사람은 더 이상 어떤 데이터도 볼 수 없습니다.', '접근 없애기', true)
            .then(function (ok) {
              if (!ok) { render(); return; }
              return D.removeMember(id)
                .then(function () { return D.audit('팀원 해제', { team: p.team, ref: p.email, before: p.mpRole, after: '없음' }); })
                .then(function () { p.mpRole = null; p.team = null; flash('접근을 없앴습니다'); renderMembers(); })
                .catch(fail);
            });
          return;
        }
        if (role === 'admin') team = '*';
        else if (team === '*') team = D.TEAMS[0];
        D.setMember(id, team, role)
          .then(function () { return D.audit('팀원 배정', { team: team, ref: p.email, before: (p.mpRole || '없음') + '/' + (p.team || '–'), after: role + '/' + team }); })
          .then(function () { p.mpRole = role; p.team = team; flash('저장됨'); renderMembers(); })
          .catch(fail);
      };
    });
  }

  /* ---------- 설정 ---------- */
  function renderConfig() {
    $('#gpRate').value = (D.gpRate() * 100).toFixed(2).replace(/\.?0+$/, '');
    $('#btnGp').onclick = function () {
      var v = parseFloat($('#gpRate').value);
      if (!(v >= 0 && v <= 100)) { flash('0~100 사이 값을 넣어 주세요', true); return; }
      D.setConfig('gongpan_rate', v / 100)
        .then(function () { return D.audit('공판율 변경', { ref: '공판율', after: v + '%' }); })
        .then(function () { K.bust(); flash('공판율을 ' + v + '% 로 바꿨습니다'); }).catch(fail);
    };
  }

  /* ---------- 변경 이력 ---------- */
  function renderAudit(rows) {
    if (!rows.length) { $('#tblAudit').innerHTML = '<tbody><tr><td class="q">아직 기록이 없습니다.</td></tr></tbody>'; return; }
    var h = '<thead><tr><th style="width:132px">시각</th><th style="width:120px">작업</th>' +
      '<th style="width:150px">대상</th><th>내용</th><th style="width:150px">사람</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      var tgt = (r.m != null ? (D.moOf(r.m) + '월 ') : '') + (r.team ? D.teamName(r.team) : '');
      var body = (r.ref ? r.ref + ' : ' : '') +
        (r.before != null || r.after != null ? ((r.before == null ? '' : r.before) + ' → ' + (r.after == null ? '' : r.after)) : '');
      h += '<tr><td class="q">' + esc(U.ymdhm(r.at)) + '</td>' +
        '<td>' + esc(r.action || '') + '</td><td>' + esc(tgt) + '</td>' +
        '<td class="txt">' + esc(body) + (r.via && r.via !== 'web' ? ' <span class="q">(' + esc(r.via) + ')</span>' : '') + '</td>' +
        '<td class="q">' + esc(r.email || '') + '</td></tr>';
    });
    $('#tblAudit').innerHTML = h + '</tbody>';
  }

  global.MpAdmin = { open: function () { render(); }, render: render };
})(window);
