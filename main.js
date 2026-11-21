import { loadApi, demoMode, friendlyError, ROLE_LABEL } from './api.js';
import { h, icon, toast } from './ui.js';
import { dashboardView } from './views/dashboard.js';
import { trucksView, truckDetailView } from './views/trucks.js';
import { driversView } from './views/drivers.js';
import { attendanceView } from './views/attendance.js';
import { modulesView, moduleStubView } from './views/modules.js';
import { usersView } from './views/users.js';
import { MODULES } from './modules.js';

const cfg = window.FLEET_CONFIG || {};
const appName = cfg.appName || 'Fleet ERP';
const root = document.getElementById('app');

const OFFICE = ['owner', 'manager', 'accountant'];
const SHOP = ['store_keeper', 'mechanic'];
const ALL = ['owner', 'manager', 'accountant', 'store_keeper', 'mechanic', 'driver'];

// One table drives both the menu and the route guard.
const ROUTES = [
  { path: '/', label: 'Home', icon: 'home', roles: ALL, match: /^\/$/, render: (ctx) => dashboardView(ctx) },
  { path: '/trucks', label: 'Trucks', icon: 'truck', roles: [...OFFICE, ...SHOP], match: /^\/trucks$/, render: (ctx) => trucksView(ctx) },
  { path: '/trucks/:id', roles: [...OFFICE, ...SHOP], match: /^\/trucks\/([\w-]+)$/, render: (ctx, id) => truckDetailView(ctx, id) },
  { path: '/drivers', label: 'Drivers', icon: 'user', roles: OFFICE, match: /^\/drivers$/, render: (ctx) => driversView(ctx) },
  { path: '/attendance', label: 'Attendance', icon: 'calendar', roles: OFFICE, match: /^\/attendance$/, render: (ctx) => attendanceView(ctx) },
  { path: '/modules', label: 'All pages', icon: 'grid', roles: [...OFFICE, ...SHOP], match: /^\/modules$/, render: (ctx) => modulesView(ctx) },
  { path: '/users', label: 'People', icon: 'users', roles: ['owner'], match: /^\/users$/, render: (ctx) => usersView(ctx) },
  { path: '/m/:id', roles: [...OFFICE, ...SHOP], match: /^\/m\/([\w-]+)$/, render: (ctx, id) => moduleStubView(ctx, id) },
];

let api = null;
let profile = null;
let view = null;
let navEl = null;
let routeToken = 0;

boot();

async function boot() {
  document.title = appName;
  let loaded;
  try {
    loaded = await loadApi();
  } catch (e) {
    return renderMessage('Could not start the app', friendlyError(e), [h('button', { class: 'btn primary', onclick: () => location.reload() }, 'Try again')]);
  }
  if (!loaded.ready) return renderSetup();
  api = loaded.api;
  if (api.onBackgroundError) api.onBackgroundError((e) => toast(friendlyError(e), 'bad'));
  if (api.onQueued) api.onQueued(() => toast('No signal. Saved on this phone, it will upload when you are online.'));
  api.onAuthChange((session) => { if (!session && profile) { profile = null; start(); } });
  window.addEventListener('hashchange', () => route());
  await start();
}

async function start() {
  const session = await api.getSession();
  if (!session) return renderLogin();
  try {
    profile = await api.getProfile();
  } catch (e) {
    return renderMessage('Could not load your account', friendlyError(e), [h('button', { class: 'btn primary', onclick: () => location.reload() }, 'Try again')]);
  }
  if (!profile || !profile.active) return renderPending();
  renderShell();
  if (api.ensureSetup) api.ensureSetup();
  registerServiceWorker();
  route();
}

// ------------------------------------------------------------------ screens
function renderMessage(title, text, actions) {
  root.replaceChildren(h('div', { class: 'auth' }, h('div', { class: 'panel' }, h('h1', null, title), h('p', null, text), h('div', { class: 'cluster' }, actions || []))));
}

function renderSetup() {
  renderMessage('Connect a database to start',
    'This copy of the app is not connected to Firebase yet. Add your Firebase settings to config.js, then reload. The README has the steps.',
    [h('a', { class: 'btn primary', href: '?demo' }, 'Try the demo with sample data')]);
}

function renderPending() {
  renderMessage('Waiting for approval',
    'Your login works, but the owner has not switched on your account yet. Ask the owner to activate it, then reload this page.',
    [h('button', { class: 'btn primary', onclick: () => location.reload() }, 'Reload'),
      h('button', { class: 'btn', onclick: signOut }, 'Sign out')]);
}

function renderLogin() {
  const error = h('div', { class: 'form-error', role: 'alert', hidden: true });
  const email = h('input', { id: 'email', type: 'text', required: true, autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false' });
  const password = h('input', { id: 'password', type: 'password', required: true, autocomplete: 'current-password' });
  const submit = h('button', { class: 'btn primary', type: 'submit' }, 'Sign in');
  const form = h('form', { class: 'stack' },
    h('h1', null, appName),
    error,
    h('div', { class: 'field' }, h('label', { for: 'email' }, 'Email or phone number'), email),
    h('div', { class: 'field' }, h('label', { for: 'password' }, 'Password'), password),
    submit);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;
    submit.disabled = true;
    submit.textContent = 'Signing in…';
    const { error: err } = await api.signIn(email.value.trim(), password.value);
    if (err) {
      error.textContent = /invalid login/i.test(err.message) ? 'Email or password is wrong.' : friendlyError(err);
      error.hidden = false;
      submit.disabled = false;
      submit.textContent = 'Sign in';
      return;
    }
    start();
  });
  root.replaceChildren(h('div', { class: 'auth' }, h('div', { class: 'panel' }, form)));
  email.focus();
}

async function signOut() {
  await api.signOut();
  profile = null;
  start();
}

function renderShell() {
  const items = ROUTES.filter((r) => r.label && r.roles.includes(profile.role));
  // Pages that are planned but not built show in the side menu on a PC only.
  const planned = MODULES.filter((m) => m.status !== 'built' && m.roles.includes(profile.role));
  navEl = h('nav', { class: 'nav', 'aria-label': 'Main' },
    items.map((r) => h('a', { href: '#' + r.path, 'data-path': r.path }, icon(r.icon), r.label)),
    planned.length ? h('div', { class: 'nav-heading' }, 'Coming later') : null,
    planned.map((m) => h('a', { class: 'planned', href: '#/m/' + m.id, 'data-path': '/m/' + m.id },
      h('span', { class: 'modno' }, m.no), m.title)));

  const banner = h('div', { class: 'banner', role: 'status', hidden: true });
  const syncBanner = () => {
    if (demoMode) { banner.textContent = 'Demo mode. This is sample data and nothing is saved.'; banner.hidden = false; }
    else if (!navigator.onLine) { banner.textContent = 'You are offline. Changes cannot be saved until you reconnect.'; banner.hidden = false; }
    else banner.hidden = true;
  };
  window.addEventListener('online', syncBanner);
  window.addEventListener('offline', syncBanner);
  syncBanner();

  view = h('div', { id: 'view' });
  root.replaceChildren(h('div', { class: 'shell' },
    h('header', { class: 'topbar' },
      h('span', { class: 'brand' }, appName),
      h('div', { class: 'who' },
        h('span', null, `${profile.full_name}, ${ROLE_LABEL[profile.role] || profile.role}`),
        h('button', { class: 'btn small', onclick: signOut }, demoMode ? 'Leave demo' : 'Sign out'))),
    navEl,
    h('main', { class: 'main', id: 'main', tabindex: '-1' }, banner, view)));
}

// ------------------------------------------------------------------ router
function find(path) {
  for (const r of ROUTES) {
    const m = r.match.exec(path);
    if (m) return { route: r, params: m.slice(1) };
  }
  return null;
}

async function route(keepScroll) {
  if (!profile || !view) return;
  const path = location.hash.replace(/^#/, '') || '/';
  const found = find(path);
  if (!found || !found.route.roles.includes(profile.role)) { location.hash = '#/'; return; }

  const token = ++routeToken;
  for (const a of navEl.querySelectorAll('a')) {
    const p = a.dataset.path;
    const on = p === '/' ? path === '/' : path === p || path.startsWith(p + '/');
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }

  const ctx = {
    api, profile,
    canWrite: profile.role === 'owner' || profile.role === 'manager',
    nav: (p) => { location.hash = '#' + p; },
    rerender: () => route(true),
  };
  const y = window.scrollY;
  if (!keepScroll) view.replaceChildren(h('div', { class: 'spinner' }, 'Loading…'));
  try {
    const node = await found.route.render(ctx, ...found.params);
    if (token !== routeToken) return;
    view.replaceChildren(node);
    document.title = (found.route.label ? found.route.label + ' - ' : '') + appName;
  } catch (e) {
    if (token !== routeToken) return;
    console.error(e);
    view.replaceChildren(h('div', { class: 'stack' },
      h('div', { class: 'form-error', role: 'alert' }, friendlyError(e)),
      h('div', null, h('button', { class: 'btn', onclick: () => route() }, 'Try again'))));
  }
  window.scrollTo(0, keepScroll ? y : 0);
}

// ------------------------------------------------------------------ offline shell
function registerServiceWorker() {
  if (demoMode || !('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;
  navigator.serviceWorker.register('sw.js').catch(() => toast('Offline mode could not be set up.', 'bad'));
}
