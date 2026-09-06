// ------------------------------------------------------------ 画面と核の橋
/* **画面が持っている「編成と TL」を、`run.js` が食べられる形にする。**

   なぜ橋が要るか。TL の本文を読むのは画面側の仕事（`parse-tl.js` が
   「即 ホシノ」「07.80　ネル」「固有2 絆21 スキル5MMM T10/10/10」を解く）で、
   コストが足りるかを見るのも `tl-engine.js` の仕事。**そこは作り直さない。**
   ここは解けたあとの状態（`st.parties[pi]`）を受け取って、束を読み込んで、
   `run()` を呼ぶだけ。

   node からも使えるように、束の読み込みは差し替えられる（`o.load`）。
   ブラウザでは `DecompressionStream('gzip')` で解く。

   ## 画面から受け取るもの

     st.parties[pi].slots[i]  1 枠の育ち（`core.js:mkSlot`）
       id / lv / star / eq / wlv / wstar / gear / bond / pot /
       ex(EX の段) / sk(通常スキル) / plv(パッシブ) / sslv(サブ)
     st.parties[pi].tl        置いた EX。`{i, t, mc, f, to, hb}`。**時刻は解決済み**
     cid                      `__TLDBG.diff().cid`。**これで面が 1 つに決まる**

   ## まだ渡していないもの

   `to`（渡し先）・`hb`（ボス本体にも当たる）・`tg`（狙う的）・`bst`（ボスの状態の窓）。
   核が盤を持っていないので置き場が無い。第 2 段で入れる。
*/
import { run } from './run.js';
import { grow } from './grow.js';

/** ブラウザ用の読み込み。`.json.gz` を取って解いて JSON にする */
export async function fetchGz(url) {
  var r = await fetch(url);
  if (!r.ok) { throw new Error(url + ' が取れない: ' + r.status); }
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('DecompressionStream が無い');
  }
  var s = r.body.pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(s).text());
}

/** 束の読み込み口。**同じものは 1 回しか取らない。** */
export function makeLoader(base, getGz, getJson) {
  var cache = {};
  var gz = getGz || fetchGz;
  var js = getJson || (async function (u) {
    var r = await fetch(u);
    return r.json();
  });
  function once(k, fn) {
    if (!cache[k]) { cache[k] = fn(); }
    return cache[k];
  }
  return {
    common: function () { return once('c', function () { return gz(base + '/common.json.gz'); }); },
    index: function () { return once('i', function () { return js(base + '/boss/index.json'); }); },
    boss: function (key) {
      return once('b' + key, function () { return gz(base + '/boss/' + key + '.json.gz'); });
    },
    student: function (id) {
      return once('s' + id, function () { return gz(base + '/s' + id + '.json.gz'); });
    },
  };
}

/** `cid`（ボスの実体 Id）から面の鍵を引く。**同じ `cid` が 2 面あるときは
    新しいほう（Id の大きいほう）。**同じボスの 2 期目で、中身は同じ。 */
export function keyOfCid(index, cid) {
  var best = null, bestN = -1, k;
  for (k in index) {
    if (index[k].cid !== cid) { continue; }
    var n = parseInt(String(k).replace(/^\D+/, ''), 10) || 0;
    if (n > bestN) { bestN = n; best = k; }
  }
  return best;
}

/** 1 枠の育ちを `grow()` の引数に。**画面の欄名をそのまま写す。** */
export function optOf(sl) {
  var eq = (sl.eq && sl.eq.length === 3) ? sl.eq.slice() : [sl.eq, sl.eq, sl.eq];
  var pt = sl.pot || [0, 0, 0];
  return {
    lv: sl.lv || 90, star: sl.star || 1, eq: eq,
    wlv: sl.wlv || 0, wstar: sl.wstar || 0,
    gear: sl.gear > 0 ? sl.gear : 0, bond: sl.bond || 1,
    // `pot` は画面では [HP, 攻撃, 治癒] の並び
    pot: { MaxHP: pt[0] || 0, AttackPower: pt[1] || 0, HealPower: pt[2] || 0 },
  };
}

/** **1 部隊ぶんを回す。**

    o = { load, st, pi, cid, seed, step, dur }
      load  `makeLoader()` の返り値
      st    画面の状態（`__TLDBG.st`）
      pi    部隊の番号
      cid   `__TLDBG.diff().cid`

    返すのは `run()` の返り値に `key` / `gaps` / `slots` を足したもの。 */
export async function simParty(o) {
  var L = o.load, st = o.st, pi = o.pi || 0;
  var index = await L.index();
  var key = o.key || keyOfCid(index, o.cid);
  if (!key) { throw new Error('面が引けない cid=' + o.cid); }
  var common = await L.common();
  var boss = await L.boss(key);

  var pt = st.parties[pi], slots = pt.slots || [], i;
  var party = [], map = {}, gaps = [], names = [];
  for (i = 0; i < slots.length; i++) {
    var sl = slots[i];
    if (!sl || !sl.id || sl.on === false) { continue; }
    var pack;
    try { pack = await L.student(sl.id); } catch (e) { gaps.push(sl.id + ':束なし'); continue; }
    var op = optOf(sl);
    var stats = grow(pack, common, op);
    if (!stats) { gaps.push(sl.id + ':素の値なし'); continue; }
    if (stats.__gaps && stats.__gaps.length) {
      gaps.push(pack.dev + ':' + stats.__gaps.join(','));
    }
    map[i] = party.length;
    names.push(pack.dev);
    party.push({
      pack: pack, lv: op.lv, stats: stats,
      wlv: op.wlv, wstar: op.wstar, gearT: op.gear,
      // 渡し先は全部の枠を数え終えてから直す（後ろの枠を指すことがある）
      _nsto: sl.nsto,
      skillLv: { Ex: sl.ex || 1, Public: sl.sk || 1, Normal: sl.sk || 1,
                 Passive: sl.plv || 1, ExtraPassive: sl.sslv || 1 },
    });
  }

  // **通常スキルが「味方 1 人」のときの渡し先。**画面の枠の番号を核の並びに直す
  for (i = 0; i < party.length; i++) {
    var nt = party[i]._nsto;
    party[i].nsto = (nt != null && map[nt] != null) ? map[nt] : null;
    delete party[i]._nsto;
  }

  var tl = [], rows = (pt.tl || []).slice().sort(function (a, b) { return a.t - b.t; });
  for (i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (map[r.i] == null) { continue; }
    // `to` は枠の番号。核の並びに直す（空いている枠を詰めているので番号が変わる）
    var to = (r.to != null && map[r.to] != null) ? map[r.to] : null;
    tl.push({ at: r.t, i: map[r.i], mc: r.mc == null ? null : r.mc, f: r.f || 0, to: to });
  }

  var dur = o.dur != null ? o.dur : ((index[key].dur || 240000) / 1000);
  var res = run({ common: common, boss: boss, party: party, tl: tl,
                  dur: dur, mc: 1, seed: o.seed, step: o.step });
  res.key = key;
  res.gaps = gaps;
  res.names = names;
  return res;
}

/** 画面から呼べる形。`window.__TLSIM` に置く（`main.js` からではなく、
    確かめる側が `import()` して置く） */
export function install(base) {
  var L = makeLoader(base);
  window.__TLSIM = function (opt) {
    var D = window.__TLDBG;
    return simParty({ load: L, st: D.st, pi: (opt && opt.pi) || 0,
                      cid: (opt && opt.cid) != null ? opt.cid : D.diff().cid,
                      seed: opt && opt.seed, dur: opt && opt.dur });
  };
  return window.__TLSIM;
}
