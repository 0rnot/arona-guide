import { mmss } from './util.js';
import { sim } from './engine.js';
import { TE } from './core.js';

// ------------------------------------------------------------ 目盛りと折れ線
export function ticks(dur, px) {
  var h = '', step = px >= 14 ? 5 : (px >= 7 ? 10 : (px >= 3.5 ? 20 : 30));
  for (var t = 0; t <= dur; t += step) {
    var big = (t % 60 === 0);
    h += '<div class="tk' + (big ? ' m' : '') + '" style="left:' + (t * px) + 'px">' +
         (big || px >= 6 ? '<b>' + mmss(dur, t) + '</b>' : '') + '</div>';
  }
  return h;
}
export function vgrid(dur, px) {
  var h = '', step = px >= 14 ? 10 : (px >= 7 ? 30 : 60);
  for (var t = step; t < dur; t += step) {
    h += '<div class="vg' + (t % 60 === 0 ? ' m' : '') + '" style="left:' + (t * px) + 'px"></div>';
  }
  return h;
}
// 回復は PlayerRegenCostDelay(2 秒)のあと 回復力/10000 /秒。上限 EchelonMaxCommonCost=10。
// 置いたスキルの時刻でコストを引く。足りなければ負のまま描いて、下の errlog で知らせる
// **engine の segs をそのまま折れ線にする。**コスト回復力バフの持続も、
// 形態ごとのコストも、複製カードの −1 も、オーバーコストも engine 側で効いている
export function costRun(dur) {
  var sm = sim(), pts = [], bad = [], i;
  for (i = 0; i < sm.segs.length; i++) { pts.push([sm.segs[i].t, sm.segs[i].c]); }
  // **最後の 1 発より後ろも描く。**engine の segs はバフやギミックの切れ目までしか
  // 伸びないので、そこから先は上限まで貯まる線を自分で足す（2026-09-01。
  // 足さないと最後の EX から先が水平になって、残りコストが読めなかった）
  if (!pts.length) { pts.push([0, 0]); }
  var lastP = pts[pts.length - 1], rate = sm.rate;
  if (lastP[0] < dur) {
    if (rate > 0 && lastP[1] < sm.cap - 1e-9) {
      var tcap = lastP[0] + (sm.cap - lastP[1]) / rate;
      if (tcap < dur) { pts.push([tcap, sm.cap], [dur, sm.cap]); }
      else { pts.push([dur, lastP[1] + rate * (dur - lastP[0])]); }
    } else {
      pts.push([dur, lastP[1]]);
    }
  }
  for (i = 0; i < sm.rows.length; i++) {
    var row = sm.rows[i];
    if (row.d && (row.why || row.at == null)) { bad.push(row); }
  }
  // **オーバーコストを使ったかどうか**（2026-09-04 の先生の指示
  // 「コストオーバーしてるなら視覚的にわかるようにしてほしい」）。
  // `ovWin` は engine が出す `{ to: 渡した枠, s: 始まり, e: 終わり }` の並び。
  // 使ったときだけ縦軸を −5 まで伸ばす（**使っていない TL の見た目は変えない**）
  var lo = 0, ov = sm.ovWin || [];
  for (i = 0; i < sm.rows.length; i++) { if (sm.rows[i].over) { lo = TE.OVER_FLOOR; } }
  return { pts: pts, bad: bad, end: pts[pts.length - 1][1], cap: sm.cap, sim: sm,
           lo: lo, ov: ov };
}
export function costPts(dur) { return costRun(dur).pts; }
/** 折れ線。**`ymin` を渡すとそこを下端にする**（既定は 0）。
    オーバーコストで 0 を割った線を描くのに要る */
export function poly(pts, px, h, ymax, pad, ymin) {
  var s = '', lo = ymin || 0, span = ymax - lo;
  for (var i = 0; i < pts.length; i++) {
    s += (i ? ' ' : '') + (pts[i][0] * px).toFixed(1) + ',' +
         (h - pad - ((pts[i][1] - lo) / span) * (h - pad * 2)).toFixed(1);
  }
  return s;
}
/** その値の y 座標（`poly` と同じ写像）。目盛りと 0 の線を置くのに使う */
export function yOf(v, h, ymax, pad, ymin) {
  var lo = ymin || 0;
  return h - pad - ((v - lo) / (ymax - lo)) * (h - pad * 2);
}

