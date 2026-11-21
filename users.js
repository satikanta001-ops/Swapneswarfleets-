import { h, emptyState, openForm, toast } from '../ui.js';
import { friendlyError, ROLE_LABEL } from '../api.js';

const ROLE_OPTIONS = Object.entries(ROLE_LABEL).map(([value, label]) => ({ value, label }));

// Owner only: who can sign in and what they may do.
export async function usersView(ctx) {
  const res = await ctx.api.listUsers();
  if (res.error) throw res.error;
  const users = res.data;
  const dres = await ctx.api.listDrivers();
  const drivers = dres.error ? [] : dres.data;
  const freeDrivers = drivers.filter((d) => !d.profile_id && d.status !== 'left');

  async function addPerson() {
    const saved = await openForm({
      title: 'Add person',
      submitLabel: 'Add person',
      fields: [
        { name: 'full_name', label: 'Full name', required: true, maxlength: 80 },
        { name: 'login', label: 'Email or phone number', required: true, maxlength: 120, autocapitalize: 'none',
          hint: 'Drivers without an email can use their 10-digit phone number.' },
        { name: 'password', label: 'Password', required: true, maxlength: 60, autocomplete: 'new-password',
          hint: 'At least 8 characters. Tell the person this password. They can change it later.' },
        { name: 'role', label: 'Role', type: 'select', required: true, options: ROLE_OPTIONS },
        { name: 'driver_id', label: 'Driver record to link', type: 'select',
          options: freeDrivers.map((d) => ({ value: d.id, label: d.full_name })),
          hint: 'Only for the Driver role. It lets the driver see their own attendance.' },
        { name: 'phone', label: 'Phone number', type: 'tel', inputmode: 'tel', maxlength: 15 },
      ],
      values: { role: 'driver' },
      onSubmit: async (v) => {
        const r = await ctx.api.createUser({ full_name: v.full_name, login: v.login, password: v.password, role: v.role, phone: v.phone, driver_id: v.driver_id });
        if (r.error) return { error: friendlyError(r.error) };
      },
    });
    if (saved) { toast('Person added. Give them their login and password.'); ctx.rerender(); }
  }

  async function editPerson(u) {
    const self = u.id === ctx.profile.id;
    const fields = [
      { name: 'full_name', label: 'Full name', required: true, maxlength: 80 },
      { name: 'phone', label: 'Phone number', type: 'tel', inputmode: 'tel', maxlength: 15 },
    ];
    if (!self) {
      fields.push(
        { name: 'role', label: 'Role', type: 'select', required: true, options: ROLE_OPTIONS },
        { name: 'active', label: 'Can sign in', type: 'select', required: true,
          options: [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No, switched off' }],
          hint: 'Switching someone off keeps their history. They cannot sign in until you switch them back on.' });
    }
    const saved = await openForm({
      title: self ? 'Your details' : 'Edit person', fields,
      values: { ...u, active: String(u.active) },
      onSubmit: async (v) => {
        const values = { full_name: v.full_name, phone: v.phone };
        if (!self) { values.role = v.role; values.active = v.active === 'true'; }
        const r = await ctx.api.updateUser(u.id, values);
        if (r.error) return { error: friendlyError(r.error) };
      },
    });
    if (saved) { toast('Saved'); ctx.rerender(); }
  }

  async function sendReset(u) {
    if (!u.email) return;
    const r = await ctx.api.resetPassword(u.email);
    toast(r.error ? friendlyError(r.error) : 'Password reset email sent to ' + u.email, r.error ? 'bad' : undefined);
  }

  const results = h('ul', { class: 'list' });
  const runBtn = h('button', { class: 'btn' }, 'Run security check');
  runBtn.addEventListener('click', async () => {
    runBtn.disabled = true;
    runBtn.textContent = 'Checking…';
    results.replaceChildren(h('li', { class: 'spinner' }, 'Trying things that must be refused…'));
    try {
      const list = await ctx.api.selfTest();
      results.replaceChildren(...list.map((r) => h('li', { class: 'row' },
        h('div', { class: 'grow' }, h('div', { class: 'title' }, r.name), h('div', { class: 'detail' }, r.detail)),
        h('span', { class: 'chip ' + (r.ok === true ? 'good' : r.ok === false ? 'bad' : 'warn') }, r.ok === true ? 'Passed' : r.ok === false ? 'Failed' : 'Not checked'))));
    } finally {
      runBtn.disabled = false;
      runBtn.textContent = 'Run security check';
    }
  });

  const canReset = !!ctx.api.resetPassword;
  return h('div', { class: 'stack' },
    h('div', { class: 'page-head' },
      h('div', null, h('h1', null, 'People'), h('p', { class: 'sub' }, 'Everyone who can sign in to this app.')),
      h('button', { class: 'btn primary', onclick: addPerson }, 'Add person')),
    users.length
      ? h('ul', { class: 'list' }, users.map((u) => h('li', null, h('div', { class: 'row' },
        h('button', { class: 'row', style: 'border:0;padding:0;min-height:0;background:none', onclick: () => editPerson(u) },
          h('div', { class: 'grow' },
            h('div', { class: 'title' }, u.full_name + (u.id === ctx.profile.id ? ' (you)' : '')),
            h('div', { class: 'detail' }, [u.email, u.phone].filter(Boolean).join(', ') || 'No contact details'))),
        h('span', { class: 'chip muted' }, ROLE_LABEL[u.role] || u.role),
        u.active ? null : h('span', { class: 'chip bad' }, 'Switched off'),
        canReset && u.email && !String(u.email).endsWith('@phone.fleet.local')
          ? h('button', { class: 'btn small', onclick: () => sendReset(u) }, 'Send password reset')
          : null))))
      : emptyState('No people yet', 'Add the first person who needs to sign in.'),
    ctx.api.selfTest
      ? h('section', { class: 'panel stack-sm' },
        h('h2', null, 'Security check'),
        h('p', { class: 'muted' }, 'Tries to delete a truck, edit the audit log, fake a name and write into a closed period. Every one of these must be refused. Run it after any change to the rules.'),
        h('div', null, runBtn),
        results)
      : null);
}
