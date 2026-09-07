// ------------------------------------------------------------ 盤の上の状態
/* **回している最中の「今」を持つ層。**`tree.js` が「いつ何が起きるか」を、
   `effect.js` が「その効果は何か」を出す。ここはその効果を**実際に当てて**、
   次に条件を判定するときの材料になる。`cond.js` が求める `ctx` はここが作る。

   焼き出し（`build-tool-data.py`）にはこの層が無かった。状態を持たないので
   「札を 3 つ持っていたら」のような条件は、候補として先生に選ばせるか捨てるかしか
   なかった。監査 113 件のうち 63 件がそれで、**足りないのは欄ではなくこの層。**

   ## 数字は全部 DB から来る

   定数は `db/common.json.gz` の `const`（`Excel/ConstCombatExcelTable`）。
   **ここに直書きしない。**2026-09-06 に実物から読んだ値:

     SkillHandCount            3      手札
     EchelonMaxCommonCost      10     コストの上限
     EchelonInitCommonCost     0      始まりのコスト
     PlayerRegenCostDelay      2000   ms。**戦闘開始からこれだけ経って回復が始まる**
     PlayerAutoUseStartDelay   333    ms。通常スキルの自動発動が始まるまで
     DyingTime                 2500   ms。倒れてから消えるまで
     CrowdControlFactor        100
     NormalTimeScale           13000  基準 10000 に対して
     FastTimeScale             17000
     DefenceConstA/C           10000 / 6000
     AccuracyConstA/C          10000 / 3000
     CriticalConstA/C          4000 / 6000

   総力戦のコスト回復は `ContentsFever` の `Raid` 行が `SkillCostFever 20000`
   ＝ **2 倍**（`FeverStartTime 0` / `FeverDurationTime 0` で常時）。

   ## 札の重なり方

   `LogicEffect_PC` の行が持っている:

     Channel                 同じ番号は重ならない。**後から来たほうが古いのを消す**
     StackSameEffectApplied   同じ効果を積めるか
     StackSameEffectCount     積める数
     ExpireOldIfStackCountOver 溢れたとき古いのを落とすか（偽なら新しいほうを捨てる）
     Category                 Buff / Debuff / CrowdControl …。解除の対象を選ぶのに使う
     Dispellable              解除できるか
     ApplyRate                効く確率（1 万分率）。**10000 でない行が味方側に 84 行ある**
*/

/** 1 体。**盤の上にいるもの全部**（生徒・ボス・ミニオン・置いた物）が同じ形 */
export function makeUnit(o) {
  return {
    key: o.key,                       // 盤の中で一意
    side: o.side,                     // 'ally' / 'enemy'
    charId: o.charId,
    dev: o.dev || null,
    kind: o.kind || 'Student',        // TacticEntityType
    lv: o.lv || 1,
    armor: o.armor || null,
    bullet: o.bullet || null,
    adapt: o.adapt || 'D',            // この面での地形適性（SS〜D）
    tags: o.tags || {},               // { 札: true }
    role: o.role || null,             // TacticRole
    school: o.school || null,
    squad: o.squad || null,           // SquadType
    personality: o.personality || null,
    aiId: o.aiId != null ? o.aiId : null,
    pos: o.pos ? { x: o.pos.x, y: o.pos.y } : { x: 0, y: 0 },
    radius: o.radius || 0,            // BodyRadius
    base: o.base || {},               // 素の値（stats.js が出したもの）
    hp: o.hp || 0,
    maxHp: o.maxHp || 0,
    shield: 0,
    ammo: o.ammo || 0,
    atg: 0,                           // ActiveGauge
    groggy: 0,
    form: 0,                          // 形態の番号
    skillLv: o.skillLv || {},         // { Ex: 5, Public: 10, … }
    alive: true,
    dyingUntil: null,
    eff: [],                          // 効いている札
    _seq: 0,
  };
}

/** 効いている札 1 枚。`effect.js` の `readOne` が返した形に、いつまで効くかを足したもの */
function makeMark(r, src, now, lvl) {
  return {
    gid: r.gid, tmpl: r.tmpl, cat: r.cat, ch: r.ch,
    slot: r.slot,                     // 撃った枠（Ex / Public / Passive …）。Channel の押し出しは同じ枠どうしだけ
    kind: r.kind, stat: r.stat, val: r.val, mode: r.mode,
    dispellable: r.disp !== false,
    src: src,                         // 撃った側の key
    lvl: lvl || 1,
    at: now,
    until: (r.dur == null) ? null : now + r.dur,   // null は時間で消えない
    raw: r,
  };
}

/** **同じ `Channel` は重ならない。**後から来たほうが古いのを消す。
    `StackSameEffectApplied` が真なら同じ効果を `StackSameEffectCount` まで積める。
    溢れたときは `ExpireOldIfStackCountOver` が真なら古いのを落とし、偽なら新しいのを捨てる。

    返り値は実際に入ったか。**確率（`ApplyRate`）はここでは振らない**
    ——振るのは呼ぶ側（1 万回まわすときに毎回ちがう目を出したいので）。 */
export function applyMark(u, r, src, now, lvl) {
  var i, same = [], ch = r.ch;
  for (i = 0; i < u.eff.length; i++) {
    if (u.eff[i].gid === r.gid) { same.push(u.eff[i]); }
  }
  if (!r.stack) {
    // 積めない札。**同じものがあれば時間だけ延ばす**
    if (same.length) {
      same[0].at = now;
      same[0].until = (r.dur == null) ? null : now + r.dur;
      same[0].lvl = lvl || same[0].lvl;
      return true;
    }
  } else {
    var cap = r.stack || 1;
    if (same.length >= cap) {
      if (r.expireOld === false) { return false; }
      // いちばん古いのを落とす
      var old = same[0], oi = u.eff.indexOf(old);
      for (i = 1; i < same.length; i++) {
        if (same[i].at < old.at) { old = same[i]; oi = u.eff.indexOf(old); }
      }
      u.eff.splice(oi, 1);
    }
  }
  // **同じ Channel の別の札は押し出す**（0 は「溝なし」で押し出さない）。
  // **ただし同じ枠の種類（Ex / Public / Passive …）どうしだけ**（2026-09-07）。
  // 旧い道（`target.js:liveBuffs0`、動画で確かめ済み）は「同じ（枠, Channel）は
  // 遅く始まったほうを残す」で、枠が違えば同じ Channel でも並ぶ。ここが Channel だけ
  // だったので、セイアの EX（防御 −47.81%、Channel 603）がリオの NS（−25.51%、同じ 603）を
  // 押し出していた。IrVUx0ywuyo の 54.3 秒でボスの防御が 1814 のところ 3549 になり、
  // ネルの 1 発が 0.667 倍
  if (ch) {
    for (i = u.eff.length - 1; i >= 0; i--) {
      if (u.eff[i].ch === ch && u.eff[i].gid !== r.gid &&
          String(u.eff[i].slot || '') === String(r.slot || '')) { u.eff.splice(i, 1); }
    }
  }
  u.eff.push(makeMark(r, src, now, lvl));
  return true;
}

/** 時間切れの札を落とす。**`until` が `null` の札は落ちない**（戦闘の終わりまで） */
export function expire(u, now) {
  var i, n = 0;
  for (i = u.eff.length - 1; i >= 0; i--) {
    if (u.eff[i].until != null && u.eff[i].until <= now) { u.eff.splice(i, 1); n++; }
  }
  return n;
}

/** 解除。`cat` を渡すとその種類だけ、`gids` を渡すその GroupId だけ。
    **`Dispellable` が偽の札は消えない。** */
export function dispel(u, opt) {
  var i, m, n = 0, o = opt || {};
  for (i = u.eff.length - 1; i >= 0; i--) {
    m = u.eff[i];
    if (!m.dispellable) { continue; }
    if (o.cat != null && m.cat !== o.cat) { continue; }
    if (o.gids && o.gids.indexOf(m.gid) < 0) { continue; }
    if (o.tmpls && o.tmpls.indexOf(m.tmpl) < 0) { continue; }
    u.eff.splice(i, 1); n++;
    if (o.max && n >= o.max) { break; }
  }
  return n;
}

/** 盤ぜんぶ。回す側（`run.js`）が持つ入れ物 */
export function makeBoard(o) {
  var C = (o.common && o.common.const) || {};
  // **フィーバーは窓のある内容だけ。**`ContentsFeverExcelTable` の総力戦の行は
  // `SkillCostFever 20000` だが `FeverStartTime 0` / `FeverDurationTime 0` で、
  // **窓が無い＝掛からない**（窓があるのはアリーナだけ。開始 120,000ms から 60,000ms）。
  // 2 倍にしていたのは読み違い（2026-09-06 に直した）。`tl-engine.js` は
  // 素の 0.42/秒 で動画と 1 コマまで合っている（コスト 4 ÷ 0.42 = 9.5238 秒）。
  var fever = 10000, fdur = 0, fstart = 0;
  var rows = (o.common && o.common.fever) || [];
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].ConditionContent === (o.content || 'Raid')) {
      fdur = rows[i].FeverDurationTime || 0;
      fstart = rows[i].FeverStartTime || 0;
      if (fdur > 0) { fever = rows[i].SkillCostFever || 10000; }
    }
  }
  return {
    t: 0,                                   // ms
    units: {},                              // key -> unit
    order: [],                              // 並び（湧いた順）
    // **コストは編成ごとに 1 本。**上限も始まりも定数から
    cost: (C.EchelonInitCommonCost || 0) * 1,
    costMax: C.EchelonMaxCommonCost != null ? C.EchelonMaxCommonCost : 10,
    costDelay: C.PlayerRegenCostDelay != null ? C.PlayerRegenCostDelay : 2000,
    autoDelay: C.PlayerAutoUseStartDelay != null ? C.PlayerAutoUseStartDelay : 333,
    handCount: C.SkillHandCount != null ? C.SkillHandCount : 3,
    dyingTime: C.DyingTime != null ? C.DyingTime : 2500,
    // **これはコマ→秒の換算ではない。**`tl-engine.js` は `FPS = 30` の素で
    // 先生の TL のスコアを 3 フレーム差まで再現できているので、
    // 木のコマ数はそのまま実時間に直る。`NormalTimeScale` が何に掛かるかは未確定なので、
    // 値だけ持っておいて**使わない**（画面の再生速度らしい）
    timeScale: (C.NormalTimeScale || 13000) / 10000,
    feverRate: fever / 10000,               // 窓が無ければ 1
    feverFrom: fstart, feverFor: fdur,
    const: C,
    common: o.common || null,
    log: [],
  };
}

export function add(b, u) {
  b.units[u.key] = u;
  b.order.push(u.key);
  return u;
}

export function unit(b, key) { return b.units[key] || null; }

export function living(b, side) {
  var out = [], i, u;
  for (i = 0; i < b.order.length; i++) {
    u = b.units[b.order[i]];
    if (u && u.alive && (!side || u.side === side)) { out.push(u); }
  }
  return out;
}

/** **`cond.js` が求める `ctx`。**盤 1 つにつき 1 個作って使い回す */
export function ctxOf(b) {
  function cnt(u, field) {
    var m = {}, i, k;
    if (!u) { return m; }
    for (i = 0; i < u.eff.length; i++) {
      k = u.eff[i][field];
      if (k != null && k !== '') { m[k] = (m[k] || 0) + 1; }
    }
    return m;
  }
  return {
    marks: function (u) { return cnt(u, 'tmpl'); },
    // **`CheckTarget: 2` は「撃つ側の味方みんな」。**1 人の札を数えるのではなく、
    // その札を持っている**体の数**を数える（ペロロジラの Ex09 は、気絶している
    // 中サイズのペロロミニオンが何体居るかでグロッキーゲージの段が決まる。
    // 2026-09-06。ここが無いあいだ段はいつも 0 で、ゲージが 1 も溜まらなかった）
    sideCount: function (u, tmpl) {
      var n = 0, i, j, k;
      if (!u) { return 0; }
      for (i = 0; i < b.order.length; i++) {
        var v = b.units[b.order[i]];
        if (!v || !v.alive || v.side !== u.side) { continue; }
        for (j = 0; j < v.eff.length; j++) {
          if (v.eff[j].tmpl === tmpl) { n++; break; }
        }
        k = 0;
      }
      return n;
    },
    gids: function (u) { return cnt(u, 'gid'); },
    cats: function (u) { return cnt(u, 'cat'); },
    hpRate: function (u) {
      return (u && u.maxHp) ? Math.round(u.hp / u.maxHp * 10000) : 0;
    },
    form: function (u) { return u ? u.form : 0; },
    role: function (u) { return u ? u.role : null; },
    // 役職の札を持つ体の数ではなく、**その役職の体の数**（`CountListTacticRoleModifierDAO` の
    // `CheckTarget: 2 / 5`。2026-09-07）
    sideRoleCount: function (u, roles) {
      var n = 0, i, v;
      if (!u) { return 0; }
      for (i = 0; i < b.order.length; i++) {
        v = b.units[b.order[i]];
        if (v && v.alive && v.side === u.side && roles.indexOf(v.role) >= 0) { n++; }
      }
      return n;
    },
    skillLv: function (u, slot) { return (u && u.skillLv[slot]) || 1; },
    armor: function (u) { return u ? u.armor : null; },
    bullet: function (u) { return u ? u.bullet : null; },
    tags: function (u) { return (u && u.tags) || {}; },
    status: function (u) {
      // 状態異常は札として持っている（`StatusAddEffectDAO` が入れる）
      var m = {}, i, e;
      if (!u) { return m; }
      for (i = 0; i < u.eff.length; i++) {
        e = u.eff[i];
        if (e.kind === 'status' && e.raw && e.raw.status) { m[e.raw.status] = true; }
      }
      return m;
    },
    side: function (u) { return u ? (u.side === 'ally' ? 'Player' : 'Enemy') : null; },
    charId: function (u) { return u ? u.charId : null; },
    // `CountEntityListCombinedModifierDAO`。**その条件が数えたい側の生きている数**
    bodies: function (m) {
      var side = null;
      if (m && m.TargetSide === 'Player') { side = 'ally'; }
      if (m && m.TargetSide === 'Enemy') { side = 'enemy'; }
      return living(b, side).length;
    },
  };
}

/** コストを進める。**開始から `PlayerRegenCostDelay` 経つまでは増えない。**
    1 秒あたりの回復は各生徒の `RegenCost`（1 万分率）の合計 × 内容ごとの倍率。
    総力戦は `ContentsFever` の `Raid` 行で 2 倍。 */
export function tickCost(b, dtMs) {
  if (b.t < b.costDelay) { return b.cost; }
  var per = 0, i, us = living(b, 'ally');
  for (i = 0; i < us.length; i++) {
    per += (us[i].base.RegenCost || 0) / 10000;
  }
  b.cost = Math.min(b.costMax, b.cost + per * b.feverRate * (dtMs / 1000));
  return b.cost;
}

/** コマ数を ms に。**30 fps の素で割るだけ。**

    `NormalTimeScale 13000` を掛けたくなるが、**掛けない。**
    今の `tl-engine.js` は `FPS = 30` の素で動画と 3 フレーム差まで合っている
    （2026-09-05、先生の TL のスコア 40,047,841 に対して平均 40,048,080）。
    ここで 1.3 を入れると全部 30% ずれる。`b.timeScale` は値として持っているだけ。 */
export function frameMs(b, frames, fps) {
  return frames / (fps || 30) * 1000;
}
