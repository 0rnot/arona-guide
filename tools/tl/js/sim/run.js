// ------------------------------------------------------------ 事象で 240 秒を回す核
/* **ここが「回す」層。**これまでの 4 つを繋ぐ。

     tree.js    木を歩いて「いつ・どの札が・どこへ」を出す
     effect.js  その札が何なのか（`LogicEffect_PC` / `_NPC` の行）
     cond.js    その瞬間に条件が立っているか
     state.js   盤の今（体・札・コスト）
     hit.js     一撃ぶんのダメージ（式は `dmg.js` の写し。24 万件で一致を確認済み）

   今の `tl-engine.js` は「曲線を足し上げる」作りで、**順番の依存を持てない**。
   ここは待ち行列で 1 つずつ処理するので、
   「札が 3 つ乗っているときだけ倍率が変わる」が素直に書ける。

   ## まだ入っていないもの（**憶測で埋めない**）

   - **盤の位置と移動。**当たる体の数は呼ぶ側が `mc` で渡す。第 2 段で入れる
   - **`Hits` の取り分**（ヒビキの愛用品の 10000/5500/1000/1000/1000）。
     いまは木が出す 1 事象 = 1 発として扱う
   - **手札とコストの引き当て。**EX を撃つ時刻は呼ぶ側（TL）が決める。
     コストが足りるかは `tl-engine.js` が既に見ているのでそちらに任せる
   - **ステータスの育ち**（星・装備・固有武器・絆・潜在）。呼ぶ側が `stats` で渡す
   - 敵の攻撃で味方が倒れること。ボスの札とフェーズは動かすが、味方は減らない

   ## 出すもの

     { hp: [[秒, 残り HP], …], total, killAt, used, unknown, log }

     `unknown` は**条件が判定できなかった回数**。ここが 0 でないうちは
     「再現できた」と言わない。
*/
import { skillEvents } from './tree.js';
import { readAll, atLevel, kindOfList, isDamage } from './effect.js';
import { all as condAll, mulOf, unknownOf } from './cond.js';
import { makeBoard, makeUnit, add, living, ctxOf, applyMark, expire, tickCost }
  from './state.js';
import { once as hitOnce, roll as hitRoll, capsOf } from './hit.js';

var FPS = 30;

/** **その瞬間のステータス。**素の値に、いま乗っている `stat` の札を畳む。

    畳み方は `js/stats.js:mkStats` と同じ:
      `_Coefficient` は係数へ足す（1 万分率）／`_Base` は固定値へ足す／
      `_BaseOuter` は係数を掛けたあとに足す（会心値だけ）。
      仕上げは `max(0, round((素 + 固定) × max(係数, 0.2)) + 別枠)`。

    敵の素の値は `CharacterStatExcelTable` の行そのままなので、
    `MaxHP100` のような 100 の欄と、`DefensePower1` / `DefensePower100` の
    両方があるときは 100 のほうを素として使う（敵はレベルで伸びない）。 */
export function statsNow(u) {
  var base = u.base || {}, acc = {}, i, k;
  function slot(name) {
    if (!acc[name]) { acc[name] = [pick(name), 0, 1, 0]; }
    return acc[name];
  }
  function pick(name) {
    if (base[name] != null) { return base[name]; }
    if (base[name + '100'] != null) { return base[name + '100']; }
    return 0;
  }
  for (i = 0; i < u.eff.length; i++) {
    var m = u.eff[i];
    if (m.kind !== 'stat' || !m.raw || !m.raw.stat) { continue; }
    var q = String(m.raw.stat).split('_'), amt = m.raw.amt || 0;
    var v = slot(q[0]);
    if (q[1] === 'Coefficient') { v[2] += amt / 10000; }
    else if (q[1] === 'BaseOuter') { v[3] += amt; }
    else { v[1] += amt; }
  }
  var out = {};
  for (k in base) { out[k] = base[k]; }
  for (k in acc) {
    var a = acc[k];
    out[k] = Math.max(0, Math.round((a[0] + a[1]) * Math.max(a[2], 0.2)) + a[3]);
  }
  // 既定が 10000 の欄（素の行に無いことがある）
  var DEF = ['DamageRatio', 'DamageRatio2', 'EnhanceExDamageRate', 'EnhanceBasicsDamageRate'];
  for (i = 0; i < DEF.length; i++) { if (out[DEF[i]] == null) { out[DEF[i]] = 10000; } }
  if (out.DefensePower == null && base.DefensePower100 != null) {
    out.DefensePower = base.DefensePower100;
  }
  return out;
}

/** `AutoUseRule` から通常スキルの周期（ms）。**`Interval` だけが周期で置ける。**
    `ConditionArgument` はフレーム（750 = 25 秒）。ほかの型は null（置かない） */
export function nsInterval(doc) {
  var r = doc && doc.AutoUseRule;
  if (!r || r.ConditionType !== 'Interval') { return null; }
  var f = r.ConditionArgument;
  if (f == null || !(+f > 0)) { return null; }
  return +f / FPS * 1000;
}

/** 通常攻撃の刻み。**`AnimationFrames` は `[{Key, Frame}]` の配列**で、
    `AttackIngDuration` / `AttackEnterDuration` / `AttackBurstRoundOverDelay` /
    `AttackReloadDuration` が入っている（アルは 42 / 45 / 50 / 70）。

    **周期は `AttackIngDuration` 1 本**（`js/na.js` と同じ扱い）。
    `AttackStartDuration` と `AttackEndDuration` が 1 発ごとか弾倉ごとかは
    データから決められないので入れない。入れると 1 発 1.4 秒が 2.4 秒になる。

    弾倉は `AmmoCount ÷ AmmoCost`、撃ち切ったら
    `AttackBurstRoundOverDelay + AttackReloadDuration` 待つ。
    `spd` は `NormalAttackSpeed`（1 万分率）で、**フレーム数のほうを割る。** */
export function naInfo(doc, spd, ammo, cost) {
  if (!doc || !doc.AnimationFrames) { return null; }
  var fr = {}, i, a = doc.AnimationFrames;
  for (i = 0; i < a.length; i++) { fr[a[i].Key] = a[i].Frame; }
  var ing = fr.AttackIngDuration;
  if (!(ing > 0)) { return null; }
  var sp = (spd || 10000) / 10000;
  return {
    per: ing / FPS * 1000 / sp,
    ent: (fr.AttackEnterDuration || 0) / FPS * 1000 / sp,
    rel: ((fr.AttackBurstRoundOverDelay || 0) + (fr.AttackReloadDuration || 0)) / FPS * 1000 / sp,
    mag: Math.max(1, Math.floor((ammo || 1) / (cost || 1))),
  };
}

/** 待ち行列。**二分ヒープ。**同じ時刻なら入れた順（`PriorityWhenSameFrame` は第 5 段）。

    最初は毎回なめる作りだった（O(n²)）。1 戦 276 ms で、**1 万回まわすと 46 分**。
    ヒープにして 1 戦あたりの取り出しが log n になる。
    処理の途中で新しい事象が入る（技が技を呼ぶ）ので、
    並べ替えて添字で進める作りにはできない。 */
function queue() {
  var a = [], seq = 0;
  function less(x, y) { return x.t < y.t || (x.t === y.t && x.i < y.i); }
  function up(k) {
    while (k > 0) {
      var p = (k - 1) >> 1;
      if (!less(a[k], a[p])) { break; }
      var t = a[k]; a[k] = a[p]; a[p] = t; k = p;
    }
  }
  function down(k) {
    for (;;) {
      var l = k * 2 + 1, r = l + 1, m = k;
      if (l < a.length && less(a[l], a[m])) { m = l; }
      if (r < a.length && less(a[r], a[m])) { m = r; }
      if (m === k) { return; }
      var t = a[k]; a[k] = a[m]; a[m] = t; k = m;
    }
  }
  return {
    push: function (t, fn, tag) { a.push({ t: t, fn: fn, tag: tag, i: seq++ }); up(a.length - 1); },
    drain: function (until, guard) {
      var n = 0;
      while (a.length && a[0].t <= until) {
        var e = a[0], last = a.pop();
        if (a.length) { a[0] = last; down(0); }
        e.fn(e.t);
        n++;
        if (guard && n > guard) { return n; }
      }
      return n;
    },
    size: function () { return seq; },
  };
}

/** 木の 1 事象を実際に当てる。**返すのは入ったダメージ。** */
function fire(R, ev, caster, target, lvl, at) {
  var list = R.eff[ev.gid];
  if (!list) { R.miss[ev.gid] = (R.miss[ev.gid] || 0) + 1; return 0; }
  var r = atLevel(list, lvl);
  if (!r) { return 0; }

  // ---- 条件。**`null`（判定できない）は数えて、当てない**
  if (ev.mods && ev.mods.length) {
    var ok = condAll(ev.mods, R.ctx, caster, target);
    if (ok == null) {
      R.unknown++;
      var u = unknownOf(ev.mods, R.ctx, caster, target);
      for (var q = 0; q < u.length; q++) {
        R.unknownBy[u[q]] = (R.unknownBy[u[q]] || 0) + 1;
      }
      return 0;
    }
    if (!ok) { return 0; }
  }
  var mul = ev.mods ? mulOf(ev.mods, R.ctx, caster, target) : 1;
  // **1 発の取り分**（`ShotFrames[].DamageDistributeRate`）。
  // CH0155 の通常攻撃は 7 発 × 14.28% で 1 周
  if (ev.share != null) { mul *= ev.share; }

  if (isDamage(r.kind)) {
    var a = R.attacker(caster, ev, at);
    var d = R.defender(target);
    var s = {
      scale: r.rate || 0, mult: mul, tick: 1,
      ig: r.pen != null && r.pen ? (10000 - r.pen) : null,
      isEx: ev.slot === 'Ex', isBasic: ev.slot === 'Normal',
      lvDiff: (caster.lv || 0) - (target.lv || 0),
      rate: r.rate2 != null ? r.rate2 : (list.applyRate != null ? list.applyRate : null),
      noCrit: r.crit === 1, noStab: r.stab === false,
    };
    // **継続ダメージは `Duration ÷ Period` 回**（戦闘の終わりで打ち切る）
    if (r.kind === 'dot' && r.period && r.dur) {
      s.tick = Math.max(0, Math.min(Math.floor(r.dur / r.period),
                                    Math.floor((R.durMs - at) / r.period)));
    }
    var o = hitOnce(a, d, s, R.C, R.lvTable, R.caps);
    var dmg = R.rnd ? hitRoll(o, R.rnd) : o.avg;
    dmg *= (ev.single ? 1 : (R.mc || 1));
    target.hp = Math.max(0, target.hp - dmg);
    R.total += dmg;
    return dmg;
  }

  // ---- ダメージ以外は札として盤に置く。**確率はここで振る**
  if (r.rate != null && r.kind !== 'stat' && R.rnd && r.rate < 10000 &&
      r.kind !== 'dmg' && R.rnd() * 10000 >= r.rate) { return 0; }
  applyMark(target, r, caster.key, at, lvl);
  return 0;
}

/** 1 枠ぶんを撃つ。木を歩いて、事象ごとに `fire` を呼ぶ */
function cast(R, u, gid, slot, lvl, at) {
  var doc = u.ls && u.ls[gid];
  if (!doc) { return; }
  var ev = R.evCache[gid] || (R.evCache[gid] = skillEvents(doc));
  for (var i = 0; i < ev.length; i++) {
    var e = ev[i];
    var t2 = at + e.f / FPS * 1000;
    if (t2 > R.durMs) { continue; }
    // **狙う先はその瞬間に決める。**仕掛けるときの盤で決めると、
    // 途中で湧いた体・倒れた体を取り違える
    (function (e2, t3) {
      R.q.push(t3, function (now) {
        e2.slot = slot;
        var to = R.pick(u, e2), k;
        for (k = 0; k < to.length; k++) { fire(R, e2, u, to[k], lvl, now); }
      }, slot + ':' + e2.gid);
    })(e, t2);
  }
  R.used.push({ t: at, who: u.key, slot: slot, gid: gid });
}

/** **本体。**

    o = {
      common, boss,                 束（`db/common.json.gz` と `db/boss/<面>.json.gz`）
      party: [{ pack, stats, lv, skillLv, gearT }],
      tl: [{ at, i, slot }],        EX を撃つ時刻（秒）と誰か
      dur, mc, seed, sample
    }
*/
export function run(o) {
  var common = o.common || {}, boss = o.boss || {};
  var b = makeBoard({ common: common, content: o.content || 'Raid' });
  var durMs = (o.dur != null ? o.dur : 240) * 1000;

  // ---- 敵。**ボスと、木から呼ばれるミニオンまで束に入っている**
  var ent = boss.ent || [], stx = {}, i;
  for (i = 0; i < (boss.st || []).length; i++) { stx[boss.st[i].CharacterId] = boss.st[i]; }
  var bossU = null;
  for (i = 0; i < ent.length; i++) {
    var c = ent[i], s = stx[c.Id];
    if (!s) { continue; }
    var lv = c.TacticEntityType === 'Boss'
      ? (boss.ground.LevelBoss || 90) : (boss.ground.LevelMinion || 90);
    var u = add(b, makeUnit({
      key: 'e' + c.Id, side: 'enemy', charId: c.Id, dev: c.DevName,
      kind: c.TacticEntityType, lv: lv, armor: c.ArmorType, bullet: c.BulletType,
      radius: c.BodyRadius, personality: c.PersonalityId, aiId: c.CharacterAIId,
      role: c.TacticRole, school: c.School, squad: c.SquadType,
      hp: s.MaxHP100, maxHp: s.MaxHP100,
      base: s,
    }));
    // **盤に最初から居るのはボスだけ。**ミニオンは湧いてから
    if (c.TacticEntityType === 'Boss' && !bossU) { bossU = u; } else { u.alive = false; }
  }
  if (!bossU) { throw new Error('ボスの実体が束に無い'); }

  // ---- 味方
  var party = o.party || [], allies = [];
  for (i = 0; i < party.length; i++) {
    var p = party[i], pc = p.pack, ch = pc.ch || {};
    var au = add(b, makeUnit({
      key: 'a' + i, side: 'ally', charId: pc.id, dev: pc.dev,
      kind: 'Student', lv: p.lv || 90, armor: ch.ArmorType, bullet: ch.BulletType,
      radius: ch.BodyRadius, personality: ch.PersonalityId, aiId: ch.CharacterAIId,
      role: ch.TacticRole, school: ch.School, squad: ch.SquadType,
      hp: (p.stats && p.stats.MaxHP) || 1, maxHp: (p.stats && p.stats.MaxHP) || 1,
      base: p.stats || {}, skillLv: p.skillLv || {},
    }));
    au.ls = pc.ls;
    au.pack = pc;
    au.slot = i;
    allies.push(au);
  }

  // ---- 効果の索引。味方とボスをまとめて 1 つに
  var le = [];
  for (i = 0; i < party.length; i++) { le = le.concat(party[i].pack.le || []); }
  le = le.concat(boss.le || []);
  var eff = readAll(le);

  var R = {
    b: b, ctx: ctxOf(b), eff: eff, q: queue(), evCache: {},
    total: 0, used: [], unknown: 0, unknownBy: {}, miss: {},
    durMs: durMs, mc: o.mc || 1, C: common.const || {},
    lvTable: common.lvdiff || null, caps: capsOf(common.calcLimit),
    rnd: o.seed != null ? mulberry(o.seed) : null,
    // **撃つ側の値。**素の値に、**その瞬間に乗っている札**を畳んでから返す。
    // 焼き出しにはこれができなかった（状態を持っていないので）
    attacker: function (u, ev, at) {
      var s = statsNow(u);
      return {
        atk: s.AttackPower || 0, pen: s.DefensePenetration || 0,
        dr: s.DamageRatio, dr2: s.DamageRatio2,
        exRate: s.EnhanceExDamageRate, baRate: s.EnhanceBasicsDamageRate,
        stab: s.StabilityPoint, stabR: s.StabilityRate,
        acc: s.AccuracyPoint, crit: s.CriticalPoint, critDmg: s.CriticalDamageRate,
        terr: (o.terr != null ? o.terr : 1), eff: (o.effmod != null ? o.effmod : 1),
      };
    },
    defender: function (u) {
      var s = statsNow(u);
      return {
        def: s.DefensePower || 0,
        dodge: s.DodgePoint || 0, critResist: s.CriticalResistPoint || 0,
        critDmgResist: s.CriticalDamageResistRate || 0,
        // **被ダメージ率は札で動く。**`DamagedRatio` は 10000 が素
        damaged: s.DamagedRatio != null ? s.DamagedRatio : 10000,
        damaged2: s.DamagedRatio2 != null ? s.DamagedRatio2 : 10000,
      };
    },
    /** **狙う先。**木の `EssentialCandidateRule.TargetSide` で振り分ける。

        ここを間違えると**自分へのバフがボスに乗る。**（2026-09-06 に踏んだ。
        味方の技も全部ボスへ流していて、攻撃力バフがボスに入っていた）

          Self          撃った本人だけ
          Enemy         相手の側
          Player / Ally / Friendly  味方の側

        人数は `MaxTargetCount`（-1 は無制限）。**位置で絞るのは第 2 段**なので、
        いまは前から順に取る。 */
    pick: function (u, ev) {
      var side = (ev.sel && ev.sel.side) || (u.side === 'ally' ? 'Enemy' : 'Player');
      if (side === 'Self') { return [u]; }
      var mine = u.side === 'ally';
      var team;
      if (side === 'Enemy') { team = mine ? living(b, 'enemy') : allies.slice(); }
      else { team = mine ? allies.slice() : living(b, 'enemy'); }
      var max = ev.sel ? ev.sel.max : null;
      if (max != null && max > 0 && team.length > max) { team = team.slice(0, max); }
      return team;
    },
  };

  // ---- 積む: 常時のパッシブ → 通常攻撃 → 通常スキル → EX
  for (i = 0; i < allies.length; i++) {
    (function (au, p) {
      var csl = (au.pack.csl || [])[0] || {};
      var gid = function (k) {
        var v = csl[k];
        v = Array.isArray(v) ? v[0] : v;
        return (v && v !== 'EmptySkill') ? String(v) : null;
      };
      var lvOf = function (slot) { return (p.skillLv && p.skillLv[slot]) || 1; };

      // 常時のパッシブ（0 秒）
      var ps = gid('PassiveSkillGroupId'), es = gid('ExtraPassiveSkillGroupId');
      if (ps) { R.q.push(0, function (t) { cast(R, au, ps, 'Passive', lvOf('Passive'), t); }); }
      if (es) { R.q.push(0, function (t) { cast(R, au, es, 'ExtraPassive', lvOf('ExtraPassive'), t); }); }

      // 通常攻撃。**構え → 弾倉ぶん撃つ → リロード**を繰り返す
      var ng = gid('NormalSkillGroupId');
      var na = ng && au.ls[ng]
        ? naInfo(au.ls[ng], (p.stats || {}).NormalAttackSpeed,
                 (p.stats || {}).AmmoCount, (p.stats || {}).AmmoCost) : null;
      if (na) {
        var t = na.ent, shot = 0;
        while (t <= durMs) {
          (function (tt) {
            R.q.push(tt, function (now) { cast(R, au, ng, 'Normal', 1, now); });
          })(t);
          shot++;
          t += na.per;
          if (shot % na.mag === 0) { t += na.rel; }
        }
        au._na = na;
      }
      // 通常スキル。**`AutoUseRule` が `Interval` のときだけ置ける**
      var pg = gid('PublicSkillGroupId');
      var iv = pg ? nsInterval(au.ls[pg]) : null;
      if (pg && iv) {
        for (var t2 = iv; t2 <= durMs; t2 += iv) {
          (function (tt) {
            R.q.push(tt, function (now) { cast(R, au, pg, 'Public', lvOf('Public'), now); });
          })(t2);
        }
      }
      au._ex = gid('ExSkillGroupId');
    })(allies[i], party[i]);
  }
  // EX は TL の指すとおりに
  for (i = 0; i < (o.tl || []).length; i++) {
    (function (row) {
      var au = allies[row.i];
      if (!au || !au._ex) { return; }
      R.q.push(row.at * 1000, function (now) {
        cast(R, au, au._ex, 'Ex', (party[row.i].skillLv || {}).Ex || 1, now);
      });
    })(o.tl[i]);
  }

  // ---- 回す。**0.1 秒刻みで札の時間切れとコストを進める**
  var step = o.step || 100, hp = [], t3;
  for (t3 = 0; t3 <= durMs; t3 += step) {
    b.t = t3;
    R.q.drain(t3, 200000);
    var us = living(b), k;
    for (k = 0; k < us.length; k++) { expire(us[k], t3); }
    tickCost(b, step);
    hp.push([t3 / 1000, bossU.hp]);
    if (bossU.hp <= 0) { break; }
  }
  return {
    hp: hp, total: R.total, killAt: bossU.hp <= 0 ? t3 / 1000 : null,
    maxHp: bossU.maxHp, used: R.used,
    unknown: R.unknown, unknownBy: R.unknownBy, miss: R.miss,
    events: R.q.size(),
  };
}

/** 差し替えられる乱数（同じ種なら同じ結果。1 万回まわすときに要る） */
export function mulberry(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
