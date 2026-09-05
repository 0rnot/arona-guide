import { $, B } from './util.js';
import { SLOTS, _byid, live, st } from './core.js';
import { diff } from './boss.js';
import { nsTimes } from './ns.js';

// ------------------------------------------------------------ 倍率の幅
// **同じスキルに `Condition` 違いのダメージが並ぶことがある。**どれが当たるかは
// 戦況次第で、データからは決められない。**推測で決めずに選ばせる**
// （2026-09-01 の先生の指示「幅がある場合は、バーで倍率を選択できるように」）
// **印（`Parameter=CH0280_Ex_01`）が付いているかどうかは、TL から決められる。**
// 印の名前の頭が生徒の開発名（`CH0280` ＝ ネル（制服））なので、
// その子が編成にいて、印を付けるスキルを TL に置いていれば「あり」。
//   `_Ex…`         … その子の EX を 1 発でも置いていれば あり
//   `_Public`/`_NS` … 通常スキルが自動で出る子なら あり
//   `_ExtraPassive` … サブスキルは常時なので あり
// 決められないときは `null` を返して**候補を減らさない**（2026-09-01。
// ネル（制服）の「怪我しても知らねえからな」が対戦状態の有無 × 段 5 の 10 通りで、
// 既定が「対戦状態なし・段1」＝ 10 通りのうち最弱を選んでいた。
// 先生の TL は ⑤ネル(VS付与) を先に置くので、必ず「あり」側）
export function markerOn(mk) {
  var i, own = -1, dv = '';
  for (i = 0; i < SLOTS; i++) {
    var p = st.party[i], d = p && _byid[p.id];
    if (d && d.dv && mk.indexOf(d.dv) === 0 && d.dv.length > dv.length) {
      own = i; dv = d.dv;
    }
  }
  if (own < 0) { return null; }
  var tail = mk.slice(dv.length);
  if (/^_?ExtraPassive/i.test(tail)) { return true; }
  if (/^_?(Public|NS|Normal)/i.test(tail)) {
    return nsTimes(st.party[own].id, diff().dur || 240, own).length > 0;
  }
  if (!/^_?Ex/i.test(tail)) { return null; }
  for (i = 0; i < st.tl.length; i++) { if (st.tl[i].i === own) { return true; } }
  return false;
}
// **スキルのレベルで決まる条件は、育成の欄から決める。**
// 「Type=SkillLevel Parameter=ExtraPassive Value=[10, 10]」は「サブが Lv10 のとき」で、
// ホシノ（臨戦）／アタッカー の EX がこの 2 択（[1,9] と [10,10]）。既定が先頭の
// 弱いほうになっていて、MMMM の子でも 1 段目の倍率で出ていた（2026-09-02、ペロロジラ
// 4 本で「ホシノ EX 1 発が実測の半分」の一因）
/** **状態の札が付いている時刻か**（2026-09-05）。`B.spc[id][Key]` は
    `[付ける枠, 持続 ms, ApplyFrame]`（`build-tool-data.py` の注記）。
    ネルの `Fury` は NS が付けて 20 秒。EX を撃った時刻がその中なら 1.7 倍の候補 */
export function spcOn(idx, key, at) {
  var p = idx == null ? null : st.party[idx];
  var sp = p ? ((B.spc || {})[p.id] || {})[key] : null;
  if (!sp || at == null) { return null; }
  var ts = [], i, dur = diff().dur || 240;
  if (sp[0] === 'Ex') {
    for (i = 0; i < st.tl.length; i++) {
      if (st.tl[i].i === idx && st.tl[i].t != null) { ts.push(st.tl[i].t); }
    }
  } else { ts = nsTimes(p.id, dur, idx); }
  var af = (sp[2] || 0) / (B.fps || 30), du = sp[1] / 1000;
  for (i = 0; i < ts.length; i++) {
    if (at >= ts[i] + af - 1e-9 && at < ts[i] + af + du - 1e-9) { return true; }
  }
  return false;
}
export function condOK(c, idx, tb, at) {
  // **相手の性質で決まる条件は、相手が分かっているのでこちらで決める。**
  // `Type=TargetProp Parameter=ArmorType Operand=Equal Value=Unarmed` が
  // サクラコ「光と共にあらんことを」＝ 特殊装甲への特攻で、装甲はどのボスにも
  // 入っている。**当てはまるときだけ足して、外れたら足さない**
  // （2026-09-03 の先生の指示「敵の装甲わかってるなら特攻も攻撃バフとして
  // 加算してほしい」。それまでは候補が 1 つしか無いぶんが素通りで、装甲の
  // 違うボスにも乗っていた）。
  // **欄が空のときは決めない。**`Size` は難易度によって null のことがある
  var m = /Type=TargetProp Parameter=([A-Za-z]+) Operand=(Equal|NotEqual) Value=(.+)$/
    .exec(String(c || ''));
  if (m) {
    var tb0 = tb || diff().bs || {};
    var got = { ArmorType: tb0.armor, BulletType: tb0.bullet, Size: tb0.size }[m[1]];
    if (got == null) { return true; }
    var same = String(got) === String(m[3]);
    return m[2] === 'Equal' ? same : !same;
  }
  m = /Parameter=([A-Za-z0-9_]+) Operand=Exists Value=(True|False)/.exec(String(c || ''));
  if (m) {
    // **撃つ時刻が分かっていれば、その時刻に札が付いているかで決める**（2026-09-05）
    var on = spcOn(idx, m[1], at);
    if (on == null) { on = markerOn(m[1]); }
    if (on == null) { return true; }
    return on === (m[2] === 'True');
  }
  m = /Type=SkillLevel Parameter=([A-Za-z]+) Value=\[(\d+),\s*(\d+)\]/.exec(String(c || ''));
  if (m && idx != null && st.slots[idx]) {
    var sl = st.slots[idx], lv = null;
    // **順番が大事。**`ExtraPassive` が `/^Ex/` に先に当たって、サブスキル 10 でも EX レベル 5 で
    // 判定していた。ホシノ（臨戦）の防御無視が [1,9] の 60% のまま（正しくは [10,10] の 85%）で
    // ×1.64 の過小（2026-09-02、Plana の調査。同じ印は 10055・10099・10113）
    if (m[1] === 'ExtraPassive') { lv = sl.sslv || 10; }
    else if (m[1] === 'Passive') { lv = sl.plv || 10; }
    else if (/^Ex\d*$/.test(m[1])) { lv = sl.ex || 5; }
    else if (/^(Public|Normal|GearPublic)$/.test(m[1])) { lv = sl.sk || 10; }
    if (lv != null) { return lv >= +m[2] && lv <= +m[3]; }
  }
  return true;
}
/** **「N人以下」「N〜M人」「N人以上」の候補**（2026-09-04）。
    `[下限, 上限]` を返す。その形でなければ `null`。

    **これは好みではなく盤の話。**スキル文が「円形範囲内の敵の数によって」と
    書いていて、当たる数は TL に入れてある（`u.mc`）ので、**データから決まる。**
    持っているのは 3 人だけ（`dmgalt` の条件を全部数えた）:

        10146 マコト（水着）  ['2人以下', '3人以上']
        20033 ??            ['4人以下', '5人～9人', '10人以上']
        20046 ??            ['3人以下', '4～6人', '7人以上']

    **これを決めていなかったので、マコト（水着）は 6 体に当てても
    「2人以下」の 321% で出ていた**（正しくは「3人以上」の 762%。2.37 倍）。
    屋内ペロロジラの「道具が実測のおよそ半分」の主犯がこれ */
export function nRange(c) {
  var t = String(c || '').replace(/\s/g, '');
  var m = /^(\d+)人以下$/.exec(t);
  if (m) { return [0, +m[1]]; }
  m = /^(\d+)人以上$/.exec(t);
  if (m) { return [+m[1], Infinity]; }
  m = /^(\d+)人?[～~〜-](\d+)人$/.exec(t);
  if (m) { return [+m[1], +m[2]]; }
  return null;
}
export function slotIdxOf(id) {
  for (var i = 0; i < SLOTS; i++) { if (st.slots[i] && st.slots[i].id === id && live(i)) { return i; } }
  return null;
}
/** `tb` は当たる先のステータス（`aimOf` の返り）。**省くとボス本体で判定する。**
    `nb` はその 1 発が当たる数（`u.mc`）。**渡すと「N人以下／N人以上」の候補が
    そこで決まる**（2026-09-04）。渡さなければ今までどおり候補を減らさない */
export function altOf(id, kind, tb, nb, at) {
  var a = ((B.dmgalt || {})[id] || {})[kind];
  if (!(a && a.v && a.v.length)) { return null; }
  var keep = [], i, idx = slotIdxOf(id);
  // **人数で分かれる候補は、当たる数で決める。**全部の候補が人数の形のときだけ
  if (nb > 0 && a.c.length > 1) {
    var rgs = [], ok2 = true;
    for (i = 0; i < a.c.length; i++) {
      var rg = nRange(a.c[i]);
      if (!rg) { ok2 = false; break; }
      rgs.push(rg);
    }
    if (ok2) {
      for (i = 0; i < rgs.length; i++) {
        if (nb >= rgs[i][0] && nb <= rgs[i][1]) {
          return { c: [a.c[i]], v: [a.v[i]], cut: a.v.length - 1, fixed: true };
        }
      }
    }
  }
  for (i = 0; i < a.v.length; i++) { if (condOK(a.c[i], idx, tb, at)) { keep.push(i); } }
  // **1 つも当てはまらないなら、この枠のダメージは出ない。**`condOK` は
  // 決められない条件を true で返すので、ここへ来るのは「全部が決められて、
  // かつ全部外れた」ときだけ（2026-09-03。それまでは候補を丸ごと返していて、
  // サクラコの特殊装甲特攻が装甲の違うボスにも乗っていた）
  if (!keep.length) { return null; }
  // **「スタックが N 個のとき」だけの候補は、既定を「無し」にする**（2026-09-03）。
  // `condOK` は `Type=BuffCount` を判定できないので素通りさせているが、
  // `dmgAt` は候補を必ず 1 つ足すので、**素の行に上乗せする形の候補が
  // 数えっぱなしになる**（ムツキ（正月）の NS は「保有している LittleDevil が
  // 6 個の場合」の 169% が 0 個でも乗って +53.9% だった）。
  // 空の候補を頭に足して、既定を「無し」・選べば「あり」にする。
  // **候補が全部 BuffCount で素の行が無い子（アコ（ドレス））はそのまま**
  // （そちらは候補から 1 つ選ぶのが正しい形で、足すものではない）
  if (keep.length === a.v.length && ((B.dmg[id] || {})[kind] || []).length > 0) {
    var allBc = true;
    for (i = 0; i < a.c.length; i++) {
      if (!/^Type=BuffCount /.test(String(a.c[i] || ''))) { allBc = false; }
    }
    if (allBc) {
      return { c: ['スタック無し'].concat(a.c), v: [[]].concat(a.v) };
    }
  }
  if (keep.length === a.v.length) { return a; }
  var c2 = [], v2 = [];
  for (i = 0; i < keep.length; i++) { c2.push(a.c[keep[i]]); v2.push(a.v[keep[i]]); }
  return { c: c2, v: v2, cut: a.v.length - keep.length };
}
// そのスキル枠に効くレベル。**EX と NS と サブは別の欄**
export function lvlOf(idx, kind) {
  var sl = st.slots[idx] || {};
  if (String(kind).indexOf('Ex') === 0) { return sl.ex || 5; }
  if (kind === 'ExtraPassive') { return sl.sslv || 10; }
  return sl.sk || 10;
}
// **その 1 発の指定が先、無ければ枠の既定**（2026-09-01 の先生の指示
// 「倍率の幅は打つ EX 毎に決めたい」）。`upk` は置いた 1 発の `pk`
export function pickOf(idx, kind, upk, tb, nb) {
  var sl = idx == null ? null : st.slots[idx];
  var a = sl && sl.id ? altOf(sl.id, kind, tb, nb) : null;
  if (!a) { return 0; }
  var v = (upk && upk[kind] != null) ? upk[kind] : (sl && sl.pk ? sl.pk[kind] : 0);
  return Math.max(0, Math.min(+v || 0, a.v.length - 1));
}
// その候補の実質倍率（1/100 %）。**候補の中のダメージ効果を全部足す。**
// `Hits` の配分は合計 10000 なので、足すのは `Scale` だけでいい
export function altScale(id, kind, i, lv, tb) {
  var a = altOf(id, kind, tb);
  if (!a) { return null; }
  var es = a.v[i] || [], sum = 0, k;
  if (!es.length) { return null; }
  for (k = 0; k < es.length; k++) {
    var arr = es[k][0] || [];
    sum += arr[Math.min(lv || 1, arr.length) - 1] || 0;
  }
  return sum;
}
// 編成にいる生徒のうち、幅を持つ（生徒, スキル枠）の一覧
export var ALTK = ['Ex', 'Ex1', 'Ex2', 'Ex3', 'Normal', 'Public', 'GearPublic', 'ExtraPassive'];
export var ALTJA = { Ex: 'EX', Ex1: 'EX 形態2', Ex2: 'EX 形態3', Ex3: 'EX 形態4',
              Normal: '通常攻撃', Public: 'ノーマル', GearPublic: 'ノーマル＋',
              ExtraPassive: 'サブ' };
export function altList() {
  var out = [], i, k;
  for (i = 0; i < SLOTS; i++) {
    var p = st.party[i];
    if (!p) { continue; }
    for (k = 0; k < ALTK.length; k++) {
      var a = altOf(p.id, ALTK[k]);
      if (a && a.v.length > 1) { out.push({ i: i, p: p, kind: ALTK[k], a: a }); }
    }
  }
  return out;
}
