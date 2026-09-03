import { $ } from './util.js';

// ------------------------------------------------------------ 吹き出し
// **標準の `title` はカーソルの真下に出るので、大きいカーソルだと隠れる**
// （2026-09-03 の先生の指摘「カーソルに被ってポップアップが見えない」。
//  写真では「コストで指定」の吹き出しがカーソルの絵で潰れていた）。
// `title` を預かって自前の枠で出し、**カーソルから離した位置に置く。**
// 中身は今までどおり `title` に書けばよく、書き足す場所は増えない
var TIP = null, HOLD = null, HELD = '';
var DX = 22, DY = 26;   // カーソルの右下は避けて、右上へ

function box() {
  if (!TIP) {
    TIP = document.createElement('div');
    TIP.className = 'tipbox';
    TIP.hidden = true;
    document.body.appendChild(TIP);
  }
  return TIP;
}
function place(x, y) {
  var t = box(), w = t.offsetWidth, h = t.offsetHeight;
  var left = x + DX, top = y - h - DY;
  if (left + w > window.innerWidth - 6) { left = x - w - DX; }
  if (left < 6) { left = 6; }
  if (top < 6) { top = y + DY; }
  t.style.left = Math.round(left) + 'px';
  t.style.top = Math.round(top + window.scrollY) + 'px';
}
function show(el, x, y) {
  var s = el.getAttribute('title');
  if (s == null || !s.trim()) { return; }
  hide();
  HOLD = el; HELD = s;
  el.removeAttribute('title');     // 標準の吹き出しを止める
  var t = box();
  t.textContent = s;
  t.hidden = false;
  place(x, y);
}
function hide() {
  if (HOLD) {
    // **預かった文字は必ず返す。**返さないと次から吹き出しが出なくなる
    if (HOLD.isConnected && !HOLD.getAttribute('title')) { HOLD.setAttribute('title', HELD); }
    HOLD = null; HELD = '';
  }
  if (TIP) { TIP.hidden = true; }
}
export function wireTip() {
  var app = $('tlapp') || document.querySelector('.tlapp');
  if (!app) { return; }
  app.addEventListener('mouseover', function (e) {
    var el = e.target.closest('[title]');
    if (!el || el === HOLD) { return; }
    show(el, e.clientX, e.clientY);
  });
  app.addEventListener('mousemove', function (e) {
    if (HOLD && TIP && !TIP.hidden) { place(e.clientX, e.clientY); }
  });
  app.addEventListener('mouseout', function (e) {
    if (!HOLD) { return; }
    if (e.relatedTarget && HOLD.contains(e.relatedTarget)) { return; }
    hide();
  });
  // **押したら消す。**押した先が描き直されると、預かったままの札が消える
  app.addEventListener('mousedown', hide);
  window.addEventListener('scroll', hide, true);
  window.addEventListener('blur', hide);
}
