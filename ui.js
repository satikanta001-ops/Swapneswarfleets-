// Small UI helpers. No innerHTML anywhere: data is always added as text, so a
// truck note or driver name can never inject markup.

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  add(el, kids);
  return el;
}

function add(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICONS = {
  home: 'M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  truck: 'M2 6h11v9H2zM13 9h4l3 3v3h-7zM6 18.5a1.8 1.8 0 1 0 0-.01M17 18.5a1.8 1.8 0 1 0 0-.01',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0z',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v5M16 3v5',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2 20a7 7 0 0 1 14 0zM16 4.3a3.5 3.5 0 0 1 0 6.4M18 14a7 7 0 0 1 4 6h-4',
};
export function icon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', ICONS[name] || '');
  svg.append(path);
  return svg;
}

// ---------- dates (India time) ----------
export function todayIST() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}
export function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function daysBetween(fromIso, toIso) {
  return Math.round((new Date(toIso + 'T00:00:00Z') - new Date(fromIso + 'T00:00:00Z')) / 86400000);
}
export function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
export function fmtDay(iso) {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}
export function plural(n, one, many) {
  return `${n} ${Math.abs(n) === 1 ? one : (many || one + 's')}`;
}

// ---------- domain bits ----------
export function plate(no, big) {
  const m = /^([A-Z]{2})(\d{1,2})([A-Z]{1,3})(\d{4})$/.exec(no || '');
  const text = m ? `${m[1]} ${m[2]} ${m[3]} ${m[4]}` : (no || '');
  return h('span', { class: 'plate' + (big ? ' big' : ''), 'aria-label': 'Registration ' + (no || '') }, text);
}

// status values come from the database view: missing | expired | due_soon | ok | no_expiry
export function docChip(row) {
  switch (row.status) {
    case 'expired': return h('span', { class: 'chip bad' }, row.days_left === -1 ? 'Expired yesterday' : `Expired ${plural(-row.days_left, 'day')} ago`);
    case 'due_soon': return h('span', { class: 'chip warn' }, row.days_left === 0 ? 'Expires today' : `Expires in ${plural(row.days_left, 'day')}`);
    case 'missing': return h('span', { class: 'chip bad' }, 'Not recorded');
    case 'no_expiry': return h('span', { class: 'chip muted' }, 'No expiry date');
    default: return h('span', { class: 'chip good' }, `Valid until ${fmtDate(row.expires_on)}`);
  }
}

// ---------- toasts ----------
export function toast(message, kind) {
  const box = document.getElementById('toasts');
  const el = h('div', { class: 'toast' + (kind === 'bad' ? ' bad' : '') }, message);
  box.append(el);
  setTimeout(() => el.remove(), kind === 'bad' ? 6000 : 2800);
}

// ---------- dialogs ----------
// fields: [{ name, label, type, required, options, hint, maxlength, pattern, inputmode, step, min, autocomplete }]
// Resolves when the dialog closes: 'saved', 'extra' (the extra button succeeded) or false.
// onSubmit(values) returns { error } to keep it open.
export function openForm({ title, fields, values = {}, submitLabel = 'Save', onSubmit, extra }) {
  return new Promise((resolve) => {
    const dlg = h('dialog', { 'aria-labelledby': 'dlg-title' });
    const errorBox = h('div', { class: 'form-error', role: 'alert', hidden: true });
    const inputs = {};

    const fieldEls = fields.map((f) => {
      const id = 'f-' + f.name;
      let input;
      const cur = values[f.name] ?? f.default ?? '';
      if (f.type === 'select') {
        input = h('select', { id, name: f.name, required: f.required },
          (f.required ? [] : [h('option', { value: '' }, 'Not set')]),
          f.options.map((o) => h('option', { value: o.value, selected: String(o.value) === String(cur) }, o.label)));
      } else if (f.type === 'textarea') {
        input = h('textarea', { id, name: f.name, maxlength: f.maxlength || 500 }, cur);
      } else {
        input = h('input', {
          id, name: f.name, type: f.type || 'text', required: f.required, value: cur,
          maxlength: f.maxlength, pattern: f.pattern, inputmode: f.inputmode, step: f.step, min: f.min,
          autocomplete: f.autocomplete || 'off', autocapitalize: f.autocapitalize,
        });
      }
      inputs[f.name] = input;
      return h('div', { class: 'field' },
        h('label', { for: id }, f.label + (f.required ? '' : ' (optional)')),
        input,
        f.hint ? h('span', { class: 'hint' }, f.hint) : null);
    });

    const submit = h('button', { type: 'submit', class: 'btn primary' }, submitLabel);
    const cancel = h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'Cancel');

    const form = h('form', { method: 'dialog', novalidate: false },
      h('h2', { id: 'dlg-title' }, title),
      errorBox,
      h('div', { class: 'form-grid' + (fields.length > 4 ? ' two' : '') }, fieldEls),
      h('div', { class: 'actions' },
        extra ? h('button', {
          type: 'button', class: 'btn danger spacer',
          onclick: async () => {
            const res = await extra.onClick();
            if (res && res.error) showError(res.error); else dlg.close('extra');
          },
        }, extra.label) : null,
        cancel, submit));

    function showError(msg) { errorBox.textContent = msg; errorBox.hidden = false; }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorBox.hidden = true;
      const out = {};
      for (const f of fields) {
        const raw = inputs[f.name].value.trim();
        if (raw === '') out[f.name] = null;
        else if (f.type === 'number') out[f.name] = Number(raw);
        else out[f.name] = raw;
      }
      submit.disabled = true;
      submit.textContent = 'Saving…';
      try {
        const res = await onSubmit(out);
        if (res && res.error) { showError(res.error); return; }
        dlg.close('saved');
      } finally {
        submit.disabled = false;
        submit.textContent = submitLabel;
      }
    });

    dlg.append(form);
    dlg.addEventListener('close', () => {
      const rv = dlg.returnValue;
      dlg.remove();
      resolve(rv === 'saved' || rv === 'extra' ? rv : false);
    });
    document.body.append(dlg);
    dlg.showModal();
    const first = dlg.querySelector('input, select, textarea');
    if (first) first.focus();
  });
}

export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = true }) {
  return new Promise((resolve) => {
    const dlg = h('dialog', { 'aria-labelledby': 'dlg-title' });
    dlg.append(h('form', { method: 'dialog' },
      h('h2', { id: 'dlg-title' }, title),
      h('p', null, message),
      h('div', { class: 'actions' },
        h('button', { type: 'submit', value: 'no', class: 'btn' }, 'Cancel'),
        h('button', { type: 'submit', value: 'yes', class: 'btn ' + (danger ? 'danger' : 'primary') }, confirmLabel))));
    dlg.addEventListener('close', () => { const yes = dlg.returnValue === 'yes'; dlg.remove(); resolve(yes); });
    document.body.append(dlg);
    dlg.showModal();
  });
}

export function emptyState(title, text, action) {
  return h('div', { class: 'empty' }, h('strong', null, title), text ? h('p', null, text) : null, action || null);
}
