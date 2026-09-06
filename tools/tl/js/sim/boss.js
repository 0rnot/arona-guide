// ------------------------------------------------------------ ボスを動かす
//
// **`BossExternalBTExcelTable` をそのまま回す。**焼き出しのように「EX が出る秒」へ
// 畳まない。畳むと、味方が速くて周回が早まったときに追随しない。
//
// 木は 1 行が「引き金 → ふるまい」の組で、`AIPhase` ごとに束ねてある。
//
//   ExternalBTTrigger        TriggerArgument     いつ
//     UseNormalSkill           N                 通常攻撃 N 発目のあと
//     CheckPeriod              ミリ秒            その間隔ごと（1 は「いつでも」＝落ち穂拾い）
//     CheckActiveGaugeOver     N                 ゲージが N を越えたら
//     CheckActiveGaugeBetween  a,b               ゲージが a〜b のあいだ
//     HPUnder                  1/100000 単位     HP がその割合を切ったら
//     ApplyGroggy              —                 グロッキーに入ったら
//     OnSpawned                —                 湧いた直後
//     CheckSummonCharacterCountUnder N           呼んだ子が N 体未満なら
//
//   ExternalBehavior         BehaviorArgument    何をする
//     UseSelectExSkill         k                 `ExSkillGroupId[k]` を撃つ（10 枠）
//     AddActiveGauge           ±d                ゲージを足す
//     ChangePhase              p                 段を移る（ForceChangePhase も同じ）
//     ClearNormalSkill         —                 通常攻撃の数えを 0 に戻す
//
// **通常攻撃 1 発は「構え → 撃つ → 戻す」で 1 周**（`AttackStartDuration` ＋
// `AttackIngDuration` ＋ `AttackEndDuration`）。**EX を撃っている間は数えが止まる**ので、
// N 発目の時刻は「N × 1 発 ＋ それまでの EX のモーションの合計」になる。
// この 2 つは `build-tool-data.py` が動画 3 本で確かめた決めをそのまま持ってきている。

var FPS = 30;

/** スキル 1 発ぶんのコマ数。引けなければ null。 */
export function frames(doc) {
  if (!doc) { return null; }
  var fr = {}, af = doc.AnimationFrames || [], i;
  for (i = 0; i < af.length; i++) { fr[af[i].Key] = af[i].Frame; }
  var v = fr.AttackIngDuration;
  if (v) {
    v = v + (fr.AttackStartDuration || 0) + (fr.AttackEndDuration || 0);
  }
  if (!v) {
    var d = doc.Duration;
    if (typeof d === 'number' && d > 0 && d < 100000) { v = d; }
  }
  return v || null;
}

function num(v) {
  var n = parseInt(String(v == null ? '' : v).trim(), 10);
  return isNaN(n) ? null : n;
}

/** `TriggerArgument` が "a,b" のときの 2 つ組。 */
function pair(v) {
  var a = String(v == null ? '' : v).split(',');
  return [num(a[0]), num(a[1])];
}

/** 台本を段ごとにまとめる。**回す前に 1 回だけ。** */
export function bossPlan(boss, cid) {
  var bt = boss.bt || [], ph = boss.phase || [], ls = boss.ls || {};
  var csl = (boss.csl || {})[cid] || (boss.csl || {})[String(cid)] || [];
  var row0 = csl[0] || {};
  var ex = row0.ExSkillGroupId || [];
  var stx = null, i;
  for (i = 0; i < (boss.st || []).length; i++) {
    if (boss.st[i].CharacterId === cid) { stx = boss.st[i]; }
  }
  var spd = ((stx && stx.NormalAttackSpeed) || 10000) / 10000;

  // EX 1 枠ぶんのモーション（ミリ秒）
  var exMs = [];
  for (i = 0; i < ex.length; i++) {
    var f = (ex[i] && ex[i] !== 'EmptySkill') ? frames(ls[ex[i]]) : null;
    exMs.push(f ? (f / FPS) * 1000 : 0);
  }

  // 段ごとの通常攻撃
  var naOf = {};
  for (i = 0; i < ph.length; i++) {
    if (ph[i].Id !== cid) { continue; }
    naOf[ph[i].AIPhase] = ph[i].NormalAttackSkillUniqueName || null;
  }
  // 段の表が無いボスは `CharacterSkillList` の通常枠で代える
  var fallbackNa = (row0.NormalSkillGroupId || [])[0] || null;

  var phases = {};
  for (i = 0; i < bt.length; i++) {
    var r = bt[i];
    var p = r.AIPhase == null ? 0 : r.AIPhase;
    if (!phases[p]) { phases[p] = { rows: [], na: null, naMs: 0, wrap: 0 }; }
    phases[p].rows.push(r);
  }
  var keys = Object.keys(phases), k;
  for (k = 0; k < keys.length; k++) {
    var ps = phases[keys[k]], rows = ps.rows, j;
    // **段の表の名前が束に無いことがある。**総力戦ビナーの `BossPhase` は
    // `BinahNormalAttackSkill01` を指すが、`LevelSkill/` にその名前のファイルは無く、
    // Torment で実際に使うのは `BinahInsaneNormalSkill01`（`CharacterSkillList` 側）。
    // 引けない名前を持つと通常攻撃が 1 発も出ず、`UseNormalSkill` の行が
    // 丸ごと死ぬ（2026-09-06。raid7 で「通常 0 発 ／ EX 63 回」になっていた）
    var cand = [naOf[keys[k]], naOf[0], fallbackNa], ci;
    ps.na = null;
    for (ci = 0; ci < cand.length; ci++) {
      if (cand[ci] && ls[cand[ci]]) { ps.na = cand[ci]; break; }
    }
    if (!ps.na) { ps.na = naOf[keys[k]] || naOf[0] || fallbackNa; }
    var nf = ps.na ? frames(ls[ps.na]) : null;
    ps.naMs = nf ? (nf / FPS) * 1000 / spd : 0;
    // **1 周の長さ。**`UseNormalSkill C → ClearNormalSkill` があればその C、
    // 無くて `CheckPeriod → ClearNormalSkill`（落ち穂拾いの枝）があるなら
    // 台本そのものの長さ（`UseNormalSkill` の引数の最大）で回る
    var clr = [], mx = 0, anyPeriodClear = false;
    for (j = 0; j < rows.length; j++) {
      var q = rows[j];
      if (q.ExternalBTTrigger === 'UseNormalSkill') {
        var n = num(q.TriggerArgument);
        if (n != null && n > mx) { mx = n; }
        if (q.ExternalBehavior === 'ClearNormalSkill' && n != null) { clr.push(n); }
      } else if (q.ExternalBTTrigger === 'CheckPeriod'
                 && q.ExternalBehavior === 'ClearNormalSkill') {
        anyPeriodClear = true;
      }
    }
    clr.sort(function (a, b) { return a - b; });
    ps.wrap = clr.length ? clr[0] : (anyPeriodClear && mx ? mx : 0);
    ps.max = mx;
  }
  return { cid: cid, ex: ex, exMs: exMs, phases: phases, spd: spd };
}

/** 盤の台本から「段 p に入ったときの待ち」を拾う（ミリ秒）。

    ペロロジラは `GroundConditionCharacterPhaseChanged Phase 1` の組に
    `GroundCommandSetStatusImmune ImmuneGroggyGaugeAdd` →
    `GroundCommandWaitSeconds 8000` → `GroundCommandStartSection` が並ぶ。
    **動画から読んで「8 秒」と決めていたものが、そのまま台本に載っていた。** */
export function phaseWaits(board) {
  var out = {}, names = Object.keys(board || {}), i, j, k, m;
  for (i = 0; i < names.length; i++) {
    var doc = board[names[i]] || {}, secs = doc.Sections || [];
    for (j = 0; j < secs.length; j++) {
      var evs = secs[j].Events || [];
      for (k = 0; k < evs.length; k++) {
        var ph = null, cs = evs[k].Conditions || [];
        for (m = 0; m < cs.length; m++) {
          var t = String(cs[m].$type || '');
          if (t.indexOf('CharacterPhaseChanged') >= 0 && cs[m].Phase != null) {
            ph = cs[m].Phase;
          }
        }
        if (ph == null) { continue; }
        var cmds = evs[k].Commands || [], wait = 0;
        for (m = 0; m < cmds.length; m++) {
          if (String(cmds[m].$type || '').indexOf('WaitSeconds') >= 0) {
            wait += cmds[m].Seconds || cmds[m].Milliseconds || cmds[m].Value || 0;
          }
        }
        if (wait > 0 && (out[ph] == null || wait > out[ph])) { out[ph] = wait; }
      }
    }
  }
  return out;
}

/** ボスを回す。`ctx` は run.js が渡す小さな取っ手。

      R       回している場（待ち行列と乱数を持っている）
      u       ボスの体
      plan    `bossPlan` の返り
      waits   `phaseWaits` の返り
      durMs   戦闘の長さ
      cast    (u, gid, slot, lv, at) → その技を撃つ
      onSpawn (何体, どの子) → ミニオンを湧かせる（run.js 側）

    返すのは `{ st }`（外から HP とグロッキーの合図を入れるため）。 */
export function driveBoss(ctx) {
  var R = ctx.R, u = ctx.u, plan = ctx.plan, durMs = ctx.durMs;
  var waits = ctx.waits || {}, cast = ctx.cast;
  var st = {
    phase: 0, n: 0, gauge: 0, exCount: 0,
    hpTriggered: {}, groggy: false, stopped: false,
  };
  var first = plan.phases[0] ? 0 : num(Object.keys(plan.phases)[0]) || 0;
  st.phase = first;

  function ps() { return plan.phases[st.phase] || null; }

  /** ふるまいを 1 つ実行して、**次の通常攻撃までに足す時間**を返す。 */
  function behave(r, now) {
    var b = r.ExternalBehavior, arg = r.BehaviorArgument;
    if (r.BehaviorRate != null && r.BehaviorRate < 10000
        && R.rnd && R.rnd() * 10000 >= r.BehaviorRate) { return 0; }
    if (b === 'UseSelectExSkill' || b === 'AlivePartsUseExSkill') {
      var k = num(arg);
      if (k == null) { return 0; }
      var gid = plan.ex[k];
      if (!gid || gid === 'EmptySkill') { return 0; }
      cast(u, gid, 'Ex', 1, now);
      st.exCount++;
      return plan.exMs[k] || 0;
    }
    if (b === 'AddActiveGauge') {
      st.gauge += (num(arg) || 0);
      if (st.gauge < 0) { st.gauge = 0; }
      return 0;
    }
    if (b === 'ChangePhase' || b === 'ForceChangePhase') {
      var p = num(arg);
      if (p == null || !plan.phases[p]) { return 0; }
      st.phase = p; st.n = 0; st.gauge = 0;
      return waits[p] || 0;
    }
    if (b === 'ClearNormalSkill') { st.n = 0; return 0; }
    if (b === 'AddGroggy') { st.groggy = true; return 0; }
    return 0;
  }

  /** その瞬間に真になっている「数えない」引き金を引く。

      **ゲージは撃ったら空になる。**ここを空にしていなくて、ビナーが
      `CheckActiveGaugeOver 100` を満たした 9 秒から **0.1 秒ごとに EX を撃ち続け**、
      15 秒で味方 6 人を全滅させていた（2026-09-06。`IrVUx0ywuyo` で 63 回）。
      木の読み方はこう:

          Selector | CheckPeriod          1000 | AddActiveGauge   12
          Selector | CheckActiveGaugeOver 100  | UseSelectExSkill 2

      1 秒ごとに 12 溜まって、100 を越えたら撃つ ＝ **8.3 秒に 1 発**。
      溜める側と撃つ側が 1 つの `Selector` の子で、撃つほうがゲージを使う。
      空にしないと、越えたあとは毎刻み撃つことになる。 */
  function checkStanding(now) {
    var cur = ps();
    if (!cur) { return 0; }
    var rows = cur.rows, i, extra = 0, spent = false;
    for (i = 0; i < rows.length; i++) {
      var r = rows[i], tg = r.ExternalBTTrigger;
      if (tg === 'CheckActiveGaugeOver') {
        var lim = num(r.TriggerArgument);
        if (lim != null && st.gauge > lim) { extra += behave(r, now); spent = true; }
      } else if (tg === 'CheckActiveGaugeBetween') {
        var ab = pair(r.TriggerArgument);
        if (ab[0] != null && ab[1] != null
            && st.gauge >= ab[0] && st.gauge <= ab[1]) { extra += behave(r, now); }
      } else if (tg === 'HPUnder') {
        // `TriggerArgument` は 1/100000（75000 ＝ 75%）。**1 度だけ**
        var pct = num(r.TriggerArgument);
        var kk = st.phase + '/' + i;
        if (pct != null && !st.hpTriggered[kk]
            && u.maxHp > 0 && (u.hp / u.maxHp) * 100000 <= pct) {
          st.hpTriggered[kk] = 1;
          extra += behave(r, now);
        }
      }
    }
    if (spent) { st.gauge = 0; }
    return extra;
  }

  /** 通常攻撃 1 発 → 木を引く → 次を積む。 */
  function beat(now) {
    if (st.stopped || now > durMs || !u.alive || u.hp <= 0) { return; }
    var cur = ps();
    if (!cur || !cur.na || !cur.naMs) { st.stopped = true; return; }
    cast(u, cur.na, 'Normal', 1, now);
    st.n++;
    var extra = 0, rows = cur.rows, i;
    for (i = 0; i < rows.length; i++) {
      if (rows[i].ExternalBTTrigger !== 'UseNormalSkill') { continue; }
      if (num(rows[i].TriggerArgument) !== st.n) { continue; }
      extra += behave(rows[i], now);
    }
    extra += checkStanding(now);
    // **台本が一周したら数えを戻す**（`CheckPeriod → ClearNormalSkill` の枝）
    var back = ps();
    if (back && back.wrap && st.n >= back.wrap) { st.n = 0; }
    var next = now + (back ? back.naMs : cur.naMs) + extra;
    if (next <= durMs) { R.q.push(next, beat); }
  }

  // ---- `CheckPeriod`（ミリ秒ごと）。**1 は「いつでも」なので周期には使わない**
  //
  // 段が変わっても効くように、**段ぜんぶから間隔を集めて**積む。撃つときは
  // そのときの段の行だけを見る。`ClearNormalSkill` は周期ではなく
  // 「台本が一周した印」（`bossPlan` の `wrap`）なので、ここでは積まない
  var allRows = [], pk = Object.keys(plan.phases), pj;
  for (pj = 0; pj < pk.length; pj++) {
    allRows = allRows.concat(plan.phases[pk[pj]].rows);
  }
  var cur0 = { rows: allRows };
  if (cur0) {
    var seen = {}, i2;
    for (i2 = 0; i2 < cur0.rows.length; i2++) {
      var r2 = cur0.rows[i2];
      if (r2.ExternalBTTrigger !== 'CheckPeriod') { continue; }
      if (r2.ExternalBehavior === 'ClearNormalSkill') { continue; }
      var ms = num(r2.TriggerArgument);
      if (!ms || ms <= 1 || seen[ms]) { continue; }
      seen[ms] = 1;
      (function (per) {
        var t;
        for (t = per; t <= durMs; t += per) {
          (function (tt) {
            R.q.push(tt, function (now) {
              var c = ps(), j, ex2 = 0;
              if (!c) { return; }
              for (j = 0; j < c.rows.length; j++) {
                if (c.rows[j].ExternalBTTrigger === 'CheckPeriod'
                    && c.rows[j].ExternalBehavior !== 'ClearNormalSkill'
                    && num(c.rows[j].TriggerArgument) === per) {
                  ex2 += behave(c.rows[j], now);
                }
              }
              checkStanding(now);
            });
          })(t);
        }
      })(ms);
    }
  }

  // ---- `OnSpawned`（0 秒）
  var cur1 = ps();
  if (cur1) {
    R.q.push(0, function (now) {
      var j;
      for (j = 0; j < cur1.rows.length; j++) {
        if (cur1.rows[j].ExternalBTTrigger === 'OnSpawned') { behave(cur1.rows[j], now); }
      }
    });
  }

  // ---- 通常攻撃の 1 発目
  R.q.push(0, beat);

  st.applyGroggy = function (now) {
    var c = ps(), j;
    if (!c) { return; }
    st.groggy = true;
    for (j = 0; j < c.rows.length; j++) {
      if (c.rows[j].ExternalBTTrigger === 'ApplyGroggy') { behave(c.rows[j], now); }
    }
  };
  st.check = checkStanding;
  return st;
}
