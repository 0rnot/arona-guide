import { $, B, S, bufStk, esc, img } from './util.js';
import { LAY, MAIN_MAX, SLOTS, isMain, live, mkSlot, st } from './core.js';
import { n0 } from './rate.js';
import { potOf, statsOf, wlvMax } from './passive.js';
import { danMax } from './buff.js';
import { ALTJA, ALTK, altList, altScale, lvlOf, pickOf } from './alt.js';

// ------------------------------------------------------------ 左
export function drawParty() {
  var h = '', i;
  for (i = 0; i < st.parties.length; i++) {
    h += '<button type="button" class="btn2" data-pt="' + i + '" aria-pressed="' +
         (i === st.pi) + '">P' + (i + 1) + '</button>';
  }
  // **最後でない部隊には「終わりの秒」。**空なら 撃破時刻／ギブアップ／制限時間 の順で決める
  if (st.parties.length > 1 && st.pi < st.parties.length - 1) {
    var pe = st.parties[st.pi].end;
    h += '<input type="number" id="p-end" step="0.1" min="0" placeholder="終了秒" title="この部隊が終わる秒（空なら 撃破時刻・ギブアップ・制限時間）" style="width:64px" value="' +
         (pe == null ? '' : pe) + '">';
  }
  $('ptabs').innerHTML = h;
  $('b-addparty').disabled = st.parties.length >= 4;
  var bs = document.querySelectorAll('#modeseg button');
  for (i = 0; i < bs.length; i++) {
    bs[i].setAttribute('aria-pressed', +bs[i].getAttribute('data-mode') === st.mode ? 'true' : 'false');
  }
}
/** 開始スキルの番号を選ぶ小さな箱。**アイコンの下に付ける**
    （2026-09-01 の先生の指示「開始スキルもアイコン下に数字の選択ボックスで
    入れるだけのがいい」）。1〜N は engine の LAYOUT.start */
export function startBox(i) {
  var n = LAY[st.mode].start, at = st.start.indexOf(i), q;
  var h = '<select class="stn" data-sk2="' + i + '" title="開始スキルの順番">' +
          '<option value="">—</option>';
  for (q = 0; q < n; q++) {
    h += '<option value="' + (q + 1) + '"' + (at === q ? ' selected' : '') + '>' +
         (q + 1) + '</option>';
  }
  return h + '</select>';
}
export function slotCard(i) {
  var p = st.party[i], sl = st.slots[i];
  if (!p) {
    return '<div class="cw"><button type="button" class="c empty" data-slot="' + i +
           '" title="ここに入れる生徒を下から選びます"><span class="pl">＋</span></button>' +
           '<select class="stn" disabled><option>—</option></select></div>';
  }
  return '<div class="cw"><button type="button" class="c' + (st.who === i ? ' on' : '') +
    '" data-slot="' + i +
    '" title="' + esc(p.n) + '\nLv' + sl.lv + ' 星' + sl.star + '／EX Lv' + sl.ex +
    '\nクリックで育成をこの子に切り替えます">' + img(p.id) +
    '<span class="lvb">' + sl.lv + '</span>' +
    '<span class="x" data-rm="' + i + '" role="button" aria-label="外す">×</span></button>' +
    startBox(i) + '</div>';
}
// **1 列に並べて、見出しだけ上に置く**（2026-09-01 の先生の指示
// 「STRIKER　SPECIAL ／ ◻️◻️◻️◻️ ◻️◻️ って表示でもいい」）。
// 2 行に分けると、枠の少ない SPECIAL だけ札が小さくなっていた
export function drawCrew() {
  var h = '', nm = 0, ns = 0, i;
  for (i = 0; i < MAIN_MAX; i++) { if (live(i)) { h += slotCard(i); nm++; } }
  for (i = MAIN_MAX; i < SLOTS; i++) { if (live(i)) { h += slotCard(i); ns++; } }
  $('crew-all').innerHTML = h;
  $('crew-all').style.setProperty('--n', (nm + ns) || 1);
  $('crewhead').style.setProperty('--n', (nm + ns) || 1);
  $('crewhead').innerHTML =
    '<span class="h st" style="grid-column:span ' + (nm || 1) + '">STRIKER</span>' +
    '<span class="h sp" style="grid-column:span ' + (ns || 1) + '">SPECIAL</span>';
}
export var SORTS = {
  n: function (a, b) { return a.n < b.n ? -1 : (a.n > b.n ? 1 : 0); },
  c: function (a, b) { return ((a.c || [])[4] || 0) - ((b.c || [])[4] || 0) || (a.n < b.n ? -1 : 1); },
  d: function (a, b) { return (a.d || 0) - (b.d || 0) || (a.n < b.n ? -1 : 1); },
  id: function (a, b) { return b.id - a.id; }
};
export function drawPicker() {
  var f = st.filt, list = [], i, k;
  for (i = 0; i < S.students.length; i++) {
    var s2 = S.students[i];
    if (f.q && s2.n.indexOf(f.q) < 0) { continue; }
    if (f.role && s2.ro !== f.role) { continue; }
    if (f.bul && s2.bt !== f.bul) { continue; }
    if (f.arm && s2.at !== f.arm) { continue; }
    if (f.sch && s2.sc !== f.sch) { continue; }
    if (f.sq && s2.sq !== f.sq) { continue; }
    if (f.star && String(s2.st) !== f.star) { continue; }
    list.push(s2);
  }
  list.sort(SORTS[f.sort] || SORTS.n);
  var inParty = {};
  for (k = 0; k < SLOTS; k++) { if (st.party[k]) { inParty[st.party[k].id] = 1; } }
  var h = '';
  for (i = 0; i < list.length; i++) {
    var s3 = list[i], on = !!inParty[s3.id];
    // **左の色帯は攻撃タイプ**（2026-09-01 の先生の指示）。
    // ストライカーとスペシャルの絞り込みは詳細フィルターの「配置」にある
    var bl = (S.labels && S.labels.BulletType && S.labels.BulletType[s3.bt]) || s3.bt || '';
    h += '<button type="button" class="pk bt-' + esc(s3.bt || 'Normal') + '" data-add="' + s3.id +
         '" aria-pressed="' + on + '" title="' + esc(s3.n) + '\n' + esc(bl) + '／' +
         (s3.sq === 'Main' ? 'STRIKER' : 'SPECIAL') + '／EX コスト ' + ((s3.c || [])[4] == null ? '—' : s3.c[4]) +
         '／演出 ' + (s3.d || '—') + 'f">' + img(s3.id) +
         '<span class="n">' + esc(s3.n) + '</span>' +
         '<span class="cst">' + ((s3.c || [])[4] == null ? '' : s3.c[4]) + '</span></button>';
  }
  $('picker').innerHTML = h;
  $('pick-n').textContent = list.length + ' / ' + S.students.length + ' 人';
}
// ---- 育成（対象ごと）
export function opt(id, vals, cur, fmt) {
  var e = $(id), h = '';
  for (var i = 0; i < vals.length; i++) {
    h += '<option value="' + vals[i] + '"' + (String(vals[i]) === String(cur) ? ' selected' : '') +
         '>' + (fmt ? fmt(vals[i]) : vals[i]) + '</option>';
  }
  e.innerHTML = h;
}
export var _dft = mkSlot();
export function whoSlot() { return st.who < 0 ? _dft : st.slots[st.who]; }
export function fillWho() {
  var h = '<option value="-1">既定（これから入れる子）</option>', i;
  for (i = 0; i < SLOTS; i++) {
    if (live(i) && st.party[i]) {
      h += '<option value="' + i + '">' + (isMain(i) ? 'ST' : 'SP') + (isMain(i) ? i + 1 : i - MAIN_MAX + 1) +
           '　' + esc(st.party[i].n) + '</option>';
    }
  }
  $('g-who').innerHTML = h;
  if (st.who >= 0 && !st.party[st.who]) { st.who = -1; }
  $('g-who').value = String(st.who);
}
export function fillBuild() {
  fillWho();
  var b = whoSlot(), lvs = [], i, wl = [], bl = [], pl = [];
  for (i = 1; i <= 90; i++) { lvs.push(i); }
  // **固有武器の段は星が決める上限まで**（wlvMax の注記に出典）
  for (i = 0; i <= wlvMax(b.wstar); i++) { wl.push(i); }
  for (i = 1; i <= 100; i++) { bl.push(i); }
  for (i = 0; i <= 25; i++) { pl.push(i); }
  opt('g-lv', lvs, b.lv);
  opt('g-star', [1, 2, 3, 4, 5], b.star, function (v) { return '★' + v; });
  // 3 枠バラバラのときは低いほうを出す。**選び直せば 3 枠とも揃う**
  var eqShow = (b.eq && b.eq.length === 3) ? Math.min(b.eq[0], b.eq[1], b.eq[2]) : b.eq;
  opt('g-eq', [0,1,2,3,4,5,6,7,8,9,10], eqShow, function (v) { return v ? 'T' + v : 'なし'; });
  opt('g-wlv', wl, Math.min(b.wlv, wlvMax(b.wstar)),
      function (v) { return v ? 'Lv' + v : 'なし'; });
  opt('g-wstar', [0, 1, 2, 3, 4], b.wstar, function (v) { return '★' + v; });
  opt('g-ex', [1, 2, 3, 4, 5], b.ex, function (v) { return 'Lv' + v; });
  opt('g-sk', [1,2,3,4,5,6,7,8,9,10], b.sk, function (v) { return 'Lv' + v; });
  opt('g-plv', [1,2,3,4,5,6,7,8,9,10], b.plv, function (v) { return 'Lv' + v; });
  opt('g-sslv', [1,2,3,4,5,6,7,8,9,10], b.sslv, function (v) { return 'Lv' + v; });
  // **愛用品は T2 まで**（2026-09-03 の先生の指摘「育成の愛用品のT3って無くない？」）。
  // 出典は `schaledb_config.json` の `GearBondReq: [15, 20]` と、
  // 生徒の `Gear.TierUpMaterial` が 1 段ぶんしか無いこと
  opt('g-gear', [0, 1, 2], Math.min(b.gear, 2),
      function (v) { return v ? 'T' + v : 'なし'; });
  opt('g-bond', bl, b.bond);
  // 潜在は 3 本あるが、選ぶのは 1 つ。**読み込みだけが枠ごとに違う値を入れる**
  opt('g-pot', pl, Math.max.apply(null, potOf(b)));
  var p = st.who < 0 ? null : st.party[st.who];
  var cs = p ? statsOf(p.id, st.who) : null;
  $('build-note').innerHTML = p
    ? esc(p.n) + '　攻撃 <b>' + n0(cs.get('AttackPower')) + '</b>／会心 <b>' +
      n0(cs.get('CriticalPoint')) + '</b>／会心ダメージ <b>' +
      (cs.get('CriticalDamageRate') / 100).toFixed(0) + '%</b>' +
      (b.wstar >= 4 && !isMain(st.who) ? '　固有★4 でコスト上限 +0.5' : '')
    : '';
}
// **バーで倍率を選ぶ。**候補は左が一番低い倍率
// **通常スキルが「味方1人」の子は、渡し先を枠ごとに決める。**
// NS は自分では置けないので、育成ではなくここで持つ
// 「バフを渡す相手」のパネルは消した（2026-09-03 の先生の指摘
// 「パネルとしてバフを渡す相手ってパネルがあるのに入力欄で別途渡す相手選ぶの
// 意味わからない」）。渡し先は「入力」の行で 1 発ずつ決める（`rowTo`）。
// 枠の既定（`slots[].nsto`）は読み込みが入れたものがそのまま生きている
/** 候補の名札。**段（スタック）だけは短く出す。**条件の原文は吹き出しのまま */
export function altShort(lab) {
  if (!lab) { return ''; }
  var m = String(lab).match(/段\s*(\d+)/);
  return m ? '段 ' + m[1] : '';
}
export function drawAlts() {
  var list = altList(), h = '', i;
  for (i = 0; i < list.length; i++) {
    var x = list[i];
    var pk = pickOf(x.i, x.kind);
    var sl9 = st.slots[x.i];
    var auto = danMax(x.p.id, x.kind) &&
               !(sl9 && sl9.pk && sl9.pk[x.kind] != null);
    var sc = altScale(x.p.id, x.kind, pk, lvlOf(x.i, x.kind));
    var nm = ((B.skname || {})[x.p.id] || {})[x.kind] || (ALTJA[x.kind] || x.kind);
    h += '<div class="alt" title="' + esc(auto ?
           'このスキルを撃つたびに 1 段ずつ上がります（形態が変わると 1 に戻ります）' :
           (x.a.c[pk] || '')) + '">' +
      img(x.p.id, 'ic') +
      '<span class="t"><b>' + esc(x.p.n) + '</b>' +
      '<span class="g">' + esc(ALTJA[x.kind] || x.kind) + '　' + esc(nm) +
      (auto ? '　<b class="pick">段 自動</b>'
            : (altShort(x.a.c[pk]) ? '　<b class="pick">' + esc(altShort(x.a.c[pk])) + '</b>' +
               '　<button type="button" class="lnk" data-autoalt="' + x.i + '|' +
               esc(x.kind) + '">自動に戻す</button>' : '')) +
      '</span></span>' +
      '<input type="range" min="0" max="' + (x.a.v.length - 1) + '" value="' + pk +
      '" data-alt="' + x.i + '|' + x.kind + '">' +
      '<span class="v">' + (sc == null ? '—' : (sc / 100).toFixed(0) + '%') +
      '<i>' + (pk + 1) + '/' + x.a.v.length + '</i></span></div>';
  }
  h += stkRows();
  // **無いときはパネルごと出さない**（説明文を置かない。2026-09-03）
  $('alts').innerHTML = h;
  $('altpane').hidden = !h;
}
// **バフの段（スタック）も同じバーで選ぶ**（LOOP.md 55、2026-09-03）。
// `Value` の 2 本目以降は段ごとの値で、道具は 1 本目しか見ていなかった
// （ミチルの会心ダメージ、アコ（ドレス）の攻撃力など 56 件）。
// **段は戦況で決まるのでデータからは出せない。**既定は 1 段目のまま
export function stkList() {
  var out = [], i, k;
  for (i = 0; i < SLOTS; i++) {
    var p = st.party[i];
    if (!p) { continue; }
    for (k = 0; k < ALTK.length; k++) {
      var n = bufStk(p.id, ALTK[k]);
      if (n > 1) { out.push({ i: i, p: p, kind: ALTK[k], n: n }); }
    }
  }
  return out;
}
export function stkRows() {
  var list = stkList(), h = '', i;
  for (i = 0; i < list.length; i++) {
    var x = list[i], sl = st.slots[x.i] || {};
    var k = Math.max(0, Math.min((sl.stk || {})[x.kind] || 0, x.n - 1));
    var nm = ((B.skname || {})[x.p.id] || {})[x.kind] || (ALTJA[x.kind] || x.kind);
    h += '<div class="alt" title="' + esc('段（スタック）が何個たまっているか') + '">' +
      img(x.p.id, 'ic') +
      '<span class="t"><b>' + esc(x.p.n) + '</b>' +
      '<span class="g">' + esc(ALTJA[x.kind] || x.kind) + '　' + esc(nm) +
      '　<b class="pick">段 ' + (k + 1) + '</b></span></span>' +
      '<input type="range" min="0" max="' + (x.n - 1) + '" value="' + k +
      '" data-stk="' + x.i + '|' + x.kind + '">' +
      '<span class="v"><i>' + (k + 1) + '/' + x.n + '</i></span></div>';
  }
  return h;
}
export function fillFilters() {
  var L = S.labels || {}, ro = {}, bu = {}, ar = {}, sc = {}, i;
  for (i = 0; i < S.students.length; i++) {
    var s4 = S.students[i];
    ro[s4.ro] = 1; bu[s4.bt] = 1; ar[s4.at] = 1; sc[s4.sc] = 1;
  }
  function opts(sel, map, dict, all) {
    var h = '<option value="">' + (all || 'すべて') + '</option>', k;
    for (k in map) { h += '<option value="' + esc(k) + '">' + esc((dict && dict[k]) || k) + '</option>'; }
    $(sel).innerHTML = h;
  }
  opts('i-role', ro, L.TacticRole);
  opts('i-bul', bu, L.BulletType);
  opts('i-arm', ar, L.ArmorType);
  opts('i-sch', sc, L.School);
  opts('i-sq', { Main: 1, Support: 1 }, L.SquadType);
  opts('i-star', { 1: 1, 2: 1, 3: 1 }, { 1: '★1', 2: '★2', 3: '★3' });
}
