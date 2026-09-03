import { $, B } from './util.js';
import { TE, _byid, isMain, slotOf, st } from './core.js';
import { ggCritAt } from './carry.js';
import { clamp } from './stats.js';
import { effMod, statsOf, support, terrMod } from './passive.js';
import { aimOf, enemyAt } from './target.js';
import { altOf, lvlOf, pickOf } from './alt.js';
import { KS } from './clear.js';

// 1 人の EX スキル 1 回ぶん。会心と乱数の組み合わせで 5 通り返す
// 倍率の幅をどう振るか。0 = 個別設定のまま、-1 = 全部いちばん低い候補、
// +1 = 全部いちばん高い候補（2026-09-01 の先生の指示
// 「上振れシナリオと下振れシナリオ」）。**総当たりするのは達成率の表だけ**
export var PICKF = 0;
export function dmgOf(idx, r, at, kind, upk, tg, gx) {
  var p = st.party[idx];
  if (!p) { return null; }
  var kd = kind || 'Ex';
  // **候補の絞り込みは「当たる先」で変わる**（装甲が部位ごとに違うため。2026-09-03）
  var tb9 = aimOf(r, tg);
  var alt = altOf(p.id, kd, tb9);
  if (!PICKF || !alt || alt.v.length < 2) {
    return dmgOf1(idx, r, at, kd, alt ? pickOf(idx, kd, upk, tb9) : 0, tg, gx);
  }
  // **候補ごとに最後まで計算して比べる。**倍率（`Scale`）だけで比べると、
  // 発数・防御無視・会心の有無が候補ごとに違うぶんを取りこぼす
  var best = null, i;
  for (i = 0; i < alt.v.length; i++) {
    var d = dmgOf1(idx, r, at, kd, i, tg, gx);
    if (!d) { continue; }
    if (!best || (PICKF > 0 ? d.avg > best.avg : d.avg < best.avg)) { best = d; }
  }
  return best;
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
export function dmgOf1(idx, r, at, kind, pick, tg, gx) {
  var p0 = st.party[idx];
  if (!p0) { return null; }
  var kd0 = kind || 'Ex';
  var ns = at == null ? 1 : sliceOf(p0.id, kd0);
  if (ns <= 1) { return dmgAt(idx, r, at, kd0, pick, tg, gx); }
  var D = formDur(p0.id, kd0), dur0 = r.dur || 240, acc = null, k, q2;
  for (k = 0; k < ns; k++) {
    var ts = Math.min(at + D * (k + 0.5) / ns, dur0);
    var d0 = dmgAt(idx, r, ts, kd0, pick, tg, gx);
    if (!d0) { return null; }
    if (!acc) { acc = { min: 0, avg0: 0, avg: 0, avgC: 0, max: 0, va: 0,
                        hit: d0.hit, crit: d0.crit, crit0: d0.crit0, name: d0.name }; }
    for (q2 = 0; q2 < KS.length; q2++) { acc[KS[q2]] += d0[KS[q2]] / ns; }
    // **切り分けは同じ 1 発をバフ違いで見ているだけ**なので、分散は足さずに平均する
    acc.va += (d0.va || 0) / ns;
  }
  return acc;
}
export function dmgAt(idx, r, at, kind, pick, tg, gx) {
  var p = st.party[idx];
  if (!p) { return null; }
  var kd = kind || 'Ex';
  var effs = ((B.dmg[p.id] || {})[kd] || []).slice();
  // **条件でダメージが変わるぶんは、選んだ候補を 1 つだけ足す**（既定は先頭）。
  // 当たる先で候補が変わるので、`aimOf` の相手で絞る（2026-09-03）
  var alt = altOf(p.id, kd, aimOf(r, tg));
  if (alt) { effs = effs.concat(alt.v[pick || 0] || []); }
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
    var base = atk * tm * em * (sc / 10000) * mult * defModOf(ig) *
               drA * drB * exM * baM * lvMod * tick;
    // **グロッキー中は確定会心**（この関数の上、ggCritAt の注記に出典）
    var cr = e[2] === 'Never' ? 0
           : (e[2] === 'Always' || ggCritAt(at) ? 1 : cEff);
    var cm = e[2] === 'Never' ? 1 : cdm;
    // **安定値に影響されない攻撃がある**（ヒナ（ドレス）の CH0230Ex02/03/04。
    // 説明文が「この攻撃は安定値に影響されず最大ダメージが適用される」と書いている）。
    // データ全体で 3 件だけ（2026-09-02 に数えて確かめた）
    var sN = e[9] === 0 ? 1 : sMin;
    var mid = (sN + 1) / 2;
    o.min += base * sN;
    o.max += base * cm;
    o.avg0 += base * mid * hit;
    o.avgC += base * cm * mid * hit;
    o.avg += (base * mid + base * mid * (cm - 1) * cr) * hit;
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

// `PICKF` は dmg.js の持ち物。pool.js / clear.js から差し替えるための窓口
export function setPICKF(v) { PICKF = v; }
