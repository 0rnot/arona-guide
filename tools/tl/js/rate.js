import { $, B, S, esc, mmss } from './util.js';
import { SLOTS, st } from './core.js';
import { diff } from './boss.js';
import { scen, scenIx } from './scen.js';
import { clamp } from './stats.js';
import { usesSorted } from './buff.js';
import { liveBuffs } from './target.js';
import { altList } from './alt.js';
import { dmgOf, nbOf } from './dmg.js';
import { total } from './clear.js';
import { fit } from './zoom.js';

export function n0(v) { return Math.round(v).toLocaleString('ja-JP'); }
/** ステータス名の日本語。`_Base` / `_Coefficient` を落として引く */
export function statName(k) {
  var b = String(k).replace(/_(Base|Coefficient)$/, '');
  return (B.statJA || {})[b] || b;
}
/** **万分率で持っている欄かどうか。**`〜Rate` `〜Ratio` は `_Base` でも割合
    （`EnhancePierceRate_Base` 5888 ＝ 貫通特効 +58.88%）。
    `AttackPower_Base` のような素の値と混ぜない */
export function isPct(k) {
  return /_Coefficient$/.test(k) || /(Rate|Ratio\d*)(_Base)?$/.test(k);
}
export function fmtBuff(e) {
  var v = e.v;
  return '・' + statName(e.stat) + ' ' + (v > 0 ? '+' : '') +
         (isPct(e.stat) ? (v / 100).toFixed(2).replace(/\.?0+$/, '') + '%' : n0(v)) +
         (e.fromN ? '（' + e.fromN + '）' : '');
}
/** その時刻に効いているものを並べる。**ツールチップに出す**
    （2026-09-01 の先生の指示「なんのデバフがかかってて なんのバフが
    かかってるのか各スキルやデバフ数の場所でわかる方が良い」） */
export function buffTip(idx, at, r, sides) {
  var s = '', i, a, d;
  if (sides !== 'enemy' && idx != null) {
    a = liveBuffs(at, 'ally' + idx, r);
    if (a.length) {
      s += '\n\n【この時点で乗っているバフ】';
      for (i = 0; i < a.length; i++) { s += '\n' + fmtBuff(a[i]); }
    }
  }
  if (sides !== 'ally') {
    d = liveBuffs(at, 'enemy', r);
    if (d.length) {
      s += '\n\n【この時点で相手にかかっているデバフ】';
      for (i = 0; i < d.length; i++) { s += '\n' + fmtBuff(d[i]); }
    }
  }
  return s;
}
// 会心と乱数の振れ幅。**倍率の幅（段・条件）は動かさない**
export var RHEAD = [['残HP／階層HP', '与ダメージ', 'EX合計', 'NS合計', '通常合計', 'SS合計'],
             ['目標までの残り', '達成率', '与ダメージ', '目標ダメージ', '1秒あたり', '制限時間']];
export function drawRate() {
  var r = diff(), hp = (r.bs && r.bs.hp) || 0, h = '', i, k;
  var cache = {};
  function tot(pf) {
    var key = String(pf);
    if (!cache[key]) { cache[key] = total(r, pf); }
    return cache[key];
  }
  var t = tot(0);
  // **置いた中に幅を持つ 1 発も無ければ、上振れ・下振れは真ん中の行と同じ数字になる。**
  // 枠の数だけで決めると、幅のあるスキルを 1 発も置いていないときに同じ行が並ぶ
  // （2026-09-01）
  var spread = altList().length > 0 && tot(-1).avg !== tot(1).avg;
  var goal = (st.goal && st.goal.dmg) || hp, sec = (st.goal && st.goal.sec) || (r.dur || 240);
  // 名前の欄は「下振れ 〜 上振れ」を 1 行で収める幅（2026-09-03）
  var hd = '<tr><th style="width:168px"></th>';
  for (i = 0; i < 6; i++) { hd += '<th>' + RHEAD[st.tab][i] + '</th>'; }
  hd += '</tr>';
  // **行は 1 本だけ**（2026-09-03 の先生の指示。5 通りの書き分けをやめた）。
  // 出すのは上の帯で選んでいるシナリオ（既定は「平均」）で、会心率は
  // その下のバー（`st.crit`）。下振れ・上振れは行を分けず、名前の下に細く添える
  var TIP = { '下振れ': '倍率の幅をぜんぶいちばん低い候補にして、会心も無しにしたとき',
              '上振れ': '倍率の幅をぜんぶいちばん高い候補にして、ぜんぶ会心したとき',
              '平均': '倍率の幅は今の個別設定のまま、会心率は下のバーの値' };
  var scNow = scen();
  var lo0 = tot(-1).min, hi0 = tot(1).max;
  var sub = (hp && t.n && hi0 - lo0 > 1)
    ? '<span class="sub">下振れ ' + n0(lo0) + '〜 上振れ ' + n0(hi0) + '</span>' : '';
  var rows = [{ lab: scNow.lab, key: scNow.key, pf: scNow.pf, ix: scenIx(),
                tip: TIP[scNow.lab] || null, sub: sub }];
  for (i = 0; i < rows.length; i++) {
    var row = rows[i], tt = tot(row.pf), v = tt[row.key];
    h += '<tr class="' + (row.pf ? 'lohi ' : '') +
         'now" data-scen="' + row.ix + '"><td class="n"' +
         (row.tip ? ' title="' + esc(row.tip) + '"' : '') + '>' +
         esc(row.lab) + row.sub + '</td>';
    if (!tt.n || !hp) {
      for (k = 0; k < 6; k++) {
        h += '<td class="v"><span class="cell"><span class="bar"><i style="width:0%"></i></span>' +
             '<span class="num mut">—</span></span></td>';
      }
    } else if (st.tab === 0) {
      var ve = tt.ex[row.key], vn = tt.ns[row.key], va = tt.na[row.key];
      h += cell(Math.max(0, hp - v) / hp, n0(Math.max(0, hp - v)));
      h += cell(Math.min(1, v / hp), n0(v));
      h += cell(v ? ve / v : 0, n0(ve));
      h += cell(v ? vn / v : 0, n0(vn));
      h += cell(v ? va / v : 0, n0(va));
      // **SS のダメージはまだ入れていない。**0 と書くと「0 ダメージ」に見える
      h += cell(0, '—');
    } else {
      var rate = goal ? v / goal : 0;
      h += cell(Math.max(0, goal - v) / (goal || 1), n0(Math.max(0, goal - v)));
      h += cell(Math.min(1, rate), (rate * 100).toFixed(2) + '%');
      h += cell(Math.min(1, v / (goal || 1)), n0(v));
      h += cell(1, n0(goal));
      h += cell(1, n0(v / (sec || 1)));
      h += cell(1, mmss(sec, 0));
    }
    h += '</tr>';
  }
  $('rate').innerHTML = hd + h;
  var g = $('goal-note');
  if (!g) { return; }
  if (!hp) { g.textContent = ''; return; }
  g.innerHTML = esc(n0(goal)) + ' ／ ' + esc(mmss(sec, 0)) +
    '　EX ' + t.ex.n + '／' + st.tl.length + '　NS ' + t.ns.n + '　通常 ' + t.na.n +
    (spread ? '　\u25c7 ' + altList().length : '');
}
export function cell(frac, txt) {
  return '<td class="v"><span class="cell"><span class="bar"><i style="width:' +
         (clamp(frac, 0, 1) * 100).toFixed(1) + '%"></i></span>' +
         '<span class="num">' + esc(txt) + '</span></span></td>';
}
/** **バーの既定になる「素の会心率」。**編成と相手から出る値で、置いた EX の平均。
    1 発も置いていなければ編成の先頭の EX で引く（2026-09-03） */
export function critNat() {
  var r = diff(), us = usesSorted(), i, sum = 0, n = 0, d;
  var sv = st.crit;
  st.crit = null;
  try {
    for (i = 0; i < us.length; i++) {
      d = dmgOf(us[i].i, r, us[i].t, us[i].k, us[i].pk, us[i].tg, us[i].gx, us[i].no,
                null, nbOf(us[i]));
      if (d && d.crit0 != null) { sum += d.crit0; n++; }
    }
    if (!n) {
      for (i = 0; i < SLOTS; i++) {
        if (!st.party[i]) { continue; }
        d = dmgOf(i, r, null, 'Ex');
        if (d && d.crit0 != null) { sum += d.crit0; n++; break; }
      }
    }
  } finally { st.crit = sv; }
  return n ? sum / n : 0;
}
/** 会心率のバー。**`st.crit` が null なら素の値の位置に置いて「自動」と書く**
    （2026-09-03 の先生の指示で 5 行のシナリオから移した） */
export function drawCrit() {
  var el = $('i-crit');
  if (!el) { return; }
  var nat = critNat(), v = st.crit == null ? nat : st.crit;
  el.value = String(Math.round(v * 1000) / 10);
  $('i-critv').textContent = (v * 100).toFixed(1) + '%';
  $('b-critauto').hidden = st.crit == null;
  $('i-critn').textContent = st.crit == null
    ? '自動（編成から ' + (nat * 100).toFixed(1) + '%）'
    : '素は ' + (nat * 100).toFixed(1) + '%';
}

// **畳んだ・広げた・大きさを変えた、を全部戻す。**localStorage を消して
// DOM も戻すので、開けなくなっても必ずここから復帰できる（2026-09-01）
export function uiReset() {
  var i, ks = [], k;
  try {
    for (i = 0; i < localStorage.length; i++) {
      k = localStorage.key(i);
      if (k && (k.indexOf('tl-fold-') === 0 || k.indexOf('tl-sz-') === 0 ||
                k === 'tl-shut' || k === 'tl-lanes')) {
        ks.push(k);
      }
    }
    for (i = 0; i < ks.length; i++) { localStorage.removeItem(ks[i]); }
  } catch (e) { void e; }
  var ps = document.querySelectorAll('.tlapp .pane, .tlapp .stage');
  for (i = 0; i < ps.length; i++) {
    ps[i].classList.remove('folded', 'sized');
    ps[i].style.height = '';
    var b = ps[i].querySelector('h2.sect > .fold');
    if (b) { b.setAttribute('aria-expanded', 'true'); }
  }
  $('tlmain').classList.remove('wide');
  $('tlmain').style.removeProperty('--lcol');
  $('tlleft').classList.remove('shut');
  $('b-side').setAttribute('aria-expanded', 'true');
  fit();
}
export function keyHelp() { alert('Ctrl+Z 戻す／Ctrl+Y（Ctrl+Shift+Z）進む／' +
      'Ctrl+ホイール 拡大／Shift+ホイール・中ドラッグ 横移動／W S 拡大／A D 横移動／' +
      '←→ 1コマ（Shift で 10 コマ、Ctrl で 1 秒）／Home 全体／End 末尾／' +
      'EX レーンをクリックでスキルを置く／バーをドラッグで移動／Delete で消す／Esc 解除／' +
      '畳んだ・大きさを変えたのを戻すのは上の「表示を戻す」'); }
