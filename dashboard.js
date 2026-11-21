import { h, plate, docChip, plural, emptyState, fmtDate, fmtDay, todayIST, addDays, daysBetween } from './ui.js';

const SHOW_FIRST = 20;

function check(res) {
  if (res.error) throw res.error;
  return res.data;
}

// A long list shows its first rows and a button for the rest.
function limited(rows, renderRow) {
  const ul = h('ul', { class: 'list' });
  const fill = (all) => {
    ul.replaceChildren(...(all ? rows : rows.slice(0, SHOW_FIRST)).map(renderRow));
    if (!all && rows.length > SHOW_FIRST) {
      ul.append(h('li', null, h('button', { class: 'btn small', onclick: () => fill(true) }, `Show all ${rows.length}`)));
    }
  };
  fill(false);
  return ul;
}

function docRow(r) {
  const detail = r.status === 'missing'
    ? 'No record yet'
    : [r.doc_no, r.expires_on ? 'until ' + fmtDate(r.expires_on) : null].filter(Boolean).join(', ');
  return h('li', null,
    h('a', { class: 'row', href: '#/trucks/' + r.truck_id },
      plate(r.truck_no),
      h('div', { class: 'grow' }, h('div', { class: 'title' }, r.doc_name), h('div', { class: 'detail' }, detail)),
      docChip(r)));
}

function group(title, rows, renderRow) {
  if (!rows.length) return null;
  return h('section', null,
    h('div', { class: 'group-title' }, h('h2', null, title), h('span', { class: 'muted' }, plural(rows.length, 'item'))),
    limited(rows, renderRow));
}

export async function dashboardView(ctx) {
  if (ctx.profile.role === 'driver') return driverHome(ctx);

  const office = ['owner', 'manager', 'accountant'].includes(ctx.profile.role);
  const [statusRes, trucksRes, driversRes] = await Promise.all([
    ctx.api.docStatus(), ctx.api.listTrucks(), office ? ctx.api.listDrivers() : Promise.resolve({ data: [], error: null }),
  ]);
  const status = check(statusRes);
  const trucks = check(trucksRes);
  const drivers = check(driversRes);

  const expired = status.filter((r) => r.status === 'expired').sort((a, b) => a.days_left - b.days_left);
  const soon = status.filter((r) => r.status === 'due_soon').sort((a, b) => a.days_left - b.days_left);
  const missing = status.filter((r) => r.status === 'missing').sort((a, b) => a.truck_no.localeCompare(b.truck_no));

  const today = todayIST();
  const licences = drivers
    .filter((d) => d.dl_expiry && d.status !== 'left' && daysBetween(today, d.dl_expiry) <= 30)
    .map((d) => ({ ...d, days_left: daysBetween(today, d.dl_expiry) }))
    .sort((a, b) => a.days_left - b.days_left);

  const nothing = !expired.length && !soon.length && !missing.length && !licences.length;

  const byStatus = {};
  for (const t of trucks) byStatus[t.status] = (byStatus[t.status] || 0) + 1;
  const label = { active: 'active', idle: 'idle', under_repair: 'under repair', sold: 'sold' };
  const fleetLine = trucks.length
    ? `${plural(trucks.length, 'truck')}: ` + Object.entries(byStatus).map(([k, n]) => `${n} ${label[k] || k}`).join(', ') + '.'
    : '';

  const parts = [];
  if (expired.length) parts.push(`${expired.length} expired`);
  if (soon.length) parts.push(`${soon.length} expiring soon`);
  if (missing.length) parts.push(`${missing.length} not recorded`);

  if (!trucks.length) {
    return h('div', { class: 'stack' },
      h('div', { class: 'page-head' }, h('h1', null, 'Welcome')),
      emptyState('No trucks yet', ctx.canWrite ? 'Add your first truck to start tracking documents.' : 'Ask the owner or a manager to add trucks.',
        ctx.canWrite ? h('a', { class: 'btn primary', href: '#/trucks' }, 'Go to trucks') : null));
  }

  return h('div', { class: 'stack' },
    h('div', { class: 'page-head' },
      h('div', null,
        h('h1', null, nothing ? 'All documents are up to date' : 'Documents that need action'),
        h('p', { class: 'sub' }, [parts.length ? parts.join(', ') + '. ' : '', fleetLine].join('')))),
    group('Expired', expired, docRow),
    group('Expiring soon', soon, docRow),
    group('Driving licences', licences, (d) => h('li', null,
      h('a', { class: 'row', href: '#/drivers' },
        h('div', { class: 'grow' }, h('div', { class: 'title' }, d.full_name), h('div', { class: 'detail' }, 'Licence ' + (d.dl_no || '') + ', ' + fmtDate(d.dl_expiry))),
        d.days_left < 0
          ? h('span', { class: 'chip bad' }, `Expired ${plural(-d.days_left, 'day')} ago`)
          : h('span', { class: 'chip warn' }, d.days_left === 0 ? 'Expires today' : `Expires in ${plural(d.days_left, 'day')}`)))),
    group('Not recorded', missing, docRow));
}

async function driverHome(ctx) {
  const today = todayIST();
  const from = addDays(today, -29);
  const rows = check(await ctx.api.attendanceRange(from, today));
  const count = (s) => rows.filter((r) => r.status === s).length;
  const first = (ctx.profile.full_name || '').split(' ')[0];
  const chipFor = (s) => ({ present: 'good', absent: 'bad', leave: 'warn', half_day: 'warn' }[s] || 'muted');
  const word = { present: 'Present', absent: 'Absent', leave: 'Leave', half_day: 'Half day' };

  return h('div', { class: 'stack' },
    h('div', { class: 'page-head' }, h('div', null,
      h('h1', null, first ? `Hello, ${first}` : 'Hello'),
      h('p', { class: 'sub' }, 'Your attendance for the last 30 days.'))),
    h('div', { class: 'panel' },
      h('p', null, `${count('present')} present, ${count('half_day')} half days, ${count('leave')} on leave, ${count('absent')} absent.`)),
    rows.length
      ? h('ul', { class: 'list' }, rows.map((r) => h('li', { class: 'row' },
        h('div', { class: 'grow title' }, fmtDay(r.att_date)),
        h('span', { class: 'chip ' + chipFor(r.status) }, word[r.status] || r.status))))
      : emptyState('No attendance recorded yet', 'Your supervisor marks attendance each day. It will show up here.'));
}
