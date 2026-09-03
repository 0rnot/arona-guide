import { S } from './util.js';
import { scen } from './scen.js';
import { clearPartyCalc } from './carry.js';
import { clearStats } from './passive.js';

// ------------------------------------------------------------ 枠とパーティー
// **コストの計算は tools/tl-engine.js に全部ある。**ここでは持たない。
// 枠は engine と同じ並び（0〜5 ストライカー・6〜9 スペシャル）で、
// 使わない後ろの枠は空のまま残す（6 人 ⇄ 10 人で編成が消えない）
export var TE = window.TLENGINE;
export var LAY = TE.LAYOUT, MAIN_MAX = TE.MAIN_MAX;
export var SLOTS = MAIN_MAX + TE.SUP_MAX;
export var _byid = {};
(function () { for (var i = 0; i < S.students.length; i++) { _byid[S.students[i].id] = S.students[i]; } })();

// 1 枠。**engine が読む欄（id / ex / sk / w4 / tier / on）を素で持つ**
export function mkSlot() {
  return { id: null, ex: 5, sk: 10, w4: false, tier: [3, 3, 3, 3, 3, 3], on: true,
           lv: 90, star: 5, eq: 9, wlv: 50, wstar: 3, plv: 10, sslv: 10, gear: 2, bond: 20,
           // **潜在能力（限界突破）。**HP・攻撃・治癒それぞれ 0〜25
           pot: [0, 0, 0],
           // **通常スキルが「味方1人」のとき、その渡し先。**null なら誰にも乗らない
           nsto: null,
           // **条件でダメージが変わるスキルの、選んだ候補。**{ スキル枠: 番号 }
           pk: {},
           // **バフの段（スタック）。**{ スキル枠: 番号 }。0 が 1 段目で、既定
           stk: {} };
}
export function mkParty() {
  var a = [], i;
  for (i = 0; i < SLOTS; i++) { a.push(mkSlot()); }
  // `bst` はボスの状態の窓（部隊ごとに時間軸が 0 から始まるので部隊に持たせる）。
  // `gu` は TL が「ギブアップ」で終わった印（2026-09-02）
  return { slots: a, tl: [], start: [], bst: [], gu: false, end: null };
}
export function live(i) { return TE.live(st.mode, i); }
export function isMain(i) { return i < MAIN_MAX; }

export var st = { bi: 0, di: 0, px: 6, pin: null, mode: 6, pi: 0, parties: [mkParty()],
           grid: 3, filt: { q: '', role: '', bul: '', arm: '', sch: '', sq: '', star: '', sort: 'n' },
           more: false, who: -1, sel: null, wantRow: null, msel: [], lv: 5, mk: [], slv: 5, tab: 0, goal: null,
           // **フェーズは既定で自動**（削った量で移る）。数値を入れると固定
           // `arm` は大決戦の装甲（null なら総力戦の既定）
           // `bst` は「ボスの状態」（被ダメージ率アップなどの窓）
           // `crit` は会心率の差し替え（null なら編成から出る素の値）。
           // **見え方の設定なので `st.scen` と同じく localStorage 側**に置く
           // （2026-09-03 の先生の指示「平均だけ残して、残りは会心率を
           // 自分でバーで調整」）
           phFix: null, scen: null, crit: null, arm: null, bst: [],
           // **タイムラインに出す段の取捨選択**（2026-09-03 の先生の指示
           // 「NS＆通常攻撃の表示非表示を上のグリッド選択の右に追加してほしい／
           //   NSと通常攻撃以外もできるならそうしたい」）。
           // 一覧と既定は `lanes.js`。**見え方の設定**なので localStorage 側
           lanes: {} };
st.slots = st.parties[0].slots;
st.tl = st.parties[0].tl;
st.start = st.parties[0].start;
st.bst = st.parties[0].bst;

// st.party は「枠 → 生徒データ」の読み取り専用の眺め。**中身は st.slots が正本。**
export var _pv = 0, _pcache = null, _pat = -1, _ppi = -1;
export function bump() { _pv++; clearStats(); clearPartyCalc(); _mm = {}; }
// **1 回の描き直しの中で、同じ答えを何度も計算し直さない**（2026-09-03）。
// `total` と `clearStat` は倍率の振り方ごとに回るので、`naTimes`（1 人 1,500 発）と
// `usesSorted` が draw 1 回で 10 回以上引き直されていた。EX 30 発で draw 1 回 9.5 秒。
// 捨てるのは 編成・育成・置いた 1 発（`bump` / `sim` の鍵）と ボス・難易度・装甲（`diff`）が
// 変わったときだけ。**覚えるのは時刻の計算だけで、ダメージの計算は今までどおり**
export var _mm = {}, _mmD = null;
export function memo(k, fn) {
  // **`fn()` の中で `_mm` が作り直されることがある**（`usesSorted0` が呼ぶ
  // `sim()` の `clearMemo()` と `diff()` の `memoOn()`）。
  // `_mm[k] = fn()` と書くと、**代入先は古い `_mm`・読み出しは新しい `_mm`** に
  // なって `undefined` が返る（JS は代入先を先に決めてから右辺を評価する）。
  // これで `dmgCurve0` の `us.length` が落ちていた
  // （2026-09-03、EX をドラッグしたあとの引き直しで
  //  `TypeError: Cannot read properties of undefined (reading 'length')`）。
  // **先に値を受け取って、そのときの `_mm` へ入れる**
  if (!(k in _mm)) {
    var v = fn();
    if (!(k in _mm)) { _mm[k] = v; }
  }
  return _mm[k];
}
Object.defineProperty(st, 'party', { get: function () {
  if (_pat !== _pv || _ppi !== st.pi) {
    _pcache = [];
    for (var i = 0; i < SLOTS; i++) {
      var sl = st.slots[i];
      _pcache.push(sl && sl.id && live(i) ? (_byid[sl.id] || null) : null);
    }
    _pat = _pv; _ppi = st.pi;
  }
  return _pcache;
} });
export function slotOf(i) { return st.slots[i]; }
// **同じ Channel が重なるかは「スキルの枠」で決まる**（LOOP.md 57）。
// 写し元の `common.js:7723` は `{slot: effect.OverrideSlot || Skill.SkillType,
// channel: effect.Channel}` で見ていて、**枠は SchaleDB の SkillType**
// （`Ex` / `Public` / `GearPublic` / `Passive` / `WeaponPassive` / `ExtraPassive`）。
// 道具の `Ex1` `Ex2` … は形態ごとに割った**こちらの都合の名前**で
// （`build-tool-data.py:5463`）、ゲームでは同じ EX の枠。別枠に数えていたので
// イブキ（水着）Ex1 ch111 と ナギサ（水着）Ex ch111 が二重に乗っていた
export function chSlot(slot, ov) { return ov || String(slot).replace(/^Ex\d+$/, 'Ex'); }


// `_mm` は core.js の持ち物。engine.js の `sim()` から捨てるための窓口
export function clearMemo() { _mm = {}; }
// 元は「難易度」の節にあった。`_mm` / `_mmD` を書くのでこちらへ移した
export function memoOn(r) { if (r !== _mmD) { _mmD = r; _mm = {}; } return r; }
