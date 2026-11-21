// Vehicle document types and the expiry status of each document.
// Pure functions, no browser or database needed, so they are easy to test.
//
// Each truck record keeps `docs_latest`: for every document type, the entry with
// the latest expiry ({ document_id, doc_no, expires_on }). The dashboard reads only
// the trucks, never the whole document history, which keeps it fast and cheap.

import { daysBetween } from './ui.js';

export const DOC_TYPES = [
  { code: 'RC', name: 'Registration Certificate (RC)', required: true, applies_to: 'all', reminder_days: 60, sort_order: 10 },
  { code: 'INSURANCE', name: 'Insurance', required: true, applies_to: 'all', reminder_days: 30, sort_order: 20 },
  { code: 'FITNESS', name: 'Fitness Certificate', required: true, applies_to: 'all', reminder_days: 30, sort_order: 30 },
  { code: 'ROAD_TAX', name: 'Road Tax', required: true, applies_to: 'all', reminder_days: 30, sort_order: 40 },
  { code: 'PERMIT', name: 'Permit', required: true, applies_to: 'all', reminder_days: 30, sort_order: 50 },
  { code: 'PUC', name: 'Pollution (PUC)', required: true, applies_to: 'all', reminder_days: 15, sort_order: 60 },
  { code: 'NATIONAL_PERMIT', name: 'National Permit', required: true, applies_to: 'national', reminder_days: 30, sort_order: 70 },
];

// The entry with the latest expiry wins. An entry without an expiry date comes last.
// Among equal expiry dates the newest entry wins (a not-yet-saved entry has no created_at, so it counts as newest).
export function latestEntry(rows) {
  const sorted = [...rows].sort((a, b) =>
    (b.expires_on || '').localeCompare(a.expires_on || '')
    || String(b.created_at || '~').localeCompare(String(a.created_at || '~')));
  const top = sorted[0];
  return top ? { document_id: top.id, doc_no: top.doc_no ?? null, expires_on: top.expires_on ?? null } : null;
}

// One row per (truck, document that is required or recorded), same shape the screens always used.
// status: missing | expired | due_soon | ok | no_expiry
export function statusRows(trucks, today) {
  const out = [];
  for (const t of trucks) {
    if (t.deleted_at || t.status === 'sold') continue;
    const latest = t.docs_latest || {};
    for (const ty of DOC_TYPES) {
      const l = latest[ty.code] || null;
      const needed = ty.required && (ty.applies_to === 'all' || ty.applies_to === t.vehicle_class);
      if (!needed && !l) continue;
      const days = l && l.expires_on ? daysBetween(today, l.expires_on) : null;
      let status = 'ok';
      if (!l) status = 'missing';
      else if (days === null) status = 'no_expiry';
      else if (days < 0) status = 'expired';
      else if (days <= ty.reminder_days) status = 'due_soon';
      out.push({
        truck_id: t.id, truck_no: t.truck_no, doc_type: ty.code, doc_name: ty.name, sort_order: ty.sort_order,
        document_id: l ? l.document_id : null, doc_no: l ? l.doc_no : null, expires_on: l ? l.expires_on : null,
        days_left: days, status,
      });
    }
  }
  return out;
}
