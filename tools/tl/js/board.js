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

/** **盤の上を動く体。**`UniqueName` の末尾が `_Move`（ペロロジラ Torment の
    `Perorozilla_Torment_Peroro_MiddleSize01_Move` など。Ex03 の波に 1 体、
    Ex04 の波に 2 体）。**どこへ動くかはデータに無い**ので、盤で人が動かす。 */
export var MOVE = /_Move$/;

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
/** 節 `si` が節 0 からどれだけ前へ動いたか。

    **ビーコンの差では取らない。**生徒の立ち位置は節ごとに前後が違っていて、
    ペロロジラ屋内では節 2 が 55.97、節 4 が 106.55 と、湧き点の 58.02 / 109.86 より
    2.05・3.31 だけ手前になる。その差だけボスが前に出て、召喚のペロロとの隙間が
    詰まって見えていた（2026-09-04 の先生の指摘
    「3回目と4回目の盤のペロロミニオンの位置が少し前に出てる気がする」）。

    **両方の節にある湧き点の差を使う。**ペロロジラは 5 点とも同じ量だけ動く。
    共通の湧き点が 1 つも無いときだけビーコンの差に落とす。 */
export function secShift(r, si) {
  var bd = r && r.board, sec = si == null ? SEC0 : si, i, q, nm, j;
  if (!bd || sec === SEC0) { return { x: 0, y: 0 }; }
  var l0 = {}, ls = {};
  for (i = 0; i < (bd.spw || []).length; i++) {
    q = bd.spw[i];
    if (q[0] === SEC0) { (l0[q[1]] = l0[q[1]] || []).push([q[2], q[3]]); }
    else if (q[0] === sec) { (ls[q[1]] = ls[q[1]] || []).push([q[2], q[3]]); }
  }
  var dx = 0, dy = 0, n = 0;
  for (nm in ls) {
    if (!Object.prototype.hasOwnProperty.call(ls, nm) || !l0[nm]) { continue; }
    for (j = 0; j < Math.min(l0[nm].length, ls[nm].length); j++) {
      dx += ls[nm][j][0] - l0[nm][j][0];
      dy += ls[nm][j][1] - l0[nm][j][1];
      n++;
    }
  }
  if (n) { return { x: dx / n, y: dy / n }; }
  var b0 = beaconOf(r, SEC0), b1 = beaconOf(r, sec);
  return { x: b0 && b1 ? b1.x - b0.x : 0, y: b0 && b1 ? b1.y - b0.y : 0 };
}

/** **動く体の歩き方の区間**（2026-09-05）。`mv` は `bd.bd[名前][3]`
    ＝ `[[x, y, start_ms, cool_ms, dur_frames, speed], …]`（`build-tool-data.py` の `_mv_of`）。
    `_Move` の付いた大きなペロロは EX スキル（`RootMotionMoveWithSpeed`）で決まった
    座標へ歩く。**冷却の明けている EX を並びの順に使い、次の EX は今の EX が
    終わって（`dur`）から**——ここは DB に無い仮定で、動画のコマで確かめる。
    返すのは `[[t0, t1, from, to], …]`（湧いてからの秒） */
var _segs = {};
function mvSegs(mv, p0) {
  var k = JSON.stringify([mv, p0.x, p0.y]);
  if (_segs[k]) { return _segs[k]; }
  var segs = [], pos = { x: p0.x, y: p0.y }, idle = 0, ready = [], i, guard = 0;
  for (i = 0; i < mv.length; i++) { ready.push((mv[i][2] || 0) / 1000); }
  while (guard++ < 200) {
    // **使えるようになった順**（同時なら先に冷却の明けたほう、それも同じなら並びの順）。
    // 並びの順だけで選ぶと、湧き点へ戻る EX（Ex03 → (3.5, 32)）を持つ子が
    // 一度も出発しなくなる
    var pick = -1, tu = Infinity, rd = Infinity;
    for (i = 0; i < mv.length; i++) {
      var at = Math.max(idle, ready[i]);
      if (at < tu - 1e-9 || (Math.abs(at - tu) <= 1e-9 && ready[i] < rd - 1e-9)) {
        tu = at; pick = i; rd = ready[i];
      }
    }
    if (pick < 0 || tu > 300) { break; }
    var e = mv[pick], spd = (e[5] || 0) / U, dur = (e[4] || 0) / B.fps;
    var dx = e[0] - pos.x, dy = e[1] - pos.y, dist = Math.sqrt(dx * dx + dy * dy), to;
    var tt = (spd > 0 && dist > 1e-9) ? Math.min(dist / spd, dur) : 0;
    if (dist > 1e-9 && spd > 0 && tt < dist / spd - 1e-9) {
      var f = tt * spd / dist;
      to = { x: pos.x + dx * f, y: pos.y + dy * f };
    } else {
      to = dist > 1e-9 && spd > 0 ? { x: e[0], y: e[1] } : pos;
    }
    segs.push([tu, tu + tt, pos, to]);
    pos = to; idle = tu + dur; ready[pick] = tu + (e[3] || 0) / 1000;
  }
  _segs[k] = segs;
  return segs;
}
/** 湧いてから `s` 秒のときの位置。湧く前（`s < 0`）は湧き点 */
export function posAt(mv, p0, s) {
  if (!mv || !mv.length || !(s >= 0)) { return p0; }
  var segs = mvSegs(mv, p0), cur = p0, i;
  for (i = 0; i < segs.length; i++) {
    var sg = segs[i];
    if (s < sg[0]) { break; }
    if (s >= sg[1]) { cur = sg[3]; continue; }
    var f = (s - sg[0]) / ((sg[1] - sg[0]) || 1);
    return { x: sg[2].x + (sg[3].x - sg[2].x) * f, y: sg[2].y + (sg[3].y - sg[2].y) * f };
  }
  return cur;
}

/** `tm` は時刻の文脈 `{t, w0, slot}`（2026-09-05）——`t` はその時刻、`w0` は
    波の EX が始まった時刻（`sceneAt`）、`slot` は撃つ子の枠。**あれば、召喚の体は
    湧くフレーム（`smn[][3]`）を待ち、動く体は `posAt` の位置に置く。**無ければ今までどおり湧き点 */
export function bodiesOf(r, si, ex, on, tm) {
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
  var seen = {};
  for (i = 0; i < (bd.spw || []).length; i++) {
    q = bd.spw[i];
    if (q[0] !== sec || !spawnOn(q, on)) { continue; }
    seen[q[1]] = 1;
    out.push({ n: q[1], x: q[2], y: q[3], br: br(q[1]), cid: cid(q[1]), sum: null,
               key: 's' + i, mv: MOVE.test(q[1]) });
  }
  // **ボスの湧き点は節 0 にしかない**（ペロロジラ Torment の
  // `Perorozilla_default_Torment` は節 0 の 1 件だけで、節 2・4・6・8 には
  // グロッキーの小さなペロロしか並んでいない）。ボスは湧き直すのではなく
  // 前へ歩くので、**節 0 の体をビーコンの差だけ動かして置く**
  // （節は同じ並びを平行移動しただけ。`secOfSummon` の注記と同じ読み。2026-09-04）。
  // これが無いと、フェーズ 2 以降の盤からボスが消える
  if (sec !== SEC0) {
    var d = secShift(r, sec);
    for (i = 0; i < (bd.spw || []).length; i++) {
      q = bd.spw[i];
      if (q[0] !== SEC0 || seen[q[1]] || !spawnOn(q, on)) { continue; }
      out.push({ n: q[1], x: q[2] + d.x, y: q[3] + d.y, br: br(q[1]),
                 cid: cid(q[1]), sum: null, key: 's' + i, mv: MOVE.test(q[1]) });
    }
  }
  // `ex === false` は「召喚された体は盤に居ない」。**吸収の直後がこれ**——
  // `Ex09` が 20.0 ワールドの中を全部消してからグロッキーが始まる（2026-09-04）
  var wave = ex === false ? null : (ex || summonsOf(r, sec)[0]);
  if (wave && bd.smn[wave]) {
    for (i = 0; i < bd.smn[wave].length; i++) {
      q = bd.smn[wave][i];
      var x = q[1], y = q[2], e = bd.bd[q[0]], mv = e && e[3];
      if (tm && tm.t != null && tm.w0 != null) {
        var s = tm.t - (tm.w0 + (q[3] || 0) / B.fps);
        if (s < -1e-9) { continue; }
        if (mv) { var p = posAt(mv, { x: x, y: y }, s); x = p.x; y = p.y; }
      }
      out.push({ n: q[0], x: x, y: y, br: br(q[0]), cid: cid(q[0]), sum: wave,
                 key: 'm' + i, mv: MOVE.test(q[0]) });
    }
  }
  return out;
}

/** **盤の枠。**その節に出てくる体を全部（波もグロッキーも問わず）ひとまとめにした
    外接の箱。**時刻で変わらない**ので、赤い線を動かしても盤の縮尺が変わらない
    （2026-09-04 の先生の指摘「タイムラインにスキルが無い時、盤面が広くなる」
    「スキル動かす時に盤面が無限に広がってターゲットしづらい」）。
    狙う点と範囲の形はここに入れない——外へ引いても盤は広がらない。 */
export function boardBox(r, si) {
  var bd = r && r.board, sec = si == null ? SEC0 : si, i, k, q;
  if (!bd) { return null; }
  var xs = [], ys = [], seen = {};
  function put(x, y, rad) { xs.push(x - rad, x + rad); ys.push(y - rad, y + rad); }
  function rad(nm) { var e = bd.bd[nm]; return e && e[1] != null ? e[1] / U : 0.5; }
  for (i = 0; i < (bd.spw || []).length; i++) {
    q = bd.spw[i];
    if (q[0] !== sec) { continue; }
    seen[q[1]] = 1; put(q[2], q[3], rad(q[1]));
  }
  var d = secShift(r, sec);
  for (i = 0; i < (bd.spw || []).length; i++) {
    q = bd.spw[i];
    if (q[0] !== SEC0 || seen[q[1]]) { continue; }
    put(q[2] + d.x, q[3] + d.y, rad(q[1]));
  }
  var sm = summonsOf(r, sec);
  for (k = 0; k < sm.length; k++) {
    var ws = bd.smn[sm[k]] || [];
    for (i = 0; i < ws.length; i++) { put(ws[i][1], ws[i][2], rad(ws[i][0])); }
  }
  var bc = beaconOf(r, sec);
  if (bc) { put(bc.x, bc.y, 1); }
  if (!xs.length) { return null; }
  return { x0: Math.min.apply(null, xs) - 2, x1: Math.max.apply(null, xs) + 2,
           y0: Math.min.apply(null, ys) - 2, y1: Math.max.apply(null, ys) + 2 };
}

/** 盤の体の cid → 「当たる先」の番号（`diff().sub` の添字）。

    **同じ見た目の体は 1 件にまとめてある**（`cnt` を持つ行が代表）。
    ペロロジラ屋内なら `7305702` が「大きなペロロミニオン ×21」、
    `7305790` が「小さなペロロミニオン ×5」で、`7305703` のような
    まとめられた側の cid は `sub` に無い。**その体より小さくていちばん近い
    代表**に寄せる（cid は種類ごとに連番）。本体なら null。 */
export function subIxOfCid(r, cid) {
  var subs = (r && r.sub) || [], i, best = -1;
  for (i = 0; i < subs.length; i++) { if (subs[i].id === cid) { return i; } }
  for (i = 0; i < subs.length; i++) {
    if (!subs[i].cnt || subs[i].id > cid) { continue; }
    if (best < 0 || subs[i].id > subs[best].id) { best = i; }
  }
  return best < 0 ? null : best;
}

/** **ダメージの計算から見て同じ相手か**を表す札。`aimOf`（`target.js`）が返す行のうち、
    `dmg.js` / `alt.js` / `target.js` / `ep.js` が実際に読む欄だけを並べる。

    ペロロジラの大きなペロロミニオンは `sub` の中で何行かに分かれている
    （`_Move` の付く体と据え置きの体。`scripts/build-tool-data.py` の `_subs`）が、
    `DB/CharacterStatExcelTable.json` では 7305701〜7305730 の 30 体とも
    HP 210000・防御 6000・Unarmed・転移 100% で、**1 発が何体に当たるかを
    数えるうえでは同じもの**（2026-09-05 に原文で裏取り）。 */
function aimSig(r, ix) {
  var s = (r.sub || [])[ix];
  if (!s) { return 'x' + ix; }
  return [s.def, s.armor, s.bullet, s.size, s.damaged, s.dodge, s.crR, s.cdR,
          s.stab, s.stabR, s.defpr, (s.ad || []).join(''), s.tr || 0,
          s.pool || '', s.dmgOnly ? 1 : 0, s.kill ? 1 : 0].join('|');
}

/** 当たり（`hitsAtOf` / `bestHitsOf` の返り値）から
    「当たる先 `tg`・当たる数 `mc`・本体にも当たるか `hb`」を出す。

    **2026-09-04 の先生の指示**「盤で決めるなら入力欄の当たる先当たる数
    ボス本体に当たるかどうかは入力させなくていいかな」。
    種類がまざったときは**いちばん多く当たった種類**を当たる先にする。

    **種類は `sub` の行ではなく素性（`aimSig`）で分ける**（2026-09-05）。
    行で分けると、ペロロジラの大きなペロロミニオン 6 体に当たった発が
    「`_Move` の行 1 体」と「据え置きの行 5 体」に割れて、多いほうの 5 体しか
    数えなかった。先生の TL がマコト（水着）の EX を 6 体に当てているのに
    与ダメージが 40,048,000 に届かなかった原因の 1 つ
    （「攻撃スキルの位置変えると与えるダメージ変わるんだけどなんで？」）。 */
export function aimFromHits(r, q) {
  if (!q || !q.hit) { return null; }
  var cnt = {}, rep = {}, i, ix, sg, best = null;
  for (i = 0; i < q.hit.length; i++) {
    if (q.hit[i].cid === r.cid) { continue; }
    ix = subIxOfCid(r, q.hit[i].cid);
    if (ix == null) { continue; }
    sg = aimSig(r, ix);
    cnt[sg] = (cnt[sg] || 0) + 1;
    // 代表は `sub` の若い行（画面の「当たる先」に出る名前が安定する）
    if (rep[sg] == null || ix < rep[sg]) { rep[sg] = ix; }
    if (best == null || cnt[sg] > cnt[best]) { best = sg; }
  }
  if (best == null) { return { tg: null, mc: 1, hb: 0 }; }
  return { tg: rep[best], mc: cnt[best], hb: q.hb ? 1 : 0 };
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
/** ビーコンの向き（単位ベクトル）。データに無ければ前（0, 1） */
export function beaconFw(r, si) {
  var bd = r && r.board, sec = si == null ? SEC0 : si, i;
  for (i = 0; bd && i < (bd.bcn || []).length; i++) {
    if (bd.bcn[i][0] === sec && bd.bcn[i].length >= 6) {
      var x = bd.bcn[i][4], y = bd.bcn[i][5], n = Math.sqrt(x * x + y * y) || 1;
      return { x: x / n, y: y / n };
    }
  }
  return { x: 0, y: 1 };
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
export function standOf(r, aim, range, si, tm) {
  var b = beaconOf(r, si);
  if (!b) { return null; }
  // **枠のずれ**（`fslot`。2026-09-05）。ビーコンの向き（`bcn[][4..5]`）で回す——
  // `SlotX` は右へ、`SlotZ` は前へ
  var fs = r.board && r.board.fslot, sl = tm && tm.slot != null ? tm.slot : null;
  if (fs && sl != null && fs[sl]) {
    var fw = beaconFw(r, si);
    b = { x: b.x + fs[sl][0] * fw.y + fs[sl][1] * fw.x,
          y: b.y - fs[sl][0] * fw.x + fs[sl][1] * fw.y };
  }
  if (!aim || !range) { return { x: b.x, y: b.y }; }
  var far = d2(b.x, b.y, aim.x, aim.y) - aim.br, need = range / U;
  if (far <= need) { return { x: b.x, y: b.y }; }
  var t = (far - need) / (far || 1);
  return { x: b.x + (aim.x - b.x) * t, y: b.y + (aim.y - b.y) * t };
}

/** **形をワールド座標に置く。**`coverOf` が数えるのと**同じ形**を返すので、
    絵に描くほうはこれを使う（2026-09-04、第 5 段）。**式を 2 か所に書かない。**

    返すのは `{typ, cx, cy, ux, uy, R, deg, W, H, EX}`——`cx`/`cy` は
    `PositionOffset` を効かせたあとの中心、`ux`/`uy` は `AngleOffset` を
    効かせたあとの向き（単位ベクトル）、長さは全部ワールド。 */
export function shapeAt(sh, c, fw, gm) {
  if (!sh || !c) { return null; }
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
  return { typ: sh[0], R: (sh[1] || 0) / U, deg: sh[2], W: (sh[3] || 0) / U,
           H: (sh[4] || 0) / U, EX: (sh[5] || 0) / U, ux: ux, uy: uy,
           cx: off ? c.x + off[1] * ux + off[0] * -uy : c.x,
           cy: off ? c.y + off[1] * uy + off[0] * ux : c.y };
}
/** **形の中に入る体。**`sh` は `B.area` の行、`c` は中心、`fw` は向き（単位ベクトル）。
    体は円（中心と `br`）として扱い、形と重なっていれば当たったとする。
    扇は**中心の角度だけ**で見る（体の端が入るぶんは数えない）。 */
export function coverOf(sh, c, fw, bs, gm) {
  var g9 = shapeAt(sh, c, fw, gm);
  if (!g9) { return null; }
  var typ = g9.typ, R = g9.R, deg = g9.deg, W = g9.W, H = g9.H, EX = g9.EX, out = [], i;
  var ux = g9.ux, uy = g9.uy, c2 = { x: g9.cx, y: g9.cy };
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

/** **盤で位置を決められる枠か。**`'pos'` 中心を自由に置ける／`'ent'` 敵の体を
    選んでその体が中心／`'aim'` 向きだけ決まる／`null` 決められない。

    先生の決め（2026-09-04）——「入力で詳細を開いてるスキルが**敵をターゲットできる**
    or **攻撃範囲指定できる**場合のみ盤に入力できるようにすればいいか」。
    `TargetSide` が `Enemy` でないもの（味方に撒く枠・`AliveAllyCenter`）は外す。
    **味方の位置は盤に出さない**（先生の「味方の位置はいらないか」）。

    **`'ent'` を分けた**（2026-09-05 の先生の指摘「敵をターゲット選択してその敵を
    中心とした位置なのか、敵指定無くただの範囲指定なのかの差別化ができてない」）。
    `SpawnPositionType` が `InputBattleEntity` / `BattleEntity` /
    `SkillCommandSelectedTarget` の枠は、ゲームでは**敵を 1 体選んでその体の上に
    範囲が出る**ので、中心を体の外に置くことができない。マコト（水着）の EX が
    これ（`SkillCommandSelectedTarget`・`Circle 350`）。`InputPosition` だけが
    地面のどこにでも置ける。 */
export function placeKind(gm) {
  if (!gm || gm[2] !== 'Enemy') { return null; }
  var sp = gm[0];
  if (sp === 'InputPosition') { return 'pos'; }
  if (sp === 'InputBattleEntity' || sp === 'BattleEntity'
      || sp === 'SkillCommandSelectedTarget') { return 'ent'; }
  if (sp === 'Invoker') { return 'aim'; }
  return null;
}

/** **置いた点にいちばん近い体。**`'ent'` の枠の中心はここへ吸い付く。 */
export function snapBody(bs, at) {
  var best = null, bd = 0, i;
  for (i = 0; i < bs.length; i++) {
    var dd = d2(at.x, at.y, bs[i].x, bs[i].y) - bs[i].br;
    if (best == null || dd < bd) { best = bs[i]; bd = dd; }
  }
  return best;
}

/** **人が動かした体を当てた盤。**`bp` は `{ 札: [x, y] }`（`bodiesOf` の `key`）。
    動かせるのは `_Move` の付いた体だけ。 */
export function movedBodies(bs, bp) {
  if (!bp) { return bs; }
  var out = [], i;
  for (i = 0; i < bs.length; i++) {
    var q = bp[bs[i].key];
    if (!q || !bs[i].mv) { out.push(bs[i]); continue; }
    out.push({ n: bs[i].n, x: q[0], y: q[1], br: bs[i].br, cid: bs[i].cid,
               sum: bs[i].sum, key: bs[i].key, mv: 1, put: 1 });
  }
  return out;
}

/** **中心（または狙う点）を人が置いたときの当たり。**`hitsOf` と同じ形を返す。
    `at` はワールド座標 `{x, y}`、`bp` は動かした体。 */
export function hitsAtOf(r, sid, kind, si, ex, on, at, bp, tm) {
  var sh = ((B.area || {})[sid] || {})[kind],
      gm = ((B.geo || {})[sid] || {})[kind];
  if (!sh || !gm || !r || !r.board || !at) { return null; }
  var pk = placeKind(gm);
  if (!pk) { return null; }
  var bs = movedBodies(bodiesOf(r, si, ex, on, tm), bp);
  if (!bs.length) { return null; }
  // **敵を選ぶ枠は、置いた点にいちばん近い体の中心へ吸い付ける**（`'ent'`）
  if (pk === 'ent') {
    var sb = snapBody(bs, at);
    if (sb) { at = { x: sb.x, y: sb.y }; }
  }
  var aim = { x: at.x, y: at.y, br: 0 };
  // **向きだけ決める枠（`'aim'`。アリスの光線）は、撃つ子が置いた点へ歩かない**
  // （2026-09-05。先生の「アリスみたいにスキルの位置じゃなくて向きを指定する
  // キャラに盤が対応できてない」）。立ち位置は `bestHitsOf` と同じ「いちばん近い
  // 体へ届くところ」に固定して、置いた点は向きにだけ使う。それまでは置いた点へ
  // 届くところまで歩いていたので、摘みを引くと光線の根元が一緒に動いていた
  var me = standOf(r, pk === 'aim' ? (aimOf(r, bs, si) || aim) : aim, gm[4], si, tm);
  if (!me) { return null; }
  // `Invoker` は撃つ子の足元が中心。狙う点は向きを決めるだけ
  var c = pk === 'aim' ? me : { x: at.x, y: at.y };
  var fw = { x: at.x - me.x, y: at.y - me.y };
  if (!fw.x && !fw.y) { fw = { x: 0, y: 1 }; }
  var hit = coverOf(sh, c, fw, bs, gm);
  if (!hit) { return null; }
  var nb = 0, hb = 0, j;
  for (j = 0; j < hit.length; j++) {
    if (hit[j].cid === r.cid) { hb = 1; } else { nb++; }
  }
  return { n: hit.length, nb: nb, hb: hb, hit: hit, c: c, me: me,
           aim: { x: at.x, y: at.y, br: 0 }, bs: bs, pk: pk };
}

/** **その（生徒, 枠）が何体に当たるか。**決められなければ null。

    `SpawnPositionType` が
      `Invoker`                        … 撃った子の足元が中心
      `InputPosition` / `InputBattleEntity` / `BattleEntity` … 狙った体が中心
      それ以外                          … 決められない（null） */
export function hitsOf(r, sid, kind, si, ex, on, tm) {
  var sh = ((B.area || {})[sid] || {})[kind],
      gm = ((B.geo || {})[sid] || {})[kind];
  if (!sh || !gm || !r || !r.board) { return null; }
  var bs = bodiesOf(r, si, ex, on, tm);
  if (!bs.length) { return null; }
  var aim = aimOf(r, bs, si);
  if (!aim) { return null; }
  var me = standOf(r, aim, gm[4], si, tm);
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

// ------------------------------------------------------------ 巻き込める最大数
// **「何体に当てられるか」は狙い方で変わる。**いちばん多く覆える置き方を探して、
// それを既定にする（2026-09-04 の先生の指示「デフォルトを巻き込める最大数、
// 任意で数を選べるって感じにできる？」）。少なくしたいときは今までどおり
// 入力欄（行の「当たる数」）で下げる。
//
// 中心の置き方は `SpawnPositionType` で決まる:
//   `InputPosition`     … 地面の好きな点。候補は「体の上」と「2 体の円の交点」
//                         （最大被覆円の中心は必ずこのどちらか）
//   `InputBattleEntity` / `BattleEntity` … 体に貼り付くので候補は体の上だけ
//   `Invoker`           … 撃った子の足元で動かせない。**向きだけ**を振る
//                         （候補は各体の方向と、2 体の中間の方向）
var _MAXBODY = 24;

function _reach(sh) {
  if (sh[0] === 'Obb') { return Math.max(sh[3] || 0, sh[4] || 0) / 2 / U; }
  return (sh[1] || 0) / U;
}

/** 中心の候補。 */
function _centers(sh, bs, spawn) {
  var R = _reach(sh), out = [], i, j;
  for (i = 0; i < bs.length; i++) { out.push({ x: bs[i].x, y: bs[i].y }); }
  if (spawn !== 'InputPosition') { return out; }
  for (i = 0; i < bs.length && i < _MAXBODY; i++) {
    for (j = i + 1; j < bs.length && j < _MAXBODY; j++) {
      var r1 = R + bs[i].br, r2 = R + bs[j].br;
      var dx = bs[j].x - bs[i].x, dy = bs[j].y - bs[i].y;
      var dd = Math.sqrt(dx * dx + dy * dy);
      if (!dd || dd > r1 + r2) { continue; }
      var a = (r1 * r1 - r2 * r2 + dd * dd) / (2 * dd), h2 = r1 * r1 - a * a;
      if (h2 < 0) { continue; }
      var h = Math.sqrt(h2), xm = bs[i].x + a * dx / dd, ym = bs[i].y + a * dy / dd;
      out.push({ x: xm + h * dy / dd, y: ym - h * dx / dd });
      out.push({ x: xm - h * dy / dd, y: ym + h * dx / dd });
    }
  }
  return out;
}

/** 向きの候補（`Invoker` 用）。各体の方向と、2 体の中間。 */
function _facings(me, bs) {
  var out = [], i, j;
  for (i = 0; i < bs.length; i++) {
    out.push({ x: bs[i].x - me.x, y: bs[i].y - me.y });
    for (j = i + 1; j < bs.length && j < _MAXBODY; j++) {
      out.push({ x: (bs[i].x + bs[j].x) / 2 - me.x, y: (bs[i].y + bs[j].y) / 2 - me.y });
    }
  }
  return out;
}

/** **その（生徒, 枠）が巻き込める最大数。**決められなければ null。
    返す形は `hitsOf` と同じ（`n` / `nb` / `hb` / `hit` / `c` / `me` / `aim`）。 */
export function bestHitsOf(r, sid, kind, si, ex, on, tm) {
  var sh = ((B.area || {})[sid] || {})[kind],
      gm = ((B.geo || {})[sid] || {})[kind];
  if (!sh || !gm || !r || !r.board) { return null; }
  var bs = bodiesOf(r, si, ex, on, tm);
  if (!bs.length) { return null; }
  var spawn = gm[0], best = null, i, k;
  if (spawn === 'Invoker') {
    // 立ち位置は「いちばん近い体まで届くところ」。そこから向きだけ振る
    var aim0 = aimOf(r, bs, si), me = standOf(r, aim0, gm[4], si, tm);
    if (!me) { return null; }
    var fws = _facings(me, bs);
    for (i = 0; i < fws.length; i++) {
      var hit = coverOf(sh, me, fws[i], bs, gm);
      if (hit && (!best || hit.length > best.hit.length)) {
        best = { hit: hit, c: me, me: me, aim: aim0 };
      }
    }
  } else if (spawn === 'InputPosition' || spawn === 'InputBattleEntity'
             || spawn === 'BattleEntity' || spawn === 'SkillCommandSelectedTarget') {
    var cs = _centers(sh, bs, spawn);
    for (k = 0; k < cs.length; k++) {
      var c = cs[k], stand = standOf(r, { x: c.x, y: c.y, br: 0 }, gm[4], si, tm);
      if (!stand) { continue; }
      var fw = { x: c.x - stand.x, y: c.y - stand.y };
      if (!fw.x && !fw.y) { fw = { x: 0, y: 1 }; }
      var h2 = coverOf(sh, c, fw, bs, gm);
      if (h2 && (!best || h2.length > best.hit.length)) {
        best = { hit: h2, c: c, me: stand, aim: null };
      }
    }
  } else {
    return null;
  }
  if (!best) { return null; }
  var nb = 0, hb = 0, j;
  for (j = 0; j < best.hit.length; j++) {
    if (best.hit[j].cid === r.cid) { hb = 1; } else { nb++; }
  }
  best.n = best.hit.length; best.nb = nb; best.hb = hb; best.bs = bs;
  return best;
}

var _ggf = {};
/** **グロッキー中に盤が増えるぶんの倍率**（2026-09-04）。
    小さなペロロ 5 体は `Sections[].Events[]` の
    `GroundConditionStatusCheck {"StatusToCheck":"Groggy"}` でだけ湧く（`spawnOn`）。
    同じスキルの形で「いちばん多く覆える置き方」を**ふだんの盤**と
    **グロッキー中の盤**の両方で解いて、その比を返す。

    **`gspl.n`（説明文の「5体」）は「盤に何体増えるか」であって
    「1 発が何体に当たるか」ではない。**ホシノ（臨戦）の `Circle 300`（3.0 ワールド）は
    ふだんの盤（本体＋大 6）で最大 4 体、グロッキー中の盤（＋小 5）で最大 10 体なので 2.5。
    形が引けないスキルは `null`（呼ぶ側が 1 にする）。 */
export function ggFactor(r, sid, kind) {
  if (!r || !r.board || sid == null) { return null; }
  var key = (r.cid || 0) + '|' + sid + '|' + kind;
  if (key in _ggf) { return _ggf[key]; }
  // **グロッキー中に大きなペロロは盤に居ない。**グロッキーは `Ex09` の吸収で始まり、
  // その `Ex09` が `Immortal` を剥がして 999999999% を入れて 20.0 ワールドの中を
  // 全部消す。だからグロッキー中の盤は**本体 ＋ 小さなペロロ 5 体**で、
  // 大きなペロロ 6 体は入らない（`bodiesOf` の第 3 引数に `false`）
  var got = null,
      a = bestHitsOf(r, sid, kind, null, null, null),
      b = a && a.n ? bestHitsOf(r, sid, kind, null, false, ['st:Groggy']) : null;
  if (a && a.n && b && b.n) { got = b.n / a.n; }
  _ggf[key] = got;
  return got;
}
