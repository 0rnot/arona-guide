import { $ } from './util.js';
import { bump, st } from './core.js';
import { draw } from './draw.js';
import { drawCrew, drawParty, drawPicker, fillBuild } from './left.js';
import { drawBstate } from './bossui.js';

// ------------------------------------------------------------ 元に戻す・進む
// **Ctrl+Z / Ctrl+Y。**編成・育成・置いたスキル・マーカーを丸ごと覚える
// **mark() は「変える直前」に呼ぶ。**そのときの状態をそのまま UNDO に積む
export var UNDO = [], REDO = [];
export function uState() {
  return JSON.stringify({ mode: st.mode, pi: st.pi, parties: st.parties, mk: st.mk, goal: st.goal });
}
export function mark() {
  var now = uState();
  if (UNDO.length && UNDO[UNDO.length - 1] === now) { return; }
  UNDO.push(now);
  if (UNDO.length > 80) { UNDO.shift(); }
  REDO.length = 0;
  syncUndo();
}
export function uApply(js) {
  var o = JSON.parse(js);
  st.mode = o.mode === 10 ? 10 : 6;
  st.parties = o.parties; st.pi = Math.min(o.pi, o.parties.length - 1);
  st.mk = o.mk; st.goal = o.goal;
  usePartyRef(); st.sel = null; st.who = -1; bump();
  fillBuild(); drawParty(); drawBstate(); drawCrew(); drawPicker(); draw();
  syncUndo();
}
export function undo() {
  if (!UNDO.length) { return; }
  REDO.push(uState()); uApply(UNDO.pop());
}
export function redo() {
  if (!REDO.length) { return; }
  UNDO.push(uState()); uApply(REDO.pop());
}
export function syncUndo() {
  var a = $('b-undo'), b2 = $('b-redo');
  if (a) { a.disabled = !UNDO.length; }
  if (b2) { b2.disabled = !REDO.length; }
}
export function usePartyRef() {
  var p = st.parties[st.pi];
  st.slots = p.slots; st.tl = p.tl; st.start = p.start;
  if (!p.bst) { p.bst = []; }
  st.bst = p.bst;
}
