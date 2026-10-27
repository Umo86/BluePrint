import 'server-only';
import { and, eq } from 'drizzle-orm';
import { getDb } from '../db/client';
import { assistantFaqs, companies, companyMembers, editions, editionStaff, exhibitorTypes, halls, invitations, orderLines, standContractors, stands, supplierUsers, users } from '../db/schema';
import type { EditionAssistantSettings } from '@/lib/assistant-config';
import type { Actor } from '../auth/actor';
import { hashPassword, passwordProblems } from '../security/password';
import { createEdition, createShow, updateEditionBranding, updateEditionContacts } from '../services/editions';
import { createSupplier } from '../services/suppliers';
import { createCategory, createProduct } from '../services/catalogue';
import { createTask } from '../services/tasks';
import { createPage } from '../services/manual';
import { createAnnouncement } from '../services/announcements';
import { markTask, reviewSubmission, saveAnswers } from '../services/submissions';
import { addToBasket, basketForStand, checkout } from '../services/shop';
import { markInvoicePaid, setLineFulfilment } from '../services/orders';
import { openTicket, replyAsStaff } from '../services/helpdesk';
import { nominateContractor, savePackDraft } from '../services/space-only';
import { inviteExhibitorContact } from '../services/stands';
import type { TestLogin } from '../test-logins';

/**
 * Demo data for trying BluePrint out as every kind of account: an invented organiser's two shows,
 * one of them live with exhibitors, suppliers, a show team, a stand contractor and things already
 * happening (orders, forms, questions, a stand pack in progress). All names are made up and every
 * address ends in .test, so nothing can reach a real person.
 */

export const DEMO_EDITION_SLUG = 'buildexpo-london-2027';

/** The accounts the test logins point at (the super admin is whichever one already exists). */
export const DEMO_ACCOUNTS = {
  showAdmin: { email: 'olivia@buildexpo.test', name: 'Olivia Grant' },
  showTeam: { email: 'sam@buildexpo.test', name: 'Sam Patel' },
  reviewer: { email: 'hannah@safestands.test', name: 'Hannah Reid' },
  shellExhibitor: { email: 'amira@acme-insulation.test', name: 'Amira Khan' },
  spaceExhibitor: { email: 'ella@evergreen-timber.test', name: 'Ella Morgan' },
  contractor: { email: 'carl@buildright-stands.test', name: 'Carl Mason' },
  supplier: { email: 'fiona@expofurniture.test', name: 'Fiona Hale' },
} as const;

type UserRow = typeof users.$inferSelect;

function actorFor(u: UserRow): Actor {
  return { userId: u.id, email: u.email, name: u.name, isSuperAdmin: u.isSuperAdmin, readOnly: false, realUserId: u.id, realEmail: u.email, ip: '127.0.0.1', userAgent: 'demo data' };
}

async function addUser(email: string, name: string, extra: Partial<typeof users.$inferInsert> = {}) {
  const db = await getDb();
  const [u] = await db.insert(users).values({ email, name, status: 'active', ...extra }).returning();
  return u;
}

/** An existing super admin acts for the set-up (the test login's, if there is one); otherwise one is made. */
async function superAdmin(logins: TestLogin[]) {
  const db = await getDb();
  const wanted = logins.find((l) => /super admin/i.test(l.role))?.email;
  if (wanted) {
    const [u] = await db.select().from(users).where(and(eq(users.email, wanted), eq(users.isSuperAdmin, true))).limit(1);
    if (u) return u;
  }
  const [any] = await db.select().from(users).where(eq(users.isSuperAdmin, true)).limit(1);
  return any ?? addUser(wanted ?? 'demo.admin@blueprint.test', 'Dana Admin', { isSuperAdmin: true });
}

const html = (...parts: string[]) => parts.join('');

/**
 * Adds the demo shows once (it skips them if they are already there), then gives each test login's
 * account its password. Returns what it did, for the build log.
 */
export async function loadDemoData(logins: TestLogin[]): Promise<string[]> {
  const db = await getDb();
  const done: string[] = [];
  const [existing] = await db.select({ id: editions.id }).from(editions).where(eq(editions.slug, DEMO_EDITION_SLUG)).limit(1);
  if (existing) done.push('Demo shows are already there.');
  else {
    await createDemoShows(logins);
    done.push('Added the demo shows, accounts and activity.');
  }
  done.push(...(await ensureDemoAssistant(logins)));
  done.push(...(await setDemoPasswords(logins)));
  return done;
}

/** The demo show's assistant set-up: a name, greeting, house rules, office hours, a low daily limit and a few answers. */
export const DEMO_ASSISTANT: EditionAssistantSettings = {
  name: 'BuildExpo helper',
  greeting: 'Hi {first_name}, I’m the BuildExpo helper. Ask me anything about getting your stand ready for BuildExpo London, or let me help you with your checklist.',
  suggestions: ['What do I still need to do?', 'When can I start building my stand?', 'How do I book a delivery slot?', 'What should I order for my stand?'],
  instructions:
    'Call us the BuildExpo team. For anything urgent on site during build-up or the show, give the operations team’s number, 020 7946 0101. Never promise refunds, discounts or extra stand space: offer to pass those questions to the show team.',
  // Low while anyone can try the demo logins.
  dailyLimit: 100,
  officeHours: { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:30' },
  replyTime: 'hours4',
  askPhone: true,
};

const DEMO_FAQS = [
  { question: 'Can we bring our own furniture?', answer: 'Yes. Keep it within your stand and the gangways clear. Deliveries need a delivery slot, which you can book from 1 March 2027.' },
  { question: 'Is wifi included with our stand?', answer: 'No, wifi is not included with any stand. Ask the show team on the Help page if you need an internet connection.' },
  { question: 'Who do we call on site if something goes wrong?', answer: 'Call the BuildExpo operations team on 020 7946 0101, or come to the organiser’s office in hall N1.' },
];

/**
 * Gives the live demo show its assistant set-up and answers, once: a show the team has set up itself
 * (any settings or answers already there) is left alone.
 */
export async function ensureDemoAssistant(logins: TestLogin[]): Promise<string[]> {
  const db = await getDb();
  const [edition] = await db.select().from(editions).where(eq(editions.slug, DEMO_EDITION_SLUG)).limit(1);
  if (!edition) return [];
  const notes: string[] = [];
  if (!Object.keys(edition.assistantSettings ?? {}).length) {
    await db.update(editions).set({ assistantSettings: DEMO_ASSISTANT }).where(eq(editions.id, edition.id));
    notes.push('Set up the demo show’s AI assistant.');
  }
  const [faq] = await db.select({ id: assistantFaqs.id }).from(assistantFaqs).where(eq(assistantFaqs.editionId, edition.id)).limit(1);
  if (!faq) {
    const admin = await superAdmin(logins);
    await db.insert(assistantFaqs).values(DEMO_FAQS.map((f) => ({ editionId: edition.id, ...f, createdBy: admin.id })));
    notes.push('Added answers for the demo show’s AI assistant.');
  }
  return notes;
}

/** Gives each test login's account its password (accounts that do not exist are skipped). */
export async function setDemoPasswords(logins: TestLogin[]): Promise<string[]> {
  const db = await getDb();
  const notes: string[] = [];
  for (const l of logins) {
    const [u] = await db.select().from(users).where(eq(users.email, l.email)).limit(1);
    if (!u) {
      notes.push(`No account for ${l.email}, so its password was not set.`);
      continue;
    }
    const problem = passwordProblems(l.password, l.email);
    if (problem) {
      notes.push(`Password for ${l.email} not set: ${problem}`);
      continue;
    }
    await db
      .update(users)
      .set({ passwordHash: await hashPassword(l.password), failedPasswordAttempts: 0, lockedUntil: null })
      .where(eq(users.id, u.id));
    notes.push(`Password set for ${l.role} (${l.email}).`);
  }
  return notes;
}

async function createDemoShows(logins: TestLogin[]) {
  const db = await getDb();
  const admin = await superAdmin(logins);
  const actor = actorFor(admin);

  // Shows and editions ------------------------------------------------------
  const expo = await createShow(actor, { name: 'BuildExpo', description: 'Building products, construction and site technology.' });
  const london = await createEdition(actor, expo.id, {
    name: 'BuildExpo London 2027',
    slug: DEMO_EDITION_SLUG,
    venue: 'ExCeL London',
    city: 'London',
    buildUpStartsAt: '2027-05-03 08:00',
    openStartsAt: '2027-05-05 09:00',
    openEndsAt: '2027-05-07 17:00',
    breakdownEndsAt: '2027-05-08 18:00',
    status: 'live',
  });
  const homes = await createShow(actor, { name: 'Green Homes Live', description: 'Retrofit, renewable energy and sustainable homes.' });
  await createEdition(actor, homes.id, {
    name: 'Green Homes Live 2027',
    slug: 'green-homes-live-2027',
    venue: 'NEC',
    city: 'Birmingham',
    buildUpStartsAt: '2027-09-20 08:00',
    openStartsAt: '2027-09-22 10:00',
    openEndsAt: '2027-09-23 17:00',
    breakdownEndsAt: '2027-09-24 18:00',
  });
  await updateEditionBranding(actor, london.id, { primaryColor: '#1d3557', accentColor: '#0f766e', footerText: 'BuildExpo London 2027, ExCeL London, 5 to 7 May 2027.' });
  await updateEditionContacts(actor, london.id, {
    contacts: [
      { id: 'ops', team: 'Operations', name: 'BuildExpo operations team', email: 'ops@buildexpo.test', phone: '+44 20 7946 0101' },
      { id: 'sales', team: 'Stand sales', name: 'Priya Shah', email: 'sales@buildexpo.test', phone: '+44 20 7946 0102' },
      { id: 'marketing', team: 'Marketing', email: 'marketing@buildexpo.test', note: 'Logos, listings and show guide entries.' },
      { id: 'venue', team: 'Venue', name: 'ExCeL London', note: 'Royal Victoria Dock, 1 Western Gateway, London E16 1XL' },
    ],
  });

  const types = await db.select().from(exhibitorTypes).where(eq(exhibitorTypes.editionId, london.id));
  const shell = types.find((t) => t.key === 'shell_scheme')!;
  const space = types.find((t) => t.key === 'space_only')!;
  const hallRows = await db
    .insert(halls)
    .values(['N1', 'N2', 'N3'].map((name, i) => ({ editionId: london.id, name, sort: i + 1 })))
    .returning();

  // The show team --------------------------------------------------------------
  const team: Record<string, UserRow> = {};
  for (const [key, a, role, permissions] of [
    ['showAdmin', DEMO_ACCOUNTS.showAdmin, 'show_admin', []],
    ['showTeam', DEMO_ACCOUNTS.showTeam, 'show_team', ['manage_exhibitors', 'manage_orders', 'view_reports', 'helpdesk']],
    ['reviewer', DEMO_ACCOUNTS.reviewer, 'hs_reviewer', []],
  ] as const) {
    const u = await addUser(a.email, a.name, { jobTitle: role === 'hs_reviewer' ? 'Health and safety consultant' : role === 'show_admin' ? 'Operations manager' : 'Exhibitor services' });
    await db.insert(editionStaff).values({ editionId: london.id, userId: u.id, role, permissions: [...permissions] as never, addedBy: admin.id });
    team[key] = u;
  }
  const opsActor = actorFor(team.showAdmin);
  const teamActor = actorFor(team.showTeam);

  // Suppliers ------------------------------------------------------------------
  const supplierIds: Record<string, string> = {};
  const supplierUsersByName: Record<string, UserRow> = {};
  for (const s of [
    { name: 'Expo Furniture Hire', email: 'orders@expofurniture.test', user: DEMO_ACCOUNTS.supplier },
    { name: 'PowerOn Electrical', email: 'orders@poweron-electrical.test', user: { email: 'pete@poweron-electrical.test', name: 'Pete Brooks' } },
    { name: 'ShowSound AV', email: 'orders@showsound-av.test', user: { email: 'sophie@showsound-av.test', name: 'Sophie Lane' } },
  ]) {
    const sup = await createSupplier(actor, { name: s.name, email: s.email });
    supplierIds[s.name] = sup.id;
    const u = await addUser(s.user.email, s.user.name);
    await db.insert(supplierUsers).values({ supplierId: sup.id, userId: u.id });
    supplierUsersByName[s.name] = u;
  }

  // Manual pages -----------------------------------------------------------------
  const page = (title: string, bodyHtml: string, visibleToTypes: string[] = [], pinned = false) => createPage(actor, london.id, { title, bodyHtml, visibleToTypes, published: true, pinned });
  await page(
    'Welcome to BuildExpo London 2027',
    html(
      '<p>Thank you for exhibiting at BuildExpo London. This manual has everything you need to get your stand ready: the rules, the deadlines and the services you can order.</p>',
      '<p>Start with <strong>your checklist</strong>. It lists what your stand needs to do and by when, and ticks things off as you go.</p>',
      '<h2>Key dates</h2><ul><li>Build-up: Monday 3 May 2027 from 08:00</li><li>Show open: Wednesday 5 to Friday 7 May, 09:00 to 17:00</li><li>Breakdown: Friday 7 May from 17:30 to Saturday 8 May at 18:00</li></ul>',
    ),
    [],
    true,
  );
  const rulesPage = await page(
    'Build-up and breakdown',
    html(
      '<h2>Build-up</h2><p>Halls open for build-up at 08:00 on Monday 3 May. Space-only stands may start from 08:00; shell scheme stands are ready from 14:00 on Tuesday 4 May.</p>',
      '<p>All building work must finish by 20:00 on Tuesday 4 May. Gangways must be clear by then so the carpet can be laid.</p>',
      '<h2>Breakdown</h2><p>Nothing may be removed from stands before 17:30 on Friday 7 May. Please leave your stand as you found it and take all waste with you.</p>',
      '<h2>Working safely</h2><ul><li>Wear hi-vis and safety footwear in the halls during build-up and breakdown.</li><li>No work at height without the right equipment and a trained operator.</li><li>Children under 16 are not allowed in the halls during build-up and breakdown.</li></ul>',
    ),
  );
  await page(
    'Deliveries and vehicle access',
    html(
      '<p>Every vehicle needs a delivery slot. Slots open on 1 March 2027 and are booked online.</p>',
      '<p>Vans and cars may stay at the loading bays for 30 minutes. Lorries are directed to the holding area until their slot.</p>',
      '<p>Address deliveries to: <strong>Your company name, stand number, BuildExpo London, ExCeL London, Royal Victoria Dock, London E16 1XL</strong>.</p>',
    ),
  );
  await page(
    'Shell scheme stands',
    html(
      '<p>Your shell scheme stand comes with white walls 2.5 m high, a fascia board with your company name, carpet, two spotlights and a power socket.</p>',
      '<p>Tell us the name for your fascia board in your checklist. You can order extra furniture, lighting and graphics from the shop.</p>',
      '<p>Please do not paint, drill or nail the walls. Use hook-and-loop pads to hang graphics.</p>',
    ),
    [shell.id],
  );
  await page(
    'Space-only stands',
    html(
      '<p>Space-only stands are built by your own contractor. Before build-up, the show team must approve your stand design and your contractor’s safety documents.</p>',
      '<h2>What to send</h2><ul><li>Stand drawings with dimensions and heights</li><li>Risk assessment and method statement</li><li>Construction phase plan (CDM 2015)</li><li>Your contractor’s public liability insurance (at least £5 million)</li></ul>',
      '<p>The maximum stand height is 4 m. Anything higher, or any stand with a second level, counts as a complex structure and needs structural calculations.</p>',
    ),
    [space.id],
  );
  await page(
    'Health and safety',
    html(
      '<p>Everyone working on your stand must follow the venue’s health and safety rules. Your stand’s main contact is responsible for this during the show.</p>',
      '<p>Report any accident or near miss to the organiser’s office in the hall straight away.</p>',
    ),
  );

  // Shop ---------------------------------------------------------------------------
  const furniture = await createCategory(actor, london.id, {
    name: 'Furniture',
    description: 'Delivered to your stand before build-up ends and collected after the show.',
    supplierId: supplierIds['Expo Furniture Hire'],
    orderByOffsetDays: 21,
    commissionType: 'percent',
    commissionValue: 1500,
  });
  const electrics = await createCategory(actor, london.id, {
    name: 'Electrics',
    description: 'Every stand needs its electrics ordered in advance. Space-only stands must order a mains supply.',
    supplierId: supplierIds['PowerOn Electrical'],
    orderByOffsetDays: 28,
    commissionType: 'percent',
    commissionValue: 1000,
  });
  const av = await createCategory(actor, london.id, { name: 'Audio visual', supplierId: supplierIds['ShowSound AV'], orderByOffsetDays: 14 });
  const cleaning = await createCategory(actor, london.id, { name: 'Stand cleaning', description: 'Provided by the organiser.', orderByOffsetDays: 7, visibleToTypes: [shell.id] });
  const product = (categoryId: string, p: Omit<Parameters<typeof createProduct>[2], 'categoryId'>) => createProduct(actor, london.id, { categoryId, ...p });
  const chair = await product(furniture.id, { name: 'Folding chair', code: 'FUR-CH1', description: 'Padded seat, stackable.', pricePence: 1800, vatRateBps: 2000, stockLimit: 200, options: [{ name: 'Colour', values: ['Black', 'White'] }] });
  const table = await product(furniture.id, { name: 'Poseur table', code: 'FUR-PT1', description: '60 cm round top, 110 cm high.', pricePence: 4500, vatRateBps: 2000, options: [{ name: 'Top', values: ['White', 'Black'] }] });
  await product(furniture.id, { name: 'Lockable counter', code: 'FUR-LC1', description: '1 m wide with a lockable cupboard and shelf.', pricePence: 9500, earlyPricePence: 8500, earlyUntilOffsetDays: 42, latePricePence: 12_000, lateFromOffsetDays: 10, vatRateBps: 2000, stockLimit: 40 });
  const rack = await product(furniture.id, { name: 'Literature rack', code: 'FUR-LR1', pricePence: 3500, vatRateBps: 2000 });
  const socket = await product(electrics.id, {
    name: '500 W power socket',
    code: 'ELE-S500',
    description: 'Single 13 A socket, live from the start of build-up.',
    pricePence: 8500,
    latePricePence: 11_000,
    lateFromOffsetDays: 10,
    vatRateBps: 2000,
    requiredDetails: [{ id: 'position', label: 'Where on the stand should it go?', type: 'text', required: true }],
  });
  const spotlight = await product(electrics.id, { name: 'LED spotlight on arm', code: 'ELE-LED', pricePence: 4200, vatRateBps: 2000 });
  const mains = await product(electrics.id, { name: '24-hour power supply', code: 'ELE-24H', description: 'For fridges and servers that must stay on overnight.', pricePence: 16_000, vatRateBps: 2000 });
  const screen = await product(av.id, { name: '55-inch screen with floor stand', code: 'AV-55', description: 'HDMI input, delivered and set up on your stand.', pricePence: 29_500, vatRateBps: 2000, stockLimit: 20 });
  await product(cleaning.id, { name: 'Daily stand clean', code: 'CLN-D', description: 'Vacuum, empty bins and wipe down each morning of the show.', unit: 'per day', pricePence: 3500, vatRateBps: 2000 });

  // Checklist tasks -----------------------------------------------------------------
  const rules = await createTask(actor, london.id, {
    title: 'Read the build-up and breakdown rules',
    descriptionHtml: '<p>Vehicle access times, working at height and what can be left on the stand overnight.</p>',
    kind: 'info',
    linkedPageId: rulesPage.id,
    deadline: { mode: 'offset', offsetDays: 21 },
    published: true,
    requirements: { [shell.id]: 'required', [space.id]: 'required' },
  });
  await createTask(actor, london.id, {
    title: 'Order your stand electrics',
    descriptionHtml: '<p>Order sockets and lighting from the shop. Space-only stands must order their mains supply.</p>',
    kind: 'order',
    linkedCategoryId: electrics.id,
    deadline: { mode: 'offset', offsetDays: 28 },
    published: true,
    requirements: { [space.id]: 'required', [shell.id]: 'if_applicable' },
  });
  const fascia = await createTask(actor, london.id, {
    title: 'Tell us the name for your fascia board',
    descriptionHtml: '<p>The name printed above your shell scheme stand. The show team checks it before it goes to print.</p>',
    kind: 'form',
    formSchema: [{ id: 'fascia', type: 'text', label: 'Name on your fascia board', help: 'Up to 30 characters, exactly as it should appear.', required: true, maxLength: 30 }],
    requiresApproval: true,
    deadline: { mode: 'offset', offsetDays: 42 },
    published: true,
    requirements: { [shell.id]: 'required' },
  });
  // Already past, so the overview has someone to chase.
  const contact = await createTask(actor, london.id, {
    title: 'Your on-site contact',
    descriptionHtml: '<p>Who we should call on the day if there is a problem with your stand.</p>',
    kind: 'form',
    formSchema: [
      { id: 'name', type: 'text', label: 'Name', required: true },
      { id: 'mobile', type: 'phone', label: 'Mobile number', required: true },
      { id: 'vehicles', type: 'number', label: 'Vehicles arriving at build-up', min: 0, max: 20 },
    ],
    deadline: { mode: 'fixed', at: new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString() },
    locksAtDeadline: false,
    published: true,
    requirements: { [shell.id]: 'required', [space.id]: 'required' },
  });
  const declaration = await createTask(actor, london.id, {
    title: 'Health and safety declaration',
    descriptionHtml: '<p>Confirm that your team and contractors will follow the health and safety rules.</p>',
    kind: 'declaration',
    formSchema: [
      {
        id: 'declaration',
        type: 'declaration',
        label: 'Declaration',
        statement: 'We have read the health and safety rules and will follow them during build-up, the show and breakdown.',
        required: true,
      },
    ],
    deadline: { mode: 'offset', offsetDays: 28 },
    published: true,
    requirements: { [shell.id]: 'required', [space.id]: 'required' },
  });

  // Announcements -----------------------------------------------------------------------
  await createAnnouncement(actor, london.id, {
    title: 'Delivery slots open on 1 March',
    bodyHtml: '<p>Every vehicle coming to build-up needs a delivery slot. Booking opens on 1 March 2027; see <em>Deliveries and vehicle access</em> in the manual.</p>',
    when: 'now',
    pinned: true,
  });
  await createAnnouncement(actor, london.id, {
    title: 'Free stand clean on the first morning',
    bodyHtml: '<p>Every shell scheme stand gets a free clean before the doors open on Wednesday 5 May.</p>',
    visibleToTypes: [shell.id],
    when: 'now',
  });

  // Exhibitors ----------------------------------------------------------------------------
  type Exhibitor = { name: string; stand: string; type: typeof shell; hall: number; width: number; depth: number; contact?: { email: string; name: string }; invite?: string; invoice?: boolean };
  const exhibitors: Exhibitor[] = [
    { name: 'Acme Insulation Ltd', stand: 'N1-110', type: shell, hall: 0, width: 3, depth: 3, contact: DEMO_ACCOUNTS.shellExhibitor, invoice: true },
    { name: 'BrightBuild Windows', stand: 'N1-214', type: shell, hall: 0, width: 4, depth: 3, contact: { email: 'ben@brightbuild.test', name: 'Ben Carter' } },
    { name: 'Cladtech Systems', stand: 'N2-305', type: shell, hall: 1, width: 6, depth: 3, contact: { email: 'chloe@cladtech.test', name: 'Chloe Wright' }, invoice: true },
    { name: 'Dura Roofing Group', stand: 'N2-410', type: shell, hall: 1, width: 3, depth: 3, contact: { email: 'dev@duraroofing.test', name: 'Dev Patel' } },
    { name: 'Evergreen Timber Frames', stand: 'N3-501', type: space, hall: 2, width: 12, depth: 6, contact: DEMO_ACCOUNTS.spaceExhibitor, invoice: true },
    { name: 'Fortis Steel', stand: 'N3-620', type: space, hall: 2, width: 12, depth: 10, contact: { email: 'finn@fortissteel.test', name: 'Finn O’Brien' } },
    { name: 'GreenRoof Solutions', stand: 'N1-118', type: shell, hall: 0, width: 3, depth: 2, contact: { email: 'grace@greenroof.test', name: 'Grace Lee' } },
    { name: 'Hydro Plumbing Supplies', stand: 'N2-322', type: shell, hall: 1, width: 4, depth: 3, invite: 'harry@hydroplumbing.test' },
    { name: 'Ironside Tools', stand: 'N2-330', type: shell, hall: 1, width: 3, depth: 3, invite: 'isla@ironside-tools.test' },
    { name: 'Jupiter Solar', stand: 'N3-510', type: space, hall: 2, width: 9, depth: 6 },
  ];
  const standIds: Record<string, string> = {};
  const people: Record<string, UserRow> = {};
  for (const x of exhibitors) {
    const domain = (x.contact?.email ?? x.invite ?? `info@${x.name.toLowerCase().replace(/[^a-z]+/g, '')}.test`).split('@')[1];
    const [c] = await db
      .insert(companies)
      .values({ name: x.name, website: `https://www.${domain.replace(/\.test$/, '.example')}`, country: 'United Kingdom', invoiceAllowed: Boolean(x.invoice) })
      .returning();
    const [s] = await db
      .insert(stands)
      .values({
        editionId: london.id,
        number: x.stand,
        exhibitorTypeId: x.type.id,
        hallId: hallRows[x.hall].id,
        companyId: c.id,
        widthM: String(x.width),
        depthM: String(x.depth),
        sizeSqm: String(x.width * x.depth),
        openSides: x.type.id === space.id ? 3 : 1,
      })
      .returning();
    standIds[x.name] = s.id;
    if (x.contact) {
      const u = await addUser(x.contact.email, x.contact.name);
      await db.insert(companyMembers).values({ companyId: c.id, userId: u.id, role: 'main_contact', canPay: true });
      people[x.name] = u;
    } else if (x.invite) {
      await inviteExhibitorContact(opsActor, london.id, c.id, { email: x.invite, role: 'main_contact', sendNow: true });
    }
  }
  // A colleague on Acme's team, who can't pay.
  const tom = await addUser('tom@acme-insulation.test', 'Tom Reed');
  const [acme] = await db.select().from(companies).where(eq(companies.name, 'Acme Insulation Ltd')).limit(1);
  await db.insert(companyMembers).values({ companyId: acme.id, userId: tom.id, role: 'colleague', canPay: false });

  // What exhibitors have done so far -------------------------------------------------
  const ex = (name: string) => ({ actor: actorFor(people[name]), stand: standIds[name] });

  // Acme: rules read, fascia approved, contact sent (the declaration is still to do), an order on invoice.
  {
    const { actor: a, stand } = ex('Acme Insulation Ltd');
    await markTask(a, stand, rules.id, 'read');
    await saveAnswers(a, stand, fascia.id, { fascia: 'ACME INSULATION' }, { submit: true });
    await reviewSubmission(opsActor, fascia.id, stand, 'approved', null);
    await saveAnswers(a, stand, contact.id, { name: 'Amira Khan', mobile: '+44 7700 900111', vehicles: 1 }, { submit: true });
    await addToBasket(a, stand, { productId: chair.id, quantity: 4, options: { Colour: 'Black' } });
    await addToBasket(a, stand, { productId: table.id, quantity: 1, options: { Top: 'White' } });
    await addToBasket(a, stand, { productId: socket.id, quantity: 1, details: { position: 'Back wall, left-hand corner' } });
    await addToBasket(a, stand, { productId: spotlight.id, quantity: 2 });
    const basket = await basketForStand(a, stand, 'invoice');
    const placed = await checkout(a, stand, { method: 'invoice', poNumber: 'PO-4471', acceptTerms: true, expectedTotalPence: basket.totals.totalPence });
    // The furniture supplier has confirmed its part.
    const lines = await db.select().from(orderLines).where(and(eq(orderLines.orderId, placed.orderId), eq(orderLines.supplierId, supplierIds['Expo Furniture Hire'])));
    for (const l of lines) await setLineFulfilment(actorFor(supplierUsersByName['Expo Furniture Hire']), l.id, 'confirmed');
  }

  // BrightBuild: rules read, a question answered by the team.
  {
    const { actor: a, stand } = ex('BrightBuild Windows');
    await markTask(a, stand, rules.id, 'read');
    const t = await openTicket(a, stand, {
      subject: 'Can we bring our own furniture?',
      body: 'We have two branded stools we would like to use on our stand. Is that allowed, and do we need to tell anyone?',
    });
    await replyAsStaff(teamActor, t.id, {
      body: 'Yes, you can bring your own furniture. Please keep it within your stand and the gangways clear. Deliveries need a delivery slot, which you can book from 1 March.',
      status: 'pending',
    });
  }

  // Cladtech: fascia waiting for review, a paid invoice order.
  {
    const { actor: a, stand } = ex('Cladtech Systems');
    await markTask(a, stand, rules.id, 'read');
    await saveAnswers(a, stand, fascia.id, { fascia: 'CLADTECH SYSTEMS' }, { submit: true });
    await saveAnswers(a, stand, contact.id, { name: 'Chloe Wright', mobile: '+44 7700 900333' }, { submit: true });
    await saveAnswers(a, stand, declaration.id, { declaration: { agreed: true, name: 'Chloe Wright' } }, { submit: true });
    await addToBasket(a, stand, { productId: screen.id, quantity: 1 });
    await addToBasket(a, stand, { productId: rack.id, quantity: 1 });
    const basket = await basketForStand(a, stand, 'invoice');
    const placed = await checkout(a, stand, { method: 'invoice', acceptTerms: true, expectedTotalPence: basket.totals.totalPence });
    await markInvoicePaid(opsActor, placed.orderId, 'BACS 2026-10-20 CLADTECH');
  }

  // Dura Roofing: fascia sent back with a change asked for.
  {
    const { actor: a, stand } = ex('Dura Roofing Group');
    await saveAnswers(a, stand, fascia.id, { fascia: 'DURA ROOFING' }, { submit: true });
    await reviewSubmission(opsActor, fascia.id, stand, 'changes_needed', 'Please use your full trading name, Dura Roofing Group, so it matches your listing.');
  }

  // GreenRoof: has only read the rules.
  {
    const { actor: a, stand } = ex('GreenRoof Solutions');
    await markTask(a, stand, rules.id, 'read');
  }

  // Evergreen (space only): contractor joined and preparing the stand pack, electrics ordered, a question waiting.
  {
    const { actor: a, stand } = ex('Evergreen Timber Frames');
    await markTask(a, stand, rules.id, 'read');
    await nominateContractor(a, stand, { companyName: 'BuildRight Stands Ltd', contactName: DEMO_ACCOUNTS.contractor.name, email: DEMO_ACCOUNTS.contractor.email, phone: '+44 7700 900123' });
    // The contractor has accepted their invitation.
    const carl = await addUser(DEMO_ACCOUNTS.contractor.email, DEMO_ACCOUNTS.contractor.name, { jobTitle: 'Project manager' });
    await db.update(standContractors).set({ userId: carl.id, status: 'active' }).where(eq(standContractors.standId, stand));
    await db
      .update(invitations)
      .set({ acceptedAt: new Date() })
      .where(and(eq(invitations.standId, stand), eq(invitations.kind, 'contractor')));
    await savePackDraft(actorFor(carl), stand, { heightM: 4, platformMm: 0, hasSteps: false, insuranceCoverGbp: 5_000_000, insuranceExpiresOn: '2027-12-31', documents: {} });
    await addToBasket(a, stand, { productId: mains.id, quantity: 1 });
    await addToBasket(a, stand, { productId: socket.id, quantity: 2, details: { position: 'Reception desk and meeting room' } });
    const basket = await basketForStand(a, stand, 'invoice');
    await checkout(a, stand, { method: 'invoice', acceptTerms: true, expectedTotalPence: basket.totals.totalPence });
    await openTicket(a, stand, {
      subject: 'Rigging above our stand',
      body: 'We would like to hang a 6 m banner above our stand. Who do we speak to about rigging points, and when do you need the drawings?',
    });
  }

  // Fortis Steel (space only): contractor invited but not joined yet.
  {
    const { actor: a, stand } = ex('Fortis Steel');
    await nominateContractor(a, stand, { companyName: 'Apex Exhibition Builds', contactName: 'Jo Hart', email: 'jo@apex-builds.test', phone: '+44 7700 900456' });
  }

}
