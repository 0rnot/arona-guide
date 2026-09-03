export var B = window.TLBOSS, S = window.TL;
export var $ = function (id) { return document.getElementById(id); };
export function esc(t) {
  return String(t).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}
export function rest(dur, t) {
  var x = Math.max(0, dur - t), m = Math.floor(x / 60), s = x - m * 60;
  return m + ':' + (s < 10 ? '0' : '') + s.toFixed(3);
}
export function mmss(dur, t) {
  var x = Math.max(0, Math.round(dur - t)), m = Math.floor(x / 60), s = x - m * 60;
  return m + ':' + (s < 10 ? '0' : '') + s;
}
export function skName(g) { return (B.skills[g] && B.skills[g].n) || g; }
export function img(id, cls) {
  return '<img class="' + (cls || '') + '" src="../img/student_' + id + '.webp" alt="" loading="lazy">';
}
export function stu(id) {
  for (var i = 0; i < S.students.length; i++) { if (S.students[i].id === id) { return S.students[i]; } }
  return null;
}

// レーンの高さ。**詰めて置く**（2026-09-01 の先生の指示「UI はツメツメでいい」）
// 2026-09-01 の先生の指示「通常攻撃はもっと細くていい／その分スキルのバーを太く」
// `bst`（ボスの状態）は EX / PS と同じ 16。**行を足しても高さは増やさない**
export var H = { axis: 18, name: 16, ex: 16, ps: 16, bst: 16, gg: 18, dbf: 13, rec: 52, cost: 58,
          row: 21, na: 11, ss: 18 };


// 盤の枠。**元は「マウス」の節にあった**が、zoom / キーボード / マウスの
// 3 か所から使うのでここへ上げた（2026-09-03 のモジュール割り）
export var view = $('view');

// ------------------------------------------------------------ バフの段（スタック）
// **`Value` の 2 本目以降は段ごとの値**（`common.js:1219` の `getEffectValue`）。
//   `StackSame` あり … 1 段ぶんの値 × 段数（上限が `StackSame`）
//   なし             … `Value[min(段-1, 本数-1)]`
// データでは 8 番目が「段ごとの Value 全部」、9 番目が `StackSame`。
// **どちらも無い行は今までどおり 4 番目だけ**（段は 1 段しかない）
/** その行の段数（1 なら幅が無い） */
export function rowStk(e) { return (e && (e[9] || (e[8] ? e[8].length : 0))) || 1; }
/** 段 `k`（0 始まり）でのレベル別の値の並びと、掛ける数 */
export function rowVals(e, k) {
  var n = rowStk(e), i = Math.max(0, Math.min(k || 0, n - 1));
  if (e[9]) { return { v: e[3] || [], mul: i + 1 }; }
  if (e[8]) { return { v: e[8][Math.min(i, e[8].length - 1)] || [], mul: 1 }; }
  return { v: e[3] || [], mul: 1 };
}
/** その（生徒, スキル枠）のバフが持ついちばん多い段数 */
export function bufStk(id, kind) {
  var list = ((B.buf || {})[id] || {})[kind] || [], n = 1, q;
  for (q = 0; q < list.length; q++) { n = Math.max(n, rowStk(list[q])); }
  return n;
}
