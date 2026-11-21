import { h, emptyState } from './ui.js';
import { PHASES, moduleById, phaseOf } from './modules.js';

const PHASE_CHIP = {
  done: ['good', 'Built'],
  next: ['warn', 'Build next'],
  planned: ['muted', 'Later'],
};

function hrefFor(m) { return '#' + (m.status === 'built' ? m.path : '/m/' + m.id); }

function moduleRow(m) {
  return h('li', null, h('a', { class: 'row', href: hrefFor(m) },
    h('span', { class: 'modno', 'aria-label': 'Point ' + m.no }, m.no),
    h('div', { class: 'grow' }, h('div', { class: 'title' }, m.title), h('div', { class: 'detail' }, m.summary)),
    m.status === 'built'
      ? h('span', { class: 'chip good' }, 'Ready')
      : h('span', { class: 'chip muted' }, 'Phase ' + m.phase)));
}

// All pages, grouped by the phase they are built in.
export function modulesView(ctx) {
  const role = ctx.profile.role;
  return h('div', { class: 'stack' },
    h('div', { class: 'page-head' }, h('div', null,
      h('h1', null, 'All pages'),
      h('p', { class: 'sub' }, 'The 10 points from the owner\'s list, in the order they will be built. Numbers match his list.'))),
    PHASES.map((p) => {
      const [cls, label] = PHASE_CHIP[p.status];
      const mods = p.modules.map(moduleById).filter((m) => m.roles.includes(role));
      return h('section', { class: 'stack-sm' },
        h('div', { class: 'group-title' }, h('h2', null, `Phase ${p.n}: ${p.name}`), h('span', { class: 'chip ' + cls }, label)),
        h('p', { class: 'muted' }, p.summary),
        mods.length ? h('ul', { class: 'list' }, mods.map(moduleRow)) : null);
    }));
}

// Placeholder for a page that is planned but not built yet.
export function moduleStubView(ctx, id) {
  const m = moduleById(id);
  const back = h('a', { class: 'back', href: '#/modules' }, 'Back to all pages');
  if (!m) return h('div', { class: 'stack' }, back, emptyState('Page not found', 'It may have been renamed. Open all pages to see the list.'));
  if (m.status === 'built') { ctx.nav(m.path); return h('div'); }
  if (!m.roles.includes(ctx.profile.role)) {
    return h('div', { class: 'stack' }, back, emptyState('Not available for your role', 'Ask the owner if you need access to this page.'));
  }
  const phase = phaseOf(m);
  const list = (items) => h('ul', { class: 'plain' }, items.map((t) => h('li', null, t)));

  return h('div', { class: 'stack' },
    h('div', null, back,
      h('div', { class: 'page-head' }, h('div', { class: 'stack-sm' },
        h('h1', null, m.title),
        h('div', { class: 'cluster' },
          h('span', { class: 'chip warn' }, 'Not built yet'),
          h('span', { class: 'chip muted' }, `Point ${m.no}, phase ${m.phase}: ${phase.name}`))))),
    m.source ? h('blockquote', { class: 'source' }, h('p', null, m.source), h('footer', null, 'From the owner\'s handwritten list')) : null,
    h('section', { class: 'panel' }, h('h2', null, 'What this page will do'), list(m.features)),
    h('section', { class: 'panel' }, h('h2', null, 'Needs these first'), list(m.needs)),
    m.question ? h('section', { class: 'panel' }, h('h2', null, 'Question for the owner'), h('p', null, m.question)) : null);
}
