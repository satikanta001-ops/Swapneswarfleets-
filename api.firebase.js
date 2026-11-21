// Real backend: Firebase (Authentication + Firestore).
// Gives the screens the same methods as the demo backend, so no screen knows which one it is using.
//
// Rules that Firestore enforces for us are in firebase/firestore.rules.
// This file adds what rules cannot do: unique values, the audit entry written with each change,
// and the latest document per type kept on the truck.
//
// `sdk` is the Firebase web SDK (loaded in api.js). It is passed in so the tests can use a stand-in.

import { todayIST } from './ui.js';
import { DOC_TYPES, latestEntry, statusRows } from './docstatus.js';

const STAMP_KEYS = new Set(['created_at', 'created_by', 'updated_at', 'updated_by', 'deleted_at', 'docs_latest']);
const TRUCK_FIELDS = ['truck_no', 'make_model', 'vehicle_class', 'capacity_tons', 'ownership', 'status', 'notes'];
const DRIVER_FIELDS = ['full_name', 'phone', 'dl_no', 'dl_expiry', 'aadhaar_last4', 'bank_account_no', 'bank_ifsc', 'join_date', 'status', 'notes'];
const DOC_FIELDS = ['doc_type', 'doc_no', 'issued_on', 'expires_on', 'remarks'];
const CHUNK = 4;          // rows per batch; Firestore limits how many documents a rule may look up per request
const QUEUE_AFTER_MS = 5000;

const fail = (message, code) => Object.assign(new Error(message), { code: code || 'app/error' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const dayNumber = (iso) => Number(String(iso).replace(/-/g, ''));
const attId = (driverId, date) => `${driverId}_${date}`;

function pick(values, fields) {
  const out = {};
  for (const f of fields) {
    const v = values[f];
    out[f] = v === undefined || v === '' ? null : v;
  }
  return out;
}

// Drivers without an email sign in with their phone number. It becomes a made-up address.
export function loginEmail(input) {
  const s = String(input || '').trim();
  if (s.includes('@')) return s.toLowerCase();
  const digits = s.replace(/\D/g, '');
  return digits.length >= 8 ? `${digits}@phone.fleet.local` : s;
}

export function createFirebaseApi(cfg, sdk) {
  const {
    initializeApp, deleteApp, getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut: fbSignOut,
    createUserWithEmailAndPassword, sendPasswordResetEmail,
    initializeFirestore, persistentLocalCache, persistentMultipleTabManager, getFirestore,
    collection, doc, getDoc, getDocs, query, where, setDoc, updateDoc, deleteDoc, writeBatch, runTransaction, serverTimestamp,
  } = sdk;

  const app = initializeApp(cfg.firebase);
  const auth = getAuth(app);
  let db;
  try {
    // Keeps data on the phone so screens open and entries are queued when there is no signal.
    db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  } catch (e) {
    db = getFirestore(app);
  }

  let me = null;                         // the signed-in person's profile
  const authListeners = [];
  const errorListeners = [];
  const queuedListeners = [];
  const authReady = new Promise((resolve) => {
    let first = true;
    onAuthStateChanged(auth, (user) => {
      if (first) { first = false; resolve(user); return; }
      authListeners.forEach((f) => f(user ? { user } : null));
    });
  });

  const uid = () => {
    if (!auth.currentUser) throw fail('You are signed out. Sign in again.', 'app/signed-out');
    return auth.currentUser.uid;
  };
  const role = () => (me ? me.role : null);

  // ---------------------------------------------------------------- helpers
  const plain = (v) => (v && typeof v.toDate === 'function' ? v.toDate().toISOString() : v);
  function rowOf(snap) {
    const out = { id: snap.id };
    for (const [k, v] of Object.entries(snap.data({ serverTimestamps: 'estimate' }))) out[k] = plain(v);
    return out;
  }
  const live = (rows) => rows.filter((r) => !r.deleted_at);
  const coll = (name) => collection(db, name);

  async function rowsWhere(name, ...conds) {
    const q = conds.length ? query(coll(name), ...conds.map(([f, op, v]) => where(f, op, v))) : coll(name);
    const snap = await getDocs(q);
    return snap.docs.map(rowOf);
  }

  const newStamps = () => ({ created_at: serverTimestamp(), created_by: uid(), updated_at: serverTimestamp(), updated_by: uid(), deleted_at: null });
  const editStamps = () => ({ updated_at: serverTimestamp(), updated_by: uid() });
  const deleteStamps = () => ({ deleted_at: serverTimestamp(), ...editStamps() });

  function strip(o) {
    if (!o) return null;
    const out = {};
    for (const [k, v] of Object.entries(o)) if (!STAMP_KEYS.has(k) && k !== 'id') out[k] = v === undefined ? null : v;
    return out;
  }
  function audit(batch, path, action, before, after) {
    batch.set(doc(coll('audit_log')), {
      at: serverTimestamp(), by: uid(), by_name: me ? me.full_name : null, path, action, before: strip(before), after: strip(after),
    });
  }

  // Sends a batch. If there is no signal it stays queued on the phone and uploads later.
  async function commit(batch, { noWait } = {}) {
    const done = batch.commit();
    if (noWait) { done.catch((e) => errorListeners.forEach((f) => f(e))); return { queued: true }; }
    const outcome = await Promise.race([done.then(() => 'sent'), wait(QUEUE_AFTER_MS).then(() => 'queued')]);
    if (outcome === 'queued') {
      done.catch((e) => errorListeners.forEach((f) => f(e)));
      queuedListeners.forEach((f) => f());
      return { queued: true };
    }
    return { queued: false };
  }

  const guard = (fn) => async (...args) => {
    try { return await fn(...args); } catch (e) { return { data: null, error: e }; }
  };

  // ---------------------------------------------------------------- trucks
  async function allTrucks() { return (await rowsWhere('trucks', ['deleted_at', '==', null])).sort((a, b) => a.truck_no.localeCompare(b.truck_no)); }

  async function saveTruckImpl(values, id) {
    const truck_no = String(values.truck_no || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (!/^[A-Z0-9]{6,12}$/.test(truck_no)) throw fail('violates check constraint "trucks_truck_no_check"');
    const same = live(await rowsWhere('trucks', ['truck_no', '==', truck_no])).filter((r) => r.id !== id);
    if (same.length) throw fail('duplicate key value violates unique constraint "trucks_truck_no_uq"');

    const fields = { ...pick(values, TRUCK_FIELDS), truck_no };
    const batch = writeBatch(db);
    if (id) {
      const ref = doc(db, 'trucks', id);
      const snap = await getDoc(ref);
      if (!snap.exists() || snap.data().deleted_at) throw fail('Truck not found.');
      const before = rowOf(snap);
      batch.update(ref, { ...fields, ...editStamps() });
      audit(batch, `trucks/${id}`, 'UPDATE', before, { ...before, ...fields });
      const res = await commit(batch);
      return { data: { ...before, ...fields }, error: null, queued: res.queued };
    }
    const ref = doc(coll('trucks'));
    batch.set(ref, { ...fields, docs_latest: {}, ...newStamps() });
    audit(batch, `trucks/${ref.id}`, 'INSERT', null, fields);
    const res = await commit(batch);
    return { data: { id: ref.id, ...fields, docs_latest: {}, deleted_at: null }, error: null, queued: res.queued };
  }

  async function removeTruckImpl(id) {
    const ref = doc(db, 'trucks', id);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw fail('Truck not found.');
    const batch = writeBatch(db);
    batch.update(ref, deleteStamps());
    audit(batch, `trucks/${id}`, 'SOFT_DELETE', rowOf(snap), null);
    const res = await commit(batch);
    return { data: [{ id }], error: null, queued: res.queued };
  }

  // ---------------------------------------------------------------- vehicle documents
  const docsForTruck = async (truckId) => live(await rowsWhere('vehicle_documents', ['truck_id', '==', truckId]));

  async function saveDocumentImpl(values, id) {
    const fields = pick(values, DOC_FIELDS);
    if (fields.issued_on && fields.expires_on && fields.expires_on < fields.issued_on) {
      throw fail('violates check constraint "vehicle_documents_check"');
    }
    if (!DOC_TYPES.some((t) => t.code === fields.doc_type)) throw fail('Choose a document type.');
    const truckRef = doc(db, 'trucks', values.truck_id);
    const tsnap = await getDoc(truckRef);
    if (!tsnap.exists() || tsnap.data().deleted_at) throw fail('Truck not found.');
    const truck = rowOf(tsnap);

    const existing = await docsForTruck(values.truck_id);
    const ref = id ? doc(db, 'vehicle_documents', id) : doc(coll('vehicle_documents'));
    const before = id ? existing.find((r) => r.id === id) : null;
    if (id && !before) throw fail('Document entry not found.');

    const others = existing.filter((r) => r.id !== ref.id && r.doc_type === fields.doc_type);
    const mine = { id: ref.id, ...fields, created_at: before ? before.created_at : null };
    const docs_latest = { ...(truck.docs_latest || {}) };
    const latest = latestEntry([...others, mine]);
    if (latest) docs_latest[fields.doc_type] = latest; else delete docs_latest[fields.doc_type];

    const batch = writeBatch(db);
    if (id) {
      batch.update(ref, { ...fields, ...editStamps() });
      audit(batch, `vehicle_documents/${ref.id}`, 'UPDATE', { ...before, truck_id: values.truck_id }, { ...fields, truck_id: values.truck_id });
    } else {
      batch.set(ref, { truck_id: values.truck_id, ...fields, ...newStamps() });
      audit(batch, `vehicle_documents/${ref.id}`, 'INSERT', null, { truck_id: values.truck_id, ...fields });
    }
    batch.update(truckRef, { docs_latest, ...editStamps() });
    const res = await commit(batch);
    return { data: { id: ref.id, truck_id: values.truck_id, ...fields }, error: null, queued: res.queued };
  }

  async function removeDocumentImpl(id) {
    const ref = doc(db, 'vehicle_documents', id);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw fail('Document entry not found.');
    const row = rowOf(snap);
    const truckRef = doc(db, 'trucks', row.truck_id);
    const truck = rowOf(await getDoc(truckRef));
    const rest = (await docsForTruck(row.truck_id)).filter((r) => r.id !== id && r.doc_type === row.doc_type);
    const docs_latest = { ...(truck.docs_latest || {}) };
    const latest = latestEntry(rest);
    if (latest) docs_latest[row.doc_type] = latest; else delete docs_latest[row.doc_type];

    const batch = writeBatch(db);
    batch.update(ref, deleteStamps());
    batch.update(truckRef, { docs_latest, ...editStamps() });
    audit(batch, `vehicle_documents/${id}`, 'SOFT_DELETE', row, null);
    const res = await commit(batch);
    return { data: [{ id }], error: null, queued: res.queued };
  }

  // ---------------------------------------------------------------- drivers
  async function allDrivers() {
    const rows = role() === 'driver'
      ? await rowsWhere('drivers', ['profile_id', '==', uid()])
      : await rowsWhere('drivers', ['deleted_at', '==', null]);
    return live(rows).sort((a, b) => a.full_name.localeCompare(b.full_name));
  }

  async function saveDriverImpl(values, id) {
    if (values.aadhaar_last4 && !/^[0-9]{4}$/.test(values.aadhaar_last4)) throw fail('violates check constraint "drivers_aadhaar_last4_check"');
    if (values.dl_no) {
      const same = live(await rowsWhere('drivers', ['dl_no', '==', values.dl_no])).filter((r) => r.id !== id);
      if (same.length) throw fail('duplicate key value violates unique constraint "drivers_dl_no_uq"');
    }
    const fields = pick(values, DRIVER_FIELDS);
    const batch = writeBatch(db);
    if (id) {
      const ref = doc(db, 'drivers', id);
      const snap = await getDoc(ref);
      if (!snap.exists()) throw fail('Driver not found.');
      const before = rowOf(snap);
      batch.update(ref, { ...fields, ...editStamps() });
      audit(batch, `drivers/${id}`, 'UPDATE', before, { ...before, ...fields });
      const res = await commit(batch);
      return { data: { ...before, ...fields }, error: null, queued: res.queued };
    }
    const ref = doc(coll('drivers'));
    batch.set(ref, { profile_id: null, ...fields, ...newStamps() });
    audit(batch, `drivers/${ref.id}`, 'INSERT', null, fields);
    const res = await commit(batch);
    return { data: { id: ref.id, profile_id: null, ...fields }, error: null, queued: res.queued };
  }

  async function removeDriverImpl(id) {
    const ref = doc(db, 'drivers', id);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw fail('Driver not found.');
    const batch = writeBatch(db);
    batch.update(ref, deleteStamps());
    audit(batch, `drivers/${id}`, 'SOFT_DELETE', rowOf(snap), null);
    const res = await commit(batch);
    return { data: [{ id }], error: null, queued: res.queued };
  }

  // ---------------------------------------------------------------- attendance
  async function attendanceOn(date) {
    const rows = role() === 'driver'
      ? await rowsWhere('driver_attendance', ['profile_id', '==', uid()], ['att_date', '==', date])
      : await rowsWhere('driver_attendance', ['att_date', '==', date]);
    return live(rows);
  }

  // Adds the operations for one attendance row to a batch.
  async function stageAttendance(batch, row) {
    const id = attId(row.driver_id, row.att_date);
    const ref = doc(db, 'driver_attendance', id);
    const snap = await getDoc(ref);
    const fields = { status: row.status, truck_id: row.truck_id ?? null, remarks: row.remarks ?? null };
    if (snap.exists()) {
      const before = rowOf(snap);
      const extra = row.profile_id !== undefined ? { profile_id: row.profile_id } : {};
      batch.update(ref, { ...fields, ...extra, deleted_at: null, ...editStamps() });
      audit(batch, `driver_attendance/${id}`, 'UPDATE', before, { ...before, ...fields, ...extra });
    } else {
      const data = { driver_id: row.driver_id, profile_id: row.profile_id ?? null, att_date: row.att_date, att_day: dayNumber(row.att_date), ...fields };
      batch.set(ref, { ...data, ...newStamps() });
      audit(batch, `driver_attendance/${id}`, 'INSERT', null, data);
    }
    return { id, driver_id: row.driver_id, att_date: row.att_date, status: row.status };
  }

  // ---------------------------------------------------------------- people (owner screen)
  async function createUserImpl({ full_name, login, password, role: newRole, phone, driver_id }) {
    if (!full_name || !login || !password) throw fail('Enter a name, a login and a password.');
    if (String(password).length < 8) throw fail('The password needs at least 8 characters.');
    const email = loginEmail(login);
    // A second app instance creates the login so the owner stays signed in.
    const second = initializeApp(cfg.firebase, 'second-' + Date.now());
    let newUid;
    try {
      const secondAuth = getAuth(second);
      const cred = await createUserWithEmailAndPassword(secondAuth, email, password);
      newUid = cred.user.uid;
      await fbSignOut(secondAuth);
    } finally {
      await deleteApp(second);
    }
    try {
      const batch = writeBatch(db);
      const profile = { full_name, email, phone: phone || null, role: newRole, active: true };
      batch.set(doc(db, 'profiles', newUid), { ...profile, ...newStamps() });
      audit(batch, `profiles/${newUid}`, 'INSERT', null, profile);
      if (driver_id) {
        batch.update(doc(db, 'drivers', driver_id), { profile_id: newUid, ...editStamps() });
        audit(batch, `drivers/${driver_id}`, 'UPDATE', null, { profile_id: newUid });
      }
      await batch.commit();
    } catch (e) {
      throw fail('The login was created but the profile was not saved (' + (e.message || e.code) + '). '
        + 'Delete this login in the Firebase console under Authentication, then add the person again.');
    }
    return { data: { id: newUid, ...{ full_name, email, role: newRole, active: true } }, error: null };
  }

  // ---------------------------------------------------------------- the API
  return {
    onBackgroundError(cb) { errorListeners.push(cb); },
    onQueued(cb) { queuedListeners.push(cb); },

    // --- session ---
    async getSession() { await authReady; return auth.currentUser ? { user: auth.currentUser } : null; },
    onAuthChange(cb) { authListeners.push(cb); },
    async signIn(login, password) {
      try {
        await signInWithEmailAndPassword(auth, loginEmail(login), password);
        return { error: null };
      } catch (e) {
        const bad = ['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-email'];
        if (bad.includes(e.code)) return { error: { message: 'Invalid login credentials' } };
        if (e.code === 'auth/too-many-requests') return { error: { message: 'Too many attempts. Wait a few minutes and try again.' } };
        return { error: e };
      }
    },
    async signOut() { me = null; await fbSignOut(auth); },
    async getProfile() {
      if (!auth.currentUser) return null;
      const snap = await getDoc(doc(db, 'profiles', auth.currentUser.uid));
      if (!snap.exists()) return null;
      const d = rowOf(snap);
      me = { id: d.id, full_name: d.full_name, role: d.role, active: d.active === true && !d.deleted_at };
      return me;
    },
    // First sign-in of the owner: make sure the period lock record exists.
    async ensureSetup() {
      if (!me || me.role !== 'owner') return;
      try {
        const ref = doc(db, 'period_locks', 'current');
        const snap = await getDoc(ref);
        if (snap.exists()) return;
        const batch = writeBatch(db);
        batch.set(ref, { locked_through: null, locked_day: 0, ...newStamps() });
        await batch.commit();
      } catch (e) { /* the rest of the app works without it */ }
    },

    // --- trucks ---
    listTrucks: guard(async () => ({ data: await allTrucks(), error: null })),
    getTruck: guard(async (id) => {
      const snap = await getDoc(doc(db, 'trucks', id));
      const row = snap.exists() ? rowOf(snap) : null;
      return { data: row && !row.deleted_at ? row : null, error: null };
    }),
    saveTruck: guard(saveTruckImpl),
    removeTruck: guard(removeTruckImpl),

    // --- vehicle documents ---
    docStatus: guard(async ({ truckId } = {}) => {
      let trucks;
      if (truckId) {
        const snap = await getDoc(doc(db, 'trucks', truckId));
        trucks = snap.exists() ? [rowOf(snap)] : [];
      } else {
        trucks = await allTrucks();
      }
      return { data: statusRows(trucks, todayIST()), error: null };
    }),
    listDocumentTypes: async () => ({ data: DOC_TYPES, error: null }),
    listDocuments: guard(async (truckId) => {
      const rows = await docsForTruck(truckId);
      rows.sort((a, b) => (b.expires_on || '').localeCompare(a.expires_on || '') || String(b.created_at || '').localeCompare(String(a.created_at || '')));
      return { data: rows, error: null };
    }),
    saveDocument: guard(saveDocumentImpl),
    removeDocument: guard(removeDocumentImpl),

    // --- drivers ---
    listDrivers: guard(async () => ({ data: await allDrivers(), error: null })),
    saveDriver: guard(saveDriverImpl),
    removeDriver: guard(removeDriverImpl),

    // --- attendance ---
    attendanceFor: guard(async (date) => ({ data: await attendanceOn(date), error: null })),
    setAttendance: guard(async (row) => {
      const batch = writeBatch(db);
      const data = await stageAttendance(batch, row);
      const res = await commit(batch);
      return { data, error: null, queued: res.queued };
    }),
    setAttendanceBulk: guard(async (rows) => {
      let noWait = false;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const batch = writeBatch(db);
        for (const row of rows.slice(i, i + CHUNK)) await stageAttendance(batch, row);
        const res = await commit(batch, { noWait });
        if (res.queued) noWait = true;
      }
      return { data: rows, error: null, queued: noWait };
    }),
    attendanceRange: guard(async (from, to) => {
      let rows;
      if (role() === 'driver') {
        rows = (await rowsWhere('driver_attendance', ['profile_id', '==', uid()])).filter((r) => r.att_date >= from && r.att_date <= to);
      } else {
        rows = await rowsWhere('driver_attendance', ['att_day', '>=', dayNumber(from)], ['att_day', '<=', dayNumber(to)]);
      }
      return { data: live(rows).sort((a, b) => b.att_date.localeCompare(a.att_date)), error: null };
    }),

    // --- document numbers, for the phases that need them: JC/2026-27/00001 ---
    nextDocNo: guard(async (prefix) => {
      if (!/^[A-Z]{2,6}$/.test(prefix)) throw fail('Invalid document prefix: ' + prefix);
      const fy = finYear(todayIST());
      const ref = doc(db, 'doc_counters', `${prefix}_${fy}`);
      const no = await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const next = snap.exists() ? snap.data().last_no + 1 : 1;
        const stamp = { updated_at: serverTimestamp(), updated_by: uid() };
        if (snap.exists()) tx.update(ref, { last_no: next, ...stamp });
        else tx.set(ref, { last_no: next, ...stamp });
        return next;
      });
      return { data: `${prefix}/${fy}/${String(no).padStart(5, '0')}`, error: null };
    }),

    // --- people (owner) ---
    listUsers: guard(async () => {
      const rows = live(await rowsWhere('profiles'));
      return { data: rows.sort((a, b) => a.full_name.localeCompare(b.full_name)), error: null };
    }),
    createUser: guard(createUserImpl),
    updateUser: guard(async (id, values) => {
      const ref = doc(db, 'profiles', id);
      const snap = await getDoc(ref);
      if (!snap.exists()) throw fail('Person not found.');
      const before = rowOf(snap);
      const fields = { full_name: values.full_name ?? before.full_name, phone: values.phone ?? before.phone ?? null, role: values.role ?? before.role, active: values.active ?? before.active };
      const batch = writeBatch(db);
      batch.update(ref, { ...fields, ...editStamps() });
      audit(batch, `profiles/${id}`, 'UPDATE', before, { ...before, ...fields });
      await batch.commit();
      return { data: { ...before, ...fields }, error: null };
    }),
    resetPassword: guard(async (login) => {
      await sendPasswordResetEmail(auth, loginEmail(login));
      return { data: true, error: null };
    }),

    // --- Security check (owner): tries things that must be refused and reports what happened ---
    async selfTest() {
      const results = [];
      const stamps = () => ({ created_at: serverTimestamp(), created_by: uid(), updated_at: serverTimestamp(), updated_by: uid(), deleted_at: null });
      const goodTruck = { truck_no: 'ZZ99ZZ9999', make_model: null, vehicle_class: 'domestic', capacity_tons: null, ownership: 'owned', status: 'active', notes: null, docs_latest: {} };

      async function mustBeRefused(name, run) {
        try {
          await Promise.race([run(), wait(8000).then(() => { throw Object.assign(new Error('timeout'), { code: 'timeout' }); })]);
          results.push({ name, ok: false, detail: 'It was allowed. The rules are too open. Tell the developer.' });
        } catch (e) {
          if (e.code === 'permission-denied') results.push({ name, ok: true, detail: 'Refused, as it should be.' });
          else results.push({ name, ok: null, detail: 'Could not check (' + (e.code || e.message) + '). Check the internet and try again.' });
        }
      }

      await mustBeRefused('Deleting a truck is refused', () => deleteDoc(doc(db, 'trucks', 'security-check')));
      await mustBeRefused('Changing the audit log is refused', () => updateDoc(doc(db, 'audit_log', 'security-check'), { by: 'x' }));
      await mustBeRefused('Deleting from the audit log is refused', () => deleteDoc(doc(db, 'audit_log', 'security-check')));
      await mustBeRefused('A fake audit entry in someone else\'s name is refused', () =>
        setDoc(doc(db, 'audit_log', 'security-check-fake'), { at: serverTimestamp(), by: 'someone-else', by_name: 'x', path: 'x', action: 'UPDATE', before: null, after: null }));
      await mustBeRefused('A truck saved with someone else\'s name on it is refused', () =>
        setDoc(doc(db, 'trucks', 'security-check-forged'), { ...goodTruck, ...stamps(), created_by: 'someone-else' }));
      await mustBeRefused('A truck with a bad registration number is refused', () =>
        setDoc(doc(db, 'trucks', 'security-check-bad'), { ...goodTruck, truck_no: 'x', ...stamps() }));
      await mustBeRefused('A collection the app does not use is closed', () => setDoc(doc(db, 'anything_else', 'x'), { a: 1 }));

      try {
        const lock = await getDoc(doc(db, 'period_locks', 'current'));
        const day = lock.exists() ? lock.data().locked_day : 0;
        if (day > 0) {
          const iso = String(day).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
          await mustBeRefused('Attendance inside the locked period is refused', () =>
            setDoc(doc(db, 'driver_attendance', attId('security-check', iso)), {
              driver_id: 'security-check', profile_id: null, att_date: iso, att_day: day, status: 'present', truck_id: null, remarks: null, ...stamps(),
            }));
        } else {
          results.push({ name: 'Attendance inside the locked period is refused', ok: null, detail: 'No period is locked yet, so there is nothing to check.' });
        }
      } catch (e) {
        results.push({ name: 'Attendance inside the locked period is refused', ok: null, detail: 'Could not check (' + (e.code || e.message) + ').' });
      }
      return results;
    },
  };
}

function finYear(iso) {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}
