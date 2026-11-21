// Picks the data backend. Every screen talks to `api`, never to the database directly,
// so the demo backend and the real one stay interchangeable.

const params = new URLSearchParams(location.search);
export const demoMode = params.has('demo');
export const demoRole = params.get('demo') || 'owner';

// Google hosts the Firebase web SDK as ES modules. Pinned to one version so it never changes under us.
const FIREBASE_SDK_VERSION = '10.14.1';

async function loadFirebaseSdk() {
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/`;
  const [app, auth, store] = await Promise.all([
    import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-firestore.js'),
  ]);
  return { ...app, ...auth, ...store };
}

export async function loadApi() {
  const cfg = window.FLEET_CONFIG || {};
  if (demoMode) {
    return { api: (await import('./api.demo.js')).createDemoApi(demoRole), ready: true, demo: true };
  }
  if (!cfg.firebase || !cfg.firebase.projectId || !cfg.firebase.apiKey) {
    return { api: null, ready: false, demo: false };
  }
  const sdk = await loadFirebaseSdk();
  const { createFirebaseApi } = await import('./api.firebase.js');
  return { api: createFirebaseApi(cfg, sdk), ready: true, demo: false };
}

// Turns database errors into sentences a workshop supervisor can act on.
export function friendlyError(err) {
  const code = err && err.code;
  if (code === 'permission-denied') return 'You do not have permission to do this.';
  if (code === 'unavailable' || code === 'auth/network-request-failed') return 'No connection. Check your internet and try again.';
  if (code === 'auth/email-already-in-use') return 'This email or phone number already has a login.';
  if (code === 'auth/invalid-email') return 'Enter a valid email address, or a phone number with at least 8 digits.';
  if (code === 'auth/weak-password') return 'The password is too weak. Use at least 8 characters.';
  const m = (err && err.message) || String(err || '');
  if (/Period closed/i.test(m)) return m.replace(/^.*?(Period closed)/i, '$1');
  if (/duplicate key|unique/i.test(m)) {
    if (/trucks_truck_no/i.test(m)) return 'A truck with this registration number already exists.';
    if (/drivers_dl_no/i.test(m)) return 'A driver with this licence number already exists.';
    if (/driver_attendance/i.test(m)) return 'Attendance for this driver and date is already recorded.';
    return 'This entry already exists.';
  }
  if (/row-level security|permission denied/i.test(m)) return 'You do not have permission to do this.';
  if (/check constraint/i.test(m)) {
    if (/truck_no/i.test(m)) return 'Registration number must be 6 to 12 letters and digits, for example OD05AB1234.';
    if (/aadhaar/i.test(m)) return 'Enter only the last 4 digits of the Aadhaar number.';
    if (/expires_on|issued_on/i.test(m)) return 'The expiry date cannot be before the issue date.';
    return 'One of the values is not allowed. Check the form and try again.';
  }
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'No connection. Check your internet and try again.';
  return m || 'Something went wrong. Try again.';
}

export const ROLES_OFFICE = ['owner', 'manager'];
export const ROLE_LABEL = {
  owner: 'Owner', manager: 'Manager', accountant: 'Accountant',
  store_keeper: 'Store keeper', mechanic: 'Mechanic', driver: 'Driver',
};
