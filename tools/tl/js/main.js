import { B, stu } from './util.js';
import { st } from './core.js';
import { syncUndo } from './undo.js';
import { boss, diff, tormentIdx } from './boss.js';
import { engIn, sim } from './engine.js';
import { costPts } from './chart.js';
import { scen } from './scen.js';
import { dmgCurve, poolHp, poolKills, poolName, poolOrder } from './pool.js';
import { carryIn, ggAt, ggCritAt, ggRuns, ggSolve, hpRateAt, killAt, partyCalc, phaseSpans, scoreOf, trOf } from './carry.js';
import { draw, drawNow } from './draw.js';
import { drawErr, kpi } from './kpi.js';
import { drawCrit, drawRate } from './rate.js';
import { movePh, ordAt, ordList } from './ord.js';
import { drawLanes, laneOn, loadLanes } from './lanes.js';
import { epEvery, epOkAt, epOn, epWhy, ssBuffUses } from './ep.js';
import { drawUse } from './useedit.js';
import { drawRows } from './rows.js';
import { drawAlts } from './left.js';
import { mkStats } from './stats.js';
import { effMod, passiveFor, statsOf, support, terrMod } from './passive.js';
import { nsInfo, nsTimes } from './ns.js';
import { busyOf, naInfo, naRuns, naTimes } from './na.js';
import { danMax, usesSorted } from './buff.js';
import { enemyAt, liveBuffs } from './target.js';
import { altOf, pickOf } from './alt.js';
import { dmgOf, dotTimes } from './dmg.js';
import { clearStat, total } from './clear.js';
import { aimOf, beaconOf, bodiesOf, coverOf, fightSecs, hitsNOf, hitsOf, secOfSummon, standOf, summonsOf } from './board.js';
import { restore, snapshot } from './io.js';
import { autoPick, fcOf } from './parse-text.js';
import { parseTL } from './parse-tl.js';
import { applyTL, findStudent } from './parse-apply.js';
import { drawCrew, drawParty, drawPicker, fillBuild, fillFilters } from './left.js';
import { bossShown, fillBoss } from './bossui.js';
import { wireBoss } from './wire-boss.js';
import { wireFold } from './wire-fold.js';
import { wireTip } from './tip.js';
import { wireSize } from './wire-size.js';
import { wireParty } from './wire-party.js';
import { wireBuild } from './wire-build.js';
import { wirePicker } from './wire-picker.js';
import { wireUse } from './wire-use.js';
import { wireRows } from './wire-rows.js';
import { wireMouse } from './wire-mouse.js';

// ------------------------------------------------------------ つなぐ
// **最初に出すのは、選べるボスの 1 体目**（2026-09-03。ペロロジラだけに絞ったので、
// 既定のままだと一覧に無いボスが選ばれた状態で開く）
for (var _bi = 0; _bi < B.bosses.length; _bi++) {
  if (bossShown(B.bosses[_bi].n)) { st.bi = _bi; break; }
}
st.di = tormentIdx(B.bosses[st.bi]);
// **段の取捨選択は最初の draw より先に読む**（2026-09-03）
loadLanes(); drawLanes();
fillBoss(); fillFilters(); fillBuild(); drawParty(); drawCrew(); drawPicker(); draw();
syncUndo();
// 突き合わせ用。**SchaleDB の実装と数字が合うかを外から確かめるため**に出している
window.__TLDBG = { statsOf: statsOf, dmgOf: dmgOf, total: total, diff: diff,
                   terrMod: terrMod, effMod: effMod, passiveFor: passiveFor, phaseSpans: phaseSpans, ggRuns: ggRuns, ggAt: ggAt, ggCritAt: ggCritAt, ggSolve: ggSolve, support: support, dmgCurve: dmgCurve, parseTL: parseTL, st: st, stu: stu, sim: sim, engIn: engIn, costPts: costPts,
                   // **継続ダメージがいつ入るか**（2026-09-03 の 47b）
                   dotTimes: dotTimes,
                   // **変身 EX の周期**（2026-09-03 の 60）
                   fcOf: fcOf,
                   // **「選ぶだけの札」の代わりに置く形態**（2026-09-04 の 61c）
                   autoPick: autoPick,
                   // **当たる先の HP 割合**（2026-09-03 の 56b）
                   hpRateAt: hpRateAt,
                   busyOf: busyOf, naTimes: naTimes, naRuns: naRuns, nsTimes: nsTimes,
                   nsInfo: nsInfo, naInfo: naInfo, altOf: altOf, pickOf: pickOf,
                   usesSorted: usesSorted, liveBuffs: liveBuffs, draw: drawNow,
                   applyTL: applyTL, fillBoss: fillBoss, findStudent: findStudent,
                   // 書き出した JSON をそのまま流し込む（先生の盤を再現するため）
                   restore: restore, snapshot: snapshot,
                   clearStat: clearStat, trOf: trOf,
                   // **盤**（2026-09-04 の第 1 段）。外から体の数を数えて図と突き合わせるため
                   bodiesOf: bodiesOf, beaconOf: beaconOf, aimOf: aimOf,
                   standOf: standOf, coverOf: coverOf, hitsOf: hitsOf,
                   summonsOf: summonsOf, secOfSummon: secOfSummon,
                   fightSecs: fightSecs, hitsNOf: hitsNOf,
                   boss: boss, scen: scen, killAt: killAt, scoreOf: scoreOf,
                   enemyAt: enemyAt, mkStats: mkStats, danMax: danMax,
                   // 池ごとの曲線（シロ→クロ、ワカモ→ホバークラフト）。
                   // `dmgCurve` は本体の池しか返さないので、2 池目を外から比べるのに要る
                   poolKills: poolKills, poolOrder: poolOrder, poolHp: poolHp,
                   poolName: poolName, carryIn: carryIn, partyCalc: partyCalc,
                   // **どこが遅いかを外から測るため**（2026-09-03 の 28）
                   drawRate: drawRate, drawErr: drawErr, kpi: kpi, drawCrit: drawCrit,
                   drawUse: drawUse, drawRows: drawRows, drawAlts: drawAlts,
                   // 再生ヘッドとスキル順（**2 段の帯を外から確かめるため**）
                   movePh: movePh, ordAt: ordAt, ordList: ordList,
                   laneOn: laneOn, drawLanes: drawLanes,
                   // サブスキル（SS）。**置ける子と、置けない理由を外から確かめる**
                   ssBuffUses: ssBuffUses, epWhy: epWhy, epOn: epOn, epEvery: epEvery, epOkAt: epOkAt,
                   B: B };


wireBoss();
wireFold();
wireSize();
wireParty();
wireBuild();
wirePicker();
wireUse();
wireRows();
wireMouse();
wireTip();
