import { B } from './util.js';
import { SLOTS, _byid, memo, st } from './core.js';
import { sim } from './engine.js';
import { busyOf } from './na.js';

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
  return 3;
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
  for (i = 0; i < rows.length; i++) { if ((rows[i][0] || 0) <= want) { au = rows[i]; } }
  var duF = (au && au[3] && au[3] < 100000) ? au[3] : 60;
  if (n && n.iv > 0 && n.st != null) {
    return { iv: n.iv, st: n.st, du: duF, src: 'desc', nm: n.n, rule: au ? au[1] : null };
  }
  if (au && au[1] === 'Interval' && au[2] > 1) {
    return { iv: au[2] / B.fps, st: au[2] / B.fps, du: duF, src: 'auto',
             nm: n ? n.n : '', rule: 'Interval' };
  }
  return null;
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
