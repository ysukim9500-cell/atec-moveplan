/* ============================================================================
 * mp-ui.js — 공용 부품
 *
 * 차트 색은 눈으로 고르지 않았다. 검증기(6개 검사)를 돌려 통과한 조합만 쓴다.
 *   계획 #2F6FB5 · 최종 OL #B07900 · 확정실적 #990033
 *   최악 인접쌍 ΔE 19.3(deutan) / 24.4(정상시력) — 전 항목 PASS
 * 처음 쓰던 청록(#3F7F86)은 채도가 낮아 회색으로 읽히고 파랑과 ΔE 12.0 이라 탈락했다.
 * ========================================================================== */
(function (global) {
  'use strict';

  /* 계열 색 — 정체성 순서 고정. 절대 순환시키지 않는다. */
  var C = { plan: '#2F6FB5', ol: '#B07900', act: '#990033' };
  /* 부호 — 상태색이라 계열색과 섞지 않는다 */
  var SIGN = { up: '#990033', down: '#2461a8', flat: '#727C83' };
  var INK = '#171C20', INK2 = '#4A555D', MUTED = '#727C83', RULE = '#DCE0E3', RULE2 = '#EBEEF0';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (m) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[m];
    });
  }
  function fmt(v, d) {
    if (v == null || v === '' || isNaN(v)) return '–';
    d = d == null ? 1 : d;
    return (Math.round(v * Math.pow(10, d)) / Math.pow(10, d))
      .toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function fmt0(v) { return (v == null || isNaN(v)) ? '–' : Math.round(v).toLocaleString('ko-KR'); }
  function sgn(v, d) {
    if (v == null || isNaN(v)) return '–';
    return (v > 0.05 ? '+' : v < -0.05 ? '−' : '') + fmt(Math.abs(v), d == null ? 1 : d);
  }
  function dcls(v) { return (v == null || isNaN(v) || Math.abs(v) < 0.05) ? 'flat' : (v > 0 ? 'up' : 'down'); }
  function pct(v) { return (v == null || isNaN(v) || !isFinite(v)) ? '–' : Math.round(v * 100) + '%'; }

  /* ---------- 시각 ----------
     언제나 한국 시간으로 보인다. 서버는 UTC 로 주고 PC 시간대는 어긋나 있을 수 있다.
     보는 사람마다 보고서의 시각이 다르면 안 되므로 브라우저 설정을 따르지 않는다. */
  var KST_MIN = 9 * 60;
  function p2(n) { return (n < 10 ? '0' : '') + n; }

  /** 어떤 시각이든 «한국 시간의 벽시계 값»을 가진 Date 로 바꾼다 */
  function kst(v) {
    var d = (v == null) ? new Date() : (v instanceof Date ? v : new Date(v));
    if (isNaN(d.getTime())) return null;
    return new Date(d.getTime() + (KST_MIN + d.getTimezoneOffset()) * 60000);
  }
  /** 2026-09-07 · sep 로 구분자를 바꾼다 ('' 이면 20260907) */
  function ymd(v, sep) {
    var d = kst(v); if (!d) return '';
    sep = (sep == null) ? '-' : sep;
    return d.getFullYear() + sep + p2(d.getMonth() + 1) + sep + p2(d.getDate());
  }
  /** 2026-09-07 14:30 */
  function ymdhm(v) {
    var d = kst(v); if (!d) return '';
    return ymd(v) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
  }
  /** 방금 · 12분 전 · 3시간 전 · 어제 14:30 · 9/5 14:30 */
  function ago(v) {
    var d = (v instanceof Date) ? v : new Date(v);
    if (isNaN(d.getTime())) return '';
    var s = Math.floor((Date.now() - d.getTime()) / 1000);
    if (s < 0) s = 0;
    if (s < 60) return '방금';
    if (s < 3600) return Math.floor(s / 60) + '분 전';
    if (s < 86400) return Math.floor(s / 3600) + '시간 전';
    var a = kst(v), b = kst(new Date());
    var days = Math.round((new Date(b.getFullYear(), b.getMonth(), b.getDate()) -
                           new Date(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000);
    if (days === 1) return '어제 ' + p2(a.getHours()) + ':' + p2(a.getMinutes());
    if (days < 7) return days + '일 전';
    return (a.getMonth() + 1) + '/' + a.getDate() + ' ' + p2(a.getHours()) + ':' + p2(a.getMinutes());
  }

  function niceMax(v) {
    if (!(v > 0)) return 10;
    var p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  }

  /* ---------- 탭 ---------- */
  function tabs(host, items, cur, onPick) {
    if (!host) return;
    host.innerHTML = items.map(function (it) {
      return '<button class="tab' + (it.id === cur ? ' on' : '') + (it.dim ? ' dim' : '') + '"' +
        (it.title ? ' title="' + esc(it.title) + '"' : '') +
        ' data-v="' + esc(it.id) + '">' + esc(it.label) + (it.mark ? ' <i>' + esc(it.mark) + '</i>' : '') + '</button>';
    }).join('');
    $$('button', host).forEach(function (b) {
      b.onclick = function () {
        var v = this.dataset.v;
        onPick(isNaN(Number(v)) || v === '' ? v : Number(v));
      };
    });
  }

  /* ---------- 툴팁 ---------- */
  var TIP = null;
  function tip() {
    if (!TIP) {
      TIP = document.createElement('div');
      TIP.className = 'viz-tip';
      document.body.appendChild(TIP);
    }
    return TIP;
  }
  function tipShow(x, y, html) {
    var t = tip();
    t.innerHTML = html;
    t.classList.add('on');
    var w = t.offsetWidth, h = t.offsetHeight;
    var left = Math.min(Math.max(8, x - w / 2), window.innerWidth - w - 8);
    var top = y - h - 12;
    if (top < 8) top = y + 18;
    t.style.left = left + 'px';
    t.style.top = top + 'px';
  }
  function tipHide() { if (TIP) TIP.classList.remove('on'); }

  /* ---------- 월별 추이 : 선 ----------
     시간에 따른 변화라 선이 맞다. 계열이 3개이므로 범례를 항상 두고,
     4개 이하이므로 마지막 점에 직접 라벨도 단다 — 색만으로 구분하지 않는다. */
  function lineChart(host, o) {
    if (!host) return;
    var W = host.clientWidth || 640, H = o.h || 250;
    var padL = 46, padR = 58, padT = 14, padB = 26;
    var labels = o.labels, series = o.series.filter(function (s) { return s.values.some(function (v) { return v != null; }); });

    var max = 0, min = 0;
    series.forEach(function (s) {
      s.values.forEach(function (v) { if (v != null) { if (v > max) max = v; if (v < min) min = v; } });
    });
    var top = niceMax(max), bot = min < 0 ? -niceMax(-min) : 0;
    var innerW = W - padL - padR, innerH = H - padT - padB;
    var X = function (i) { return padL + (labels.length === 1 ? innerW / 2 : innerW * i / (labels.length - 1)); };
    var Y = function (v) { return padT + innerH - ((v - bot) / ((top - bot) || 1)) * innerH; };

    var g = '';
    /* 눈금 — 뒤로 물러나 있어야 한다 */
    var TICKS = 4;
    for (var t = 0; t <= TICKS; t++) {
      var val = bot + (top - bot) * t / TICKS, y = Y(val);
      g += '<line x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y +
           '" stroke="' + (val === 0 ? RULE : RULE2) + '" stroke-width="1"/>' +
           '<text x="' + (padL - 8) + '" y="' + (y + 3.5) + '" text-anchor="end" font-size="10.5" fill="' + MUTED + '">' +
           fmt0(val) + '</text>';
    }
    /* 선택 구간 음영 */
    if (o.shade && o.shade.length) {
      var a = Math.min.apply(null, o.shade), b = Math.max.apply(null, o.shade);
      var x0 = X(a) - (innerW / (labels.length - 1)) / 2, x1 = X(b) + (innerW / (labels.length - 1)) / 2;
      g = '<rect x="' + Math.max(padL, x0) + '" y="' + padT + '" width="' + (Math.min(W - padR, x1) - Math.max(padL, x0)) +
          '" height="' + innerH + '" fill="#171C20" opacity=".045"/>' + g;
    }
    /* x 라벨 */
    labels.forEach(function (lb, i) {
      g += '<text x="' + X(i) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="10.5" fill="' + MUTED + '">' + esc(lb) + '</text>';
    });

    /* 선 — 2px. 마커는 지름 8px, 겹침 대비 2px 서피스 링. */
    var marks = [];
    series.forEach(function (s) {
      var d = '', on = false;
      s.values.forEach(function (v, i) {
        if (v == null) { on = false; return; }
        d += (on ? 'L' : 'M') + X(i) + ' ' + Y(v); on = true;
      });
      g += '<path d="' + d + '" fill="none" stroke="' + s.color + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
      s.values.forEach(function (v, i) {
        if (v == null) return;
        g += '<circle cx="' + X(i) + '" cy="' + Y(v) + '" r="4" fill="' + s.color + '" stroke="#fff" stroke-width="2"/>';
      });
      var li = -1;
      s.values.forEach(function (v, i) { if (v != null) li = i; });
      if (li >= 0) marks.push({ name: s.name, color: s.color, x: X(li), y: Y(s.values[li]) });
    });

    /* 직접 라벨 — 마지막 실값에만.
       그냥 찍으면 선끼리 붙는 구간에서 라벨이 겹쳐 읽히지 않는다.
       세로로 밀어 최소 간격을 확보하고, 선 위를 지날 때를 대비해 흰 테두리를 두른다. */
    marks.sort(function (a, b) { return a.y - b.y; });
    var GAP = 13;
    for (var mi = 1; mi < marks.length; mi++) {
      if (marks[mi].y - marks[mi - 1].y < GAP) marks[mi].y = marks[mi - 1].y + GAP;
    }
    marks.forEach(function (mk) {
      var right = mk.x + 9 + mk.name.length * 7 < W - 4;
      g += '<text x="' + (right ? mk.x + 9 : mk.x - 9) + '" y="' + (mk.y + 3.5) + '"' +
           (right ? '' : ' text-anchor="end"') +
           ' font-size="10.5" font-weight="700" fill="' + INK2 +
           '" stroke="#fff" stroke-width="3" paint-order="stroke" stroke-linejoin="round">' +
           esc(mk.name) + '</text>';
    });

    /* 크로스헤어 — 기본으로 단다 */
    g += '<line id="vx" x1="0" y1="' + padT + '" x2="0" y2="' + (padT + innerH) + '" stroke="' + INK + '" stroke-width="1" opacity="0"/>';
    g += '<rect x="' + padL + '" y="' + padT + '" width="' + innerW + '" height="' + innerH + '" fill="transparent" id="vhit"/>';

    host.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '" role="img" aria-label="' +
      esc(o.aria || '월별 추이') + '">' + g + '</svg>';

    var svg = host.querySelector('svg'), vx = svg.querySelector('#vx');
    svg.querySelector('#vhit').addEventListener('mousemove', function (e) {
      var r = svg.getBoundingClientRect();
      var px = (e.clientX - r.left) * (W / r.width);
      var i = Math.round((px - padL) / (innerW / Math.max(1, labels.length - 1)));
      i = Math.max(0, Math.min(labels.length - 1, i));
      vx.setAttribute('x1', X(i)); vx.setAttribute('x2', X(i)); vx.setAttribute('opacity', '.18');
      var rows = series.map(function (s) {
        return '<div class="r"><i style="background:' + s.color + '"></i>' + esc(s.name) +
               '<b>' + fmt(s.values[i]) + '</b></div>';
      }).join('');
      tipShow(e.clientX, e.clientY, '<div class="h">' + esc(labels[i]) + '</div>' + rows);
    });
    svg.querySelector('#vhit').addEventListener('mouseleave', function () {
      vx.setAttribute('opacity', '0'); tipHide();
    });
  }

  /* ---------- 팀별 기여 : 가로 막대 ----------
     한 측정치를 여러 대상에 걸쳐 비교하는 것이므로 크기 문제다.
     정체성이 아니라 크기이니 색은 하나만 쓴다. */
  function barsH(host, o) {
    if (!host) return;
    var rows = o.rows.filter(function (r) { return r.v != null; });
    var max = 0;
    rows.forEach(function (r) { if (Math.abs(r.v) > max) max = Math.abs(r.v); });
    max = max || 1;
    var html = '<div class="bh">' + rows.map(function (r, i) {
      var w = Math.abs(r.v) / max * 100;
      return '<div class="bh-row" data-i="' + i + '">' +
        '<div class="bh-nm">' + esc(r.name) + '</div>' +
        '<div class="bh-tr"><i style="width:' + w.toFixed(1) + '%;background:' + (o.color || C.act) + '"></i></div>' +
        '<div class="bh-v">' + fmt(r.v, o.d == null ? 0 : o.d) + '</div>' +
        '</div>';
    }).join('') + '</div>';
    host.innerHTML = html;
    $$('.bh-row', host).forEach(function (el) {
      el.addEventListener('mousemove', function (e) {
        var r = rows[+this.dataset.i];
        tipShow(e.clientX, e.clientY, '<div class="h">' + esc(r.name) + '</div>' +
          '<div class="r">' + esc(o.unit || '백만원') + '<b>' + fmt(r.v, 1) + '</b></div>' +
          (r.sub ? '<div class="r">' + esc(r.sub) + '</div>' : ''));
      });
      el.addEventListener('mouseleave', tipHide);
    });
  }

  /* ---------- 확인 창 ----------
     window.confirm 을 쓰지 않는다. 브라우저가 «이 페이지에서 대화 상자를 추가로
     표시하지 않음» 을 켜면 confirm 은 묻지도 않고 false 를 돌려준다 — 그러면
     버튼을 눌러도 아무 일이 없고, 화면에는 아무 말도 남지 않는다.
     확인은 우리 화면 안에서 받는다. */
  var ASKBOX = null;
  function ask(title, body, okLabel, danger) {
    return new Promise(function (resolve) {
      if (!ASKBOX) {
        ASKBOX = document.createElement('div');
        ASKBOX.className = 'askwrap';
        document.body.appendChild(ASKBOX);
      }
      var done = false;
      var close = function (v) {
        if (done) return;
        done = true;
        ASKBOX.className = 'askwrap';
        ASKBOX.innerHTML = '';
        document.removeEventListener('keydown', onKey, true);
        resolve(v);
      };
      var onKey = function (e) {
        if (e.key === 'Escape') { e.preventDefault(); close(false); }
        if (e.key === 'Enter') { e.preventDefault(); close(true); }
      };
      ASKBOX.innerHTML = '<div class="askbg"></div><div class="askbox" role="dialog" aria-modal="true">' +
        '<div class="askh">' + esc(title) + '</div>' +
        '<div class="askb">' + String(body || '').split('\n').map(function (l) {
          return l.trim() === '' ? '<div class="askgap"></div>' : '<div>' + esc(l) + '</div>';
        }).join('') + '</div>' +
        '<div class="askf"><button class="btn" data-a="0">취소</button>' +
        '<button class="btn ' + (danger ? 'red' : 'dark') + '" data-a="1">' + esc(okLabel || '확인') + '</button></div></div>';
      ASKBOX.className = 'askwrap on';
      ASKBOX.querySelector('.askbg').onclick = function () { close(false); };
      $('button[data-a]', ASKBOX).forEach(function (b) {
        b.onclick = function () { close(this.dataset.a === '1'); };
      });
      var ok = ASKBOX.querySelector('button[data-a="1"]');
      if (ok) ok.focus();
      document.addEventListener('keydown', onKey, true);
    });
  }

  /* ---------- 범례 ---------- */
  function legend(host, items) {
    if (!host) return;
    host.innerHTML = items.map(function (i) {
      return '<span class="lg"><i style="background:' + i.color + '"></i>' + esc(i.name) + '</span>';
    }).join('');
  }

  global.MpUI = {
    C: C, SIGN: SIGN, $: $, $$: $$,
    esc: esc, fmt: fmt, fmt0: fmt0, sgn: sgn, dcls: dcls, pct: pct, niceMax: niceMax,
    kst: kst, ymd: ymd, ymdhm: ymdhm, ago: ago,
    tabs: tabs, lineChart: lineChart, barsH: barsH, legend: legend,
    tipShow: tipShow, tipHide: tipHide, ask: ask
  };
})(window);
