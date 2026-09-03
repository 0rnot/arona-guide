import { mmss } from './util.js';
import { sim } from './engine.js';

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
  return { pts: pts, bad: bad, end: pts[pts.length - 1][1], cap: sm.cap, sim: sm };
}
export function costPts(dur) { return costRun(dur).pts; }
export function poly(pts, px, h, ymax, pad) {
  var s = '';
  for (var i = 0; i < pts.length; i++) {
    s += (i ? ' ' : '') + (pts[i][0] * px).toFixed(1) + ',' +
         (h - pad - (pts[i][1] / ymax) * (h - pad * 2)).toFixed(1);
  }
  return s;
}

