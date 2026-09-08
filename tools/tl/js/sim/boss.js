// ------------------------------------------------------------ ボスを動かす
//
// **`BossExternalBTExcelTable` をそのまま回す。**焼き出しのように「EX が出る秒」へ
// 畳まない。畳むと、味方が速くて周回が早まったときに追随しない。
//
// 木は 1 行が「引き金 → ふるまい」の組で、`AIPhase` ごとに束ねてある。
// **どの体の木かは `CharacterExcelTable.ExternalBTId`**（シロクロは 7302700 / 7302701、
// カイテンジャーは棒 605110703 と本体 605110701 で別々。2026-09-07 まで全部を 1 体に
// 束ねていた）。**体が 2 つある面はその両方に木を回す**（2026-09-09。`run.js:startSubBoss`）。
//
//   ExternalBTTrigger        TriggerArgument     いつ
//     UseNormalSkill           N                 通常攻撃 N 発目のあと
//     CheckPeriod              ミリ秒            その間隔ごと（1 は「いつでも」）
//     CheckActiveGaugeOver     N                 ゲージが N 以上なら
//     CheckActiveGaugeBetween  a,b               ゲージが a〜b のあいだ
//     HPUnder                  HP                **HP がその値以下**（割合ではない。
//                                                ビナー 13,800,000 / 5,750,000、
//                                                シロクロの 45,000,001 は「最初から」）
//     ApplyGroggy              —                 グロッキーに入ったら
//     OnSpawned                —                 湧いた直後
//     CheckSummonCharacterCountUnder/Over N      呼んだ子が N 体以下／以上
//     CheckHallucinationCountUnder/Over N        幻影（ゴズ）が N 体以下／以上
//     ApplyLogicEffectTemplateId T               その札（TemplateId）がどこかに貼られたら
//                                                （ホドの仮設タワーが死んで貼る
//                                                `Dummy_HOD_TemporaryDeadChangePhase01`、
//                                                ケセドの `Attack_Damage_Chesed`）
//
//   ExternalBehavior         BehaviorArgument    何をする
//     UseSelectExSkill         k                 `ExSkillGroupId[k]` を撃つ（10 枠）
//     AlivePartsUseExSkill     k                 その部位が生きていれば撃つ
//     SetMaxHPToParts          a,b,c             部位を作る（束の中でカイテンジャーだけ。
//                                                3 つで 11,000,000 ずつ。`SubPartsCount` と同じ数）
//     ConnectExSkillToParts    k,ExSkillNN       部位 k が持つ EX（`AlivePartsUseExSkill k` の k）
//     AddActiveGauge           ±d                ゲージを足す
//     ChangePhase              p                 段を移る（ForceChangePhase も同じ）
//     ClearNormalSkill         —                 通常攻撃の数えを 0 に戻す
//
// **`ExternalBTNodeType` が木の形**（2026-09-07。全 10,868 行のうち Instant 33,331・
// Selector 4,374・Sequence 2,163・SubNode 1,187 — 束の合計）:
//     Instant    その行だけ
//     Selector   その行と、続く `SubNode` の行が候補。**上から順に、できた 1 つで止まる**
//                （ヒエロニムスは 4 発目のあと EX1、クールタイム中なら EX2、それも駄目なら EX0。
//                 ゴズは 3333 / 5000 / 10000 の順で振って 3 つから 1 つ）
//     Sequence   その行と続く `SubNode` を順に全部。できなかったらそこで止まる
//     SubNode    直前の Selector / Sequence の子（`AIPhase` は当てにならない。
//                カイテンジャーは段 1 の Selector に段 0 の SubNode がぶら下がる）
//
// **EX には 3 つの都合がある**（`SkillExcelTable`）:
//     UseAtg              その EX が使うゲージ（ヒエロニムス EX04 100、ゴズ EX02 900、
//                         ホド EX05 100）。`CheckActiveGaugeOver N` の N と揃う。
//                         足りなければ撃てず、撃ったらそのぶん減る
//     EnemyStartCoolTime  戦闘開始からこのミリ秒は撃てない（ヒエロニムス EX02 45,000）
//     EnemyCoolTime       撃ってからこのミリ秒は撃てない
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

/** **その体の部位**（`SubPartsCount` と木の `OnSpawned → SetMaxHPToParts`）。
    持たない体は `null`。2026-09-09。

    **部位を持つのはカイテンジャーでは本体のほう**で、画面が本体に選ぶのは
    棒（`Kaitenranger_Boss_…`。`BossCharacterId` の 1 つ目）。木を体ごとに回すように
    したのは 2026-09-09 04:1x で、それまで本体の `SetMaxHPToParts` は一度も走らなかった。
    いまも湧いた瞬間に部位が要る（常時札の `GetActiveParts()` は木より先に見る）ので、
    `behave` に任せきりにせず湧かせるところでもここから読む。 */
export function partsOf(boss, cid) {
  var ent = boss.ent || [], bt = boss.bt || [], i, me = null;
  for (i = 0; i < ent.length; i++) { if (ent[i].Id === cid) { me = ent[i]; } }
  if (!me || !(me.SubPartsCount > 0)) { return null; }
  for (i = 0; i < bt.length; i++) {
    if (bt[i].ExternalBehavior !== 'SetMaxHPToParts') { continue; }
    if (me.ExternalBTId != null && bt[i].ExternalBTId != null
        && bt[i].ExternalBTId !== me.ExternalBTId) { continue; }
    var hs = String(bt[i].BehaviorArgument == null ? '' : bt[i].BehaviorArgument).split(',');
    var out = [], j, v;
    for (j = 0; j < hs.length; j++) {
      v = num(hs[j]);
      if (v != null) { out.push({ hp: v, max: v, alive: true }); }
    }
    if (out.length) { return out; }
  }
  return null;
}

/** 台本を段ごとにまとめる。**回す前に 1 回だけ。** */
export function bossPlan(boss, cid) {
  var bt0 = boss.bt || [], ph = boss.phase || [], ls = boss.ls || {};
  var csl = (boss.csl || {})[cid] || (boss.csl || {})[String(cid)] || [];
  var row0 = csl[0] || {};
  var ex = row0.ExSkillGroupId || [];
  var stx = null, i;
  for (i = 0; i < (boss.st || []).length; i++) {
    if (boss.st[i].CharacterId === cid) { stx = boss.st[i]; }
  }
  var spd = ((stx && stx.NormalAttackSpeed) || 10000) / 10000;

  // ---- この体の木だけ（`ExternalBTId`）。引けない束は今までどおり全部
  var btId = null;
  for (i = 0; i < (boss.ent || []).length; i++) {
    if (boss.ent[i].Id === cid && boss.ent[i].ExternalBTId) { btId = boss.ent[i].ExternalBTId; }
  }
  var bt = [];
  for (i = 0; i < bt0.length; i++) {
    if (btId == null || bt0[i].ExternalBTId == null || bt0[i].ExternalBTId === btId) { bt.push(bt0[i]); }
  }
  if (!bt.length) { bt = bt0; }

  // ---- EX 1 枠ぶんのモーション（ミリ秒）と、ゲージ・クールタイム（`SkillExcelTable`）
  var skBy = {}, sk = boss.sk || [];
  for (i = 0; i < sk.length; i++) { if (!skBy[sk[i].GroupId]) { skBy[sk[i].GroupId] = sk[i]; } }
  // **形態ごとの枠**（`CharacterSkillList` の `FormIndex`。ホドは形態 1 で
  // `HODInsaneNormal02` と本物の `HODEx03_Torment` に入れ替わる。2026-09-07）
  var forms = {}, fz;
  for (fz = 0; fz < csl.length; fz++) {
    var rowF = csl[fz], exF = rowF.ExSkillGroupId || [], fi = rowF.FormIndex || 0;
    if (forms[fi]) { continue; }
    var fo = { ex: exF, exMs: [], atg: [], cool: [], na: (rowF.NormalSkillGroupId || [])[0] || null };
    for (i = 0; i < exF.length; i++) {
      var fF = (exF[i] && exF[i] !== 'EmptySkill') ? frames(ls[exF[i]]) : null;
      fo.exMs.push(fF ? (fF / FPS) * 1000 : 0);
      var srowF = skBy[exF[i]] || {};
      fo.atg.push(+srowF.UseAtg || 0);
      fo.cool.push({ start: +srowF.EnemyStartCoolTime || 0, cool: +srowF.EnemyCoolTime || 0 });
    }
    forms[fi] = fo;
  }
  var f0 = forms[0] || { ex: ex, exMs: [], atg: [], cool: [], na: null };
  var exMs = f0.exMs, atg = f0.atg, cool = f0.cool;

  // ---- 段ごとの通常攻撃
  var naOf = {}, hasRow = {};
  for (i = 0; i < ph.length; i++) {
    if (ph[i].Id !== cid) { continue; }
    naOf[ph[i].AIPhase] = ph[i].NormalAttackSkillUniqueName || null;
    hasRow[ph[i].AIPhase] = 1;
  }
  // 段の表が無いボスは `CharacterSkillList` の通常枠で代える
  var fallbackNa = (row0.NormalSkillGroupId || [])[0] || null;

  // ---- 行を節に束ねる。Selector / Sequence に続く SubNode がその子
  var nodes = [], cur = null;
  for (i = 0; i < bt.length; i++) {
    var r = bt[i], ty = String(r.ExternalBTNodeType || 'Instant');
    if (ty === 'SubNode' && cur) { cur.kids.push(r); continue; }
    cur = { type: ty === 'SubNode' ? 'Instant' : ty,
            trig: String(r.ExternalBTTrigger || 'None'), arg: r.TriggerArgument,
            phase: r.AIPhase == null ? 0 : r.AIPhase, kids: [r], i: i };
    nodes.push(cur);
  }
  var phases = {};
  for (i = 0; i < nodes.length; i++) {
    var p = nodes[i].phase;
    if (!phases[p]) { phases[p] = { rows: [], nodes: [], na: null, naMs: 0, wrap: 0 }; }
    phases[p].nodes.push(nodes[i]);
    phases[p].rows.push(nodes[i].kids[0]);
  }
  var keys = Object.keys(phases), k;
  for (k = 0; k < keys.length; k++) {
    var ps = phases[keys[k]], rows = ps.rows, j;
    // **段の表が「通常攻撃なし」と言っている段は撃たない**（ホドの段 0・1。
    // 仮設タワーを壊すまで本体は立っているだけ）
    if (hasRow[keys[k]] && !naOf[keys[k]]) {
      ps.na = null;
    } else {
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
    }
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
  return { cid: cid, btId: btId, ex: ex, exMs: exMs, atg: atg, cool: cool, phases: phases, spd: spd,
           forms: forms, ls: ls, naOf: naOf, hasRow: hasRow, fallbackNa: fallbackNa };
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

/** その節の子に EX を撃つ行があるか。 */
function usesEx(nd) {
  var i, b;
  for (i = 0; i < nd.kids.length; i++) {
    b = nd.kids[i].ExternalBehavior;
    if (b === 'UseSelectExSkill' || b === 'AlivePartsUseExSkill') { return true; }
  }
  return false;
}

/** ボスを回す。`ctx` は run.js が渡す小さな取っ手。

      R       回している場（待ち行列と乱数を持っている）
      u       ボスの体
      plan    `bossPlan` の返り
      waits   `phaseWaits` の返り
      durMs   戦闘の長さ
      cast    (u, gid, slot, lv, at) → その技を撃つ

    返すのは `st`（外から HP とグロッキーの合図を入れるため）。 */
export function driveBoss(ctx) {
  var R = ctx.R, u = ctx.u, plan = ctx.plan, durMs = ctx.durMs;
  // 湧いた時刻。盤が途中で湧かせる本体（ケセドは節 3）はここから木が回る
  var t0 = ctx.t0 || 0;
  var waits = ctx.waits || {}, cast = ctx.cast, outOfRange = ctx.outOfRange || null;
  var st = {
    phase: 0, n: 0, gauge: 0, exCount: 0, parts: null,
    hpTriggered: {}, groggy: false, stopped: false, busyUntil: 0,
    coolUntil: {}, seenTmpl: {}, log: [],
  };
  var first = plan.phases[0] ? 0 : num(Object.keys(plan.phases)[0]) || 0;
  st.phase = first;
  var k0;
  for (k0 = 0; k0 < plan.ex.length; k0++) {
    st.coolUntil[k0] = (plan.cool[k0] && plan.cool[k0].start) || 0;
  }

  function ps() { return plan.phases[st.phase] || null; }
  /** いまの形態の枠（EX の並び・モーション・ゲージ・クールタイム） */
  function fp() { return (plan.forms && plan.forms[u.form || 0]) || (plan.forms && plan.forms[0]) || plan; }
  /** いまの段・形態の通常攻撃。段の表が '' なら無し。表の名前が束に無ければ形態の枠で代える */
  function naNow() {
    var cur = ps(), ph = st.phase, ls = plan.ls || {};
    if (!cur) { return null; }
    if (plan.hasRow && plan.hasRow[ph] && !(plan.naOf || {})[ph]) { return null; }
    var cand = [(plan.naOf || {})[ph], fp().na, (plan.naOf || {})[0], plan.fallbackNa], ci;
    for (ci = 0; ci < cand.length; ci++) { if (cand[ci] && ls[cand[ci]]) { return cand[ci]; } }
    return cur.na || null;
  }
  function naMsNow() {
    var na = naNow(), nf = na ? frames((plan.ls || {})[na]) : null;
    return nf ? (nf / FPS) * 1000 / (plan.spd || 1) : 0;
  }

  // **ゲージは 2 つの入口がある**（2026-09-07）。木が足す `AddActiveGauge` と、
  // 札が足す `AddCurrentATG`（`run.js` の `u.atg`）。後者を見ていなくて、
  // **ペロロジラの段が一度も変わらなかった**——あのボスの段は
  // `CheckActiveGaugeOver 301`、つまり気絶したミニオンを吸って溜まる
  // ゲージが 301 を越えたときに動く。
  function gaugeNow() { return (st.gauge || 0) + (u.atg || 0); }
  function spend(v) {
    var g = gaugeNow() - v;
    st.gauge = g < 0 ? 0 : g; u.atg = 0;
  }

  /** 呼んだ子の数（`Summoned` だけ。無ければボス以外ぜんぶ） */
  function summons() {
    if (R.summonCount) { return R.summonCount(); }
    return R.minionCount ? R.minionCount() : 0;
  }

  function roll(r) {
    var rate = r.BehaviorRate;
    if (rate != null && rate < 10000 && R.rnd && R.rnd() * 10000 >= rate) { return false; }
    return true;
  }

  /** 段を移る。**数えとゲージは 0 に戻る**（ペロロジラは `UseAtg 0` の EX09 で
      ゲージが減らないので、ここで戻さないと同じ刻みで段を回り続ける）。
      盤の `CharacterPhaseChanged → WaitSeconds` があればそのあいだ立っている。 */
  function changePhase(p, now) {
    st.phase = p; st.n = 0; st.gauge = 0; u.atg = 0;
    var w = waits[p] || 0;
    if (w > 0) { st.busyUntil = Math.max(st.busyUntil || 0, now + w); }
    if (st.log) { st.log.push([now, 'ph' + p]); }
    // 通常攻撃の無い段（ホドの段 0・1）から有る段へ。止めていた拍を起こす
    if (st.stopped) {
      st.stopped = false;
      R.q.push(Math.max(now, st.busyUntil || 0), beat);
    }
  }

  /** ふるまいを 1 つ実行して、**できたら true**。Selector はこれで次の子へ回るかを決める。 */
  function behave(r, now) {
    var b = r.ExternalBehavior, arg = r.BehaviorArgument;
    if (b === 'UseSelectExSkill' || b === 'AlivePartsUseExSkill') {
      var k = num(arg);
      if (k == null) { return false; }
      var fo = fp(), gid = fo.ex[k];
      if (!gid || gid === 'EmptySkill') { return false; }
      // **グロッキー中は撃たない。**`checkStanding` の頭でも見ているが、
      // **最後の 1 体が死んだ刻は「召喚が 0 になった」と「ゲージが満タンになった」が
      // 同じ刻に立つ**ので、ここでも見ないと気絶した瞬間に次の群が出る。
      // 動画（QnKBiKMMUQE）では明けるまで 1 体も湧かず、その 20 秒で本体を削っている
      // ——湧いていると味方の EX が手前の召喚物に吸われて本体に入らない（2026-09-08）
      if (inGroggy(now)) { return false; }
      // クールタイム（`EnemyStartCoolTime` / `EnemyCoolTime`）とゲージ（`UseAtg`）
      if (now < (st.coolUntil[k] || 0)) { return false; }
      var need = fo.atg[k] || 0;
      if (need > 0 && gaugeNow() < need) { return false; }
      // **部位が死んでいるときだけ止める。**`null` は「部位を持っていない体」で、
      // そこは今までどおり撃つ（`R.partAlive` は 2026-09-09 に置いた）
      if (b === 'AlivePartsUseExSkill' && R.partAlive && R.partAlive(u, k) === false) { return false; }
      cast(u, gid, 'Ex', 1, now);
      st.exCount++;
      if (need > 0) { spend(need); }
      if (fo.cool[k] && fo.cool[k].cool > 0) { st.coolUntil[k] = now + fo.cool[k].cool; }
      // **撃っている間は木を引き直さない。**`CheckSummonCharacterCountUnder` は
      // ゲージのように「使い切る」ものが無いので、これが無いと 0.1 秒ごとに
      // 呼び直して盤が雑魚で埋まる（2026-09-07）
      st.busyUntil = Math.max(st.busyUntil || 0, now + (fo.exMs[k] || 0));
      if (st.log) { st.log.push([now, 'Ex' + k]); }
      return true;
    }
    if (b === 'AddActiveGauge') {
      st.gauge += (num(arg) || 0);
      if (st.gauge < 0) { st.gauge = 0; }
      return true;
    }
    if (b === 'ChangePhase' || b === 'ForceChangePhase') {
      var p = num(arg);
      if (p == null || !plan.phases[p]) { return false; }
      changePhase(p, now);
      return true;
    }
    // **雑魚の HP を 1 本の棒に束ねる**（`ConnectCharacterToDummy`。束に 355 行）。
    // カイテンジャーは 5 人のレンジャーが `Kaitenranger_Boss`（棒だけの体）に
    // 繋がっていて、**誰を撃っても同じ棒が減る。**繋いでいなかったので、
    // 与ダメージ 6,225,406 のうち棒に届いたのは 27,706 だけだった（2026-09-07）。
    // 流し方は `DamageTransferEffectDAO` と同じ札を使う
    if (b === 'ConnectCharacterToDummy') {
      var cid2 = num(arg);
      var cu = (cid2 != null && R.unitOf) ? R.unitOf('e' + cid2) : null;
      if (cu && cu !== u) { cu.xfer = { ratio: 10000, to: u.key }; }
      return true;
    }
    // **部位を作る**（`SetMaxHPToParts`。2026-09-09）。束の中でこれを持つのは
    // カイテンジャーだけで、`SubPartsCount` 3 と数が揃う（11,000,000 が 3 つ）。
    // これが無いあいだ `GetActiveParts()` が読めず、本体の常時札 3 本
    // （右腕＝攻撃力 +50%・胸＝見張り・左腕＝防御力 +1000）が 1 度も乗らなかった。
    // **削り方は束に無い**（`Excel/` で `Part` を持つ欄は `SubPartsCount` だけ）ので、
    // ここでは湧いた形のまま置く。`ActivatePart` も削れないうちは動かしようがない
    if (b === 'SetMaxHPToParts') {
      var hps = String(arg == null ? '' : arg).split(','), pz, pv, ps2 = [];
      for (pz = 0; pz < hps.length; pz++) {
        pv = num(hps[pz]);
        if (pv == null) { continue; }
        ps2.push({ hp: pv, max: pv, alive: true });
      }
      if (!ps2.length) { return false; }
      st.parts = ps2; u.parts = ps2;
      return true;
    }
    // 部位 k が持つ EX の名前。`AlivePartsUseExSkill k` の k と揃っているかの裏取り用
    if (b === 'ConnectExSkillToParts') {
      var pr = String(arg == null ? '' : arg).split(','), pk = num(pr[0]);
      if (pk == null) { return false; }
      st.partEx = st.partEx || {};
      st.partEx[pk] = String(pr[1] || '').trim();
      return true;
    }
    if (b === 'ClearNormalSkill') { st.n = 0; return true; }
    if (b === 'AddGroggy') { st.groggy = true; return true; }
    R.miss['bt:' + b] = (R.miss['bt:' + b] || 0) + 1;
    return true;
  }

  /** 節を 1 つ引く。Selector は「できた 1 つ」で止まり、Sequence は失敗で止まる。 */
  function runNode(nd, now) {
    var kids = nd.kids, i, ok, any = false;
    if (nd.type === 'Selector') {
      for (i = 0; i < kids.length; i++) {
        if (!roll(kids[i])) { continue; }
        if (behave(kids[i], now)) { return true; }
      }
      return false;
    }
    for (i = 0; i < kids.length; i++) {
      if (!roll(kids[i])) {
        if (nd.type === 'Sequence') { return any; }
        continue;
      }
      ok = behave(kids[i], now);
      any = any || ok;
      if (!ok && nd.type === 'Sequence') { return any; }
    }
    return any;
  }

  /** その瞬間に真になっている「数えない」引き金を引く。

      **`CheckActiveGaugeOver` は EX の `UseAtg` ぶんだけ減る**（2026-09-07）。
      以前はここで 0 に戻していた——ゲージを空にしないと、越えたあとは毎刻み
      撃つことになる（2026-09-06。`IrVUx0ywuyo` で 63 回）。`UseAtg 0` の EX
      （ペロロジラの EX09）は `ChangePhase` の側で戻る。
      木の読み方はこう:

          Selector | CheckPeriod          1000 | AddActiveGauge   12
          Selector | CheckActiveGaugeOver 100  | UseSelectExSkill 2

      1 秒ごとに 12 溜まって、100 に届いたら撃つ ＝ **8.3 秒に 1 発**。 */
  /** **グロッキーの間は木が止まる。**EX も通常攻撃も出ない（ケセドは雑魚を全滅させた瞬間に
      グロッキーへ入り、同じ刻の `CheckSummonCharacterCountUnder 0 → UseSelectExSkill` で
      次の群を出していた。動画では明けるまで何も湧かず、その 20 秒で本体を削っている。2026-09-07） */
  function inGroggy(now) { return u.groggyUntil != null && now < u.groggyUntil; }
  function checkStanding(now) {
    var cur = ps();
    if (!cur || inGroggy(now)) { return; }
    var nodes = cur.nodes, i, ph0 = st.phase, busy;
    for (i = 0; i < nodes.length; i++) {
      var nd = nodes[i], tg = nd.trig, a = nd.arg, lim;
      // **撃っている最中は撃つ節を引かない。**節ごとに見直す——ホドの `HPUnder 9,000,000 …
      // 8,100,000 → EX3` は 10 行あって、一巡の頭で 1 回だけ見ると 10 発が同じ瞬間に出る
      busy = now < (st.busyUntil || 0);
      if (busy && usesEx(nd)) { continue; }
      if (tg === 'CheckSummonCharacterCountUnder') {
        // **呼んだ子が N 体以下なら呼び直す。**ケセドの筋道の 1 本目
        // （`TriggerArgument: "0"` ＝ 1 体も居ないとき。段ごとに呼ぶ EX が変わる）
        lim = num(a);
        if (lim != null && summons() <= lim) { runNode(nd, now); }
      } else if (tg === 'CheckSummonCharacterCountOver') {
        lim = num(a);
        if (lim != null && summons() >= lim) { runNode(nd, now); }
      } else if (tg === 'CheckHallucinationCountUnder') {
        lim = num(a);
        if (lim != null && R.hallucinationCount && R.hallucinationCount() <= lim) { runNode(nd, now); }
      } else if (tg === 'CheckHallucinationCountOver') {
        lim = num(a);
        if (lim != null && R.hallucinationCount && R.hallucinationCount() >= lim) { runNode(nd, now); }
      } else if (tg === 'CheckActiveGaugeOver') {
        lim = num(a);
        if (lim != null && gaugeNow() >= lim) { runNode(nd, now); }
      } else if (tg === 'CheckActiveGaugeBetween') {
        var ab = pair(a);
        if (ab[0] != null && ab[1] != null
            && gaugeNow() >= ab[0] && gaugeNow() <= ab[1]) { runNode(nd, now); }
      } else if (tg === 'HPUnder') {
        // **`TriggerArgument` は HP そのもの**（13 面ぜんぶ。割合ではない）。1 度だけ
        var hv = num(a), kk = st.phase + '/' + nd.i;
        if (hv != null && !st.hpTriggered[kk] && u.hp <= hv) {
          st.hpTriggered[kk] = 1;
          runNode(nd, now);
        }
      } else if (tg === 'CheckPeriod' && (num(a) || 0) <= 1) {
        // **`CheckPeriod 1` は「いつでも」。**`ClearNormalSkill` だけは台本の一周の印
        // （`bossPlan` の `wrap`）なので引かない。`ChangePhase 1`（カイテンジャー・クロ）は
        // 入った瞬間に段が移る
        var onlyClr = true, z;
        for (z = 0; z < nd.kids.length; z++) {
          if (nd.kids[z].ExternalBehavior !== 'ClearNormalSkill') { onlyClr = false; }
        }
        if (!onlyClr) { runNode(nd, now); }
      }
      if (st.phase !== ph0) { break; }
    }
  }

  /** 通常攻撃 1 発 → 木を引く → 次を積む。 */
  function beat(now) {
    if (st.stopped || now > durMs || !u.alive || u.hp <= 0) { return; }
    // EX の演出中・段替わりの待ちの中は撃たない。明けた瞬間に撃つ
    if (now < (st.busyUntil || 0)) { R.q.push(st.busyUntil, beat); return; }
    if (inGroggy(now)) { R.q.push(u.groggyUntil, beat); return; }
    var cur = ps(), na = naNow(), naMs = naMsNow();
    if (!cur || !na || !naMs) { st.stopped = true; return; }
    // **射程の外では撃たない**（`run.js:outOfRange`。近づくのは `stepApproach`）
    if (outOfRange && outOfRange(u)) { R.q.push(now + 100, beat); return; }
    cast(u, na, 'Normal', 1, now);
    st.n++;
    var before = st.busyUntil || 0, nodes = cur.nodes, i, ph0 = st.phase;
    for (i = 0; i < nodes.length; i++) {
      if (nodes[i].trig !== 'UseNormalSkill') { continue; }
      if (num(nodes[i].arg) !== st.n) { continue; }
      runNode(nodes[i], now);
      if (st.phase !== ph0) { break; }
    }
    checkStanding(now);
    // この拍で撃った EX のモーションぶんだけ、次の通常攻撃が遅れる
    var extra = Math.max(0, (st.busyUntil || 0) - Math.max(before, now));
    // **台本が一周したら数えを戻す**（`CheckPeriod → ClearNormalSkill` の枝）
    var back = ps();
    if (back && back.wrap && st.n >= back.wrap) { st.n = 0; }
    var next = now + (naMsNow() || naMs) + extra;
    if (next <= durMs) { R.q.push(next, beat); }
  }

  // ---- `CheckPeriod`（ミリ秒ごと）。**1 は「いつでも」なので周期には使わない**
  //
  // 段が変わっても効くように、**段ぜんぶから間隔を集めて**積む。撃つときは
  // そのときの段の節だけを見る。`ClearNormalSkill` は周期ではなく
  // 「台本が一周した印」（`bossPlan` の `wrap`）なので、ここでは積まない
  var allNodes = [], pk = Object.keys(plan.phases), pj;
  for (pj = 0; pj < pk.length; pj++) {
    allNodes = allNodes.concat(plan.phases[pk[pj]].nodes);
  }
  (function () {
    var seen = {}, i2;
    for (i2 = 0; i2 < allNodes.length; i2++) {
      var nd2 = allNodes[i2];
      if (nd2.trig !== 'CheckPeriod') { continue; }
      if (nd2.kids[0].ExternalBehavior === 'ClearNormalSkill') { continue; }
      var ms = num(nd2.arg);
      if (!ms || ms <= 1 || seen[ms]) { continue; }
      seen[ms] = 1;
      (function (per) {
        var t;
        for (t = t0 + per; t <= durMs; t += per) {
          (function (tt) {
            R.q.push(tt, function (now) {
              var c = ps(), j, ph0 = st.phase;
              if (!c) { return; }
              for (j = 0; j < c.nodes.length; j++) {
                var nd3 = c.nodes[j];
                if (nd3.trig !== 'CheckPeriod' || num(nd3.arg) !== per) { continue; }
                if (nd3.kids[0].ExternalBehavior === 'ClearNormalSkill') { continue; }
                if (now < (st.busyUntil || 0) && usesEx(nd3)) { continue; }
                if (inGroggy(now) && usesEx(nd3)) { continue; }
                runNode(nd3, now);
                if (st.phase !== ph0) { break; }
              }
              checkStanding(now);
            });
          })(t);
        }
      })(ms);
    }
  }());

  // ---- `OnSpawned`（湧いた瞬間。盤が途中で湧かせる本体は `ctx.t0`）
  // **湧いた刻に、その場で木を一度引く**（2026-09-07）。列に積むと、同じ刻に積んであった
  // 味方の 1 発が先に当たって `HPUnder 20,999,999 → ChangePhase 1` が立ち、ケセドの 1 波目
  // （段 0 の `UseSelectExSkill 0`＝ドロイド）が飛んで 2 波目（ドローン）から始まっていた。
  // ゲームは湧いた瞬間（殴られる前）に木を見るので、`OnSpawned` も立っている節もここで引く
  var cur1 = ps(), j1;
  if (cur1) {
    for (j1 = 0; j1 < cur1.nodes.length; j1++) {
      if (cur1.nodes[j1].trig === 'OnSpawned') { runNode(cur1.nodes[j1], t0); }
    }
  }
  checkStanding(t0);

  // ---- 通常攻撃の 1 発目
  R.q.push(t0, beat);

  st.applyGroggy = function (now) {
    var c = ps(), j;
    if (!c) { return; }
    st.groggy = true;
    for (j = 0; j < c.nodes.length; j++) {
      if (c.nodes[j].trig === 'ApplyGroggy') { runNode(c.nodes[j], now); }
    }
  };

  /** **札が貼られたとき**（`ApplyLogicEffectTemplateId`）。`run.js` の `fire` が
      札とダメージの `TemplateId` を全部ここへ流す。**同じ発（`castId`）の同じ札は
      1 回だけ**——ケセドの `Attack_Damage_Chesed` は当たった人数ぶん飛んでくる。
      撃っている最中なら明けてから引く。 */
  st.onTemplate = function (tmpl, now, castId) {
    var c = ps(), j, key = tmpl + '/' + (castId == null ? Math.round(now) : castId);
    if (!c || !tmpl) { return; }
    if (st.seenTmpl[key]) { return; }
    var hit = false, ph0 = st.phase;
    for (j = 0; j < c.nodes.length; j++) {
      var nd = c.nodes[j];
      if (nd.trig !== 'ApplyLogicEffectTemplateId' || String(nd.arg || '') !== tmpl) { continue; }
      hit = true;
      if (now < (st.busyUntil || 0) && usesEx(nd)) {
        (function (nd4, key4) {
          R.q.push(st.busyUntil, function (t4) {
            if (st.seenTmpl[key4 + '/late']) { return; }
            st.seenTmpl[key4 + '/late'] = 1;
            runNode(nd4, t4);
          });
        })(nd, key);
        continue;
      }
      runNode(nd, now);
      if (st.phase !== ph0) { break; }
    }
    if (hit) { st.seenTmpl[key] = 1; }
  };
  /** 形態が変わった（`run.js` の `R.onForm`）。通常攻撃の無い形態から有る形態へなら拍を起こす */
  st.setForm = function (fi, now) {
    if (st.log) { st.log.push([now, 'form' + fi]); }
    if (st.stopped && naNow()) {
      st.stopped = false;
      R.q.push(Math.max(now, st.busyUntil || 0), beat);
    }
  };
  st.check = checkStanding;
  return st;
}
