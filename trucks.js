import { h, plate, docChip, plural, emptyState, fmtDate, openForm, confirmDialog, toast } from './ui.js';
import { friendlyError } from './api.js';

const CLASS_OPTIONS = [{ value: 'domestic', label: 'Domestic' }, { value: 'national', label: 'National permit' }];
const OWNERSHIP_OPTIONS = [{ value: 'owned', label: 'Owned' }, { value: 'attached', label: 'Attached' }, { value: 'leased', label: 'Leased' }];
const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' }, { value: 'idle', label: 'Idle' },
  { value: 'under_repair', label: 'Under repair' }, { value: 'sold', label: 'Sold' },
];
const STATUS_LABEL = Object.fromEntries(STATUS_OPTIONS.map((o) => [o.value, o.label]));
const CLASS_LABEL = Object.fromEntries(CLASS_OPTIONS.map((o) => [o.value, o.label]));

function check(res) {
  if (res.error) throw res.error;
  return res.data;
}

const truckFields = [
  { name: 'truck_no', label: 'Registration number', required: true, maxlength: 20, autocapitalize: 'characters', hint: 'Spaces and dashes are removed. Example: OD05AB1234' },
  { name: 'make_model', label: 'Make and model', maxlength: 60 },
  { name: 'vehicle_class', label: 'Permit type', type: 'select', required: true, options: CLASS_OPTIONS },
  { name: 'capacity_tons', label: 'Capacity (tonnes)', type: 'number', step: '0.5', min: '1', inputmode: 'decimal' },
  { name: 'ownership', label: 'Ownership', type: 'select', required: true, options: OWNERSHIP_OPTIONS },
  { name: 'status', label: 'Status', type: 'select', required: true, options: STATUS_OPTIONS },
  { name: 'notes', label: 'Notes', type: 'textarea' },
];

// ---------------------------------------------------------------- list
export async function trucksView(ctx) {
  const [trucks, status] = await Promise.all([ctx.api.listTrucks().then(check), ctx.api.docStatus().then(check)]);

  const tally = new Map();
  for (const r of status) {
    const t = tally.get(r.truck_id) || { expired: 0, due_soon: 0, missing: 0 };
    if (r.status in t) t[r.status] += 1;
    tally.set(r.truck_id, t);
  }

  const search = h('input', { type: 'search', placeholder: 'Search by number or model', 'aria-label': 'Search trucks', autocomplete: 'off' });
  const filter = h('select', { 'aria-label': 'Filter by status' },
    h('option', { value: '' }, 'All statuses'),
    STATUS_OPTIONS.map((o) => h('option', { value: o.value }, o.label)));
  const list = h('ul', { class: 'list' });
  const count = h('p', { class: 'sub', 'aria-live': 'polite' });

  function render() {
    const q = search.value.replace(/[^A-Za-z0-9 ]/g, '').toUpperCase();
    const qCompact = q.replace(/ /g, '');
    const rows = trucks.filter((t) =>
      (!filter.value || t.status === filter.value) &&
      (!q || t.truck_no.includes(qCompact) || (t.make_model || '').toUpperCase().includes(q)));
    count.textContent = plural(rows.length, 'truck') + (rows.length === trucks.length ? '' : ` of ${trucks.length}`);
    list.replaceChildren(...rows.map((t) => {
      const c = tally.get(t.id) || {};
      return h('li', null, h('a', { class: 'row', href: '#/trucks/' + t.id },
        plate(t.truck_no),
        h('div', { class: 'grow' },
          h('div', { class: 'title' }, t.make_model || 'Model not set'),
          h('div', { class: 'detail' }, [t.capacity_tons ? t.capacity_tons + ' t' : null, CLASS_LABEL[t.vehicle_class]].filter(Boolean).join(', '))),
        t.status !== 'active' ? h('span', { class: 'chip muted' }, STATUS_LABEL[t.status]) : null,
        c.expired ? h('span', { class: 'chip bad' }, `${c.expired} expired`) : null,
        c.due_soon ? h('span', { class: 'chip warn' }, `${c.due_soon} expiring`) : null,
        c.missing ? h('span', { class: 'chip bad' }, `${c.missing} not recorded`) : null));
    }));
    if (!rows.length) {
      list.replaceChildren(h('li', null, emptyState(trucks.length ? 'No trucks match' : 'No trucks yet',
        trucks.length ? 'Try a different number or clear the filter.' : (ctx.canWrite ? 'Add your first truck.' : 'Ask the owner or a manager to add trucks.'))));
    }
  }
  search.addEventListener('input', render);
  filter.addEventListener('change', render);
  render();

  async function addTruck() {
    let createdId = null;
    const saved = await openForm({
      title: 'Add truck', fields: truckFields, values: { vehicle_class: 'domestic', ownership: 'owned', status: 'active' },
      onSubmit: async (values) => {
        const res = await ctx.api.saveTruck(values);
        if (res.error) return { error: friendlyError(res.error) };
        createdId = res.data.id;
      },
    });
    if (saved) { toast('Truck added'); ctx.nav('/trucks/' + createdId); }
  }

  return h('div', { class: 'stack' },
    h('div', { class: 'page-head' },
      h('div', null, h('h1', null, 'Trucks'), count),
      ctx.canWrite ? h('button', { class: 'btn primary', onclick: addTruck }, 'Add truck') : null),
    h('div', { class: 'toolbar' }, search, filter),
    list);
}

// ---------------------------------------------------------------- detail
export async function truckDetailView(ctx, id) {
  const truck = check(await ctx.api.getTruck(id));
  if (!truck) {
    return h('div', { class: 'stack' }, h('a', { class: 'back', href: '#/trucks' }, 'Back to trucks'),
      emptyState('Truck not found', 'It may have been removed.'));
  }
  const [status, docs, types] = await Promise.all([
    ctx.api.docStatus({ truckId: id }).then(check), ctx.api.listDocuments(id).then(check), ctx.api.listDocumentTypes().then(check),
  ]);
  const typeName = Object.fromEntries(types.map((t) => [t.code, t.name]));

  async function editTruck() {
    const saved = await openForm({
      title: 'Edit truck', fields: truckFields, values: truck,
      extra: ctx.canWrite ? {
        label: 'Remove truck',
        onClick: async () => {
          const yes = await confirmDialog({ title: 'Remove this truck?', message: `${truck.truck_no} will disappear from the lists. Its history is kept.`, confirmLabel: 'Remove truck' });
          if (!yes) return { error: 'Not removed.' };
          const res = await ctx.api.removeTruck(id);
          if (res.error) return { error: friendlyError(res.error) };
          toast('Truck removed');
          ctx.nav('/trucks');
        },
      } : null,
      onSubmit: async (values) => {
        const res = await ctx.api.saveTruck(values, id);
        if (res.error) return { error: friendlyError(res.error) };
      },
    });
    if (saved === 'saved') { toast('Truck saved'); ctx.rerender(); }
  }

  async function recordDocument(docType) {
    const saved = await openForm({
      title: docType ? `Record ${typeName[docType] || 'document'}` : 'Record document',
      submitLabel: 'Save document',
      fields: [
        { name: 'doc_type', label: 'Document', type: 'select', required: true, options: types.map((t) => ({ value: t.code, label: t.name })) },
        { name: 'doc_no', label: 'Document number', maxlength: 60 },
        { name: 'issued_on', label: 'Issued on', type: 'date' },
        { name: 'expires_on', label: 'Valid until', type: 'date' },
        { name: 'remarks', label: 'Remarks', type: 'textarea' },
      ],
      values: { doc_type: docType || '' },
      onSubmit: async (values) => {
        const res = await ctx.api.saveDocument({ ...values, truck_id: id });
        if (res.error) return { error: friendlyError(res.error) };
      },
    });
    if (saved) { toast('Document saved'); ctx.rerender(); }
  }

  async function removeDoc(d) {
    const yes = await confirmDialog({
      title: 'Remove this entry?', message: `${typeName[d.doc_type] || 'Document'} ${d.doc_no || ''} will be removed from the history. Use this only for mistakes. To renew a document, add a new entry instead.`,
      confirmLabel: 'Remove entry',
    });
    if (!yes) return;
    const res = await ctx.api.removeDocument(d.id);
    if (res.error) { toast(friendlyError(res.error), 'bad'); return; }
    toast('Entry removed');
    ctx.rerender();
  }

  const kv = (k, v) => v ? [h('dt', null, k), h('dd', null, v)] : null;

  return h('div', { class: 'stack' },
    h('div', null,
      h('a', { class: 'back', href: '#/trucks' }, 'Back to trucks'),
      h('div', { class: 'page-head' },
        h('div', { class: 'stack-sm' }, plate(truck.truck_no, true), h('p', { class: 'sub' }, truck.make_model || 'Model not set')),
        ctx.canWrite ? h('button', { class: 'btn', onclick: editTruck }, 'Edit truck') : null)),

    h('section', { class: 'panel' },
      h('h2', null, 'Details'),
      h('dl', { class: 'kv' },
        kv('Status', STATUS_LABEL[truck.status]), kv('Permit type', CLASS_LABEL[truck.vehicle_class]),
        kv('Capacity', truck.capacity_tons ? truck.capacity_tons + ' tonnes' : null),
        kv('Ownership', OWNERSHIP_OPTIONS.find((o) => o.value === truck.ownership)?.label), kv('Notes', truck.notes))),

    h('section', { class: 'panel' },
      h('h2', null, 'Documents'),
      status.length
        ? h('ul', { class: 'doc-list' }, status.map((r) => h('li', null,
          h('div', { class: 'what' }, h('strong', null, r.doc_name), h('span', { class: 'muted' }, r.doc_no || (r.status === 'missing' ? 'No record yet' : ''))),
          docChip(r),
          ctx.canWrite ? h('button', { class: 'btn small', onclick: () => recordDocument(r.doc_type) }, r.status === 'missing' ? 'Record' : 'Add renewal') : null)))
        : h('p', { class: 'muted' }, 'No documents are required for this truck.'),
      ctx.canWrite ? h('div', { style: 'margin-top:12px' }, h('button', { class: 'btn small', onclick: () => recordDocument(null) }, 'Record another document')) : null),

    h('section', { class: 'panel' },
      h('h2', null, 'Document history'),
      docs.length
        ? h('ul', { class: 'doc-list' }, docs.map((d) => h('li', null,
          h('div', { class: 'what' },
            h('strong', null, typeName[d.doc_type] || d.doc_type),
            h('span', { class: 'muted' }, [d.doc_no, d.issued_on ? 'from ' + fmtDate(d.issued_on) : null, d.expires_on ? 'until ' + fmtDate(d.expires_on) : null].filter(Boolean).join(', ') || 'No dates')),
          ctx.canWrite ? h('button', { class: 'btn small danger', onclick: () => removeDoc(d), 'aria-label': 'Remove ' + (typeName[d.doc_type] || 'document') + ' entry' }, 'Remove') : null)))
        : h('p', { class: 'muted' }, 'Nothing recorded yet.')));
}
