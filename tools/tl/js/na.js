import { B } from './util.js';
import { isMain, memo, slotOf, st } from './core.js';
import { sim } from './engine.js';
import { statsOf } from './passive.js';

// ------------------------------------------------------------ 通常攻撃
// **出どころは SchaleDB の `students.min.json` の `Skills.Normal.Frames`**
// （＝ ba-data の `LevelSkill/<NormalSkillGroupId>.json` の `AnimationFrames`）と
// `AmmoCount` / `AmmoCost`、`DB/CharacterStatExcelTable` の `NormalAttackSpeed`。
//
// **周期は `AttackIngDuration` 1 本で回す。**ボス側の実装（`build_tl` の
// `per = AttackIngDuration / 30 / (NormalAttackSpeed / 10000)`）と同じ扱いに
// そろえてある。`AttackStartDuration` と `AttackEndDuration` が 1 回ごとに
// 入るのか、弾倉ごとに 1 回なのかは**データからは決められない**ので入れていない。
// 入れると 1 回あたり 1.67 秒が 2.6 秒（毎回）／1.86 秒（弾倉ごと）に伸びる。
// 使った値は下の「数字の出どころ」に全部出している。
//
// **移動・遮蔽・射程外は数えていない。**ずっと撃ち続けられる前提の上限寄りの数字
export function naInfo(id) {
  return frOf((B.na || {})[id]);
}
// **変身している間の撃ち方**（2026-09-04、61f の残り）。`data.js` の `naf` は
// `Skills.Normal.FormChange.Frames`。**14 人のうち実際に値が違うのは 4 人**で、
// うち「切れ方＝時間」で窓が引けるのは シロコ＊テラー（`AttackIngDuration` 30 → 35）・
// スバル（28 → 12）・エイミ（臨戦）（42 → 60）の 3 人。トキは切れ方が 5（EX の回数）
// なので今のところ窓が引けず、素のままになる。
// `fix` は `FixedFrameRate`（1 万分率）で、**その間は攻撃速度のバフで速くならない**
export function nafInfo(id) {
  return frOf((B.naf || {})[id]);
}
function frOf(a) {
  if (!a || !a.ing) { return null; }
  var spd = (a.spd || 10000) / 10000;
  var mag = Math.max(1, Math.floor((a.ammo || 1) / (a.cost || 1)));
  return { per: a.ing / B.fps / spd, mag: mag,
           rel: ((a.brd || 0) + (a.rel || 0)) / B.fps / spd,
           ent: (a.ent || 0) / B.fps / spd, nm: a.n, raw: a, spd: spd,
           fix: a.fix > 0 };
}
/** **変身している区間**（`[始まり, 終わり]` の並び）。
    `B.fchg[id]` は `[切れ方, 段 1〜5 の値]` で、**切れ方 1（時間 ms）だけ**引ける。
    `-1` は「戦闘が終わるまで切れない」（ココロ）。

    **見ているのは `st.tl` に書いてある時刻**で、engine が解いた時刻ではない。
    `usesSorted()` を使うと `usesSorted → statsOf → naShots → usesSorted` で輪になる
    （`ns.js` の `formOK` と同じ理由）。コスト待ちで後ろへ動いたぶんはずれる */
export function formWins(idx, id, dur) {
  var fv = (B.fchg || {})[id];
  if (!fv || fv[0] !== 1) { return null; }
  var ms = fv[1][Math.min(slotOf(idx).ex || 5, fv[1].length) - 1];
  if (ms == null) { return null; }
  var out = [], i;
  for (i = 0; i < st.tl.length; i++) {
    if (st.tl[i].i !== idx || st.tl[i].t == null) { continue; }
    out.push([st.tl[i].t, ms < 0 ? dur + 1 : st.tl[i].t + ms / 1000]);
  }
  return out.length ? out : null;
}
// その枠が EX を撃っている区間。**撃っている本人は通常攻撃をしない**
export function busyOf(idx) {
  sim();      // 先に鍵を更新する（変わっていれば memo はここで捨てられる）
  return memo('bz|' + idx, function () { return busyOf0(idx); });
}
export function busyOf0(idx) {
  var sm = sim(), out = [], i;
  for (i = 0; i < sm.rows.length; i++) {
    var r0 = sm.rows[i];
    if (!r0.d || r0.e.i !== idx || r0.at == null) { continue; }
    out.push([r0.at, r0.at + ((r0.sk && r0.sk.d) || 0) / B.fps]);
  }
  return out;
}
// 通常攻撃が出る時刻。**弾倉を撃ち切ったらリロードのぶん空く**
export function naTimes(idx, dur) {
  sim();
  return memo('na|' + idx + '|' + dur, function () { return naTimes0(idx, dur); });
}
// **時刻だけでなく「その弾倉での何発目か」も要る**（2026-09-03）。
// 弾数で出る NS（`AmmoCountUnder`）がそこに乗る。`k` を外から数え直すと
// EX の演出明けで 0 に戻るぶんがずれるので、ここで一緒に返す
export function naShots(idx, dur) {
  sim();
  return memo('nas|' + idx + '|' + dur, function () { return naShots0(idx, dur); });
}
// **攻撃速度のバフを見ない版**（2026-09-03）。弾数・回数で出る NS
// （`AmmoCountUnder` / `OnAttackIng`）の時刻を決めるのに使う。
// バフ込みの `naShots` を使うと
//   `usesSorted` → `nsTimes` → `naShots` → `statsOf` → `liveBuffs` → `usesSorted`
// で無限に回る（実際に `Maximum call stack size exceeded` を踏んだ）。
// **輪を切る場所はここしかない。**攻撃速度のバフは通常攻撃の間隔を縮めるので、
// そのぶん NS の発動はここで出すより少し早くなる
export function naShotsRaw(idx, dur) {
  sim();
  return memo('nas0|' + idx + '|' + dur, function () { return naShots0(idx, dur, true); });
}
export function naTimes0(idx, dur) {
  var sh = naShots(idx, dur), o = [], i;
  for (i = 0; i < sh.length; i++) { o.push(sh[i].t); }
  return o;
}
export function naShots0(idx, dur, raw) {
  var p = st.party[idx];
  if (!p) { return []; }
  // **SPECIAL（サポーター）は通常攻撃をしない。**盤に出ているのは EX を
  // 撃つあいだだけで、あとは引っ込んでいる。データの側でも
  // `DB/CharacterExcelTable.json` の `SquadType` が `Support`（STRIKER は
  // `Main`）で、STRIKER への `支援値` に変換される側になっている。
  // **数えていたぶん、序盤の削りが実物の 2 倍近くあった**（2026-09-01、
  // 大決戦ビナー Torment の録画と突き合わせて分かった）
  if (!isMain(idx)) { return []; }
  var a = naInfo(p.id);
  if (!a || a.per <= 0) { return []; }
  // **変身している間は、変わったほうのフレームで撃つ**（2026-09-04）。
  // 窓が引けない子（`fchg` が無い・切れ方が 2/3/5）は今までどおり素のまま
  var af = nafInfo(p.id), win = af ? formWins(idx, p.id, dur) : null;
  function frames(x) {
    var w;
    if (!win) { return a; }
    for (w = 0; w < win.length; w++) {
      if (x >= win[w][0] - 1e-9 && x < win[w][1] - 1e-9) { return af; }
    }
    return a;
  }
  var busy = busyOf(idx), out = [], t = a.ent, k = 0, guard = 0;
  function block(x) {
    for (var q = 0; q < busy.length; q++) {
      if (x >= busy[q][0] - 1e-9 && x < busy[q][1] - 1e-9) { return busy[q][1]; }
    }
    return null;
  }
  // **攻撃速度（`AttackSpeed`）のバフで通常攻撃は速くなる。**素は 10000。
  // 発ごとに引き直すと重いので 2 秒刻みに丸めて引く
  function mul(x, fr) {
    // **`FixedFrameRate` の間は攻撃速度が 100% に固定される**（エイミ（臨戦））
    if (raw || fr.fix) { return 1; }
    var cs = statsOf(p.id, idx, Math.floor(x / 2) * 2);
    if (!cs) { return 1; }
    return Math.max(0.1, cs.get('AttackSpeed') / 10000);
  }
  while (t <= dur && guard++ < 8000) {
    var b = block(t);
    var f = frames(t);
    // **演出が明けたら構え直す**（AttackEnterDuration をもう一度)
    if (b != null) { t = b + frames(b).ent; k = 0; continue; }
    out.push({ t: +t.toFixed(3), k: k });
    var m = mul(t, f);
    t += f.per / m; k++;
    if (k % f.mag === 0) { t += f.rel / m; }
  }
  return out;
}
// 弾倉ごとの区間（撃っている間・リロード中）。レーンに描くのに使う
export function naRuns(idx, dur) {
  var ts = naTimes(idx, dur), p = st.party[idx];
  if (!ts.length) { return []; }
  var a = naInfo(p.id), runs = [], cur = null, i;
  for (i = 0; i < ts.length; i++) {
    if (!cur) { cur = { a: ts[i], b: ts[i] + a.per, n: 1 }; continue; }
    if (ts[i] - cur.b < a.per * 0.5) { cur.b = ts[i] + a.per; cur.n++; }
    else { runs.push(cur); cur = { a: ts[i], b: ts[i] + a.per, n: 1 }; }
  }
  if (cur) { runs.push(cur); }
  return runs;
}
