// The 10 points from the owner's handwritten list, and the build phase each one belongs to.
// This table drives the "All pages" screen, the placeholder pages and the menu.
// When a phase is built, change that module's status to 'built' and set its path.

const OFFICE = ['owner', 'manager', 'accountant'];
const SHOP = ['store_keeper', 'mechanic'];

export const PHASES = [
  {
    n: 0, name: 'Groundwork', status: 'done',
    summary: 'Database with roles, audit log, no hard deletes, document numbers and period lock. App with login, menus and this skeleton.',
    modules: [],
  },
  {
    n: 1, name: 'Trucks, documents and drivers', status: 'done',
    summary: 'Every truck and driver in one place, with document expiry alerts and daily attendance.',
    modules: ['documents', 'classification', 'drivers'],
  },
  {
    n: 2, name: 'Diesel and trips', status: 'next',
    summary: 'Diesel, urea and lube issued per truck, trips by destination, and cash advances to drivers. Gives mileage and cost per trip.',
    modules: ['fuel', 'trips'],
  },
  {
    n: 3, name: 'Tyres', status: 'planned',
    summary: 'Every tyre, tube and flap tracked from purchase to fitment, punctures and resoling. Gives cost per tyre and per km.',
    modules: ['tyres', 'tyreshop'],
  },
  {
    n: 4, name: 'Warehouse and creditors', status: 'planned',
    summary: 'Stock of tyres and parts as a ledger of receipts and issues, and what is owed to each parts shop. The hardest phase, so it comes after the master data is clean.',
    modules: ['warehouse', 'creditors'],
  },
  {
    n: 5, name: 'Parts indent and maintenance', status: 'planned',
    summary: 'Parts requests with approval, issued from the warehouse to a job card on a truck. Servicing and repairs with parts and downtime.',
    modules: ['indents', 'maintenance'],
  },
  {
    n: 6, name: 'Reports', status: 'planned',
    summary: 'Cost per truck, per km and per month. Downtime, low stock, what is owed. Exports to Excel and Tally.',
    modules: [],
  },
];

export const MODULES = [
  {
    id: 'documents', no: '1', title: 'Documents checklist', phase: 1, status: 'built', path: '/trucks',
    roles: [...OFFICE, ...SHOP],
    summary: 'RC, particulars, insurance, fitness, tax, permit, pollution and national permit for every truck, with expiry alerts.',
  },
  {
    id: 'classification', no: '2', title: 'Vehicle classification', phase: 1, status: 'built', path: '/trucks',
    roles: [...OFFICE, ...SHOP],
    summary: 'National or domestic permit type on each truck. It decides which documents are required.',
  },
  {
    id: 'drivers', no: '3', title: 'Driver details', phase: 1, status: 'built', path: '/drivers',
    roles: OFFICE,
    summary: 'Driving licence, Aadhaar (last 4 digits), phone and bank account, plus daily attendance.',
  },
  {
    id: 'fuel', no: '4', title: 'Diesel, urea and lube', phase: 2, status: 'planned',
    roles: [...OFFICE, 'store_keeper'],
    source: 'Diesel and urea, lube. Details fetched from filling station.',
    summary: 'What each truck was given at the filling station, and how far it ran on it.',
    features: [
      'Fill entry from the station: date, litres, rate, amount, odometer and a photo of the slip',
      'Diesel, urea and lube oil issued to each truck',
      'Mileage for every fill, with an alert when it looks too low',
      'Station bills checked against what was issued',
    ],
    needs: ['Trucks', 'Drivers'],
    tables: ['fuel_stations', 'fuel_entries'],
  },
  {
    id: 'tyres', no: '5', title: 'Tyres, tubes and flaps', phase: 3, status: 'planned',
    roles: [...OFFICE.slice(0, 2), ...SHOP],
    source: 'Tyre, tube, flap. Serial no., brand name, tyre ageing, puncture monitoring, resoling.',
    summary: 'Each tyre, tube and flap with its own record from purchase to scrap.',
    features: [
      'Serial number and brand for every tyre, tube and flap',
      'Which tyre is on which truck and wheel position, with fitment history',
      'Tyre ageing: date fitted, km run, cost per km',
      'Puncture monitoring: how often, on which tyre, and why',
      'Resoling history and cost',
    ],
    needs: ['Trucks', 'Warehouse stock (for new tyres)'],
    tables: ['tyres', 'tyre_events'],
  },
  {
    id: 'maintenance', no: '6', title: 'Maintenance', phase: 5, status: 'planned',
    roles: [...OFFICE.slice(0, 2), ...SHOP],
    source: 'Maintenance. Servicing, pati. Attendance.',
    summary: 'Servicing and repairs for each truck, with parts used and days off the road.',
    features: [
      'Servicing due by km or by days, with alerts',
      'Pati (leaf spring) repairs and replacements',
      'Job card for each repair: parts issued from the warehouse, labour, status',
      'Days each truck was in the workshop',
    ],
    needs: ['Trucks', 'Parts indent', 'Warehouse stock'],
    tables: ['job_cards', 'job_card_parts'],
    question: 'His list also has "attendance" under maintenance. Does it mean mechanic attendance, or days a truck spent in the workshop?',
  },
  {
    id: 'creditors', no: '7', title: 'Creditors (parts shops)', phase: 4, status: 'planned',
    roles: OFFICE,
    source: 'Creditors, parts shop. Kamala Mohanty, Tarikh parts, Patra parts, TVS Automobil, Samal Motors, Ohm Enterprises.',
    summary: 'What the company owes each parts shop.',
    features: [
      'Shop list: Kamala Mohanty, Tarikh Parts, Patra Parts, TVS Automobil, Samal Motors, Ohm Enterprises',
      'Bills and goods received from each shop, with GST number and bill number',
      'Payments made and balance owed',
      'What is overdue, oldest first',
    ],
    needs: ['Warehouse stock (goods received create the bill)'],
    tables: ['vendors', 'vendor_bills', 'vendor_payments'],
  },
  {
    id: 'tyreshop', no: '8a', title: 'Tyre shop', phase: 3, status: 'planned',
    roles: [...OFFICE.slice(0, 2), ...SHOP],
    source: 'Tyre shop. Tyre fitment and puncture.',
    summary: 'The tyre shop desk: fitting tyres and repairing punctures.',
    features: [
      'Record each fitment and removal against a truck and wheel position',
      'Record each puncture repair with cost',
      'Same data as the tyre records, entered from the shop floor on a phone',
    ],
    needs: ['Tyres, tubes and flaps'],
    tables: ['tyre_events (shared with Tyres)'],
  },
  {
    id: 'warehouse', no: '8b', title: 'Warehouse', phase: 4, status: 'planned',
    roles: [...OFFICE, 'store_keeper'],
    source: 'Warehouse. Tyre, tube, flap, omni, gatish, parts.',
    summary: 'Stock of tyres, tubes, flaps and spare parts.',
    features: [
      'Item list with units and re-order level',
      'Goods received from a shop, and goods issued to a truck or job',
      'Stock is a ledger of receipts and issues. It is never edited directly',
      'Physical count against system stock',
    ],
    needs: ['Trucks'],
    tables: ['items', 'stock_ledger', 'goods_receipts'],
    question: 'What are "omni" and "gatish" in his list? They look like item groups.',
  },
  {
    id: 'indents', no: '9', title: 'Parts indent', phase: 5, status: 'planned',
    roles: [...OFFICE.slice(0, 2), ...SHOP],
    source: "Parts' indent.",
    summary: 'A request for parts, approved, then issued from the warehouse.',
    features: [
      'Mechanic or driver requests parts for a truck',
      'Manager approves or rejects',
      'Store keeper issues from stock, and the cost lands on that truck',
      'Numbered IND/2026-27/00001, with no gaps',
    ],
    needs: ['Warehouse stock', 'Trucks'],
    tables: ['indents', 'indent_lines'],
  },
  {
    id: 'trips', no: '10', title: 'Trip details', phase: 2, status: 'planned',
    roles: OFFICE,
    source: 'Trip details. Destination wise. HSD and cash advance.',
    summary: 'Each trip by destination, with the diesel and cash advance given for it.',
    features: [
      'Trip: truck, driver, loading point, destination, dates, km',
      'Diesel (HSD) given for the trip',
      'Cash advance to the driver, with approval and settlement against expenses',
      'Cost and income per destination',
    ],
    needs: ['Trucks', 'Drivers', 'Diesel, urea and lube'],
    tables: ['trips', 'cash_advances'],
  },
];

export function moduleById(id) { return MODULES.find((m) => m.id === id) || null; }
export function phaseOf(m) { return PHASES.find((p) => p.n === m.phase); }
