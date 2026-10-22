// Modal dialogs and the full-screen status overlay.
import { esc } from './util.js';
import { $ } from './app.js';

/** body: trusted HTML string. onOk(dlg) may return false to keep the dialog open. Resolves value or null. */
export function modal({ title, body = '', ok = 'ตกลง', cancel = 'ยกเลิก', danger = false, onOk }) {
  return new Promise((resolve) => {
    const m = $('#modal');
    m.hidden = false;
    m.innerHTML = `<div class="dlg" role="dialog" aria-modal="true" aria-label="${esc(title)}"><h3>${esc(title)}</h3>${body}
      <div class="acts">${cancel ? `<button class="btn" data-m="cancel">${esc(cancel)}</button>` : ''}<button class="btn ${danger ? 'danger' : 'primary'}" data-m="ok">${esc(ok)}</button></div></div>`;
    const close = (v) => { m.hidden = true; m.innerHTML = ''; m.onclick = null; resolve(v); };
    m.onclick = (e) => {
      const b = e.target.closest('[data-m]');
      if (e.target === m || b?.dataset.m === 'cancel') return close(null);
      if (b?.dataset.m === 'ok') {
        const v = onOk ? onOk(m.querySelector('.dlg')) : true;
        if (v !== false) close(v);
      }
    };
    m.querySelector('input[type=text],textarea')?.focus();
  });
}

export const confirmDlg = (title, message, okLabel = 'ลบ') =>
  modal({ title, body: `<p class="sub">${esc(message)}</p>`, ok: okLabel, danger: true }).then(Boolean);

/** Full-screen status card (permission, errors). Pass null to hide. actions: [{label,cls,fn}] */
export function overlay(card) {
  const o = $('#overlay');
  if (!card) { o.classList.add('gone'); return; }
  o.classList.remove('gone');
  if (card.loading) { o.innerHTML = `<div class="spinner"></div><p>${esc(card.loading)}</p>`; return; }
  o.innerHTML = `<div class="card"><h2>${esc(card.title)}</h2><p class="sub">${card.html || esc(card.text)}</p>
    <div class="row wrap" style="margin-top:12px">${card.actions.map((a, i) => `<button class="btn ${a.cls || ''} grow" data-oa="${i}">${esc(a.label)}</button>`).join('')}</div></div>`;
  o.onclick = (e) => { const b = e.target.closest('[data-oa]'); if (b) card.actions[+b.dataset.oa].fn(); };
}
