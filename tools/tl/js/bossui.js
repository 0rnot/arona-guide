import { $, B, S, esc, view } from './util.js';
import { st } from './core.js';
import { mark } from './undo.js';
import { ARMJA, boss, diff, ggNoDmg } from './boss.js';
import { draw } from './draw.js';
import { n0 } from './rate.js';

// **選べるのは、下限を通したボスだけ**（2026-09-03 の先生の指示
// 「エディタの選択肢、ペロロジラ以外なくしちゃっていいや、ペロロジラ詰めよう／
// 他のボスは下限クリアし次第、順次追加していく形で」）。
// 下限は 幅の中 90% ／ 平均±5%以内 60% ／ 討伐秒の差 15 秒（LOOP.md「進め方」）。
// **データは全部入ったまま**なので、通ったボスをここへ足すだけで出せる。
// 答え合わせの道具は `?all=1` を付けて全部のボスを出す
export var BOSS_OK = ['ペロロジラ'];
export function bossShown(n) {
  if (/[?&]all=1/.test(location.search)) { return true; }
  for (var q = 0; q < BOSS_OK.length; q++) {
    if (String(n).indexOf(BOSS_OK[q]) === 0) { return true; }
  }
  return false;
}
export function fillBoss() {
  var h = '', i;
  for (i = 0; i < B.bosses.length; i++) {
    if (!bossShown(B.bosses[i].n)) { continue; }
    h += '<option value="' + i + '">' + esc(B.bosses[i].n) + '</option>';
  }
  $('i-boss').innerHTML = h; $('i-boss').value = String(st.bi);
  var k = '';
  for (i = 0; i < boss().d.length; i++) {
    k += '<option value="' + i + '">' + esc(boss().d[i].df) + '</option>';
  }
  $('i-diff').innerHTML = k; $('i-diff').value = String(st.di);
  var r = diff(), dur = r.dur || 240;
  $('i-lim').innerHTML = '<option>' + Math.floor(dur / 60) + ':' +
    (dur % 60 < 10 ? '0' : '') + (dur % 60) + '</option>';
  var envJa = { Street: '市街', Outdoor: '屋外', Indoor: '屋内' };
  $('i-terr').innerHTML = '<option>' + (envJa[r.env] || r.env || '—') + '</option>';
  var pk = '<option value="">自動（削った量で移る）</option>', pn;
  for (pn in (r.ph || {})) {
    pk += '<option value="' + pn + '">フェーズ ' + (+pn + 1) + ' に固定</option>';
  }
  $('i-phase').innerHTML = pk;
  $('i-phase').value = st.phFix == null ? '' : String(st.phFix);
  $('i-lv').textContent = r.lv == null ? '—' : ('Lv' + r.lv);
  // 装甲。**大決戦がある枝だけ選べる**（`arm` はそこから入る）
  var raw = boss().d[st.di], arms = raw.arm || [], ah = '', ai;
  if (arms.length) {
    ah = '<option value="">総力戦（' + (ARMJA[(raw.bs || {}).armor] ||
         (raw.bs || {}).armor || '—') + '）</option>';
    for (ai = 0; ai < arms.length; ai++) {
      ah += '<option value="' + arms[ai] + '">大決戦 ' +
            (ARMJA[arms[ai]] || arms[ai]) + '</option>';
    }
  } else {
    ah = '<option value="">' + (ARMJA[(raw.bs || {}).armor] ||
         (raw.bs || {}).armor || '—') + '</option>';
  }
  $('i-armor').innerHTML = ah;
  $('i-armor').value = st.arm || '';
  // **このボスを動画と突き合わせたかどうかの印。**画面に言葉は出さず、
  // 丸の色と塗りだけ（2026-09-03 の先生の指示「注釈とかマジでいらないから全箇所」）。
  // 表は `data.js` の `vfy`＝ `build-tool-data.py` の `TL_VERIFY`。
  // **屋内・屋外・市街地はまとめて 1 件**（模型が同じなので `dev` で引く）
  var vf = (B.vfy || {})[boss().dev] || ['none', 'まだ突き合わせていません'];
  var vb = $('i-vfy');
  if (vb) {
    vb.className = 'qm vdot ' + vf[0];
    vb.setAttribute('data-hint', vf[1]);
    vb.setAttribute('aria-label', 'この道具の確かめ具合');
  }
  drawGroggy(); drawBstate();
}
// **グロッキーで何が起きるかはボスごとに違う**（2026-09-01 の先生の指摘）。
// 中身は `DB/BossExternalBTExcelTable.json` の引き金 `ApplyGroggy`。
// **被ダメージが増える指定はどのボスにも無い**ので、そう書く
export var GGJA = { AddActiveGauge: 'EX ゲージを引く', ChangePhase: '別のフェーズへ移る',
             ClearNormalSkill: '通常攻撃を止める', ForceChangePhase: '別のフェーズへ移る' };
// **ボスの状態。**被ダメージ率などを、効いている間だけ置く
// **ギミックの「DEF を 1,500 減少」は割合ではなく絶対値。**割合として掛けると
// 係数が `1 + (-1500/100) = -14` になって下限 0.2 に張り付く
// （2026-09-02、総力戦ヒエロニムスの「不浄なる光」。DEF 6,500 に対する正解は -23.1%）
export var BSTJA = [['damaged', '被ダメージ率', '%', 300],
             ['def', '防御力', '%', -50],
             ['defAbs', '防御力（実数）', '', -1500],
             ['crR', '会心抵抗値', '', -400],
             ['cdR', '会心ダメージ抵抗率', '', -2000],
             // **ボスに当たらない区間。**雑魚処理や移動でボスが盤に居ない間
             ['away', 'ボスに当たらない', '', 0],
             // 雑魚を撃っている間（ボスは居るが通常攻撃・NS は雑魚へ。EX は当たる先で置く）
             ['mob', '通常攻撃・NS が雑魚へ', '', 0],
             // 条件つきでグロッキーになるボス（シロクロの跳ね返り・ゲージ）は時刻が解けないので、
             // 動画で見た区間を置く。効くのは確定会心だけ（2026-09-02）
             ['groggy', 'グロッキー（確定会心）', '', 0]];
export function bstLabel(k) {
  for (var i = 0; i < BSTJA.length; i++) { if (BSTJA[i][0] === k) { return BSTJA[i][1]; } }
  return k;
}
/** 値を持つ種類かどうか。`away` / `mob` / `groggy` は区間だけで値が無い */
export function bstHasV(k) { return k !== 'away' && k !== 'mob' && k !== 'groggy'; }
/** 帯に出す名前。**チップから置いたものはギミックの名前（`w.n`）を先に出す** */
export function bstName(w) {
  var u = (w.k === 'damaged' || w.k === 'def') ? '%' : '';
  // **グロッキーの窓は確定会心だけではない**（2026-09-03）。分かれるボスでは
  // `gspl.n` 体ぶんの倍率も同時に乗る（`dmg.js` の `gsplMul`）。名乗らせる
  var g = w.k === 'groggy' ? diff().gspl : null;
  return (w.n ? w.n + ' / ' : '') + bstLabel(w.k) +
    (g && g.gg ? '×' + g.n : '') +
    (bstHasV(w.k) ? ' ' + ((w.v || 0) >= 0 ? '+' : '') + (w.v || 0) + u : '');
}
/** 帯の title。**数字はここにだけ出す**（2026-09-03。数字の行は消した） */
export function bstTip(w, dur) {
  return bstName(w) + '\n' + (+w.t0).toFixed(2) + '〜' +
    (+w.t1).toFixed(2) + '秒（' + Math.max(0, w.t1 - w.t0).toFixed(2) + '秒間）' +
    (dur && w.t1 > dur ? '\n※ 制限時間 ' + dur + ' 秒を超えたぶんは効きません' : '') +
    '\n端をドラッグで動かします／× で消します';
}
// ボスの説明文（`RaidSkills`）から拾ったギミックの候補。**自動では効かせない。**
// いつ入るかは TL 次第なので、選んだら窓を 1 つ置いて、秒は自分で動かす
export function esc2(t) {
  return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
export function gimLabel(g) {
  var u = (g.k === 'damaged' || g.k === 'def') ? '%' : '';
  // 説明文が「ホド：…」「インベイドピラー：…」のように相手で分かれていることがある
  // （ホドの「栄光の裏側」は本体と柱で 2 行。名前だけだと見分けが付かない）
  var m = String(g.t || '').match(/^[-－]?([^：:]{1,12})[：:]/);
  return g.n + (m ? '（' + m[1] + '）' : '') + ' / ' + bstLabel(g.k) + ' ' +
    (g.v >= 0 ? '+' : '') + g.v + u + (g.d ? ' ' + g.d + '秒' : '');
}
/** **候補はチップ。**見出しと同じ行に並べる（2026-09-03。プルダウンと
    「＋足す」は消した）。押すと、いま見えている範囲の先頭に帯を 1 本置く。
    `gim` に無い「ボスに当たらない」「雑魚へ」「グロッキー」も同じ行に出す */
export var BSTPLAIN = ['away', 'mob', 'groggy'];
export function drawBstate() {
  var el = $('bst-chips'), gm = (diff().gim || []), h = '', i;
  if (!el) { return; }
  for (i = 0; i < gm.length; i++) {
    h += '<button type="button" class="btn2 gchip" data-gim="' + i + '" title="' +
      esc2(gm[i].t) + '">' + esc2(gimLabel(gm[i])) + '</button>';
  }
  for (i = 0; i < BSTPLAIN.length; i++) {
    h += '<button type="button" class="btn2 gchip" data-gimk="' + BSTPLAIN[i] +
      '" title="秒はデータに無いので、置いてから端をドラッグします">＋ ' +
      bstLabel(BSTPLAIN[i]) + '</button>';
  }
  el.innerHTML = h;
}
/** チップを押したときに置く窓。**始まりは、いま見えている範囲の先頭
    （または最後に置いた EX の時刻）**。長さは説明文の秒、無ければ戦闘の終わりまで */
export function bstPut(w) {
  var d0 = diff().dur || 240, at = 0, i;
  var vw = $('view');
  if (vw) { at = Math.max(0, Math.min(d0, vw.scrollLeft / st.px)); }
  // 最後に置いた EX があれば、そこを始まりにする（置きたいのはたいてい直前の 1 発の近く）
  for (i = 0; i < st.tl.length; i++) { if (st.tl[i].t > at) { at = Math.min(d0, st.tl[i].t); } }
  mark();
  w.t0 = +at.toFixed(2);
  w.t1 = Math.min(d0, w.d ? at + w.d : d0);
  delete w.d;
  st.bst.push(w);
  drawBstate(); draw();
}
/** 窓を消す。**`u.gx`（その 1 発だけ外した窓の番号）を詰め直す。**
    番号は `st.bst` の並びを指しているので、消したままだと隣の窓を指す */
export function bstDel(wi) {
  st.bst.splice(wi, 1);
  var i, q, g, o;
  for (i = 0; i < st.tl.length; i++) {
    g = st.tl[i].gx;
    if (!g) { continue; }
    o = [];
    for (q = 0; q < g.length; q++) {
      if (g[q] === wi) { continue; }
      o.push(g[q] > wi ? g[q] - 1 : g[q]);
    }
    st.tl[i].gx = o.length ? o : null;
  }
  drawBstate(); draw();
}
export function drawGroggy() {
  var b = boss(), r = diff(), bs = r.bs || {}, gg = r.gg || [];
  if (!bs.groggy) { $('groggy').innerHTML = ''; return; }
  var seen = {}, acts = [], i;
  for (i = 0; i < gg.length; i++) {
    var key = gg[i][1] + '/' + gg[i][2];
    if (seen[key]) { continue; }
    seen[key] = 1;
    acts.push((GGJA[gg[i][1]] || gg[i][1]) + '（' + gg[i][2] + '）');
  }
  var wk = (S.labels && S.labels.BulletType && S.labels.BulletType[b.gwk]) || b.gwk || '';
  var how = b.gc || (wk ? wk + 'ダメージを受けると増加する。' : '');
  // **数字だけ画面に出して、言葉は吹き出しへ畳む**（2026-09-03 の先生の指示
  // 「注釈とかマジでいらないから全箇所」）。前はここに 3 つの文が常時出ていた
  var tip = (how ? how : '') + (acts.length ? '　' + acts.join('・') : '');
  // **溜まらないボスの番号は出さない**（2026-09-03）。ペロロジラ Torment の
  // 1,000,000,000 は「ダメージでは埋まらない」という意味の番号で、桁を読ませても意味が無い。
  // 言い方は `draw.js` の帯の札（`実質なし`）に揃えた。
  // **`gc` があるボスだけ**にしてある。`gc` が空のボス（イェソド・ドラム缶ガニ）は
  // 帯のほうがまだ「ダメージ」で線を引いていて、ここだけ言い換えると食い違う
  $('groggy').innerHTML =
    '<b>グロッキー</b> ゲージ ' +
    ((b.gc && ggNoDmg(r)) ? 'ダメージでは貯まらない' : n0(bs.groggy)) + '／' +
    ((bs.groggyT || 0) / 1000) + ' 秒' +
    (tip ? ' <button type="button" class="qm" data-hint="' + esc(tip) + '">?</button>' : '');
}
