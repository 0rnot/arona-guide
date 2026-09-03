import { B } from './util.js';
import { SLOTS, _byid, memo, slotOf, st } from './core.js';
import { sim } from './engine.js';
import { busyOf, naInfo, naShotsRaw } from './na.js';

// ------------------------------------------------------------ 通常スキル（NS）
// **自動発動の周期は `LevelSkill/<PublicSkillGroupId>.json` の `AutoUseRule`。**
// `ConditionType: "Interval"` なら `ConditionArgument` がフレーム（750 = 25 秒）。
// `OnAttackIng` など間隔で決まらない型は、周期が出せないので置かない
export function nsKind(id) {
  return (gearT(id) >= 2 && (B.dmg[id] || {}).GearPublic) ? 'GearPublic' : 'Public';
}
// その生徒が編成のどこに居るか（居なければ既定の育成）
export function gearT(id) {
  for (var i = 0; i < SLOTS; i++) { if (st.slots[i].id === id) { return st.slots[i].gear; } }
  return 2;
}
// **置ける根拠は 2 つある。**
//  ① スキル文の「N 秒毎に」（cost-timeline の `ns.iv` / `ns.st`）。
//     引き金が先に書いてある子は `st` が付かない＝時刻が決まらないので置かない
//  ② `LevelSkill` の `AutoUseRule`（tl の `ns`）。`Interval` だけが置ける
// ①のほうが広く読めるので先に見る（イブキ（水着）は②では
// `RemoveLogicEffectTemplateId` だが、スキル文は「30秒毎に」）
export function nsInfo(id) {
  var sd = _byid[id], n = sd && sd.ns, i;
  var rows = (B.ns || {})[id] || [], want = gearT(id) >= 2 ? 2 : 0, au = null;
  // **形態ごとに行がある**（9 番目が `FormIndex`。2026-09-03、50c）。
  // **既定は形態 0。**ただしオトギは形態 0 の `CH0174Public01` が `TriggerRate: 0` で
  // 発動せず、ダメージは形態 1 の `CH0174Public02`（`AmmoCountUnder`）から来る。
  // **形態 0 の札が発動しないときだけ、発動する札を見る。**
  // トキのように両方の形態に発動する札がある子は、今までどおり形態 0
  function pick(mode) {
    var j, o = null;
    for (j = 0; j < rows.length; j++) {
      if ((rows[j][0] || 0) > want) { continue; }
      // 0 … 形態 0 で発動する札 ／ 1 … どの形態でも発動する札 ／ 2 … 何でも
      if (mode < 2 && rows[j][7] === 0) { continue; }
      if (mode === 0 && (rows[j][8] || 0) !== 0) { continue; }
      o = rows[j];
    }
    return o;
  }
  au = pick(0) || pick(1) || pick(2);
  var need = au ? au[9] : null;
  var duF = (au && au[3] && au[3] < 100000) ? au[3] : 60;
  if (n && n.iv > 0 && n.st != null) {
    return { iv: n.iv, st: n.st, du: duF, src: 'desc', nm: n.n, rule: au ? au[1] : null, need: need };
  }
  // **「戦闘中に 1 回のみ」は周期ではない**（2026-09-03）。`AutoUseRule` の
  // `MaxTriggerCount: 1` がその印で、`ConditionArgument` は待ちフレームでしかない。
  // 5 件ある（シュン・ヒナ（ドレス）・シュン（水着）・シロコ（水着）・ミチル（ドレス））。
  // **周期と読むと、シロコ（水着）と ミチル（ドレス）は 1 秒ごとに 240 回発動して
  // 60 秒バフが戦闘中ずっと切れなくなる**（1 人ぶんで −8.5% の過大）
  if (n && n.once && n.st != null) {
    return { iv: 0, st: n.st, du: duF, src: 'desc1', nm: n.n,
             rule: au ? au[1] : null, need: need };
  }
  if (au && au[1] === 'Interval' && au[4] === 1) {
    return { iv: 0, st: au[2] / B.fps, du: duF, src: 'auto1',
             nm: (n ? n.n : '') || (B.skname[id] || {})[nsKind(id)] || '',
             rule: 'Interval', need: need };
  }
  // **周期の出どころは 2 つ。**`ConditionArgument` が 1 のときは
  // `CoolTimeNotTrigger` がそれ（マコト（水着）の 900 フレーム＝30 秒）。
  // 今はスキル文の「30秒毎に」で助かっているだけで、文の書き方が変われば落ちる
  var per = (au && au[1] === 'Interval') ? (au[2] > 1 ? au[2] : (au[5] || 0)) : 0;
  if (per > 1) {
    return { iv: per / B.fps, st: per / B.fps, du: duF, src: 'auto',
             nm: n ? n.n : '', rule: 'Interval', need: need };
  }
  // **`OnAttackIng` は「通常攻撃 N 回毎に」**（2026-09-03）。N は `TryCount`（`au[6]`）で、
  // スキルの説明文に N が書いてある 22 件すべてで一致した（`ConditionArgument` は
  // "" / "0" / "1" しか入っておらず、回数と相関しない）。時刻は通常攻撃の並びから
  // 作るので、ここでは回数だけ返して `nsTimes0` に任せる。
  // **確率のもの（イズミ 20%・アカリ 10%）は置かない**
  if (au && au[1] === 'OnAttackIng' && au[6] > 1 && au[7] === 10000) {
    return { iv: 0, st: 0, du: duF, src: 'na', tc: au[6],
             nm: nsNameOf(id, n), rule: 'OnAttackIng', need: need };
  }
  // **`AmmoCountUnder` は「弾薬が N 以下になったら」**（2026-09-03）。
  // 閾値は `ConditionArgument`（`au[2]`）。フブキの説明文「弾薬が3以下になる毎に」が
  // 根拠で、`<` ではなく `≤`（弾薬は 15→12→9→6→3→0 としか動かないので、
  // `< 3` だと「0 のとき」になって説明文と食い違う）。1 弾倉に 1 回出る
  if (au && au[1] === 'AmmoCountUnder' && au[2] != null) {
    var a2 = naInfo(id), rw = a2 && a2.raw;
    if (a2 && a2.per > 0 && rw && rw.ammo > 0 && rw.cost > 0) {
      var tg = Math.ceil((rw.ammo - au[2]) / rw.cost);
      if (tg > 0) {
        return { iv: a2.mag * a2.per + a2.rel, st: a2.ent + tg * a2.per,
                 du: duF, src: 'ammo', trig: tg,
                 nm: nsNameOf(id, n), rule: 'AmmoCountUnder', need: need };
      }
    }
  }
  return null;
}
/** NS の名前。**`window.TL` 側が無い子は `skname` から引く**（無いと
    画面が「通常スキル」と出てしまう） */
function nsNameOf(id, n) {
  return (n ? n.n : '') || (B.skname[id] || {})[nsKind(id)] || '';
}
// 引き金の型。**AutoUseRule の名前をそのまま出したうえで、日本語を添える**
export var NSRULE = { OnAttackIng: '攻撃中', HpUnder: 'HP がしきい値を下回ったとき',
               KillTarget: '敵を倒したとき', AmmoCountUnder: '弾薬が減ったとき',
               UseSkill: '別のスキルを使ったとき', CriticalAttack: '会心が出たとき',
               HitLogicEffectTemplateId: '特定の効果が乗ったとき',
               HitLogicEffectGroupId: '特定の効果が乗ったとき',
               RemoveLogicEffectTemplateId: '特定の効果が切れたとき' };
export function nsWhy(id) {
  var sd = _byid[id], n = sd && sd.ns;
  var rows = (B.ns || {})[id] || [], r0 = rows[0];
  if (r0 && r0[1] && r0[1] !== 'Interval') {
    return '引き金が ' + r0[1] + (NSRULE[r0[1]] ? '（' + NSRULE[r0[1]] + '）' : '') +
           ' なので時刻が決まりません';
  }
  if (n && n.cond) { return '引き金つき（' + n.cond + '）なので時刻が決まりません'; }
  return '発動間隔が読めませんでした';
}
// **EX と NS は同時に出せない**（2026-09-01 の先生の指摘）。1 人が 2 つの
// スキルを同時には出せないので、その子が EX の演出中に来た NS は演出明けへ送る。
// **周期そのものはずらさない**（次の発動は元の時計から数える）
export function nsTimes(id, dur, idx) {
  sim();
  return memo('ns|' + id + '|' + dur + '|' + idx, function () { return nsTimes0(id, dur, idx); });
}
/** **「その形態のときだけ出る NS」の門**（2026-09-04、50b）。
    `AutoUseRule.TryToUseSkillModifiers` の `FormIndexCheckModifierDAO.FormIndex` が
    `n.need`。形態 0 以外を求めるものは、**変身している間だけ**通す。
    変身の長さは `B.fchg[id]`（`[切れ方, 段 1〜5 の値]`。切れ方 1 が時間 ms）。

    オトギの `CH0174Public02` は `AmmoCountUnder 0` ＋ FormIndex 1 で、
    **指定射撃姿勢の 35 秒の間に弾切れしたときだけ**出る。門が無いと戦闘中ずっと出る。

    **見ているのは `st.tl` に書いてある時刻**（engine が解いた時刻ではない）。
    `usesSorted()` を使うと `usesSorted → nsTimes → formOK → usesSorted` で輪になる
    （`na.js` の `naShotsRaw` と同じ理由）。コスト待ちで後ろへ動いたぶんはずれる */
function formOK(id, idx, n, t) {
  if (!n || !n.need) { return true; }
  var fv = (B.fchg || {})[id];
  if (!fv || fv[0] !== 1) { return true; }
  var ms = fv[1][Math.min(slotOf(idx).ex || 5, fv[1].length) - 1];
  if (ms == null) { return true; }
  var i;
  for (i = 0; i < st.tl.length; i++) {
    if (st.tl[i].i !== idx || st.tl[i].t == null) { continue; }
    if (t < st.tl[i].t) { continue; }
    if (ms < 0 || t < st.tl[i].t + ms / 1000) { return true; }
  }
  return false;
}
export function nsTimes0(id, dur, idx) {
  var n = nsInfo(id), out = [], t;
  if (!n) { return out; }
  var busy = idx == null ? [] : busyOf(idx);
  function push(x) {
    var q, y = x, guard = 0;
    while (guard++ < 20) {
      var hit = null;
      for (q = 0; q < busy.length; q++) {
        if (y >= busy[q][0] - 1e-9 && y < busy[q][1] - 1e-9) { hit = busy[q][1]; }
      }
      if (hit == null) { break; }
      y = hit;
    }
    if (y > dur) { return null; }
    y = +y.toFixed(4);
    out.push(y);
    return y;
  }
  // **通常攻撃の N 発目に乗る NS。**`naShots` が EX の演出を既に避けているので、
  // ここで `push()` の押し出しをかけ直さない（二重に遅れる）
  if (n.src === 'na') {
    if (idx == null) { return out; }
    var ts = naShotsRaw(idx, dur), q;
    for (q = n.tc - 1; q < ts.length; q += n.tc) {
      if (ts[q].t <= dur) { out.push(+ts[q].t.toFixed(4)); }
    }
    return out;
  }
  // **弾数で出る NS。**その弾倉の `trig` 発目を撃った直後（1 発ぶんの間合いのあと）
  if (n.src === 'ammo') {
    if (idx == null) { return out; }
    var sh = naShotsRaw(idx, dur), a3 = naInfo(id), q2;
    for (q2 = 0; q2 < sh.length; q2++) {
      // `k` は撃った通し番号（EX の演出明けに 0 へ戻る）。弾倉の中の位置は `k % mag`
      if (sh[q2].k % a3.mag === n.trig - 1) {
        var y3 = sh[q2].t + a3.per;
        if (y3 <= dur && formOK(id, idx, n, y3)) { out.push(+y3.toFixed(4)); }
      }
    }
    return out;
  }
  if (n.iv <= 0) { if (n.st <= dur) { push(n.st); } return out; }
  // **次の 25 秒は「実際に発動した時刻」から数える。**格子のままだと、
  // EX で押し出されたぶんが次で戻ってしまう（2026-09-01 の先生の指摘）。
  // 出どころは下の「数字の出どころ」に書いた実測動画 2 本
  var guard2 = 0;
  for (t = n.st; t <= dur && guard2++ < 400;) {
    var y2 = push(t);
    if (y2 == null) { break; }
    t = y2 + n.iv;
  }
  return out;
}
export function nsDur(id) {
  var n = nsInfo(id);
  return n ? n.du : 60;
}
/** 通常スキルのバフの持続（秒）。**いちばん長いものを採る。**無ければ 0 */
export function nsBuffDur(id) {
  var sd = _byid[id], bf = sd && sd.ns && sd.ns.bf, i, mx = 0;
  if (!bf) { return 0; }
  for (i = 0; i < bf.length; i++) {
    if (bf[i] && bf[i].du > 0 && bf[i].du < 1000000) { mx = Math.max(mx, bf[i].du / 1000); }
  }
  return mx;
}
