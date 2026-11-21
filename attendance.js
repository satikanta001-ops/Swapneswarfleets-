import { h, plural, emptyState, fmtDay, todayIST, addDays, toast } from './ui.js';
import { friendlyError } from './api.js';

const OPTIONS = [
  { value: 'present', label: 'Present' }, { value: 'absent', label: 'Absent' },
  { value: 'leave', label: 'Leave' }, { value: 'half_day', label: 'Half day' },
];

export async function attendanceView(ctx) {
  const today = todayIST();
  let date = today;

  const dateInput = h('input', { type: 'date', max: today, value: date, 'aria-label': 'Date' });
  const summary = h('p', { class: 'sub', 'aria-live': 'polite' });
  const list = h('ul', { class: 'list' });
  const markAll = h('button', { class: 'btn' }, 'Mark unmarked as present');
  const prev = h('button', { class: 'btn', 'aria-label': 'Previous day' }, 'Previous');
  const next = h('button', { class: 'btn', 'aria-label': 'Next day' }, 'Next');

  const dres = await ctx.api.listDrivers();
  if (dres.error) throw dres.error;
  const drivers = dres.data.filter((d) => d.status !== 'left');
  let marks = new Map();   // driver_id -> status

  async function load() {
    list.replaceChildren(h('li', { class: 'spinner' }, 'Loading…'));
    const res = await ctx.api.attendanceFor(date);
    if (res.error) { list.replaceChildren(h('li', { class: 'form-error' }, friendlyError(res.error))); return; }
    marks = new Map(res.data.map((a) => [a.driver_id, a.status]));
    draw();
  }

  function draw() {
    const counts = { present: 0, absent: 0, leave: 0, half_day: 0 };
    for (const d of drivers) { const s = marks.get(d.id); if (s) counts[s] += 1; }
    const unmarked = drivers.length - [...drivers].filter((d) => marks.has(d.id)).length;
    summary.textContent = `${fmtDay(date)}: ${counts.present} present, ${counts.half_day} half day, ${counts.leave} on leave, ${counts.absent} absent, ${unmarked} not marked.`;
    markAll.hidden = !ctx.canWrite || unmarked === 0;
    next.disabled = date >= today;

    if (!drivers.length) { list.replaceChildren(h('li', null, emptyState('No drivers yet', 'Add drivers first, then mark their attendance here.'))); return; }

    list.replaceChildren(...drivers.map((d) => {
      const current = marks.get(d.id);
      const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Attendance for ' + d.full_name },
        OPTIONS.map((o) => h('button', {
          type: 'button', 'data-status': o.value, 'aria-pressed': String(current === o.value), disabled: !ctx.canWrite,
          onclick: () => mark(d, o.value),
        }, o.label)));
      return h('li', { class: 'row att-row' },
        h('div', { class: 'grow' }, h('div', { class: 'title' }, d.full_name), d.status === 'on_leave' ? h('div', { class: 'detail' }, 'Marked on leave in the driver list') : null),
        seg);
    }));
  }

  async function mark(d, status) {
    const before = marks.get(d.id);
    if (before === status) return;
    marks.set(d.id, status);
    draw();
    const res = await ctx.api.setAttendance({ driver_id: d.id, profile_id: d.profile_id ?? null, att_date: date, status });
    if (res.error) {
      if (before) marks.set(d.id, before); else marks.delete(d.id);
      draw();
      toast(friendlyError(res.error), 'bad');
    }
  }

  markAll.addEventListener('click', async () => {
    const rows = drivers.filter((d) => !marks.has(d.id)).map((d) => ({ driver_id: d.id, profile_id: d.profile_id ?? null, att_date: date, status: 'present' }));
    markAll.disabled = true;
    const res = await ctx.api.setAttendanceBulk(rows);
    markAll.disabled = false;
    if (res.error) { toast(friendlyError(res.error), 'bad'); return; }
    for (const r of rows) marks.set(r.driver_id, 'present');
    draw();
    toast(plural(rows.length, 'driver') + ' marked present');
  });

  function setDate(v) {
    if (!v || v > today) return;
    date = v;
    dateInput.value = v;
    load();
  }
  dateInput.addEventListener('change', () => setDate(dateInput.value));
  prev.addEventListener('click', () => setDate(addDays(date, -1)));
  next.addEventListener('click', () => setDate(addDays(date, 1)));

  await load();
  return h('div', { class: 'stack' },
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Attendance'), summary)),
    h('div', { class: 'toolbar datebar' }, prev, dateInput, next),
    markAll,
    list);
}
