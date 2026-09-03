import { $, B } from './util.js';
import { TE, _byid, isMain, slotOf, st } from './core.js';
import { accIn, ggCritAt, hpRateAt } from './carry.js';
import { clamp } from './stats.js';
import { effMod, statsOf, support, terrMod } from './passive.js';
import { aimOf, enemyAt } from './target.js';
import { altOf, lvlOf, pickOf } from './alt.js';
import { KS } from './clear.js';
import { formWinsCut, naShotsRaw } from './na.js';
import { usesSorted } from './buff.js';

// 1 人の EX スキル 1 回ぶん。会心と乱数の組み合わせで 5 通り返す
// 倍率の幅をどう振るか。0 = 個別設定のまま、-1 = 全部いちばん低い候補、
// +1 = 全部いちばん高い候補（2026-09-01 の先生の指示
// 「上振れシナリオと下振れシナリオ」）。**総当たりするのは達成率の表だけ**
export var PICKF = 0;
/** **グロッキー中にボスが分かれるぶん、1 発が何体に当たるか**（2026-09-03）。
    `data.js` の `gspl` は `RaidSkills` の本文から出した体数（`build-tool-data.py` の `_gspl`）。

      ペロロジラ  グロッキー状態になると、小さなペロロミニオンを5体召喚
                  小さなペロロミニオンはImmortalでその被ダメージの100%分をペロロジラに転移
      クロカゲ    クロカゲの領域内でグロッキー状態になればクロカゲは4つの片鱗に別れ、
                  それぞれ攻撃を受けることになり、その間はすべての味方の会心率が最大値まで増加

    **効かせるのはグロッキー中に分かれるボスだけ**（`gspl.gg`）。ゴズの分身 2 体は
    グロッキーと関係なく、ダメージが本体へ移るとも書いていないので**外してある**。
    当たる先を人が選んだ発（`tg`）には掛けない。そちらは「当たる数」で人が決めている。

    **範囲攻撃でない発にも掛かる。**どの発が範囲かはデータから決められないので、
    まず「全部に当たる」で置いて動画と突き合わせる（2026-09-03。突き合わせの結果は
    `~/arona/tl-work/cards/` と `LOOP.md` の 42 に書く） */
function gsplMul(r, at, tg) {
  var g = r && r.gspl;
  if (!g || !g.n || !g.gg || tg != null) { return 1; }
  return ggCritAt(at) ? g.n : 1;
}
function gsplScale(d, m) {
  if (!d || m === 1) { return d; }
  return { min: d.min * m, avg0: d.avg0 * m, avg: d.avg * m, avgC: d.avgC * m,
           max: d.max * m, va: (d.va || 0) * m, hit: d.hit, crit: d.crit,
           crit0: d.crit0, name: d.name };
}
/** **その 1 発が当たる数**（`u.mc`）。`tg` を置いていない発は 1。
    「円形範囲内の敵の数によって」倍率が変わるスキルの候補を決めるのに使う。
    **ボス本体にも当たるぶん（`hb`）にも同じ数を渡す**——円の中の数は
    どちらを計算していても同じだから（2026-09-04） */
export function nbOf(u) {
  return (u && u.tg != null && u.mc > 1) ? u.mc : 1;
}
/** `nb` はその 1 発が当たる数（`u.mc`）。**「N人以下／N人以上」で倍率が変わる
    スキルは、これで候補が決まる**（2026-09-04。`alt.js` の `nRange`） */
export function dmgOf(idx, r, at, kind, upk, tg, gx, nso, only, nb) {
  var p = st.party[idx];
  if (!p) { return null; }
  var kd = kind || 'Ex';
  // **候補の絞り込みは「当たる先」で変わる**（装甲が部位ごとに違うため。2026-09-03）
  var tb9 = aimOf(r, tg);
  var alt = altOf(p.id, kd, tb9, nb);
  var gm9 = gsplMul(r, at, tg);
  if (!PICKF || !alt || alt.v.length < 2) {
    return gsplScale(dmgOf1(idx, r, at, kd, alt ? pickOf(idx, kd, upk, tb9, nb) : 0,
                            tg, gx, nso, only, nb), gm9);
  }
  // **候補ごとに最後まで計算して比べる。**倍率（`Scale`）だけで比べると、
  // 発数・防御無視・会心の有無が候補ごとに違うぶんを取りこぼす
  var best = null, i;
  for (i = 0; i < alt.v.length; i++) {
    var d = dmgOf1(idx, r, at, kd, i, tg, gx, nso, only, nb);
    if (!d) { continue; }
    if (!best || (PICKF > 0 ? d.avg > best.avg : d.avg < best.avg)) { best = d; }
  }
  return gsplScale(best, gm9);
}
/** その形態の演出の長さ（秒）。**ダメージが何秒かけて出るか** */
export function formDur(id, kind) {
  var sd = _byid[id];
  if (!sd) { return 0; }
  if (kind === 'Ex') { return (sd.d || 0) / B.fps; }
  var m = /^Ex(\d)$/.exec(String(kind));
  if (m) {
    var x = (sd.xs || [])[+m[1] - 1];
    return x ? (x.d || 0) / B.fps : 0;
  }
  return 0;
}
/** **発数が多いスキルは、演出の長さいっぱいに撃ち続ける。**
    ネル（制服）の「怪我しても知らねえからな」は `Hits` が 46 個で、
    演出は 229 フレーム＝7.63 秒。**撃ち始めた瞬間のバフだけで計算すると、
    その最中に乗ったバフが 1 発ぶんも効かない**（2026-09-01。先生の TL は
    カンナ → Cネル → セイア → 水着セイア の順で、Cネル の最中に
    EXスキル与ダメージ倍率 +74.15% と 防御力 -47.81% が乗る作りだった）。
    演出を 6 つに割って、それぞれの時点のバフで計算して平均する。
    **割らない（撃った瞬間だけで引く）形も試しました**（2026-09-01）。
    大決戦ビナー Torment の実測 20,245,147 に対して、割ると 15,032,033、
    割らないと 11,577,602。大決戦ホドの TL の目安「7.5M 以下」に対しても
    割ると残 6,074,012、割らないと 5,951,965 で、**2 本とも割るほうが近い。** */
export var SLICE = 6;
export function sliceOf(id, kind) {
  var effs = ((B.dmg[id] || {})[kind] || []), a = altOf(id, kind), i, q, n = 0;
  function look(list) {
    for (q = 0; q < list.length; q++) {
      var h = list[q][1] || [];
      if (h.length > n) { n = h.length; }
    }
  }
  look(effs);
  if (a) { for (i = 0; i < a.v.length; i++) { look(a.v[i]); } }
  return (n >= 4 && formDur(id, kind) >= 1) ? SLICE : 1;
}
export function dmgOf1(idx, r, at, kind, pick, tg, gx, nso, only, nb) {
  var p0 = st.party[idx];
  if (!p0) { return null; }
  var kd0 = kind || 'Ex';
  var ns = at == null ? 1 : sliceOf(p0.id, kd0);
  if (ns <= 1) { return dmgAt(idx, r, at, kd0, pick, tg, gx, nso, only, nb); }
  var D = formDur(p0.id, kd0), dur0 = r.dur || 240, acc = null, k, q2;
  for (k = 0; k < ns; k++) {
    var ts = Math.min(at + D * (k + 0.5) / ns, dur0);
    var d0 = dmgAt(idx, r, ts, kd0, pick, tg, gx, nso, only, nb);
    if (!d0) { return null; }
    if (!acc) { acc = { min: 0, avg0: 0, avg: 0, avgC: 0, max: 0, va: 0,
                        hit: d0.hit, crit: d0.crit, crit0: d0.crit0, name: d0.name }; }
    for (q2 = 0; q2 < KS.length; q2++) { acc[KS[q2]] += d0[KS[q2]] / ns; }
    // **切り分けは同じ 1 発をバフ違いで見ているだけ**なので、分散は足さずに平均する
    acc.va += (d0.va || 0) / ns;
  }
  return acc;
}
/** **`DamageByHit` が何回出るか。**「その敵が攻撃を受ける度に」なので、
    盤に居る STRIKER の通常攻撃の当たり数を効果の続く間ぶん数えて、上限で頭を打つ。

    **数えているのは通常攻撃だけ。**EX・NS の当たりぶんは入っていない（30 秒で
    通常が 200 発前後あるのに対して EX は数発なので、そのぶんは少なめに出る）。
    攻撃速度のバフも見ていない（`naShotsRaw`。バフ込みの `naShots` を通すと
    `statsOf` → `liveBuffs` → `usesSorted` で輪になる。`na.js` の注記に出典）。
    **狙う先で分けていない**——誰がボスを撃っていて誰がミニオンを撃っているかは
    データからは決まらないので、全員がその敵を撃っている前提の上限寄りの数 */
function hitsOn(r, at, sec, cap) {
  var a = at == null ? 0 : at, b = a + sec, i, q, n = 0;
  if (r && r.dur) { b = Math.min(b, r.dur); }
  for (i = 0; i < st.party.length; i++) {
    if (!st.party[i] || !isMain(i)) { continue; }
    var na = ((B.dmg[st.party[i].id] || {}).Normal || []), hn = 0;
    for (q = 0; q < na.length; q++) { hn += ((na[q][1] || []).length || 1); }
    if (!hn) { hn = 1; }
    var ts = naShotsRaw(i, (r && r.dur) || b);
    for (q = 0; q < ts.length; q++) { if (ts[q].t >= a && ts[q].t < b) { n += hn; } }
  }
  return Math.max(1, Math.min(cap, n));
}
/** **変身後の通常攻撃になっているか**（2026-09-04、61f）。
    `B.fchg[id]` は `[切れ方, 段 1〜5 の値]` で、切れ方 1 だけが時間（ms）。
    **2（リロード回数）・3（装弾数）・5（EX の回数）はまだ数えていない**ので、
    そのぶんは今までどおり素の通常攻撃で引く（出どころは `fchg_of` の注記）。
    `-1` は「戦闘が終わるまで切れない」（ココロ）。 */
function inFormAt(idx, at, dur) {
  var p = st.party[idx];
  if (p == null || at == null) { return false; }
  var fv = (B.fchg || {})[p.id];
  if (!fv || fv[0] !== 1) { return false; }
  var ms = fv[1][Math.min(lvlOf(idx, 'Ex'), fv[1].length) - 1];
  if (ms == null) { return false; }
  // **NS で終わる変身は、その発数で切り詰めた窓を見る**（2026-09-04、50b-3）。
  // エイミ（臨戦）は 30 秒ではなく通常攻撃 4 発ぶんで終わる
  if (fv[2]) {
    var wc = formWinsCut(idx, p.id, dur || 240), w;
    if (!wc) { return false; }
    for (w = 0; w < wc.length; w++) {
      if (at >= wc[w][0] - 1e-9 && at < wc[w][1] - 1e-9) { return true; }
    }
    return false;
  }
  var us = usesSorted(), i;
  for (i = 0; i < us.length; i++) {
    if (us[i].i !== idx || String(us[i].k || 'Ex').indexOf('Ex') !== 0) { continue; }
    if (at < us[i].t) { continue; }
    if (ms < 0 || at < us[i].t + ms / 1000) { return true; }
  }
  return false;
}
export function dmgAt(idx, r, at, kind, pick, tg, gx, nso, only, nb) {
  var p = st.party[idx];
  if (!p) { return null; }
  var kd = kind || 'Ex';
  // **変身している間は、変わったほうの通常攻撃で引く**（2026-09-04、61f）。
  // 撃つ速さ（`Frames`）は 61g で `na.js` が差し替えている
  if (kd === 'Normal' && (B.dmg[p.id] || {}).NormalF && inFormAt(idx, at, r && r.dur)) {
    kd = 'NormalF';
  }
  var effs = ((B.dmg[p.id] || {})[kd] || []).slice();
  // **条件でダメージが変わるぶんは、選んだ候補を 1 つだけ足す**（既定は先頭）。
  // 当たる先で候補が変わるので、`aimOf` の相手で絞る（2026-09-03）
  var alt = altOf(p.id, kd, aimOf(r, tg), nb);
  if (alt) { effs = effs.concat(alt.v[pick || 0] || []); }
  // **`only` は「継続ダメージだけ」「それ以外だけ」の切り分け**（2026-09-03）。
  // 曲線を引くときに、DoT を撃った瞬間ではなく `Period` ごとに置くのに要る
  if (only) {
    effs = effs.filter(function (e) {
      var isDot = e[12] === 'DamageDebuff' && e[4] && e[5];
      return only === 'dot' ? isDot : !isDot;
    });
  }
  if (!effs.length) { return null; }
  var lv = slotOf(idx).lv || 90, bs = r.bs || {};
  // **スキルの段数はスキルごとに別。**NS を EX のレベルで引くと 5 段目になる
  var slv = lvlOf(idx, kd);
  var cs = statsOf(p.id, idx, at);
  if (!cs) { return null; }
  var tb = aimOf(r, tg);
  var eb = at == null ? { def: tb.def, dodge: tb.dodge, crR: tb.crR, cdR: tb.cdR,
                          damaged: 10000, damaged2: 10000, armor: tb.armor, n: 0 }
                      : enemyAt(r, at, tg, gx);
  var atk = cs.get('AttackPower');
  if (isMain(idx)) { atk += support('AttackPower', lv, r); }
  /* **レベル差の倍率。**出典は `DB/BattleLevelFactorExcelTable.json`（51 行。
     2026-09-04 に突き合わせて、この式と 1 行の狂いもなく一致することを確認した）。
     `LevelDiff` は「撃つ側 − 撃たれる側」で、0 が `DamageRate 10000`、
     そこから 1 レベルにつき 200 ずつ減り、`-29` の `4200` まで来たあと
     `-30` から `-50` は全部 `4000` で止まる。原文の両端:
     `{"LevelDiff": -50, "DamageRate": 4000}` / `{"LevelDiff": 0, "DamageRate": 10000}`。
     **`LevelDiff` が正の行は表に無い**ので、上は 1 で止める（表の最大値） */
  var lvMod = clamp(1 - ((r.lv || lv) - lv) * 0.02, 0.4, 1);
  var pen = cs.get('DefensePenetration');
  // **防御無視（`IgnoreDef`）は効果ごとに違う。**中で引き直す
  function defModOf(ig) {
    var d2 = Math.max(((eb.def || 0) - pen) * ((ig == null ? 10000 : ig) / 10000), 0);
    return 10000000 / (d2 * 6000 + 10000000);
  }
  var tm = terrMod(p.id, r.env, cs), em = effMod(p.id, eb.armor, cs);
  // 与ダメージ倍率。**A 枠と B 枠の 2 つ**で、それぞれ
  // （10000 ＋ 与ダメージ増加 − 被ダメージ減少）÷ 10000
  // （Zenn「ブルーアーカイブ ダメージ計算の仕組み」13 章）。
  // SchaleDB の `calculateDamage` は A 枠を 2 つの掛け算にしているが、
  // どちらも既定値では 1.0 で、突き合わせた 151 人の値は変わらない
  // **与ダメージ側（DmgAmpMod）と被ダメージ側（DmgRedMod）は別の掛け算。**
  // それぞれの中だけが足し算です（ItJustWorks Library of Stats and Formulas、
  // 2026-06-20 更新の "Damage Reduction" / "Damage Amplification"）。
  //   DmgAmpMod = 1 + Σ(与ダメージ増加)
  //   DmgRedMod = 1 − Σ(被ダメージ減少)
  //   Dmg Ceil = 攻撃力 × 地形 × 特効 × 倍率 × 1/発数 × 防御 × DmgRedMod ×
  //              DmgAmpMod × Lv 差 × 会心
  // **2026-09-01 まで 1 本の足し算にまとめていました**（両方が同時に効くと
  // 食い違います。与 +20% と 被 +20% で 1.40 対 1.44）
  // 素の被ダメージ率（ケセド 0.1 倍）に、窓の +N% を**掛ける**。玉座 +900% で 0.1 × 10 = 1.0
  var drA = (cs.get('DamageRatio') / 10000) * ((20000 - eb.damaged) / 10000) * (eb.dbase == null ? 1 : eb.dbase);
  var drB = (cs.get('DamageRatio2') / 10000) *
            ((20000 - (eb.damaged2 == null ? 10000 : eb.damaged2)) / 10000);
  // EX スキルダメージ倍率（＝ キサキ枠）。**EX 由来のダメージにだけ掛かる**
  // （同 14 章）。通常攻撃には掛からない
  var exM = /^Ex\d*$/.test(kd) ? cs.get('EnhanceExDamageRate') / 10000 : 1;
  // 通常攻撃側の同じ形の枠。**14 章に載っているのは EX だけ**で、
  // こちらは同じ形として扱っている（データにある `EnhanceBasicsDamageRate`）
  var baM = kd === 'Normal' ? cs.get('EnhanceBasicsDamageRate') / 10000 : 1;
  var stab = cs.get('StabilityPoint'), stabR = cs.get('StabilityRate');
  var sMin = clamp(stab / (stab + 1000) + stabR / 10000, 0, 1);
  var acc = cs.get('AccuracyPoint');
  var hit = clamp(2000 / (Math.max((eb.dodge || 0) - acc, 0) * 3 + 2000), 0, 1);
  var cp = cs.get('CriticalPoint');
  var cRate = clamp(1 - 4000000 / (Math.max(cp - (eb.crR || 0), 0) * 6000 + 4000000), 0, 1);
  // **会心の倍率には 1 倍の下限を置いている。**写し元（SchaleDB の
  // `calculateDamage`）にもけーさんの本にも下限は無いが、下限が無いと
  // **合計ダメージが負になる**。イェソド Torment は会心ダメージ抵抗率が
  // 30,000 で、生徒の会心ダメージ率 20,000 を上回るので
  // `(20000 - 30000) / 10000 = -1` になり、`1 + (cdm - 1)` が -1 倍になる。
  // 全会心平均が -14.9%（HP 36,000,000 に対して -5,364,000）まで沈んだ。
  // **会心が通常より弱くなることは無い**という扱いにして 1 で止める。
  // 元の式に戻すなら、この `Math.max(..., 1)` を外す（2026-09-01）
  var cdm = Math.max((cs.get('CriticalDamageRate') - (eb.cdR || 0)) / 10000, 1);
  // **`var` はこの 1 発のダメージの分散。**突破率（HP を削り切る確率）を出すのに要る。
  // 中身の乱れは 3 つ:
  //   ・ダメージのばらつき … 安定値から 1 倍までの一様乱数（`sMin`〜1）
  //   ・命中 … 確率 `hit` で 0 になる
  //   ・会心 … 確率 `cr` で倍率が `cm` になる
  // **3 つとも独立**として E[X²] − E[X]² を積む。`tick`（継続ダメージの回数）と
  // `HitFrames` のぶんは**別々に振られる**ので、1 回ぶんの分散を回数だけ足す
  // （まとめて 1 発として扱うと分散が回数倍に膨らむ）
  // **会心率だけを差し替えられるようにしてある**（2026-09-03）。`st.crit` に
  // 0〜1 を入れると、素の `cRate` の代わりにそれで解く。**式はそのまま**で、
  // 入口の 1 つの値を替えるだけなので、`Never`（会心しない）・`Always`・
  // グロッキー中の確定会心は今までどおり効く。`crit0` は素の値（バーの既定に使う）
  var cEff = st.crit == null ? cRate : clamp(st.crit, 0, 1);
  var o = { min: 0, avg0: 0, avg: 0, avgC: 0, max: 0, va: 0,
            hit: hit, crit: cEff, crit0: cRate, name: p.en };
  for (var k = 0; k < effs.length; k++) {
    // **`Scale` の段数はスキルによって違う。**通常攻撃は 1 段しかないので、
    // EX のレベルで引くと範囲外になって 0 になる（2026-09-01 に踏んだ）
    var e = effs[k], arr0 = e[0] || [];
    // **「ノーマルスキルの発動 N 回毎に」の行は、N 回に 1 度しか出ない**（2026-09-03）。
    // ミカの隕石（339%）がこれで、毎回数えると NS の出力が 1.8 倍になる。
    // `nso` はその子の NS が何発目か（1 始まり）。渡ってこない呼び方では出さない
    if (e[14] > 1 && (!nso || nso % e[14] !== 0)) { continue; }
    var sc = arr0[Math.min(slv, arr0.length) - 1] || 0;
    var hs = e[1] || [10000], sum = 0, q, full = false;
    for (q = 0; q < hs.length; q++) { sum += hs[q]; if (hs[q] === 10000) { full = true; } }
    // **`Hits` の読み方は 2 通りある**（2026-09-01 の全キャラ照合で確定）。
    //   10000 が 1 つでもある → 各値は「フル発に対する割合」。**合計ぶん出る**
    //     ヒビキの愛用品スキルが [10000, 5500, 1000, 1000, 1000] で、
    //     説明文の「同じ対象にダメージを与える度にダメージが45%減少（最少で10%
    //     ダメージまで）」そのもの。合計 185%。
    //     （SchaleDB は「10000 があれば全部フル発」と当てて 500% にしている）
    //   1 つも無い → `Hits` は `Scale` の**配分**。総量は `Scale` のまま
    //     11 発 × 909 のように端数が出るので、合計で割ると 0.04% ずれる
    var mult = full ? sum / 10000 : 1;
    // **継続ダメージ（`DamageDebuff`）は `Duration ÷ Period` 回ぶん出る。**
    // 1 回ぶんしか数えていなくて、ヒビキ（応援団）が 30 分の 1 だった
    // （2026-09-01。`Period` は全部 4000ms、`Duration` は 16000〜120000）。
    // **戦闘の終わりで打ち切る。**
    var tick = 1;
    if (e[4] && e[5]) {
      tick = Math.floor(e[5] / e[4]);
      if (at != null && r.dur) {
        tick = Math.max(0, Math.min(tick, Math.floor((r.dur - at) * 1000 / e[4])));
      }
    }
    // **`DamageByHit` は「その敵が攻撃を受ける度に」出る**（2026-09-03）。
    // 1 回ぶんしか数えていなかった（メル 上限 480・ミユ 120/50・キララ 100・
    // ノア（パジャマ）240・スミレ（アルバイト）240 の 5 人 6 枠）。
    // 上限の出どころは `build-tool-data.py` の `dbh_cap`（`DB/LogicEffect_PC.json`）
    if (e[15] && e[5]) { tick = hitsOn(r, at, e[5] / 1000, e[15]); }
    // **`HitFrames` は「1 秒毎に N 秒間」型。**書いてあるフレームの数だけフル発が出る。
    // 落としていて 1 発ぶんしか数えていなかった（チセ・サヤ・サヤ（私服）・
    // チェリノ（温泉）・メグの 5 人 6 枠。2026-09-01 の全キャラ照合）
    if (e[7] && e[7].length) {
      var hf = e[7], nh = 0;
      for (q = 0; q < hf.length; q++) {
        if (at == null || !r.dur || at + hf[q] / TE.FPS <= r.dur) { nh++; }
      }
      tick *= nh;
    }
    // **範囲が居座るもの**（ミサキ EX）。`ZoneDuration ÷ ZoneHitInterval` 回、
    // `Hits` の数だけ範囲がある。単位はフレーム
    if (e[8]) {
      var zd = e[8][0], zi = e[8][1], nz = Math.ceil(zd / zi), k2;
      if (at != null && r.dur) {
        for (k2 = nz, nz = 0; nz < k2 && at + nz * zi / TE.FPS <= r.dur; nz++) { void 0; }
      }
      tick *= nz;
    }
    var ig = e[6] ? (e[6][Math.min(slv, e[6].length) - 1] || 10000) : null;
    // **撃つ子の能力でダメージが変わるもの**（2026-09-03、56a）。
    // `StatModifier` を運んでいなくて、オトギの通常攻撃と NS が 1 倍のままだった
    // （キサキ込みで ×1.807 の過小）。出どころは `build-tool-data.py` の注記
    var smM = 1;
    if (e[16]) {
      var sv = cs.get(e[16][0]), sLo = e[16][1], sHi = e[16][2];
      if (sv >= 0 && sHi > sLo) {
        var sf = Math.max(0, Math.min(1, (sv - sLo) / (sHi - sLo)));
        smM = (e[16][3] + (e[16][4] - e[16][3]) * sf) / 10000;
      }
    }
    // **当たる先の HP でダメージが変わるもの**（2026-09-03、56b）。
    // 倍率は `MultiplierMin + (MultiplierMax − MultiplierMin) × h`。
    // `h` は `carry.js` の `hpRateAt`（`ggSolve` が 4 周まわして解く）。
    // **見ているのは本体の池だけ**なので、部位に当てたときも本体の HP で引く
    var hrM = 1;
    if (e[17]) {
      var hR = hpRateAt(at), hLo = (e[17][0] || 0) / 10000, hHi = (e[17][1] || 10000) / 10000;
      var hf = hHi > hLo ? Math.max(0, Math.min(1, (hR - hLo) / (hHi - hLo))) : 0;
      hrM = e[17][2] + (e[17][3] - e[17][2]) * hf;
    }
    var base = atk * tm * em * (sc / 10000) * mult * defModOf(ig) *
               drA * drB * exM * baM * lvMod * tick * smM * hrM;
    // **蓄積（ワカモ・カンナ）**（2026-09-03、56c）。**倍率ではなく、
    // その間に味方が入れたダメージそのものが弾になる。**
    //   ・溜める秒数と取り込む割合は `AccumulateEffectDAO`（`build-tool-data.py` の注記）
    //   ・上限は攻撃力 × `Scale`（ワカモ 1322.34%・カンナ 2691%）
    //   ・出すほうの弾は `BulletType: 5`（神秘）で、**カンナは自分の貫通ではなく神秘**
    //   ・`ApplyDefense` が無く `DefensePenetrationRate: 10000` なので**防御は引かない**
    //   ・`CriticalCheck: 1` で会心なし（説明文も「会心が発動しません」）
    // 地形・被ダメージ率・レベル差はそのまま掛かる（DAO の `Apply…` が全部 true）
    if (e[18]) {
      var aSec = (e[18][0] || 0) / 1000;
      var aRt = ((e[18][1] || [])[Math.min(slv, (e[18][1] || []).length) - 1] || 10000) / 10000;
      var aSum = Math.min(atk * (sc / 10000), accIn(at, aSec) * aRt);
      var aEm = eb.armor === 'Structure' ? 1
              : (((B.bam[e[18][2]] || {})[eb.armor] || [10000])[0] / 10000);
      base = aSum * tm * aEm * drA * drB * lvMod;
    }
    // **グロッキー中は確定会心**（この関数の上、ggCritAt の注記に出典）
    var cr = e[2] === 'Never' ? 0
           : (e[2] === 'Always' || ggCritAt(at) ? 1 : cEff);
    var cm = e[2] === 'Never' ? 1 : cdm;
    // **持続ダメージ（DoT）に会心は乗らない**（2026-09-03）。
    // `DamageOverTimeEffectDAO` には `CriticalCheck` の欄が**無い**。同じメルの EX で
    // `CH0124_Ex01_Effect01`（`DamageEffectDAO`）だけが `"CriticalCheck": 2` を持ち、
    // `Effect02`（DoT）と `Effect03`（`DamageByHit`）は欄ごと無い。説明文も Effect03 に
    // ついて「このダメージにおいては、会心が発動しません」と書いている。
    // **`cr` / `cm` をここで落とすと、下の `eC` / `eC2`（分散）も自動で 1 になる**
    if (e[12] === 'DamageDebuff') { cr = 0; cm = 1; }
    // **蓄積の弾も会心が出ない**（`CriticalCheck: 1`。56c）
    if (e[18]) { cr = 0; cm = 1; }
    // **安定値に影響されない攻撃がある**（ヒナ（ドレス）の CH0230Ex02/03/04。
    // 説明文が「この攻撃は安定値に影響されず最大ダメージが適用される」と書いている）。
    // データ全体で 3 件だけ（2026-09-02 に数えて確かめた）
    var sN = e[9] === 0 ? 1 : sMin;
    var mid = (sN + 1) / 2;
    // **上限は 1 発ごとに掛かる**（出典は `dmgCap` の注記）。`base` は多段（`Hits`）と
    // 継続（`tick`）の回数ぶんを掛けたあとの値なので、**1 発ぶんに割って上限を通し、
    // また掛け戻す**。`Hits` の取り分は `hs[q] / Σhs`（`full` かどうかに依らず同じ形）
    var nt = Math.max(1, tick), hsm = 0;
    for (q = 0; q < hs.length; q++) { hsm += hs[q]; }
    function capS(f) {
      var t2 = 0, z;
      if (!(hsm > 0)) { return dmgCap(base * f / nt) * nt; }
      for (z = 0; z < hs.length; z++) { t2 += dmgCap(base / nt * (hs[z] / hsm) * f); }
      return t2 * nt;
    }
    var cA = capS(mid), cB = capS(mid * cm);
    o.min += capS(sN);
    o.max += capS(cm);
    o.avg0 += cA * hit;
    o.avgC += cB * hit;
    o.avg += ((1 - cr) * cA + cr * cB) * hit;
    // 1 回ぶん（`tick` で割ったもの）の平均と 2 乗平均
    // **多段は 1 発ずつ別々に振られる。**まとめて 1 発として扱うと分散が
    // 発数の 2 乗で効いてしまう（ネル（制服）は `Hits` が 46 個）。
    // 各段の取り分を `hs[q]/sum` として、分散は Σ(hs²)/(Σhs)² 倍
    var hsum = 0, hsq = 0;
    for (q = 0; q < hs.length; q++) { hsum += hs[q]; hsq += hs[q] * hs[q]; }
    var hf2 = (hs.length > 1 && hsum > 0) ? hsq / (hsum * hsum) : 1;
    var n1 = Math.max(1, tick), b1 = base / n1;
    var eR = mid, eR2 = (1 - sN) * (1 - sN) / 12 + mid * mid;
    var eC = 1 + (cm - 1) * cr, eC2 = (1 - cr) + cr * cm * cm;
    var m1 = b1 * eR * hit * eC;
    var m2 = b1 * b1 * hf2 * eR2 * hit * eC2;
    o.va += n1 * Math.max(0, m2 - m1 * m1 * hf2);
  }
  return o;
}

/** その 1 発の継続ダメージ（DoT）が、いつ・何回に分けて入るか。
    **`Period`（ms）ごとに `Duration ÷ Period` 回**。戦闘の終わりで打ち切る。
    返すのは `[時刻, …]`（回数ぶん）。DoT が無ければ空。

    2026-09-03。それまで DoT は**撃った瞬間に全部入って**いて、曲線・討伐時刻・
    HP のゲート・スコアがその分だけ早くずれていた（ヒビキ（応援団）は 120 秒ぶん）。 */
export function dotTimes(idx, r, at, kind, pick, tg) {
  var p = st.party[idx];
  if (!p) { return []; }
  var kd = kind || 'Ex';
  var effs = ((B.dmg[p.id] || {})[kd] || []).slice();
  var alt = altOf(p.id, kd, aimOf(r, tg));
  if (alt) { effs = effs.concat(alt.v[pick || 0] || []); }
  var per = 0, dur = 0, i;
  for (i = 0; i < effs.length; i++) {
    var e = effs[i];
    if (e[12] !== 'DamageDebuff' || !e[4] || !e[5]) { continue; }
    // **いちばん長いものに合わせる。**同じ枠に DoT が 2 本ある子はいない
    if (e[5] > dur) { per = e[4]; dur = e[5]; }
  }
  if (!per || !dur) { return []; }
  var n = Math.floor(dur / per), out = [], end = r.dur || 240, k;
  for (k = 0; k < n; k++) {
    var t = at + (k + 1) * per / 1000;
    if (t > end + 1e-9) { break; }
    out.push(t);
  }
  return out;
}

/** **1 発ごとのダメージ上限。**4,000,000 までは素通しで、そこから先は段階的に減り、
    19,969,999 で頭打ちになる。段は 4M・6.248M・8.496M・10.744M・12.992M・
    15.240M・17.488M・19.736M・22M で、係数は 1 → 0.8 → 0.65 → 0.5 → 0.4 → 0.3 →
    0.225 → 0.15 → 0.075。**掛かるのは 1 発ごとで、合計には掛からない。**

    **出典は一次資料の `DB/CharacterCalculationLimitExcelTable.json`**（2026-09-04 に
    突き合わせて一致を確認した。それまでは ItJustWorks Library of Stats and Formulas の
    「Damage Cap」しか無かった）。同表 22 行は 11 の `TacticEntityType` ×
    `FinalDamage` / `FinalHeal` で、`FinalDamage` は全型が同じ値。原文:
    `{"Id": 1, "TacticEntityType": "Student", "CalculationValue": "FinalDamage", "MinValue": 1, "MaxValue": 4000000, "LimitStartValue": [10000, 15620, 21240, 26860, 32480, 38100, 43720, 49340, 55000], "DecreaseRate": [2000, 3500, 5000, 6000, 7000, 7750, 8500, 9250, 10000]}`
    下の `CAPS` の段は `LimitStartValue` × 400、係数は `1 - DecreaseRate / 10000`。
    9 段目の先（22M 超）は係数 0 ＝ それ以上は増えない */
var CAPS = [[4000000, 1], [6248000, 0.8], [8496000, 0.65], [10744000, 0.5],
            [12992000, 0.4], [15240000, 0.3], [17488000, 0.225],
            [19736000, 0.15], [22000000, 0.075]];
export function dmgCap(x) {
  if (!(x > 4000000)) { return x || 0; }
  var out = 0, lo = 0, i;
  for (i = 0; i < CAPS.length; i++) {
    out += CAPS[i][1] * Math.max(0, Math.min(x, CAPS[i][0]) - lo);
    lo = CAPS[i][0];
  }
  return out;
}

// `PICKF` は dmg.js の持ち物。pool.js / clear.js から差し替えるための窓口
export function setPICKF(v) { PICKF = v; }
