import { $, view } from './util.js';
import { st } from './core.js';
import { diff } from './boss.js';
import { draw } from './draw.js';

// ------------------------------------------------------------ 拡大・移動
// **自分で拡大したかどうかを覚えておく。**パネルを畳んだり大きさを変えたりする
// たびに `fit()` を呼んでいて、拡大した表示が毎回全体表示に戻っていた
// （2026-09-01 の先生の指摘「タイムラインを拡大した状態でトグルを閉じると
// 全体表示に戻っちゃう／開いても同様／パネルサイズを変えても同様」）
export var userZoom = false;
export function fit() {
  var r = diff(), dur = r.dur || 240;
  userZoom = false;
  st.px = Math.max(0.6, ($('view').clientWidth - 4) / dur);
  draw();
}
// 入れ物の大きさが変わったときの引き直し。**拡大しているなら倍率も位置も保つ**
export function relayout() {
  if (!userZoom) { fit(); return; }
  var v = $('view'), sl = v ? v.scrollLeft : 0;
  draw();
  if (v) { v.scrollLeft = sl; }
}
export function zoomAt(clientX, factor) {
  var v = $('view'), box = v.getBoundingClientRect();
  var mx = clientX - box.left + v.scrollLeft, t = mx / st.px;
  var np = Math.max(0.6, Math.min(160, st.px * factor));
  if (np === st.px) { return; }
  userZoom = true;
  st.px = np; draw();
  v.scrollLeft = t * st.px - (clientX - box.left);
}
export function zoomAtTime(t, factor) {
  var v = $('view'), keep = t * st.px - v.scrollLeft;
  userZoom = true;
  st.px = Math.max(0.6, Math.min(160, st.px * factor)); draw();
  v.scrollLeft = t * st.px - keep;
}
