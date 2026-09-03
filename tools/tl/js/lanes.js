import { $ } from './util.js';
import { st } from './core.js';

// ------------------------------------------------------------ 段の取捨選択
// **タイムラインのどの段を出すか**（2026-09-03 の先生の指示「チェックボックスで
// TL 上の情報を取捨選択できるようにしたい、NS と通常攻撃以外もできるならそうしたい」）。
// **時間軸と生徒の EX は外せない。**時間軸が無いと秒が読めないし、EX は置く先そのもの。
// `d` は畳んだときに何が消えるかの説明（ツールチップ）
export var LANES = [
  { k: 'boss', n: 'ボス',     d: 'フェーズの帯・ボスの EX・PS' },
  { k: 'bst',  n: '状態',     d: 'ボスの状態（被ダメージ率アップなどの窓）' },
  { k: 'gg',   n: 'グロッキー', d: 'グロッキーの線' },
  { k: 'dbf',  n: 'デバフ',   d: 'ボスに乗っている弱体の数' },
  { k: 'cost', n: 'コスト',   d: 'コスト回復力とコストの山' },
  { k: 'ns',   n: 'NS',       d: '生徒の通常スキル' },
  { k: 'na',   n: '通常',     d: '生徒の通常攻撃' },
  { k: 'ss',   n: 'SS',       d: 'サブスキル' }
];
export function laneOn(k) { return st.lanes[k] !== false; }
export function loadLanes() {
  var v = null, i;
  try { v = localStorage.getItem('tl-lanes'); } catch (e) { void e; }
  st.lanes = {};
  if (!v) { return; }
  for (i = 0; i < LANES.length; i++) {
    if (v.indexOf(LANES[i].k + ',') < 0) { st.lanes[LANES[i].k] = false; }
  }
}
export function saveLanes() {
  var on = '', i;
  for (i = 0; i < LANES.length; i++) { if (laneOn(LANES[i].k)) { on += LANES[i].k + ','; } }
  try { localStorage.setItem('tl-lanes', on); } catch (e) { void e; }
}
/** ツールバーの摘み。**グリッドの右**に並べる。`aria-pressed` が入／切 */
export function drawLanes() {
  var box = $('lanebox'), h = '<span class="cap">表示</span>', i;
  if (!box) { return; }
  for (i = 0; i < LANES.length; i++) {
    var L = LANES[i], on = laneOn(L.k);
    h += '<button type="button" class="btn2 lane" data-lane="' + L.k + '" aria-pressed="' +
         (on ? 'true' : 'false') + '" title="' + L.d + '"><i class="tk"></i>' + L.n + '</button>';
  }
  box.innerHTML = h;
}
