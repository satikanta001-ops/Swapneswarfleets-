import { h, plural, emptyState, fmtDate, todayIST, daysBetween, openForm, confirmDialog, toast } from './ui.js';
import { friendlyError } from './api.js';

const STATUS_OPTIONS = [
  { value: 'active', label: 'Working' }, { value: 'on_leave', label: 'On leave' }, { value: 'left', label: 'Left the company' },
];
const STATUS_LABEL = Object.fromEntries(STATUS_OPTIONS.map((o) => [o.value, o.label]));

const driverFields = [
  { name: 'full_name', label: 'Full name', required: true, maxlength: 80, autocomplete: 'off' },
  { name: 'phone', label: 'Phone number', type: 'tel', inputmode: 'tel', maxlength: 15 },
  { name: 'dl_no', label: 'Driving licence number', maxlength: 25, autocapitalize: 'characters' },
  { name: 'dl_expiry', label: 'Licence valid until', type: 'date' },
  { name: 'aadhaar_last4', label: 'Aadhaar, last 4 digits', maxlength: 4, pattern: '[0-9]{4}', inputmode: 'numeric', hint: 'Store only the last 4 digits. Never the full number.' },
  { name: 'join_date', label: 'Joined on', type: 'date' },
  { name: 'bank_account_no', label: 'Bank account number', inputmode: 'numeric', maxlength: 20 },
  { name: 'bank_ifsc', label: 'Bank IFSC code', maxlength: 11, autocapitalize: 'characters' },
  { name: 'status', label: 'Status', type: 'select', required: true, options: STATUS_OPTIONS },
  { name: 'notes', label: 'Notes', type: 'textarea' },
];

export async function driversView(ctx) {
  const res = await ctx.api.listDrivers();
  if (res.error) throw res.error;
  const drivers = res.data;
  const today = todayIST();

  const search = h('input', { type: 'search', placeholder: 'Search by name, phone or licence', 'aria-label': 'Search drivers', autocomplete: 'off' });
  const showLeft = h('input', { type: 'checkbox', id: 'show-left' });
  const list = h('ul', { class: 'list' });
  const count = h('p', { class: 'sub', 'aria-live': 'polite' });

  function licenceChip(d) {
    if (!d.dl_expiry) return h('span', { class: 'chip muted' }, 'Licence date not set');
    const days = daysBetween(today, d.dl_expiry);
    if (days < 0) return h('span', { class: 'chip bad' }, `Licence expired ${plural(-days, 'day')} ago`);
    if (days <= 30) return h('span', { class: 'chip warn' }, days === 0 ? 'Licence expires today' : `Licence expires in ${plural(days, 'day')}`);
    return h('span', { class: 'chip good' }, 'Licence valid until ' + fmtDate(d.dl_expiry));
  }

  async function edit(d) {
    if (!ctx.canWrite) return;
    const saved = await openForm({
      title: d ? 'Edit driver' : 'Add driver', fields: driverFields, values: d || { status: 'active' },
      extra: d ? {
        label: 'Remove driver',
        onClick: async () => {
          const yes = await confirmDialog({
            title: 'Remove this driver?', message: `${d.full_name} will disappear from the lists. Their past attendance is kept. If they simply left, set the status to "Left the company" instead.`,
            confirmLabel: 'Remove driver',
          });
          if (!yes) return { error: 'Not removed.' };
          const r = await ctx.api.removeDriver(d.id);
          if (r.error) return { error: friendlyError(r.error) };
          toast('Driver removed');
        },
      } : null,
      onSubmit: async (values) => {
        const r = await ctx.api.saveDriver(values, d ? d.id : undefined);
        if (r.error) return { error: friendlyError(r.error) };
      },
    });
    if (saved) ctx.rerender();
  }

  function render() {
    const q = search.value.trim().toUpperCase();
    const rows = drivers.filter((d) =>
      (showLeft.checked || d.status !== 'left') &&
      (!q || d.full_name.toUpperCase().includes(q) || (d.phone || '').includes(q) || (d.dl_no || '').toUpperCase().includes(q)));
    count.textContent = plural(rows.length, 'driver');
    list.replaceChildren(...rows.map((d) => {
      const body = [
        h('div', { class: 'grow' },
          h('div', { class: 'title' }, d.full_name),
          h('div', { class: 'detail' }, [d.phone, d.dl_no ? 'Licence ' + d.dl_no : null].filter(Boolean).join(', ') || 'No contact details')),
        d.status !== 'active' ? h('span', { class: 'chip muted' }, STATUS_LABEL[d.status]) : null,
        licenceChip(d),
      ];
      return h('li', null, ctx.canWrite
        ? h('button', { class: 'row', onclick: () => edit(d) }, body)
        : h('div', { class: 'row' }, body));
    }));
    if (!rows.length) {
      list.replaceChildren(h('li', null, emptyState(drivers.length ? 'No drivers match' : 'No drivers yet',
        drivers.length ? 'Try a different search.' : (ctx.canWrite ? 'Add your first driver.' : ''))));
    }
  }
  search.addEventListener('input', render);
  showLeft.addEventListener('change', render);
  render();

  return h('div', { class: 'stack' },
    h('div', { class: 'page-head' },
      h('div', null, h('h1', null, 'Drivers'), count),
      ctx.canWrite ? h('button', { class: 'btn primary', onclick: () => edit(null) }, 'Add driver') : null),
    h('div', { class: 'toolbar' }, search,
      h('label', { class: 'cluster', for: 'show-left' }, showLeft, 'Show drivers who left')),
    list);
}
