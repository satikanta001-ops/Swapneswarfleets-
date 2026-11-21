// Demo backend: sample data in memory, no server. Open the app with ?demo.
// It mirrors the database rules that matter for screens (registration
// normalising, duplicate checks, document status) so the UI can be tried and
// tested without a database. Changes vanish on reload.

import { todayIST, addDays, daysBetween } from './ui.js';

const TYPES = [
  { code: 'RC', name: 'Registration Certificate (RC)', required: true, applies_to: 'all', reminder_days: 60, sort_order: 10 },
  { code: 'INSURANCE', name: 'Insurance', required: true, applies_to: 'all', reminder_days: 30, sort_order: 20 },
  { code: 'FITNESS', name: 'Fitness Certificate', required: true, applies_to: 'all', reminder_days: 30, sort_order: 30 },
  { code: 'ROAD_TAX', name: 'Road Tax', required: true, applies_to: 'all', reminder_days: 30, sort_order: 40 },
  { code: 'PERMIT', name: 'Permit', required: true, applies_to: 'all', reminder_days: 30, sort_order: 50 },
  { code: 'PUC', name: 'Pollution (PUC)', required: true, applies_to: 'all', reminder_days: 15, sort_order: 60 },
  { code: 'NATIONAL_PERMIT', name: 'National Permit', required: true, applies_to: 'national', reminder_days: 30, sort_order: 70 },
];

function rng(seed) { let s = seed; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; }
let uid = 1;
const newId = () => 'demo-' + (uid++);

export function createDemoApi(role = 'owner') {
  const rand = rng(42);
  const today = todayIST();
  const roles = ['owner', 'manager', 'accountant', 'store_keeper', 'mechanic', 'driver'];
  const myRole = roles.includes(role) ? role : 'owner';

  // ---- sample data ----
  const districts = ['OD02', 'OD05', 'OD09', 'OD15', 'OD33', 'JH05'];
  const series = ['AB', 'CD', 'BK', 'AE', 'M', 'XY', 'KT'];
  const models = ['Tata Signa 4825', 'BharatBenz 3128C', 'Ashok Leyland 3718', 'Tata Prima 2830', 'Eicher Pro 6049'];
  const trucks = [];
  const documents = [];
  for (let i = 0; i < 18; i++) {
    const d = districts[Math.floor(rand() * districts.length)];
    const s = series[Math.floor(rand() * series.length)];
    const no = d + s + String(1000 + Math.floor(rand() * 8999));
    const t = {
      id: newId(), truck_no: no, make_model: models[i % models.length],
      vehicle_class: i % 4 === 0 ? 'national' : 'domestic',
      capacity_tons: [16, 25, 31][i % 3], ownership: 'owned',
      status: i === 5 ? 'under_repair' : i === 9 ? 'idle' : 'active', notes: null, deleted_at: null,
    };
    trucks.push(t);
    for (const ty of TYPES) {
      if (ty.applies_to === 'national' && t.vehicle_class !== 'national') continue;
      const roll = rand();
      if (roll < 0.08) continue;                                   // never recorded
      let days;
      if (roll < 0.17) days = -Math.floor(2 + rand() * 40);         // expired
      else if (roll < 0.3) days = Math.floor(1 + rand() * 24);      // due soon
      else days = Math.floor(70 + rand() * 280);                    // fine
      documents.push({
        id: newId(), truck_id: t.id, doc_type: ty.code, doc_no: ty.code.slice(0, 3) + '-' + Math.floor(10000 + rand() * 89999),
        issued_on: addDays(today, days - 365), expires_on: addDays(today, days), remarks: null, deleted_at: null,
        created_at: new Date().toISOString(),
      });
    }
  }

  const names = ['Ramesh Behera', 'Sanjay Nayak', 'Prakash Das', 'Bijay Mohanty', 'Santosh Sahu', 'Dillip Jena', 'Anil Pradhan', 'Mohan Patra'];
  const drivers = names.map((n, i) => ({
    id: newId(), profile_id: i === 0 ? 'demo-me' : null, full_name: n, phone: '98' + String(10000000 + Math.floor(rand() * 89999999)),
    dl_no: 'OD01' + (2019000 + i * 137 + 11), dl_expiry: addDays(today, [400, 25, -10, 900, 365, 8, 1200, 600][i]),
    aadhaar_last4: String(1000 + Math.floor(rand() * 8999)), bank_account_no: null, bank_ifsc: null,
    join_date: addDays(today, -300 - i * 40), status: i === 6 ? 'on_leave' : 'active', notes: null, deleted_at: null,
  }));

  const attendance = [];
  for (let back = 1; back <= 9; back++) {
    for (const d of drivers) {
      const r = rand();
      attendance.push({
        id: newId(), driver_id: d.id, att_date: addDays(today, -back),
        status: r < 0.82 ? 'present' : r < 0.9 ? 'absent' : r < 0.96 ? 'leave' : 'half_day', truck_id: null, remarks: null, deleted_at: null,
      });
    }
  }

  const profile = { id: 'demo-me', full_name: { owner: 'Demo Owner', manager: 'Demo Manager', accountant: 'Demo Accountant', store_keeper: 'Demo Store Keeper', mechanic: 'Demo Mechanic', driver: 'Ramesh Behera' }[myRole], role: myRole, active: true };
  const canWrite = myRole === 'owner' || myRole === 'manager';
  const people = [
    { id: 'demo-me', full_name: profile.full_name, email: 'owner@example.com', phone: null, role: myRole, active: true },
    { id: newId(), full_name: 'Demo Manager', email: 'manager@example.com', phone: null, role: 'manager', active: true },
    { id: newId(), full_name: 'Sanjay Nayak', email: '9000000002@phone.fleet.local', phone: '9000000002', role: 'driver', active: false },
  ];
  const forbidden = () => ({ data: null, error: { message: 'permission denied' } });
  const ok = (data) => Promise.resolve({ data, error: null });
  const fail = (message) => Promise.resolve({ data: null, error: { message } });
  const live = (rows) => rows.filter((r) => !r.deleted_at);
  const normalise = (no) => String(no || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();

  function statusRows(truckId) {
    const out = [];
    for (const t of live(trucks)) {
      if (truckId && t.id !== truckId) continue;
      if (t.status === 'sold') continue;
      for (const ty of TYPES) {
        const mine = live(documents).filter((d) => d.truck_id === t.id && d.doc_type === ty.code)
          .sort((a, b) => (b.expires_on || '').localeCompare(a.expires_on || '') || b.created_at.localeCompare(a.created_at));
        const l = mine[0];
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
          document_id: l ? l.id : null, doc_no: l ? l.doc_no : null, expires_on: l ? l.expires_on : null, days_left: days, status,
        });
      }
    }
    return out;
  }

  const delay = (v) => new Promise((r) => setTimeout(() => r(v), 60));

  return {
    async getSession() { return { user: { id: 'demo-me' } }; },
    onAuthChange() {},
    async signIn() { return { error: null }; },
    async signOut() { location.search = ''; },
    async getProfile() { return profile; },

    listTrucks: () => delay({ data: live(trucks).sort((a, b) => a.truck_no.localeCompare(b.truck_no)), error: null }),
    getTruck: (id) => ok(live(trucks).find((t) => t.id === id) || null),
    async saveTruck(values, id) {
      if (!canWrite) return forbidden();
      const v = { ...values, truck_no: normalise(values.truck_no) };
      if (!/^[A-Z0-9]{6,12}$/.test(v.truck_no)) return fail('violates check constraint "trucks_truck_no_check"');
      if (live(trucks).some((t) => t.truck_no === v.truck_no && t.id !== id)) return fail('duplicate key value violates unique constraint "trucks_truck_no_uq"');
      if (id) { Object.assign(trucks.find((t) => t.id === id), v); return ok(trucks.find((t) => t.id === id)); }
      const row = { id: newId(), notes: null, deleted_at: null, ...v };
      trucks.push(row);
      return ok(row);
    },
    async removeTruck(id) { if (!canWrite) return forbidden(); trucks.find((t) => t.id === id).deleted_at = 'now'; return ok([{ id }]); },

    docStatus: ({ truckId } = {}) => delay({ data: statusRows(truckId), error: null }),
    listDocumentTypes: () => ok(TYPES),
    listDocuments: (truckId) => ok(live(documents).filter((d) => d.truck_id === truckId)
      .sort((a, b) => (b.expires_on || '').localeCompare(a.expires_on || ''))),
    async saveDocument(values, id) {
      if (!canWrite) return forbidden();
      if (values.issued_on && values.expires_on && values.expires_on < values.issued_on) return fail('violates check constraint "vehicle_documents_check"');
      if (id) { Object.assign(documents.find((d) => d.id === id), values); return ok(documents.find((d) => d.id === id)); }
      const row = { id: newId(), remarks: null, deleted_at: null, created_at: new Date().toISOString(), ...values };
      documents.push(row);
      return ok(row);
    },
    async removeDocument(id) { if (!canWrite) return forbidden(); documents.find((d) => d.id === id).deleted_at = 'now'; return ok([{ id }]); },

    async listDrivers() {
      if (!['owner', 'manager', 'accountant'].includes(myRole)) return ok(live(drivers).filter((d) => d.profile_id === 'demo-me'));
      return delay({ data: live(drivers).sort((a, b) => a.full_name.localeCompare(b.full_name)), error: null });
    },
    async saveDriver(values, id) {
      if (!canWrite) return forbidden();
      if (values.aadhaar_last4 && !/^[0-9]{4}$/.test(values.aadhaar_last4)) return fail('violates check constraint "drivers_aadhaar_last4_check"');
      if (values.dl_no && live(drivers).some((d) => d.dl_no === values.dl_no && d.id !== id)) return fail('duplicate key value violates unique constraint "drivers_dl_no_uq"');
      if (id) { Object.assign(drivers.find((d) => d.id === id), values); return ok(drivers.find((d) => d.id === id)); }
      const row = { id: newId(), profile_id: null, status: 'active', deleted_at: null, ...values };
      drivers.push(row);
      return ok(row);
    },
    async removeDriver(id) { if (!canWrite) return forbidden(); drivers.find((d) => d.id === id).deleted_at = 'now'; return ok([{ id }]); },

    async attendanceFor(date) {
      const mine = myRole === 'driver' ? drivers.filter((d) => d.profile_id === 'demo-me').map((d) => d.id) : null;
      return delay({ data: live(attendance).filter((a) => a.att_date === date && (!mine || mine.includes(a.driver_id))), error: null });
    },
    async setAttendance(row) {
      if (!canWrite) return forbidden();
      const found = attendance.find((a) => a.driver_id === row.driver_id && a.att_date === row.att_date);
      if (found) { Object.assign(found, row); return ok(found); }
      const created = { id: newId(), remarks: null, deleted_at: null, truck_id: null, ...row };
      attendance.push(created);
      return ok(created);
    },
    async setAttendanceBulk(rows) {
      for (const row of rows) { const r = await this.setAttendance(row); if (r.error) return r; }
      return ok(rows);
    },
    // --- people (owner) ---
    async listUsers() {
      return ok(people.map((p) => ({ ...p })));
    },
    async createUser({ full_name, login, role: newRole, phone, driver_id }) {
      if (people.some((p) => p.email === login)) return fail('auth/email-already-in-use');
      const row = { id: newId(), full_name, email: login, phone: phone || null, role: newRole, active: true };
      people.push(row);
      if (driver_id) drivers.find((d) => d.id === driver_id).profile_id = row.id;
      return ok(row);
    },
    async updateUser(id, values) { Object.assign(people.find((p) => p.id === id), values); return ok(true); },
    async resetPassword() { return ok(true); },
    async attendanceRange(from, to) {
      const mine = myRole === 'driver' ? drivers.filter((d) => d.profile_id === 'demo-me').map((d) => d.id) : null;
      return ok(live(attendance).filter((a) => a.att_date >= from && a.att_date <= to && (!mine || mine.includes(a.driver_id)))
        .sort((a, b) => b.att_date.localeCompare(a.att_date)));
    },
  };
}
