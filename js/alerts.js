// Alert banners (persistent, keyed) + toasts (transient) + audible/vibrate cue.
import { esc } from './util.js';
import { getSettings } from './store.js';

const active = new Map(); // id -> {level,title,text,action}
const rank = { critical: 3, warn: 2, info: 1 };
let ctx;

function beep() {
  if (!getSettings().sound) return;
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.65);
  } catch { /* audio blocked until user gesture */ }
  try { navigator.vibrate?.([200, 100, 200]); } catch { /* unsupported */ }
}

export function setAlert(id, a) {
  const isNew = !active.has(id);
  const key = [a.level, a.title, a.text, a.action?.label].join('|');
  const prev = active.get(id);
  active.set(id, a);
  if (prev && prev._key === key) { a._key = key; return; } // unchanged: skip re-render (no flicker)
  a._key = key;
  if (isNew && a.level === 'critical') beep();
  render();
}
export function clearAlert(id) { if (active.delete(id)) render(); }
export const hasAlert = (id) => active.has(id);

let handlers = {};
function render() {
  const box = document.getElementById('alerts');
  const list = [...active.entries()].sort((a, b) => rank[b[1].level] - rank[a[1].level]);
  handlers = {};
  box.innerHTML = list
    .slice(0, 3)
    .map(([id, a]) => {
      if (a.action) handlers[id] = a.action.fn;
      return `<div class="alert ${a.level}" role="alert"><svg class="ic"><use href="#i-${a.level === 'info' ? 'info' : 'alert'}"/></svg>
        <div class="alert-t"><b>${esc(a.title)}</b>${a.text ? `<span>${esc(a.text)}</span>` : ''}</div>
        ${a.action ? `<button class="btn sm" data-alert="${esc(id)}">${esc(a.action.label)}</button>` : ''}</div>`;
    })
    .join('');
  if (list.length > 3) box.insertAdjacentHTML('beforeend', `<div class="alert-more">+${list.length - 3} การแจ้งเตือนอื่น</div>`);
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-alert]');
  if (b) handlers[b.dataset.alert]?.();
});

export function toast(msg, kind = 'ok', ms = 3200) {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.setAttribute('role', 'status');
  el.textContent = msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.classList.add('out'), ms);
  setTimeout(() => el.remove(), ms + 300);
}
