import { B } from './util.js';
import { SLOTS, memoOn, st } from './core.js';

export function boss() { return B.bosses[st.bi]; }
// **大決戦は「装甲を選べる総力戦」。**表は `EliminateRaidStageExcelTable` と
// 別だが、`DevName` の「素の名前＋難易度」で束ねて 1,100 回突き合わせて
// **装甲以外まったく同じ**だった（HP・防御・会心抵抗・グロッキー・
// スコアの 4 定数まで。2026-09-01）。だから枝は増やさず、字だけ差し替える
export var ARMJA = { LightArmor: '軽装備', HeavyArmor: '重装甲', Unarmed: '特殊装甲',
              ElasticArmor: '弾力装甲' };
export var _dfC = null, _dfK = '';
export function diff() {
  var r0 = boss().d[st.di];
  if (!st.arm || !r0 || !r0.bs || r0.bs.armor === st.arm) { return memoOn(r0); }
  var k = st.bi + '|' + st.di + '|' + st.arm;
  if (_dfK === k && _dfC) { return _dfC; }
  var r = {}, q, bs = {};
  for (q in r0) { if (has(r0, q)) { r[q] = r0[q]; } }
  for (q in r0.bs) { if (has(r0.bs, q)) { bs[q] = r0.bs[q]; } }
  bs.armor = st.arm;
  r.bs = bs;
  // 部位の装甲も揃える（部位のステータスも装甲では変わらない）
  if (r0.sub && r0.sub.length) {
    r.sub = r0.sub.map(function (x) {
      var y = {}, q2;
      for (q2 in x) { if (has(x, q2)) { y[q2] = x[q2]; } }
      y.armor = st.arm;
      return y;
    });
  }
  _dfK = k; _dfC = r;
  return memoOn(r);
}
/** ボス・難易度・装甲が入れ替わったら、覚えていた答えを捨てる（2026-09-03） */
export function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
/** **グロッキーゲージがダメージでは埋まらないボスか**（2026-09-03）。
    `GroggyGauge` がボス本体の HP を超えていたら、削り切ってもゲージは届かない
    （ペロロジラ Torment はゲージ 1,000,000,000 に対して HP 44,000,000。ケセドは
    どの難易度も 1,000,000,000）。**推測ではなく、この道具の中では成り立つ**——
    `carry.js` の `ggRuns` は累計ダメージをゲージと比べていて、累計はボスの HP で頭打ちになる。
    こういうボスは `raids.json` の `GroggyCondition`（`gc`）に書いてある出来事だけが
    ゲージを増やす（ペロロジラは「気絶状態のペロロミニオンを吸い込むと増加する。」）。
    その出来事はこの道具が持っていないので、**窓は人が置く。** */
export function ggNoDmg(r) {
  var bs = (r && r.bs) || {};
  return !!(bs.groggy && bs.hp && bs.groggy > bs.hp);
}
export function tormentIdx(b) {
  for (var i = 0; i < b.d.length; i++) { if (b.d[i].df === 'Torment') { return i; } }
  return b.d.length - 1;
}
export function crewCount() {
  var n = 0;
  for (var i = 0; i < SLOTS; i++) { if (st.party[i]) { n++; } }
  return n;
}

// `_dfK` は boss.js の持ち物。読み込み・装甲の切り替えから捨てるための窓口
export function resetDiffCache() { _dfK = ''; }
