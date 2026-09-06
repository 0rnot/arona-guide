import { B } from './util.js';
import { memo, st } from './core.js';
import { poolBodies, poolOf } from './pool.js';
import { trOf } from './carry.js';
import { dmgOf, nbOf, repUnits } from './dmg.js';
import { epTierPick } from './ep.js';
import { aimFromHits, bestHitsOf } from './board.js';
import { sceneAt } from './view.js';
import { fallMap } from './deadly.js';
import { busyOf, naTimes } from './na.js';
import { exStart, nsBusy } from './ns.js';

// ------------------------------------------------------------ SS（サブスキル）が何体に当たるか
// **SS のダメージは長いあいだ 1 体ぶんしか数えていなかった**（2026-09-06。LOOP.md の
// 「検証の残り」）。EX は置いた 1 発ごとに当たる先 `tg`・当たる数 `mc`・本体にも当たるか
// `hb` を持つが、SS は `clear.js` / `carry.js` / `roll.js` が
// `dmgOf(…, 'ExtraPassive', …, subIxOfPool(r, pid))` で数えていて、**掛ける先が無かった**。
//
// 範囲を持つ SS は 274 人で 2 枠だけ（`ssarea.py`）:
//   10099 ホシノ（臨戦）「制圧攻撃」 `["Fan", 850, 30]`  撃つ子の足元から扇（`Invoker`）
//   10034                          `["Circle", 200]`    撃つ子の足元の円（`Invoker`）
// 形と中心の置き方は `B.area` / `B.geo`（`scripts/build-tool-data.py` の `_ls_geom_ss`。
// ホシノの扇の実体は `LevelSkill/CH0258_AttackerNormal02.json` に居る）。
//
// 数え方は EX の既定（`parse-tl.js` の `bestHitsOf` → `aimFromHits`）と同じ——
// **その時刻の盤で「いちばん多く巻き込める置き方」**。SS は人が置くものではないので
// 入力欄は無く、置き直しもできない。盤が無い相手・形が引けない枠は今までどおり 1 体。
//
// **グロッキー中の増えるぶんは `dmg.js` の `gsplMul` に任せる**（当たる先を持つ発は
// `ggFactor` の比、持たない発は `gspl.n`）。だからここは**ふだんの盤**で数える
// （`on` は null。吸収のあと `sc.wave` が無いときは召喚された体も居ない `false`）。
// 二重に掛けないため。

var SS_BUSY = false;

/** その時刻の盤で SS が当たる先。`{tg, mc, hb}`。決められなければ null。 */
export function ssAim(r, i, at) {
  var p = st.party[i];
  if (!p || !r || !r.board || at == null) { return null; }
  var sid = p.id;
  if (!((B.area || {})[sid] || {}).ExtraPassive ||
      !((B.geo || {})[sid] || {}).ExtraPassive) { return null; }
  // **輪の保険**（`view.js` の `dsOf` と同じ）。場面 → 曲線 → ここ → 場面、と
  // 戻ってきたら null。本筋は `sceneAt(r, at, true)` で曲線を引かないこと
  if (SS_BUSY) { return null; }
  var key = ['ssaim', r.cid, sid, i, at, JSON.stringify(st.bst || null)].join('|');
  return memo(key, function () {
    SS_BUSY = true;
    try {
      var sc = sceneAt(r, at, true);
      var tm = { t: at, w0: sc.w0, slot: i, fall: fallMap(r) };
      var q = bestHitsOf(r, sid, 'ExtraPassive', sc.sec, sc.wave || false, null, tm);
      return aimFromHits(r, q);
    } finally { SS_BUSY = false; }
  });
}

var KEYS = ['min', 'avg0', 'avg', 'avgC', 'max'];
/** `f` 体ぶんに増やす。**1 体にしか当たらないぶん（`one`）には `f1` を掛ける**
    （`dmg.js` の `gsplScale` と同じ形。転移なら転移率、本体だけを見るときは 0） */
function scaleD(d, f, f1) {
  if (!d) { return null; }
  var o1 = d.one || {}, o = { va: (d.va || 0) * f, hit: d.hit, crit: d.crit,
                              crit0: d.crit0, name: d.name, one: d.one }, k;
  for (k = 0; k < KEYS.length; k++) {
    o[KEYS[k]] = (d[KEYS[k]] - (o1[KEYS[k]] || 0)) * f + (o1[KEYS[k]] || 0) * f1;
  }
  if (d.u) { o.u = repUnits(d.u, f, f1); }
  return o;
}
function addD(a, b) {
  if (!a) { return b; }
  if (!b) { return a; }
  var o = { va: (a.va || 0) + (b.va || 0), hit: a.hit, crit: a.crit, crit0: a.crit0,
            name: a.name, one: a.one }, k;
  for (k = 0; k < KEYS.length; k++) { o[KEYS[k]] = a[KEYS[k]] + b[KEYS[k]]; }
  if (a.u || b.u) { o.u = (a.u || []).concat(b.u || []); }
  return o;
}

/** **SS の 1 発ぶん**を、盤で当たる数だけ数えて返す。返す形は `dmgOf` と同じ。
    `pid` はどの池に入るぶんを見るか、`sub` はその池の相手（`subIxOfPool(r, pid)`）。

    池の扱いは EX（`clear.js` の `total0` / `clearStat1`、`carry.js` の `dmgCurve0`）と同じ:
      当たった体がその池を分け合う  → 当たった数（池の体数で頭打ち）
      当たった体が本体へ転移する    → 転移率 × 当たった数（本体の池を見ているとき）
      本体にも当たる（`hb`）        → 本体 1 体ぶんを足す（1 体にしか当たらないぶんは除く）
    盤で決められない・本体にしか当たらない発は、今までどおり `sub` の 1 体ぶん。 */
export function ssDmgOf(i, r, at, pid, sub) {
  var p = st.party[i];
  if (!p) { return null; }
  var base = dmgOf(i, r, at, 'ExtraPassive', epTierPick(p.id, r, at, sub), sub);
  var a = ssAim(r, i, at);
  if (!a || !base || a.tg == null) { return base; }
  var nb = nbOf(a), tr = trOf(r, a.tg), pp = poolOf(r, a.tg), out = null, f = 0, f1 = 1;
  if (pp === pid) { f = Math.min(a.mc, poolBodies(r, pid)); f1 = 1; }
  else if (pid === r.cid && tr) { f = tr * a.mc; f1 = tr; }
  if (f) {
    out = scaleD(dmgOf(i, r, at, 'ExtraPassive', epTierPick(p.id, r, at, a.tg), a.tg,
                       null, null, null, nb, 0), f, f1);
  }
  if (pid === r.cid && a.hb) {
    out = addD(out, scaleD(dmgOf(i, r, at, 'ExtraPassive', epTierPick(p.id, r, at, null),
                                 null, null, null, null, nb, 1), 1, 0));
  }
  return out || base;
}

// ------------------------------------------------------------ EX・NS のあとの通常攻撃で出る SS
// **ホシノ（臨戦）10099 の「制圧攻撃」は引き金が `Event 1`（常時）で、`ep.js` の
// `epWhy` が「引き金が 常時 です」と落としていた**（LOOP.md「引き金が未対応 7 人」）。
// 原文「EXスキル、またはノーマルスキルの使用時、すぐにリロードした後、最初の通常攻撃は
// 扇形範囲内の敵に対して攻撃力の<?3>分のダメージ」。データでは、扇の実体が
// **形態 1 の通常攻撃 `LevelSkill/CH0258_AttackerNormal02.json`** に居て
// （`MainEntityData` が `FanAreaEntityDAO`、`AreaAbilities` が
// `CH0258_01_ExtraPassive01_Effect02_Lv1〜10`）、`B.ssnf[id]` がその形態の番号
// （`scripts/build-tool-data.py` の `_ls_geom_ss`）。
//
// 数え方: **EX・NS の演出が明けたあとの最初の通常攻撃が扇になる。**`na.js` の
// `naShots0` は演出が明けると構え直して弾倉を 0 に戻す（＝リロード）ので、
// その並びの「演出明けの最初の発」がそれ。**その発は通常攻撃としては数えない**
// （`Normal02` の `ShotFrames` は SS の札しか配らない＝置き換わる）。
// 2 つの演出の間に通常攻撃が無ければ扇は 1 発（同じ発を 2 度数えない）。

/** その子の SS が「EX・NS のあとの通常攻撃」で出るか */
export function ssReloadFan(id) {
  return id != null && (B.ssnf || {})[id] != null;
}

/** その枠の子が扇を撃つ時刻の並び（昇順）。出ない子は空 */
export function ssUseShots(i, dur) {
  var p = st.party[i];
  if (!p || !ssReloadFan(p.id)) { return []; }
  return memo('ssuse|' + i + '|' + dur, function () {
    var ts = naTimes(i, dur), bz = busyOf(i), ends = [], out = [], seen = {}, q, j;
    for (q = 0; q < bz.length; q++) {
      var s2 = exStart(i, bz[q][0], dur);
      ends.push(s2 + (bz[q][1] - bz[q][0]));
    }
    var nb = nsBusy(i, dur);
    for (q = 0; q < nb.length; q++) { ends.push(nb[q][1]); }
    ends.sort(function (a, b) { return a - b; });
    for (q = 0, j = 0; q < ends.length; q++) {
      while (j < ts.length && ts[j] < ends[q] - 1e-9) { j++; }
      if (j >= ts.length) { break; }
      if (!seen[ts[j]]) { seen[ts[j]] = 1; out.push(ts[j]); }
    }
    return out;
  });
}

/** **通常攻撃の並びを「通常攻撃のまま」と「扇に置き換わる発」に分ける。**
    `{na: [...], ss: [...]}`。扇の無い子は `na` が `naTimes` そのまま */
export function naSplit(i, dur) {
  var ts = naTimes(i, dur), ss = ssUseShots(i, dur);
  if (!ss.length) { return { na: ts, ss: ss }; }
  var set = {}, na = [], j;
  for (j = 0; j < ss.length; j++) { set[ss[j]] = 1; }
  for (j = 0; j < ts.length; j++) { if (!set[ts[j]]) { na.push(ts[j]); } }
  return { na: na, ss: ss };
}
