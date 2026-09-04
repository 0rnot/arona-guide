import { B } from './util.js';

// ------------------------------------------------------------ 盤
// **「1 発が何体に当たるか」は今まで人が入れていた**（`uses[].mc`、既定 1、
// 範囲 EX だけ「湧いた数ぶん全部」）。**座標はデータに全部ある**ので数えられる。
//
//   `r.board.bcn`  生徒のビーコン `[[SectionIndex, Index, x, y], …]`
//   `r.board.spw`  敵の湧き点
//                  `[[SectionIndex, 名前, x, y, 最初から居るか, [CommandId…], いつ湧くか], …]`
//   `r.board.smn`  召喚の座標 `{EX の枠: [[名前, x, y], …]}`
//   `r.board.bd`   体の素性 `{名前: [CharacterId, BodyRadius, Range]}`
//   `B.area[生徒][枠]` 形 `[Type, Radius, Degree, Width, Height, ExcludeRadius]`
//   `B.geo[生徒][枠]`  `[SpawnPositionType, TargetingType, TargetSide,
//                       MaxTargetCount, Range, HitFrames, 範囲の型,
//                       PositionOffset(ワールド), AngleOffset, SpawnDirectionType]`
//
// **単位は 1 : 100。**`Stage` の座標と `BodyRadius` はワールド、スキルの
// `Radius` / `Width` / `Height` と `stats.Range` は 1/100 ワールド
// （ボスの `BodyRadius: 700` が 7.0 ワールド、転移の円 `Radius: 3000` が 30.0）。
//
// **範囲に「何体まで」の上限は無い**（`Radius` を持つ 232 枠すべてで
// 範囲の実体の `MaxTargetCount` が `null`。2026-09-04 に数えた）。
// `EssentialCandidateRule.MaxTargetCount` のほうは「狙う相手を何体選ぶか」で、
// **形の中に入った体は全部当たる。**だから数は幾何だけで決まる。
export var U = 100;

/** 節（Section）は同じ並びを平行移動しただけ。**既定は節 0 で数える。** */
export var SEC0 = 0;

function d2(ax, ay, bx, by) {
  var dx = ax - bx, dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

/** **召喚の枠がどの節のものか。**召喚の座標は世界座標で入っているので、
    **いちばん近い生徒のビーコンの節**をその枠の節とする。

    ペロロジラ Lunatic は Ex03/Ex04 が節 0（y ≒ 30〜32、ビーコン 25.95）、
    Ex05/Ex06 が節 2（y ≒ 88〜90、ビーコン 81.92）、Ex07/Ex08 が節 4
    （y ≒ 140〜142）。節は同じ並びを平行移動しただけ。 */
export function secOfSummon(r, ex) {
  var bd = r && r.board;
  if (!bd || !bd.smn || !bd.smn[ex] || !bd.smn[ex].length) { return null; }
  var y = bd.smn[ex][0][2], best = null, bdy = 0, i;
  // **比べる先はビーコンではなく湧き点。**節は 2 本で 1 組になっていて
  // （節 0 が戦う場、節 1 は「前へ移動する」だけの繋ぎ）、ビーコンで比べると
  // 繋ぎの節に吸われる（ペロロジラ Lunatic の中ペロロは y ≒ 31、
  // 節 0 のビーコンは 25.95、節 1 のビーコンは 30.2）。
  // **湧き点があるのは戦う節だけ**なので、そちらで比べれば間違えない
  for (i = 0; i < (bd.spw || []).length; i++) {
    var dy = Math.abs(bd.spw[i][3] - y);
    if (best == null || dy < bdy) { best = bd.spw[i][0]; bdy = dy; }
  }
  return best;
}

/** その節で湧く召喚の枠を、`smn` に出てくる順に。 */
export function summonsOf(r, si) {
  var bd = r && r.board, sec = si == null ? SEC0 : si, out = [], k;
  if (!bd) { return out; }
  for (k in (bd.smn || {})) {
    if (!Object.prototype.hasOwnProperty.call(bd.smn, k)) { continue; }
    if (secOfSummon(r, k) === sec) { out.push(k); }
  }
  return out;
}

/** **その湧き点が今の場面で盤に居るか。**

    `spw` の 7 番目が「いつ湧くか」（`start` / `st:Groggy` / `ph:1` / …）。
    **ペロロジラの小さなペロロ 5 体は `st:Groggy`**——ボスがグロッキーに
    なったときだけ湧くので、ふだんの盤には居ない（2026-09-04 に先生の指摘で
    `Stage` の `Events` を原文で確かめた。それまで開幕から 12 体として数えていた）。
    `on` に足すと、その引き金の体も盤に載る（既定は「最初から居るもの」だけ）。 */
export function spawnOn(q, on) {
  if (q[4]) { return true; }
  var w = q[6];
  if (!w) { return true; }
  if (w.indexOf("start") >= 0) { return true; }
  if (!on || !on.length) { return false; }
  for (var i = 0; i < on.length; i++) {
    if (w.indexOf(on[i]) >= 0) { return true; }
  }
  return false;
}

/** 盤に居る体（節 `si`、召喚の波 `ex`、追加の引き金 `on`）。
    `[{n, x, y, br, cid, sum}]`。

    **召喚は 1 度に 1 波しか盤に居ない**（ペロロジラは Ex03 が 6 体出して
    Ex09 が吸い、次に Ex04 が 6 体出す）。`ex` を省くとその節の 1 波目。
    `on` は `["st:Groggy"]` のように渡す。省くと「最初から居る体」だけ。 */
export function bodiesOf(r, si, ex, on) {
  var bd = r && r.board;
  if (!bd) { return []; }
  var sec = si == null ? SEC0 : si, out = [], i, q;
  function br(nm) {
    var e = bd.bd[nm];
    return e && e[1] != null ? e[1] / U : 0.5;
  }
  function cid(nm) {
    var e = bd.bd[nm];
    return e ? e[0] : null;
  }
  for (i = 0; i < (bd.spw || []).length; i++) {
    q = bd.spw[i];
    if (q[0] !== sec || !spawnOn(q, on)) { continue; }
    out.push({ n: q[1], x: q[2], y: q[3], br: br(q[1]), cid: cid(q[1]), sum: null });
  }
  var wave = ex || summonsOf(r, sec)[0];
  if (wave && bd.smn[wave]) {
    for (i = 0; i < bd.smn[wave].length; i++) {
      q = bd.smn[wave][i];
      out.push({ n: q[0], x: q[1], y: q[2], br: br(q[0]), cid: cid(q[0]), sum: wave });
    }
  }
  return out;
}

/** その節の生徒のビーコン。無ければ null。 */
export function beaconOf(r, si) {
  var bd = r && r.board, sec = si == null ? SEC0 : si, i;
  if (!bd) { return null; }
  for (i = 0; i < (bd.bcn || []).length; i++) {
    if (bd.bcn[i][0] === sec) { return { x: bd.bcn[i][2], y: bd.bcn[i][3] }; }
  }
  return null;
}

/** 湧き点を持つ節（＝戦う節）の並び。 */
export function fightSecs(r) {
  var bd = r && r.board, out = [], i;
  if (!bd) { return out; }
  for (i = 0; i < (bd.spw || []).length; i++) {
    if (out.indexOf(bd.spw[i][0]) < 0) { out.push(bd.spw[i][0]); }
  }
  out.sort(function (a, b) { return a - b; });
  return out;
}

/** **生徒が狙う体。**`ConcentratedTarget` を持つ体が居ればそれ、
    居なければビーコンからいちばん近い体。無ければ null。

    ペロロジラは転倒していない大きなペロロに `Perorozilla01_ConcentratedTarget` が
    貼られる（永続・Parameter 2000）。**推測ではなく DB にある**（2026-09-04 の裏取り B）。
    道具はまだ「誰に貼られているか」を時間で追えないので、
    **召喚された体（`sum` が付いているもの）を優先する**という近似で置く。 */
export function aimOf(r, bs, si) {
  var b = beaconOf(r, si), list = bs || bodiesOf(r, si), i, pool = [];
  if (!list.length) { return null; }
  // 召喚された体が居るならその中から選ぶ（`ConcentratedTarget` はそちらに貼られる）
  for (i = 0; i < list.length; i++) { if (list[i].sum) { pool.push(list[i]); } }
  if (!pool.length) { pool = list; }
  if (!b) { return pool[0]; }
  var best = null, bd2 = 0;
  for (i = 0; i < pool.length; i++) {
    var dd = d2(b.x, b.y, pool[i].x, pool[i].y) - pool[i].br;
    if (!best || dd < bd2) { best = pool[i]; bd2 = dd; }
  }
  return best;
}

/** **生徒の立ち位置。**ビーコンから狙う体へ、届くところまで進む。
    `range` はスキルの `Range`（1/100 ワールド）。 */
export function standOf(r, aim, range, si) {
  var b = beaconOf(r, si);
  if (!b) { return null; }
  if (!aim || !range) { return { x: b.x, y: b.y }; }
  var far = d2(b.x, b.y, aim.x, aim.y) - aim.br, need = range / U;
  if (far <= need) { return { x: b.x, y: b.y }; }
  var t = (far - need) / (far || 1);
  return { x: b.x + (aim.x - b.x) * t, y: b.y + (aim.y - b.y) * t };
}

/** **形の中に入る体。**`sh` は `B.area` の行、`c` は中心、`fw` は向き（単位ベクトル）。
    体は円（中心と `br`）として扱い、形と重なっていれば当たったとする。
    扇は**中心の角度だけ**で見る（体の端が入るぶんは数えない）。 */
export function coverOf(sh, c, fw, bs, gm) {
  if (!sh || !c) { return null; }
  var typ = sh[0], R = (sh[1] || 0) / U, deg = sh[2], W = (sh[3] || 0) / U,
      H = (sh[4] || 0) / U, EX = (sh[5] || 0) / U, out = [], i;
  var ux = (fw && fw.x) || 0, uy = (fw && fw.y) || 1,
      un = Math.sqrt(ux * ux + uy * uy) || 1;
  ux /= un; uy /= un;
  // **`AngleOffset` は形を向きから回す角度**（度）
  var ang = (gm && gm[8]) || 0;
  if (ang) {
    var a = ang * Math.PI / 180, cx0 = ux, cy0 = uy;
    ux = cx0 * Math.cos(a) - cy0 * Math.sin(a);
    uy = cx0 * Math.sin(a) + cy0 * Math.cos(a);
  }
  // **`PositionOffset` は向きを軸にしたずれ**（ワールド。`y` が前）。
  // 落とすとアリスの光線が背中側 10.0 まで伸びる。
  // **`x`（横）の向きはデータからは決まらない**が、範囲の実体 243 件のうち
  // `x` が 0 でないのは 3 件だけで、いちばん大きいスミレの 0.77 ワールドでも
  // 体の半径より小さい（ボスは 7.0）。**符号は `Obb` の横軸と揃えてある**
  var off = gm && gm[7];
  var c2 = off ? { x: c.x + off[1] * ux + off[0] * -uy,
                   y: c.y + off[1] * uy + off[0] * ux } : c;
  // **体の大きさぶん、許す角度を広げる。**中心だけで見ると、ボスのような
  // 大きな体（半径 7.0）が扇の縁に掛かっていても外れる
  function inAng(dx, dy, d, br) {
    if (!deg || deg >= 360) { return true; }
    if (d <= br) { return true; }
    var cs = Math.max(-1, Math.min(1, (dx * ux + dy * uy) / d));
    var slop = Math.asin(Math.min(1, br / d)) * 180 / Math.PI;
    return (Math.acos(cs) * 180 / Math.PI) <= deg / 2 + slop;
  }
  for (i = 0; i < bs.length; i++) {
    var p = bs[i], dx = p.x - c2.x, dy = p.y - c2.y, d = Math.sqrt(dx * dx + dy * dy);
    var ok = false;
    if (typ === 'Circle') {
      ok = d - p.br <= R && (!EX || d + p.br >= EX);
    } else if (typ === 'Donut') {
      // **ドーナツは「穴のあいた扇」。**`Degree` を持っていて、
      // 360 とはかぎらない（ハルナ 90 度・スミレ 70 度・ヒナタ 50 度）
      ok = d - p.br <= R && d + p.br >= EX && inAng(dx, dy, d, p.br);
    } else if (typ === 'Fan') {
      ok = d - p.br <= R && inAng(dx, dy, d, p.br);
    } else if (typ === 'Obb') {
      // 前後（向き）と左右（垂線）に落とす。**`Height` が前後、`Width` が左右**
      var f = dx * ux + dy * uy, s = dx * -uy + dy * ux;
      ok = Math.abs(f) - p.br <= H / 2 && Math.abs(s) - p.br <= W / 2;
    } else {
      // `Bounce` は跳ねる弾で、円でも扇でも矩形でもない。**数えない**
      return null;
    }
    if (ok) { out.push(p); }
  }
  return out;
}

/** **その（生徒, 枠）が何体に当たるか。**決められなければ null。

    `SpawnPositionType` が
      `Invoker`                        … 撃った子の足元が中心
      `InputPosition` / `InputBattleEntity` / `BattleEntity` … 狙った体が中心
      それ以外                          … 決められない（null） */
export function hitsOf(r, sid, kind, si, ex, on) {
  var sh = ((B.area || {})[sid] || {})[kind],
      gm = ((B.geo || {})[sid] || {})[kind];
  if (!sh || !gm || !r || !r.board) { return null; }
  var bs = bodiesOf(r, si, ex, on);
  if (!bs.length) { return null; }
  var aim = aimOf(r, bs, si);
  if (!aim) { return null; }
  var me = standOf(r, aim, gm[4], si);
  if (!me) { return null; }
  var spawn = gm[0], c;
  if (spawn === 'Invoker') {
    c = me;
  } else if (spawn === 'InputPosition' || spawn === 'InputBattleEntity'
             || spawn === 'BattleEntity' || spawn === 'SkillCommandSelectedTarget') {
    c = { x: aim.x, y: aim.y };
  } else {
    return null;
  }
  var fw = { x: aim.x - me.x, y: aim.y - me.y };
  if (!fw.x && !fw.y) { fw = { x: 0, y: 1 }; }
  var hit = coverOf(sh, c, fw, bs, gm);
  if (!hit) { return null; }
  // **ボス本体と部位を分ける。**道具は `mc`（当たった部位の数）と
  // `hb`（本体にも当たったか）を別々に持っている
  var nb = 0, hb = 0, j;
  for (j = 0; j < hit.length; j++) {
    if (hit[j].cid === r.cid) { hb = 1; } else { nb++; }
  }
  return { n: hit.length, nb: nb, hb: hb, hit: hit, c: c, me: me, aim: aim, bs: bs };
}

/** `hitsOf` の数だけ。数えられなければ null。 */
export function hitsNOf(r, sid, kind, si, ex, on) {
  var q = hitsOf(r, sid, kind, si, ex, on);
  return q ? q.n : null;
}
