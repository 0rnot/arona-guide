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
