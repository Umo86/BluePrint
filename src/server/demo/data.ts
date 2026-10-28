import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { getDb } from '../db/client';
import {
  cartItems,
  assistantConversations,
  assistantFaqs,
  assistantMessages,
  assistantUnanswered,
  companies,
  companyMembers,
  editions,
  editionStaff,
  exhibitorTypes,
  files,
  halls,
  invitations,
  libraryItems,
  orderLines,
  orders,
  products,
  reminderLog,
  shows,
  standContractors,
  stands,
  supplierTransfers,
  supplierUsers,
  suppliers,
  users,
} from '../db/schema';
import type { EditionAssistantSettings } from '@/lib/assistant-config';
import type { Actor } from '../auth/actor';
import { hashPassword, passwordProblems } from '../security/password';
import { assertSuperAdmin } from '../authz';
import { audit } from '../audit';
import { createEdition, createShow, updateEditionBranding, updateEditionContacts } from '../services/editions';
import { createSupplier } from '../services/suppliers';
import { createCategory, createProduct, createSupplierProduct, setProductStatus } from '../services/catalogue';
import { createTask, saveTaskToLibrary } from '../services/tasks';
import { createPage, savePageToLibrary } from '../services/manual';
import { createAnnouncement } from '../services/announcements';
import { markTask, reviewSubmission, saveAnswers } from '../services/submissions';
import { addToBasket, basketForStand, cancelMyCheckout, checkout, simulateCheckout } from '../services/shop';
import { cancelOrder, markInvoicePaid, refundOrder, setLineFulfilment, settleManualTransfer } from '../services/orders';
import { assignTicket, closeTicketAsExhibitor, openTicket, replyAsExhibitor, replyAsStaff, saveSavedReply } from '../services/helpdesk';
import { nominateContractor, reviewPack, savePackDraft, submitPack } from '../services/space-only';
import { addExhibitorNote, inviteExhibitorContact } from '../services/stands';
import { inviteStaff } from '../services/staff';
import { createCampaign, sendCampaign } from '../services/campaigns';
import { PRACTICE_KEY_PREFIX, practiceStorage, storage } from '../storage';
import { parseLocalDateTime, toLocalDateTimeString } from '@/lib/dates';
import { SPACE_ONLY_DOC_LABELS } from '@/lib/space-only';
import { clearDemoFlags } from './flags';
import { getDemoState, removeAll, setDemoState } from './remove';
import { basketCycle } from '../services/baskets';
import type { TestLogin } from '../test-logins';

/**
 * Demo data for trying BluePrint out as every kind of account. An invented organiser runs two
 * shows: BuildExpo London, live and a few weeks from build-up, with 36 exhibitors at every stage
 * (orders paid, invoiced, refunded and cancelled, forms waiting for approval, space-only packs in
 * every review state, questions, assistant conversations, emails), and Green Homes Live, still
 * being set up. Dates are set from the day it is loaded.
 *
 * Everything is marked as demo data, so the super admin can remove it in one go (Super admin →
 * Demo data). All names are made up and every address ends in .test, so nothing can reach a real
 * person; demo shows never take real payments.
 */

/** Bump when the demo data changes: the next build replaces an older version. */
export const DEMO_VERSION = 3;

export const DEMO_EDITION_SLUG = 'buildexpo-london';

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

/** Version 1 of the demo data (before it was marked as demo), so the build can replace it. */
const LEGACY_SHOW_SLUGS = ['buildexpo', 'green-homes-live'];
const LEGACY_EDITION_SLUG = 'buildexpo-london-2027';

type UserRow = typeof users.$inferSelect;

function actorFor(u: Pick<UserRow, 'id' | 'email' | 'name' | 'isSuperAdmin'>): Actor {
  return { userId: u.id, email: u.email, name: u.name, isSuperAdmin: u.isSuperAdmin, readOnly: false, realUserId: u.id, realEmail: u.email, ip: '127.0.0.1', userAgent: 'demo data' };
}

async function addUser(email: string, name: string, extra: Partial<typeof users.$inferInsert> = {}) {
  const db = await getDb();
  const [u] = await db.insert(users).values({ email, name, status: 'active', isDemo: true, ...extra }).returning();
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

// ---------------------------------------------------------------------------
// Loading, replacing and passwords
// ---------------------------------------------------------------------------

/**
 * What the build runs (DEMO_DATA=load): adds the demo data once, replaces an older version, and
 * leaves it out for good once a super admin has removed it. Then gives each test login's account
 * its password. Returns what it did, for the build log.
 */
export async function loadDemoData(logins: TestLogin[]): Promise<string[]> {
  const done: string[] = [];
  const state = await getDemoState();
  if (state?.removedAt) {
    done.push(`The demo data was removed on ${state.removedAt.slice(0, 10)} by ${state.removedBy ?? 'a super admin'}, so it was not added again. Remove DEMO_DATA and TEST_LOGINS from the deployment settings.`);
  } else {
    const legacy = await markLegacyDemoData();
    if (legacy) done.push('Marked the first version of the demo data so it can be replaced.');
    const present = await hasDemoShows();
    let version = state?.version ?? 1;
    // Small additions are made to the demo that is there, so what testers have done is kept.
    while (present && version < DEMO_VERSION && DEMO_UPGRADES[version]) {
      done.push(await DEMO_UPGRADES[version]());
      version += 1;
      await setDemoState({ ...(state ?? { loadedAt: new Date().toISOString() }), version });
    }
    if (present && version < DEMO_VERSION) {
      const counts = await removeAll({ actor: null, markRemoved: false });
      done.push(`Removed the older demo data (${counts.shows} shows, ${counts.people} people, ${counts.orders} orders).`);
    }
    if (!present || version < DEMO_VERSION) {
      await createDemoData(logins);
      done.push(`Added version ${DEMO_VERSION} of the demo shows, accounts and activity.`);
    } else {
      done.push('The demo data is up to date.');
    }
  }
  done.push(...(await setDemoPasswords(logins)));
  return done;
}

/**
 * The super admin starts the demo again from the Demo data page: removes the demo data (if it is
 * there) and adds a fresh copy with today's dates. Also brings it back after it was removed.
 */
export async function resetDemoData(actor: Actor, logins: TestLogin[]) {
  assertSuperAdmin(actor);
  const hadDemo = await hasDemoShows();
  if (hadDemo) await removeAll({ actor: null, keepUserId: actor.realUserId, markRemoved: false });
  else await setDemoState(null);
  await createDemoData(logins);
  await setDemoPasswords(logins);
  await audit(actor, hadDemo ? 'demo.reset' : 'demo.added', { entityType: 'platform_settings', entityId: 'demo_data', details: { version: DEMO_VERSION } });
}

async function hasDemoShows() {
  const db = await getDb();
  const [row] = await db.select({ id: shows.id }).from(shows).where(eq(shows.isDemo, true)).limit(1);
  return Boolean(row);
}

/** The first version was not marked as demo data: marks its shows and suppliers so it can be removed. */
async function markLegacyDemoData() {
  const db = await getDb();
  const [edition] = await db.select({ id: editions.id, showId: editions.showId }).from(editions).where(eq(editions.slug, LEGACY_EDITION_SLUG)).limit(1);
  if (!edition) return false;
  const [show] = await db.select({ isDemo: shows.isDemo }).from(shows).where(eq(shows.id, edition.showId)).limit(1);
  if (show?.isDemo) return false;
  await db.update(shows).set({ isDemo: true }).where(inArray(shows.slug, LEGACY_SHOW_SLUGS));
  await db.update(suppliers).set({ isDemo: true }).where(inArray(suppliers.email, ['orders@expofurniture.test', 'orders@poweron-electrical.test', 'orders@showsound-av.test']));
  await db.update(users).set({ isDemo: true }).where(inArray(users.email, Object.values(DEMO_ACCOUNTS).map((a) => a.email)));
  clearDemoFlags();
  return true;
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

// ---------------------------------------------------------------------------
// The demo show's AI assistant
// ---------------------------------------------------------------------------

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
  { question: 'Can we bring our own furniture?', answer: 'Yes. Keep it within your stand and the gangways clear. Deliveries need a delivery slot, which you can book now.' },
  { question: 'Is wifi included with our stand?', answer: 'No, wifi is not included with any stand. You can order a wired internet connection in the shop, under Internet and lead scanning.' },
  { question: 'Who do we call on site if something goes wrong?', answer: 'Call the BuildExpo operations team on 020 7946 0101, or come to the organiser’s office in hall N1.' },
  { question: 'Is there a prayer room at ExCeL?', answer: 'Yes, there is a quiet room on the boulevard near hall N1. Ask at the organiser’s office for directions.' },
];

/** Gives a demo show its assistant set-up and answers, once: anything the team has set up is left alone. */
export async function ensureDemoAssistant(editionId: string, createdBy: string) {
  const db = await getDb();
  const [edition] = await db.select().from(editions).where(eq(editions.id, editionId)).limit(1);
  if (!edition) return;
  if (!Object.keys(edition.assistantSettings ?? {}).length) await db.update(editions).set({ assistantSettings: DEMO_ASSISTANT }).where(eq(editions.id, edition.id));
  const [faq] = await db.select({ id: assistantFaqs.id }).from(assistantFaqs).where(eq(assistantFaqs.editionId, edition.id)).limit(1);
  if (!faq) await db.insert(assistantFaqs).values(DEMO_FAQS.map((f) => ({ editionId: edition.id, ...f, createdBy })));
}

// ---------------------------------------------------------------------------
// Dates (London time, from the day the data is loaded)
// ---------------------------------------------------------------------------

const DAY = 86_400_000;
const today = () => toLocalDateTimeString(new Date())!.slice(0, 10);
function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const at = (date: string, time: string) => parseLocalDateTime(`${date} ${time}`)!;
/** The first Monday at least `days` days from today. */
function mondayAfter(days: number) {
  let d = addDays(today(), days);
  while (new Date(`${d}T12:00:00Z`).getUTCDay() !== 1) d = addDays(d, 1);
  return d;
}
const longDate = (d: Date) => d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/London' });
const html = (...parts: string[]) => parts.join('');

// ---------------------------------------------------------------------------
// Files: placeholder documents and images, kept like real uploads
// ---------------------------------------------------------------------------

/** A one-page PDF that says what the document would be. */
async function placeholderPdf(title: string, lines: string[]) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setCreator('BluePrint demo data');
  const page = pdf.addPage([595.28, 841.89]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ascii = (t: string) => t.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/[^\x20-\x7e£]/g, '');
  page.drawRectangle({ x: 0, y: 781.89, width: 595.28, height: 60, color: rgb(0.11, 0.21, 0.34) });
  page.drawText('DEMO DOCUMENT', { x: 48, y: 805, size: 12, font: bold, color: rgb(1, 1, 1) });
  page.drawText(ascii(title), { x: 48, y: 730, size: 20, font: bold, color: rgb(0.1, 0.1, 0.1) });
  let y = 700;
  for (const line of lines) {
    page.drawText(ascii(line), { x: 48, y, size: 11, font: regular, color: rgb(0.2, 0.2, 0.2) });
    y -= 18;
  }
  page.drawText('Invented for trying BluePrint out. It is removed with the rest of the demo data.', { x: 48, y: 60, size: 9, font: regular, color: rgb(0.45, 0.45, 0.45) });
  return pdf.save();
}

/** A small plain PNG (for artwork and attachments). */
function placeholderPng() {
  return Uint8Array.from(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAIAAAAuKetIAAAAQklEQVR4nO3PQQ0AIBDAMMC/5+ODfwKOKbYn7dkzv7m3D9wYgBkwYAYMmAEDZsCAGTBgBgyYAQNmwIAZMGAGDJgBA2bAgFkBBQAxS2lJAAAAAElFTkSuQmCC',
      'base64',
    ),
  );
}

/**
 * Keeps a file as if the person had uploaded it: in the database while file storage is not
 * connected (as practice uploads in the demo shows are), otherwise in the site's storage.
 */
async function storeDemoFile(input: {
  purpose: 'space_only' | 'submission' | 'ticket' | 'order';
  filename: string;
  contentType: string;
  body: Uint8Array;
  editionId: string;
  standId: string;
  companyId: string | null;
  uploadedBy: string;
}) {
  const id = randomUUID();
  const practice = storage().kind === 'off';
  const key = `${practice ? PRACTICE_KEY_PREFIX : ''}${input.purpose}/${new Date().toISOString().slice(0, 7)}/${id}`;
  await (practice ? practiceStorage() : storage()).put(key, input.body, input.contentType);
  const db = await getDb();
  const [row] = await db
    .insert(files)
    .values({
      id,
      storageKey: key,
      originalName: input.filename,
      mimeType: input.contentType,
      sizeBytes: input.body.byteLength,
      sha256: createHash('sha256').update(input.body).digest('hex'),
      purpose: input.purpose,
      editionId: input.editionId,
      companyId: input.companyId,
      standId: input.standId,
      supplierId: null,
      isPublic: false,
      uploadedBy: input.uploadedBy,
      verifiedAt: new Date(),
    })
    .returning();
  return row;
}

// ---------------------------------------------------------------------------
// The demo shows
// ---------------------------------------------------------------------------

type Profile = 'complete' | 'good' | 'started' | 'behind' | 'none';
type ExhibitorSpec = {
  key: string;
  name: string;
  domain: string;
  stand: string;
  space?: boolean;
  hall: number;
  w: number;
  d: number;
  /** "First Last" of the main contact; `invite` sends them an invitation instead of an account. */
  person?: string;
  email?: string;
  invite?: boolean;
  invoice?: boolean;
  profile: Profile;
  city: string;
};

const EXHIBITORS: ExhibitorSpec[] = [
  // Shell scheme
  { key: 'acme', name: 'Acme Insulation Ltd', domain: 'acme-insulation.test', stand: 'N1-110', hall: 0, w: 3, d: 3, person: DEMO_ACCOUNTS.shellExhibitor.name, email: DEMO_ACCOUNTS.shellExhibitor.email, invoice: true, profile: 'good', city: 'Leeds' },
  { key: 'brightbuild', name: 'BrightBuild Windows', domain: 'brightbuild.test', stand: 'N1-214', hall: 0, w: 4, d: 3, person: 'Ben Carter', profile: 'started', city: 'Reading' },
  { key: 'cladtech', name: 'Cladtech Systems', domain: 'cladtech.test', stand: 'N2-305', hall: 1, w: 6, d: 3, person: 'Chloe Wright', invoice: true, profile: 'complete', city: 'Coventry' },
  { key: 'dura', name: 'Dura Roofing Group', domain: 'duraroofing.test', stand: 'N2-410', hall: 1, w: 3, d: 3, person: 'Dev Patel', profile: 'good', city: 'Bristol' },
  { key: 'greenroof', name: 'GreenRoof Solutions', domain: 'greenroof.test', stand: 'N1-118', hall: 0, w: 3, d: 2, person: 'Grace Lee', profile: 'started', city: 'Brighton' },
  { key: 'hydro', name: 'Hydro Plumbing Supplies', domain: 'hydroplumbing.test', stand: 'N2-322', hall: 1, w: 4, d: 3, person: 'Harry Shaw', invite: true, profile: 'none', city: 'Stoke-on-Trent' },
  { key: 'ironside', name: 'Ironside Tools', domain: 'ironside-tools.test', stand: 'N2-330', hall: 1, w: 3, d: 3, person: 'Isla Grant', invite: true, profile: 'none', city: 'Sheffield' },
  { key: 'keystone', name: 'Keystone Brick & Block', domain: 'keystone-brick.test', stand: 'N1-120', hall: 0, w: 3, d: 3, person: 'Kofi Mensah', profile: 'complete', city: 'Nottingham' },
  { key: 'lumen', name: 'Lumen Lighting', domain: 'lumen-lighting.test', stand: 'N1-126', hall: 0, w: 4, d: 2, person: 'Lara Novak', profile: 'good', city: 'London' },
  { key: 'meridian', name: 'Meridian Flooring', domain: 'meridian-flooring.test', stand: 'N1-132', hall: 0, w: 3, d: 3, person: 'Max Turner', profile: 'behind', city: 'Norwich' },
  { key: 'northgate', name: 'Northgate Doors', domain: 'northgate-doors.test', stand: 'N1-140', hall: 0, w: 6, d: 3, person: 'Nadia Hussain', invoice: true, profile: 'good', city: 'Bradford' },
  { key: 'oakridge', name: 'Oakridge Joinery', domain: 'oakridge-joinery.test', stand: 'N1-148', hall: 0, w: 3, d: 3, person: 'Owen Price', profile: 'good', city: 'Cardiff' },
  { key: 'pinnacle', name: 'Pinnacle Glazing', domain: 'pinnacle-glazing.test', stand: 'N2-302', hall: 1, w: 3, d: 3, person: 'Petra Kowalski', profile: 'complete', city: 'Milton Keynes' },
  { key: 'quantum', name: 'Quantum Smart Homes', domain: 'quantum-smarthomes.test', stand: 'N2-312', hall: 1, w: 4, d: 3, person: 'Quinn Adams', profile: 'started', city: 'Cambridge' },
  { key: 'redwood', name: 'Redwood Decking', domain: 'redwood-decking.test', stand: 'N2-318', hall: 1, w: 3, d: 3, profile: 'none', city: 'Exeter' },
  { key: 'sunfield', name: 'Sunfield Roof Tiles', domain: 'sunfield-tiles.test', stand: 'N2-340', hall: 1, w: 3, d: 3, person: 'Sara Ahmed', profile: 'good', city: 'Swindon' },
  { key: 'thermaflow', name: 'Thermaflow Heating', domain: 'thermaflow.test', stand: 'N2-346', hall: 1, w: 3, d: 3, person: 'Theo Walsh', profile: 'behind', city: 'Preston' },
  { key: 'unity', name: 'Unity Fixings', domain: 'unity-fixings.test', stand: 'N2-352', hall: 1, w: 3, d: 2, person: 'Uma Joshi', profile: 'complete', city: 'Leicester' },
  { key: 'vantage', name: 'Vantage Scaffolding', domain: 'vantage-scaffolding.test', stand: 'N1-156', hall: 0, w: 6, d: 3, person: 'Victor Lund', profile: 'started', city: 'Hull' },
  { key: 'westbrook', name: 'Westbrook Paints', domain: 'westbrook-paints.test', stand: 'N1-162', hall: 0, w: 3, d: 3, person: 'Wendy Clarke', invoice: true, profile: 'good', city: 'Bath' },
  { key: 'xylo', name: 'Xylo Acoustic Panels', domain: 'xylo-acoustics.test', stand: 'N2-360', hall: 1, w: 4, d: 3, person: 'Xander Bloom', profile: 'started', city: 'Oxford' },
  { key: 'york', name: 'York Stone Masonry', domain: 'yorkstone.test', stand: 'N2-366', hall: 1, w: 3, d: 3, person: 'Yasmin Ali', invoice: true, profile: 'complete', city: 'York' },
  { key: 'zenith', name: 'Zenith Ventilation', domain: 'zenith-vent.test', stand: 'N1-170', hall: 0, w: 3, d: 3, person: 'Zac Rowe', profile: 'behind', city: 'Derby' },
  { key: 'aspen', name: 'Aspen Kitchens', domain: 'aspen-kitchens.test', stand: 'N1-176', hall: 0, w: 4, d: 3, person: 'Alice Wood', profile: 'complete', city: 'Chester' },
  // Space only
  { key: 'evergreen', name: 'Evergreen Timber Frames', domain: 'evergreen-timber.test', stand: 'N3-501', space: true, hall: 2, w: 12, d: 6, person: DEMO_ACCOUNTS.spaceExhibitor.name, email: DEMO_ACCOUNTS.spaceExhibitor.email, invoice: true, profile: 'good', city: 'Inverness' },
  { key: 'fortis', name: 'Fortis Steel', domain: 'fortissteel.test', stand: 'N3-620', space: true, hall: 2, w: 12, d: 10, person: 'Finn O’Brien', profile: 'started', city: 'Middlesbrough' },
  { key: 'jupiter', name: 'Jupiter Solar', domain: 'jupiter-solar.test', stand: 'N3-510', space: true, hall: 2, w: 9, d: 6, person: 'Jade Kim', profile: 'good', city: 'Southampton' },
  { key: 'granite', name: 'Granite Groundworks', domain: 'granite-groundworks.test', stand: 'N3-530', space: true, hall: 2, w: 9, d: 9, person: 'Gina Russo', profile: 'complete', city: 'Aberdeen' },
  { key: 'helix', name: 'Helix Heat Pumps', domain: 'helix-heatpumps.test', stand: 'N3-540', space: true, hall: 2, w: 6, d: 6, person: 'Hugo Bennett', invoice: true, profile: 'good', city: 'Lincoln' },
  { key: 'ironbridge', name: 'Ironbridge Cladding', domain: 'ironbridge-cladding.test', stand: 'N3-550', space: true, hall: 2, w: 10, d: 6, person: 'Iris Cole', profile: 'good', city: 'Telford' },
  { key: 'kingfisher', name: 'Kingfisher Water Systems', domain: 'kingfisher-water.test', stand: 'N3-560', space: true, hall: 2, w: 6, d: 6, person: 'Kai Evans', profile: 'complete', city: 'Plymouth' },
  { key: 'lattice', name: 'Lattice Modular Buildings', domain: 'lattice-modular.test', stand: 'N3-570', space: true, hall: 2, w: 15, d: 10, person: 'Liam Byrne', profile: 'started', city: 'Belfast' },
  { key: 'mosaic', name: 'Mosaic Tiles Direct', domain: 'mosaic-tiles.test', stand: 'N3-580', space: true, hall: 2, w: 6, d: 6, person: 'Mia Lopez', profile: 'behind', city: 'Luton' },
  { key: 'nova', name: 'Nova Insulated Panels', domain: 'nova-panels.test', stand: 'N3-590', space: true, hall: 2, w: 9, d: 6, person: 'Noah Fischer', profile: 'good', city: 'Wolverhampton' },
  { key: 'orbit', name: 'Orbit Lifts & Hoists', domain: 'orbit-lifts.test', stand: 'N3-600', space: true, hall: 2, w: 9, d: 9, person: 'Oscar Fry', profile: 'good', city: 'Sunderland' },
  { key: 'prism', name: 'Prism Glass Structures', domain: 'prism-glass.test', stand: 'N3-610', space: true, hall: 2, w: 6, d: 6, person: 'Pia Sorensen', profile: 'started', city: 'Ipswich' },
];

const STREETS = ['Mill Lane', 'Station Road', 'Kingsway', 'Canal Street', 'Church Road', 'Victoria Street', 'Park Avenue', 'High Street'];

/** Adds both demo shows and everything happening in them. */
async function createDemoData(logins: TestLogin[]) {
  const db = await getDb();
  const admin = await superAdmin(logins);
  const actor = actorFor(admin);
  const startedAt = new Date();

  // Dates: BuildExpo London is about five weeks away; Green Homes Live is in the spring.
  const buildDay = mondayAfter(35);
  const buildUp = at(buildDay, '08:00');
  const openStarts = at(addDays(buildDay, 2), '09:00');
  const openEnds = at(addDays(buildDay, 4), '17:00');
  const breakdownEnds = at(addDays(buildDay, 5), '18:00');
  const year = openStarts.toLocaleDateString('en-GB', { year: 'numeric', timeZone: 'Europe/London' });
  const before = (days: number) => new Date(buildUp.getTime() - days * DAY);
  const ago = (days: number) => new Date(Date.now() - days * DAY);

  // Shows and editions ------------------------------------------------------
  const expo = await createShow(actor, { name: 'BuildExpo', description: 'Building products, construction and site technology.' });
  const homes = await createShow(actor, { name: 'Green Homes Live', description: 'Retrofit, renewable energy and sustainable homes.' });
  await db.update(shows).set({ isDemo: true }).where(inArray(shows.id, [expo.id, homes.id]));
  clearDemoFlags();
  const london = await createEdition(actor, expo.id, {
    name: `BuildExpo London ${year}`,
    slug: DEMO_EDITION_SLUG,
    venue: 'ExCeL London',
    city: 'London',
    buildUpStartsAt: buildUp,
    openStartsAt: openStarts,
    openEndsAt: openEnds,
    breakdownEndsAt: breakdownEnds,
    status: 'live',
  });
  await updateEditionBranding(actor, london.id, { primaryColor: '#1d3557', accentColor: '#0f766e', footerText: `BuildExpo London ${year}, ExCeL London.` });
  await updateEditionContacts(actor, london.id, {
    contacts: [
      { id: 'ops', team: 'Operations', name: 'BuildExpo operations team', email: 'ops@buildexpo.test', phone: '+44 20 7946 0101' },
      { id: 'sales', team: 'Stand sales', name: 'Priya Shah', email: 'sales@buildexpo.test', phone: '+44 20 7946 0102' },
      { id: 'marketing', team: 'Marketing', name: 'Leo Fraser', email: 'marketing@buildexpo.test', note: 'Logos, listings and show guide entries.' },
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
  for (const [key, email, name, role, permissions, jobTitle] of [
    ['showAdmin', DEMO_ACCOUNTS.showAdmin.email, DEMO_ACCOUNTS.showAdmin.name, 'show_admin', [], 'Operations manager'],
    ['showTeam', DEMO_ACCOUNTS.showTeam.email, DEMO_ACCOUNTS.showTeam.name, 'show_team', ['manage_exhibitors', 'manage_orders', 'view_reports', 'helpdesk'], 'Exhibitor services'],
    ['reviewer', DEMO_ACCOUNTS.reviewer.email, DEMO_ACCOUNTS.reviewer.name, 'hs_reviewer', [], 'Health and safety consultant'],
    ['marketing', 'leo@buildexpo.test', 'Leo Fraser', 'show_team', ['edit_content', 'send_emails', 'view_reports'], 'Marketing manager'],
    ['sales', 'priya@buildexpo.test', 'Priya Shah', 'show_team', ['view_reports'], 'Sales manager'],
  ] as const) {
    const u = await addUser(email, name, { jobTitle, phone: '+44 20 7946 0100' });
    await db.insert(editionStaff).values({ editionId: london.id, userId: u.id, role, permissions: [...permissions] as never, addedBy: admin.id });
    team[key] = u;
  }
  const ops = actorFor(team.showAdmin);
  const sam = actorFor(team.showTeam);
  const hannah = actorFor(team.reviewer);

  // Suppliers (their payouts are practice ones) -----------------------------------------
  const supplierRows: Record<string, typeof suppliers.$inferSelect> = {};
  const supplierPeople: Record<string, UserRow> = {};
  for (const s of [
    { key: 'furniture', name: 'Expo Furniture Hire', email: 'orders@expofurniture.test', phone: '+44 20 7946 0300', person: DEMO_ACCOUNTS.supplier, stripe: 'ready' },
    { key: 'electrics', name: 'PowerOn Electrical', email: 'orders@poweron-electrical.test', phone: '+44 20 7946 0301', person: { email: 'pete@poweron-electrical.test', name: 'Pete Brooks' }, stripe: 'none' },
    { key: 'av', name: 'ShowSound AV', email: 'orders@showsound-av.test', phone: '+44 20 7946 0302', person: { email: 'sophie@showsound-av.test', name: 'Sophie Lane' }, stripe: 'ready' },
    { key: 'graphics', name: 'BrightSigns Graphics', email: 'studio@brightsigns.test', phone: '+44 20 7946 0303', person: { email: 'gareth@brightsigns.test', name: 'Gareth Owen' }, stripe: 'started' },
  ] as const) {
    const sup = await createSupplier(actor, { name: s.name, email: s.email, phone: s.phone, website: `https://www.${s.email.split('@')[1].replace(/\.test$/, '.example')}` });
    const account = s.stripe === 'none' ? null : `acct_sim${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const ready = s.stripe === 'ready';
    const [row] = await db
      .update(suppliers)
      .set({ isDemo: true, stripeAccountId: account, stripeChargesEnabled: ready, stripePayoutsEnabled: ready, stripeDetailsSubmitted: ready })
      .where(eq(suppliers.id, sup.id))
      .returning();
    supplierRows[s.key] = row;
    const u = await addUser(s.person.email, s.person.name, { jobTitle: 'Orders' });
    await db.insert(supplierUsers).values({ supplierId: sup.id, userId: u.id });
    supplierPeople[s.key] = u;
  }
  // A colleague at the furniture supplier.
  const marcus = await addUser('marcus@expofurniture.test', 'Marcus Bell', { jobTitle: 'Warehouse manager' });
  await db.insert(supplierUsers).values({ supplierId: supplierRows.furniture.id, userId: marcus.id });
  clearDemoFlags();
  const fiona = actorFor(supplierPeople.furniture);

  // Manual pages -----------------------------------------------------------------
  const page = (title: string, bodyHtml: string, visibleToTypes: string[] = [], opts: { pinned?: boolean; published?: boolean } = {}) =>
    createPage(actor, london.id, { title, bodyHtml, visibleToTypes, published: opts.published ?? true, pinned: opts.pinned ?? false });
  await page(
    `Welcome to BuildExpo London ${year}`,
    html(
      '<p>Thank you for exhibiting at BuildExpo London. This manual has everything you need to get your stand ready: the rules, the deadlines and the services you can order.</p>',
      '<p>Start with <strong>your checklist</strong>. It lists what your stand needs to do and by when, and ticks things off as you go.</p>',
      `<h2>Key dates</h2><ul><li>Build-up: ${longDate(buildUp)} from 08:00</li><li>Show open: ${longDate(openStarts)} to ${longDate(openEnds)}, 09:00 to 17:00</li><li>Breakdown: ${longDate(openEnds)} from 17:30 to ${longDate(breakdownEnds)} at 18:00</li></ul>`,
    ),
    [],
    { pinned: true },
  );
  const rulesPage = await page(
    'Build-up and breakdown',
    html(
      `<h2>Build-up</h2><p>Halls open for build-up at 08:00 on ${longDate(buildUp)}. Space-only stands may start straight away; shell scheme stands are ready from 14:00 the next day.</p>`,
      '<p>All building work must finish by 20:00 on the day before the show opens. Gangways must be clear by then so the carpet can be laid.</p>',
      `<h2>Breakdown</h2><p>Nothing may be removed from stands before 17:30 on ${longDate(openEnds)}. Please leave your stand as you found it and take all waste with you.</p>`,
      '<h2>Working safely</h2><ul><li>Wear hi-vis and safety footwear in the halls during build-up and breakdown.</li><li>No work at height without the right equipment and a trained operator.</li><li>Children under 16 are not allowed in the halls during build-up and breakdown.</li></ul>',
    ),
  );
  await page(
    'Deliveries and vehicle access',
    html(
      '<p>Every vehicle needs a delivery slot. Slots are booked online and are now open.</p>',
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
      '<h2>What to send</h2><ul><li>Stand drawings with dimensions and heights</li><li>Risk assessment and method statement</li><li>Construction phase plan (CDM 2015)</li><li>Your contractor’s public liability insurance (at least £5 million)</li><li>A signed health and safety declaration</li></ul>',
      '<p>The maximum stand height is 4 m. Anything higher, or any stand with a second level, counts as a complex structure and needs structural calculations.</p>',
    ),
    [space.id],
  );
  const hsPage = await page(
    'Health and safety',
    html(
      '<p>Everyone working on your stand must follow the venue’s health and safety rules. Your stand’s main contact is responsible for this during the show.</p>',
      '<p>Report any accident or near miss to the organiser’s office in hall N1 straight away.</p>',
    ),
  );
  await page(
    'Badges and passes',
    html('<p>Every member of your stand team needs an exhibitor badge. Add their names in your checklist and collect the badges from the exhibitor services desk at the north entrance.</p>', '<p>Contractors need a build-up pass, which their company registers for.</p>'),
  );
  await page(
    'Sustainability',
    html('<p>BuildExpo aims to send nothing to landfill. Please reuse stand materials where you can, avoid single-use plastics and take everything you bring home with you.</p>', '<p>Waste left on stands after breakdown is cleared at the exhibitor’s cost.</p>'),
  );
  await page('Floor plan', '<p>The final floor plan will be published here shortly.</p>', [], { published: false });

  // Shop ---------------------------------------------------------------------------
  const furniture = await createCategory(actor, london.id, {
    name: 'Furniture',
    description: 'Delivered to your stand before build-up ends and collected after the show.',
    supplierId: supplierRows.furniture.id,
    orderByOffsetDays: 21,
    commissionType: 'percent',
    commissionValue: 1500,
  });
  const electrics = await createCategory(actor, london.id, {
    name: 'Electrics',
    description: 'Every stand needs its electrics ordered in advance. Space-only stands must order a mains supply.',
    supplierId: supplierRows.electrics.id,
    orderByOffsetDays: 28,
    commissionType: 'percent',
    commissionValue: 1000,
  });
  const av = await createCategory(actor, london.id, { name: 'Audio visual', description: 'Screens and sound, delivered and set up on your stand.', supplierId: supplierRows.av.id, orderByOffsetDays: 14 });
  const graphics = await createCategory(actor, london.id, {
    name: 'Graphics and printing',
    description: 'Printed panels and boards. Upload your artwork when you order.',
    supplierId: supplierRows.graphics.id,
    orderByOffsetDays: 21,
    commissionType: 'percent',
    commissionValue: 1200,
  });
  const cleaning = await createCategory(actor, london.id, { name: 'Stand cleaning', description: 'Provided by the organiser.', orderByOffsetDays: 7, visibleToTypes: [shell.id] });
  const internet = await createCategory(actor, london.id, { name: 'Internet and lead scanning', description: 'Provided by the organiser.', orderByOffsetDays: 14 });
  const product = (categoryId: string, p: Omit<Parameters<typeof createProduct>[2], 'categoryId'>) => createProduct(actor, london.id, { categoryId, ...p });
  const chair = await product(furniture.id, { name: 'Folding chair', code: 'FUR-CH1', description: 'Padded seat, stackable.', pricePence: 1800, vatRateBps: 2000, stockLimit: 200, options: [{ name: 'Colour', values: ['Black', 'White'] }] });
  const table = await product(furniture.id, { name: 'Poseur table', code: 'FUR-PT1', description: '60 cm round top, 110 cm high.', pricePence: 4500, vatRateBps: 2000, options: [{ name: 'Top', values: ['White', 'Black'] }] });
  const counter = await product(furniture.id, {
    name: 'Lockable counter',
    code: 'FUR-LC1',
    description: '1 m wide with a lockable cupboard and shelf.',
    pricePence: 9500,
    earlyPricePence: 8500,
    earlyUntilOffsetDays: 42,
    latePricePence: 12_000,
    lateFromOffsetDays: 10,
    vatRateBps: 2000,
    stockLimit: 40,
  });
  const rack = await product(furniture.id, { name: 'Literature rack', code: 'FUR-LR1', pricePence: 3500, vatRateBps: 2000 });
  const sofa = await product(furniture.id, { name: 'Two-seat sofa', code: 'FUR-SF2', description: 'Grey fabric.', pricePence: 14_500, vatRateBps: 2000, stockLimit: 25 });
  const meetingSet = await product(furniture.id, { name: 'Meeting table and four chairs', code: 'FUR-MT4', pricePence: 11_000, vatRateBps: 2000 });
  await createProduct(actor, london.id, { categoryId: furniture.id, name: 'Bar stool', code: 'FUR-BS1', pricePence: 2400, vatRateBps: 2000 }, { draft: true });
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
  const threePhase = await product(electrics.id, { name: 'Three-phase mains supply (32 A)', code: 'ELE-3P32', description: 'For space-only stands with their own lighting rig.', pricePence: 64_000, vatRateBps: 2000, visibleToTypes: [space.id] });
  const screen = await product(av.id, { name: '55-inch screen with floor stand', code: 'AV-55', description: 'HDMI input, delivered and set up on your stand.', pricePence: 29_500, vatRateBps: 2000, stockLimit: 20 });
  const bigScreen = await product(av.id, { name: '75-inch screen with floor stand', code: 'AV-75', pricePence: 52_000, vatRateBps: 2000, stockLimit: 8 });
  await product(av.id, { name: 'PA speaker and microphone', code: 'AV-PA1', pricePence: 18_500, vatRateBps: 2000 });
  const wallGraphic = await product(graphics.id, {
    name: 'Printed wall panel',
    code: 'GR-WP1',
    description: 'Full-colour print to fit one shell scheme wall, fitted on site.',
    unit: 'per panel',
    pricePence: 22_000,
    vatRateBps: 2000,
    requiredDetails: [
      { id: 'artwork', label: 'Artwork (print-ready PDF or image)', type: 'file', required: true },
      { id: 'wall', label: 'Which wall?', type: 'text', required: true },
    ],
  });
  await product(graphics.id, { name: 'A1 foamex board', code: 'GR-A1', pricePence: 6500, vatRateBps: 2000, requiredDetails: [{ id: 'artwork', label: 'Artwork', type: 'file', required: true }] });
  const dailyClean = await product(cleaning.id, { name: 'Daily stand clean', code: 'CLN-D', description: 'Vacuum, empty bins and wipe down each morning of the show.', unit: 'per day', pricePence: 3500, vatRateBps: 2000 });
  await product(internet.id, { name: 'Wired internet connection', code: 'NET-W1', description: '20 Mbps, one cable to your stand.', pricePence: 32_500, vatRateBps: 2000 });
  await product(internet.id, { name: 'Lead scanning app licence', code: 'LS-APP', description: 'Scan visitor badges with your phone.', unit: 'per user', pricePence: 9900, vatRateBps: 2000 });
  // The furniture supplier has suggested products of its own: one waiting, one turned down.
  await createSupplierProduct(fiona, supplierRows.furniture.id, { categoryId: furniture.id, name: 'Phone charging locker', code: 'FUR-CL6', description: 'Six lockable bays with USB-C chargers.', pricePence: 7500, vatRateBps: 2000 }, { submit: true });
  const cabinet = await createSupplierProduct(
    fiona,
    supplierRows.furniture.id,
    { categoryId: furniture.id, name: 'Glass display cabinet', code: 'FUR-GD1', description: 'Lockable, with lighting.', pricePence: 21_000, vatRateBps: 2000 },
    { submit: true },
  );
  await setProductStatus(ops, cabinet.id, 'rejected', 'Please add a photo and the dimensions. A lower price for a three-day show would help too.');

  // Checklist tasks -----------------------------------------------------------------
  const both = { [shell.id]: 'required', [space.id]: 'required' } as const;
  const rules = await createTask(actor, london.id, {
    title: 'Read the build-up and breakdown rules',
    descriptionHtml: '<p>Vehicle access times, working at height and what can be left on the stand overnight.</p>',
    kind: 'info',
    linkedPageId: rulesPage.id,
    deadline: { mode: 'offset', offsetDays: 21 },
    published: true,
    requirements: both,
  });
  const fascia = await createTask(actor, london.id, {
    title: 'Tell us the name for your fascia board',
    descriptionHtml: '<p>The name printed above your shell scheme stand. The show team checks it before it goes to print.</p>',
    kind: 'form',
    formSchema: [{ id: 'fascia', type: 'text', label: 'Name on your fascia board', help: 'Up to 30 characters, exactly as it should appear.', required: true, maxLength: 30 }],
    requiresApproval: true,
    deadline: { mode: 'offset', offsetDays: 42 },
    locksAtDeadline: false,
    published: true,
    requirements: { [shell.id]: 'required' },
  });
  const contact = await createTask(actor, london.id, {
    title: 'Your on-site contact',
    descriptionHtml: '<p>Who we should call on the day if there is a problem with your stand.</p>',
    kind: 'form',
    formSchema: [
      { id: 'name', type: 'text', label: 'Name', required: true },
      { id: 'mobile', type: 'phone', label: 'Mobile number', required: true },
      { id: 'vehicles', type: 'number', label: 'Vehicles arriving at build-up', min: 0, max: 20 },
    ],
    // Already past, so the overview has people to chase.
    deadline: { mode: 'fixed', at: ago(4).toISOString() },
    locksAtDeadline: false,
    published: true,
    requirements: both,
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
    linkedPageId: hsPage.id,
    deadline: { mode: 'offset', offsetDays: 28 },
    published: true,
    requirements: both,
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
  const insurance = await createTask(actor, london.id, {
    title: 'Upload your public liability insurance',
    descriptionHtml: '<p>A copy of your company’s public liability insurance certificate, valid until the end of breakdown.</p>',
    kind: 'upload',
    formSchema: [{ id: 'certificate', type: 'file', label: 'Insurance certificate', required: true }],
    deadline: { mode: 'offset', offsetDays: 35 },
    published: true,
    requirements: { [space.id]: 'required', [shell.id]: 'if_applicable' },
  });
  const badges = await createTask(actor, london.id, {
    title: 'Names for your exhibitor badges',
    descriptionHtml: '<p>Everyone working on your stand during the show.</p>',
    kind: 'form',
    formSchema: [
      {
        id: 'people',
        type: 'repeater',
        label: 'Stand team',
        maxRows: 20,
        fields: [
          { id: 'name', type: 'text', label: 'Full name', required: true },
          { id: 'role', type: 'text', label: 'Job title' },
        ],
      },
    ],
    deadline: { mode: 'offset', offsetDays: 14 },
    locksAtDeadline: false,
    published: true,
    requirements: { [shell.id]: 'optional', [space.id]: 'optional' },
  });
  const guide = await createTask(actor, london.id, {
    title: 'Your show guide entry',
    descriptionHtml: '<p>What visitors read about you in the printed show guide and on the website.</p>',
    kind: 'form',
    formSchema: [
      { id: 'summary', type: 'textarea', label: 'About your company (up to 60 words)', required: true, maxLength: 450 },
      { id: 'category', type: 'select', label: 'Main product area', options: ['Structure and envelope', 'Interiors and finishes', 'Building services', 'Tools and site equipment', 'Digital construction'], required: true },
    ],
    deadline: { mode: 'offset', offsetDays: 35 },
    published: true,
    requirements: { [shell.id]: 'if_applicable', [space.id]: 'if_applicable' },
  });
  await createTask(actor, london.id, { title: 'Nominate your stand contractor', kind: 'contractor_nomination', deadline: { mode: 'offset', offsetDays: 49 }, published: true, requirements: { [space.id]: 'required' } });
  await createTask(actor, london.id, { title: 'Send your space-only stand pack', kind: 'space_only_pack', deadline: { mode: 'offset', offsetDays: 28 }, published: true, requirements: { [space.id]: 'required' } });
  await createTask(actor, london.id, {
    title: 'Catering for your stand (coming soon)',
    descriptionHtml: '<p>Order tea, coffee and lunches for your stand team.</p>',
    kind: 'form',
    formSchema: [{ id: 'notes', type: 'textarea', label: 'What would you like?' }],
    deadline: { mode: 'none' },
    published: false,
    requirements: both,
  });

  // Exhibitors ----------------------------------------------------------------------------
  const standIds: Record<string, string> = {};
  const companyIds: Record<string, string> = {};
  const people: Record<string, UserRow> = {};
  let i = 0;
  for (const x of EXHIBITORS) {
    i += 1;
    const [c] = await db
      .insert(companies)
      .values({
        name: x.name,
        website: `https://www.${x.domain.replace(/\.test$/, '.example')}`,
        email: `info@${x.domain}`,
        phone: `+44 1632 9600${String(i).padStart(2, '0')}`,
        addressLine1: `${10 + i} ${STREETS[i % STREETS.length]}`,
        city: x.city,
        postcode: `ZZ${i % 9} ${i % 9}AB`,
        country: 'United Kingdom',
        vatNumber: x.invoice ? `GB${String(100_000_000 + i * 7919).slice(0, 9)}` : null,
        invoiceAllowed: Boolean(x.invoice),
        isDemo: true,
      })
      .returning();
    companyIds[x.key] = c.id;
    const [s] = await db
      .insert(stands)
      .values({
        editionId: london.id,
        number: x.stand,
        exhibitorTypeId: (x.space ? space : shell).id,
        hallId: hallRows[x.hall].id,
        companyId: c.id,
        widthM: String(x.w),
        depthM: String(x.d),
        sizeSqm: String(x.w * x.d),
        openSides: x.space ? 3 : 1,
      })
      .returning();
    standIds[x.key] = s.id;
    if (!x.person) continue;
    const email = x.email ?? `${x.person.split(' ')[0].toLowerCase().replace(/[^a-z]/g, '')}@${x.domain}`;
    if (x.invite) {
      await inviteExhibitorContact(ops, london.id, c.id, { email, role: 'main_contact', sendNow: true });
      continue;
    }
    const u = await addUser(email, x.person, { jobTitle: x.space ? 'Marketing manager' : 'Sales director', phone: '+44 7700 900' + String(100 + i) });
    await db.insert(companyMembers).values({ companyId: c.id, userId: u.id, role: 'main_contact', canPay: true });
    people[x.key] = u;
  }
  // A colleague on Acme's team, who can't pay.
  const tom = await addUser('tom@acme-insulation.test', 'Tom Reed', { jobTitle: 'Marketing executive' });
  await db.insert(companyMembers).values({ companyId: companyIds.acme, userId: tom.id, role: 'colleague', canPay: false });
  clearDemoFlags();

  const ex = (key: string) => ({ actor: actorFor(people[key]), stand: standIds[key], user: people[key], company: companyIds[key] });
  const spec = (key: string) => EXHIBITORS.find((e) => e.key === key)!;

  // What exhibitors have done so far ---------------------------------------------------
  const contactForm = (key: string) => ({ name: people[key].name, mobile: people[key].phone ?? '+44 7700 900000', vehicles: 1 });
  const sign = (key: string) => ({ declaration: { agreed: true, name: people[key].name } });
  const fasciaName = (key: string) => spec(key).name.toUpperCase().replace(/[^A-Z0-9 &]/g, '').slice(0, 30);
  const uploadInsurance = async (key: string) => {
    const { actor: a, stand, company } = ex(key);
    const f = await storeDemoFile({
      purpose: 'submission',
      filename: `Public liability insurance - ${spec(key).name}.pdf`,
      contentType: 'application/pdf',
      body: await placeholderPdf('Public liability insurance', [`Policy holder: ${spec(key).name}`, 'Cover: £10,000,000', `Valid until: ${addDays(today(), 300)}`]),
      editionId: london.id,
      standId: stand,
      companyId: company,
      uploadedBy: a.realUserId,
    });
    await saveAnswers(a, stand, insurance.id, { certificate: [f.id] }, { submit: true });
  };

  for (const x of EXHIBITORS) {
    if (!people[x.key]) continue;
    const { actor: a, stand } = ex(x.key);
    if (x.profile === 'behind' || x.profile === 'none') continue;
    await markTask(a, stand, rules.id, 'read');
    if (x.profile === 'started') continue;
    await saveAnswers(a, stand, contact.id, contactForm(x.key), { submit: true });
    if (!x.space && x.key !== 'dura') await saveAnswers(a, stand, fascia.id, { fascia: fasciaName(x.key) }, { submit: true });
    if (x.profile !== 'complete') continue;
    await saveAnswers(a, stand, declaration.id, sign(x.key), { submit: true });
    if (!x.space) await reviewSubmission(ops, fascia.id, stand, 'approved', null);
    await saveAnswers(a, stand, badges.id, { people: [{ name: people[x.key].name, role: 'Sales director' }, { name: 'Jamie Fox', role: 'Technical sales' }] }, { submit: true });
    await saveAnswers(
      a,
      stand,
      guide.id,
      { summary: `${x.name} supplies the UK construction industry from its base in ${x.city}. Visit us to see our latest products and talk to our technical team.`, category: x.space ? 'Structure and envelope' : 'Interiors and finishes' },
      { submit: true },
    );
    if (x.space || x.key === 'cladtech') await uploadInsurance(x.key);
  }
  // Fascia names: some approved, some waiting, one sent back.
  for (const key of ['acme', 'sunfield', 'westbrook']) await reviewSubmission(ops, fascia.id, standIds[key], 'approved', null);
  {
    const { actor: a, stand } = ex('dura');
    await saveAnswers(a, stand, fascia.id, { fascia: 'DURA ROOFING' }, { submit: true });
    await reviewSubmission(ops, fascia.id, stand, 'changes_needed', 'Please use your full trading name, Dura Roofing Group, so it matches your listing.');
  }
  // Two space-only exhibitors have signed their declarations.
  for (const key of ['jupiter', 'helix', 'evergreen']) await saveAnswers(ex(key).actor, ex(key).stand, declaration.id, sign(key), { submit: true });
  await uploadInsurance('evergreen');

  // Orders ------------------------------------------------------------------------------
  type Item = [productId: string, quantity: number, extra?: { options?: Record<string, string>; details?: Record<string, string> }];
  const placeOrder = async (key: string, items: Item[], method: 'invoice' | 'card', opts: { po?: string; pay?: boolean } = {}) => {
    const { actor: a, stand } = ex(key);
    for (const [productId, quantity, extra] of items) await addToBasket(a, stand, { productId, quantity, options: extra?.options ?? {}, details: extra?.details ?? {} });
    const basket = await basketForStand(a, stand, method);
    const placed = await checkout(a, stand, { method, poNumber: opts.po ?? null, acceptTerms: true, expectedTotalPence: basket.totals.totalPence });
    if (method === 'card' && opts.pay !== false) await simulateCheckout(a, placed.orderId, 'pay');
    return placed.orderId;
  };
  const linesOf = async (orderId: string, supplierId?: string) =>
    db
      .select()
      .from(orderLines)
      .where(supplierId ? and(eq(orderLines.orderId, orderId), eq(orderLines.supplierId, supplierId)) : eq(orderLines.orderId, orderId));
  const fulfil = async (orderId: string, supplierKey: 'furniture' | 'av' | 'electrics', status: 'confirmed' | 'delivered') => {
    for (const l of await linesOf(orderId, supplierRows[supplierKey].id)) {
      await setLineFulfilment(actorFor(supplierPeople[supplierKey]), l.id, 'confirmed');
      if (status === 'delivered') await setLineFulfilment(actorFor(supplierPeople[supplierKey]), l.id, 'delivered');
    }
  };

  // Acme: an order on invoice with a PO number (the furniture is confirmed), and a screen paid by card.
  const acmeInvoice = await placeOrder(
    'acme',
    [
      [chair.id, 4, { options: { Colour: 'Black' } }],
      [table.id, 1, { options: { Top: 'White' } }],
      [socket.id, 1, { details: { position: 'Back wall, left-hand corner' } }],
      [spotlight.id, 2],
    ],
    'invoice',
    { po: 'PO-4471' },
  );
  await fulfil(acmeInvoice, 'furniture', 'confirmed');
  const acmeCard = await placeOrder('acme', [[screen.id, 1]], 'card');
  await fulfil(acmeCard, 'av', 'confirmed');
  // Cladtech: paid by bank transfer; finance has paid the suppliers their share by hand.
  const cladtech = await placeOrder('cladtech', [[screen.id, 1], [rack.id, 2], [socket.id, 1, { details: { position: 'Front left' } }]], 'invoice', { po: 'CT-2210' });
  await markInvoicePaid(ops, cladtech, 'BACS CLADTECH 2210');
  for (const t of await db.select().from(supplierTransfers).where(and(eq(supplierTransfers.orderId, cladtech), eq(supplierTransfers.supplierId, supplierRows.furniture.id))))
    await settleManualTransfer(ops, t.id, 'BACS EXPOFURN 0193');
  await fulfil(cladtech, 'furniture', 'confirmed');
  // Card orders, with the suppliers at different stages.
  const keystone = await placeOrder('keystone', [[counter.id, 1], [socket.id, 1, { details: { position: 'Behind the counter' } }]], 'card');
  await fulfil(keystone, 'furniture', 'confirmed');
  await placeOrder('pinnacle', [[meetingSet.id, 1], [spotlight.id, 2]], 'card');
  await placeOrder('sunfield', [[chair.id, 2, { options: { Colour: 'White' } }], [table.id, 1, { options: { Top: 'Black' } }]], 'card');
  const aspen = await placeOrder('aspen', [[counter.id, 1], [mains.id, 1], [dailyClean.id, 3]], 'card');
  await fulfil(aspen, 'furniture', 'delivered');
  await placeOrder('kingfisher', [[bigScreen.id, 1]], 'card');
  // Granite's electrics supplier has not set up payouts yet, so its payout waits.
  await placeOrder('granite', [[threePhase.id, 1]], 'card');
  // Lumen: artwork uploaded with a graphics order; one spotlight refunded afterwards.
  {
    const { actor: a, stand, company } = ex('lumen');
    const artwork = await storeDemoFile({ purpose: 'order', filename: 'Lumen wall panel artwork.png', contentType: 'image/png', body: placeholderPng(), editionId: london.id, standId: stand, companyId: company, uploadedBy: a.realUserId });
    const lumen = await placeOrder('lumen', [[spotlight.id, 3], [wallGraphic.id, 1, { details: { artwork: artwork.id, wall: 'Back wall' } }]], 'card');
    const spot = (await linesOf(lumen)).find((l) => l.productId === spotlight.id)!;
    await refundOrder(ops, lumen, { lines: [{ lineId: spot.id, amountPence: Math.round((spot.netPence + spot.vatPence) / 3) }], reason: 'Ordered one spotlight too many.' });
  }
  // Unity: refunded in full after they changed their mind.
  {
    const unity = await placeOrder('unity', [[rack.id, 1]], 'card');
    const lines = await linesOf(unity);
    const [o] = await db.select({ fee: orders.cardFeePence }).from(orders).where(eq(orders.id, unity)).limit(1);
    await refundOrder(ops, unity, { lines: lines.map((l) => ({ lineId: l.id, amountPence: l.netPence + l.vatPence })), cardFeePence: o.fee, reason: 'The exhibitor no longer needs it.' });
  }
  // Vantage: went to pay by card and gave up.
  {
    const orderId = await placeOrder('vantage', [[sofa.id, 1]], 'card', { pay: false });
    await cancelMyCheckout(ex('vantage').actor, orderId);
  }
  // Westbrook: ordered on invoice by mistake; the team cancelled it.
  {
    const westbrook = await placeOrder('westbrook', [[spotlight.id, 2]], 'invoice');
    await cancelOrder(ops, westbrook, 'Ordered twice by mistake; the other order stands.');
  }
  await placeOrder('westbrook', [[spotlight.id, 2]], 'invoice');
  // Northgate: an unpaid invoice that is now overdue.
  {
    const northgate = await placeOrder('northgate', [[sofa.id, 1], [socket.id, 2, { details: { position: 'Either side of the doors display' } }]], 'invoice', { po: 'NG/0091' });
    await db.update(orders).set({ dueAt: ago(5) }).where(eq(orders.id, northgate));
  }
  const york = await placeOrder('york', [[socket.id, 1, { details: { position: 'Rear wall' } }], [dailyClean.id, 3]], 'invoice');
  await markInvoicePaid(ops, york, 'BACS YORKSTONE 77');
  await placeOrder('evergreen', [[mains.id, 1], [socket.id, 2, { details: { position: 'Reception desk and meeting room' } }]], 'invoice');
  await placeOrder('helix', [[socket.id, 2, { details: { position: 'Heat pump display' } }]], 'invoice');

  // Space-only stands: contractors and packs in every state ---------------------------------
  const contractors: Record<string, UserRow> = {};
  const nominate = async (key: string, firm: { company: string; name: string; email: string; phone: string }, opts: { joined: boolean }) => {
    const { actor: a, stand } = ex(key);
    await nominateContractor(a, stand, { companyName: firm.company, contactName: firm.name, email: firm.email, phone: firm.phone });
    if (!opts.joined) return;
    let u = contractors[firm.email];
    if (!u) {
      u = await addUser(firm.email, firm.name, { jobTitle: 'Project manager', phone: firm.phone });
      contractors[firm.email] = u;
    }
    await db.update(standContractors).set({ userId: u.id, status: 'active' }).where(eq(standContractors.standId, stand));
    await db
      .update(invitations)
      .set({ acceptedAt: new Date(), acceptedUserId: u.id })
      .where(and(eq(invitations.standId, stand), eq(invitations.kind, 'contractor')));
  };
  const BUILDRIGHT = { company: 'BuildRight Stands Ltd', name: DEMO_ACCOUNTS.contractor.name, email: DEMO_ACCOUNTS.contractor.email, phone: '+44 7700 900123' };
  const STANDWORKS = { company: 'StandWorks Ltd', name: 'Sean Doyle', email: 'sean@standworks.test', phone: '+44 7700 900456' };
  const EXPOBUILDS = { company: 'Expo Builds Co', name: 'Ruth Lane', email: 'ruth@expobuilds.test', phone: '+44 7700 900789' };
  const APEX = { company: 'Apex Exhibition Builds', name: 'Jo Hart', email: 'jo@apex-builds.test', phone: '+44 7700 900321' };
  for (const key of ['evergreen', 'granite', 'helix', 'lattice', 'prism']) await nominate(key, BUILDRIGHT, { joined: true });
  for (const key of ['ironbridge', 'kingfisher', 'orbit']) await nominate(key, STANDWORKS, { joined: true });
  await nominate('nova', EXPOBUILDS, { joined: true });
  await nominate('fortis', APEX, { joined: false });
  // Jupiter is building its own stand.
  await nominateContractor(ex('jupiter').actor, standIds.jupiter, { selfBuild: true });

  const STANDARD_DOCS = ['drawings', 'risk_assessment', 'method_statement', 'construction_phase_plan', 'contractor_insurance', 'hs_declaration'];
  const preparePack = async (key: string, by: Actor, p: { height: number; platform: number; steps?: boolean; docs: string[]; submit: boolean }) => {
    const stand = standIds[key];
    const documents: Record<string, string[]> = {};
    for (const doc of p.docs) {
      const label = SPACE_ONLY_DOC_LABELS[doc] ?? doc;
      const f = await storeDemoFile({
        purpose: 'space_only',
        filename: `${label} - ${spec(key).name}.pdf`,
        contentType: 'application/pdf',
        body: await placeholderPdf(label, [`Stand ${spec(key).stand}, ${spec(key).name}`, `BuildExpo London ${year}, hall N3`, `Stand height: ${p.height} m`, `Prepared by: ${by.name}`]),
        editionId: london.id,
        standId: stand,
        companyId: companyIds[key],
        uploadedBy: by.realUserId,
      });
      documents[doc] = [f.id];
    }
    await savePackDraft(by, stand, {
      heightM: p.height,
      platformMm: p.platform,
      hasSteps: Boolean(p.steps),
      insuranceCoverGbp: 10_000_000,
      insuranceExpiresOn: addDays(today(), 330),
      documents,
    });
    if (p.submit) await submitPack(by, stand);
  };
  const carl = actorFor(contractors[BUILDRIGHT.email]);
  const sean = actorFor(contractors[STANDWORKS.email]);
  const ruth = actorFor(contractors[EXPOBUILDS.email]);

  // Evergreen: the health and safety reviewer asked for changes to the risk assessment.
  await preparePack('evergreen', carl, { height: 4, platform: 0, docs: STANDARD_DOCS, submit: true });
  await reviewPack(hannah, standIds.evergreen, {
    decision: 'comment',
    docType: 'risk_assessment',
    comment: 'The risk assessment does not cover lifting the 4 m timber frames into place. Add how they are lifted, by whom, and the exclusion zone while it happens.',
  });
  await reviewPack(ops, standIds.evergreen, { decision: 'changes_needed', comment: 'Please update the risk assessment as Hannah describes, then send the pack again. Everything else looks good.' });
  // Granite: approved, with its permission-to-build certificate.
  await preparePack('granite', carl, { height: 3.5, platform: 0, docs: STANDARD_DOCS, submit: true });
  await reviewPack(hannah, standIds.granite, { decision: 'comment', comment: 'Checked: risk assessment and method statement are fine.' });
  await reviewPack(ops, standIds.granite, { decision: 'approved', comment: 'Thank you, all approved.' });
  // Helix, Orbit (a complex stand) and Jupiter (self-build): waiting for review.
  await preparePack('helix', carl, { height: 3, platform: 100, docs: STANDARD_DOCS, submit: true });
  await preparePack('orbit', sean, { height: 5.5, platform: 0, steps: true, docs: [...STANDARD_DOCS, 'structural_calculations'], submit: true });
  await preparePack('jupiter', ex('jupiter').actor, { height: 2.8, platform: 0, docs: STANDARD_DOCS, submit: true });
  // Ironbridge: the show team has started its review.
  await preparePack('ironbridge', sean, { height: 4, platform: 50, docs: STANDARD_DOCS, submit: true });
  await reviewPack(ops, standIds.ironbridge, { decision: 'under_review', comment: 'Checking the drawings against the hall plan.' });
  await reviewPack(hannah, standIds.ironbridge, { decision: 'comment', docType: 'method_statement', comment: 'Method statement is fine. Please confirm who supervises the cladding panels being fixed.' });
  // Kingfisher: approved with conditions.
  await preparePack('kingfisher', sean, { height: 3.8, platform: 0, docs: STANDARD_DOCS, submit: true });
  await reviewPack(ops, standIds.kingfisher, {
    decision: 'approved_with_conditions',
    conditions: 'The water feature must be drained and dry before breakdown starts. No working at height without a harness and a second person present.',
  });
  // Nova: not approved.
  await preparePack('nova', ruth, { height: 3.9, platform: 450, docs: STANDARD_DOCS, submit: true });
  await reviewPack(hannah, standIds.nova, {
    decision: 'comment',
    docType: 'drawings',
    comment: 'The drawings show a raised walkway at the back of the stand that is not in the method statement.',
  });
  await reviewPack(ops, standIds.nova, {
    decision: 'rejected',
    comment: 'The design has changed since the drawings were made, and the raised walkway needs structural calculations. Please send new drawings, a method statement covering the walkway and the calculations.',
  });
  // Lattice: Carl is still preparing it (a complex stand, so calculations are still missing).
  await preparePack('lattice', carl, { height: 5.5, platform: 0, steps: true, docs: ['drawings', 'risk_assessment', 'method_statement'], submit: false });

  // Help desk ------------------------------------------------------------------------------
  await saveSavedReply(ops, london.id, null, { title: 'Delivery slots', body: 'Every vehicle needs a delivery slot, booked online. Slots are open now; book yours from the Deliveries and vehicle access page in the manual.' });
  await saveSavedReply(ops, london.id, null, { title: 'Exhibitor badges', body: 'Add everyone working on your stand under “Names for your exhibitor badges” in your checklist. Badges are collected from the exhibitor services desk at the north entrance.' });
  await saveSavedReply(ops, london.id, null, { title: 'Wifi', body: 'Wifi is not included with stands. You can order a wired internet connection in the shop, under Internet and lead scanning.' });
  await saveSavedReply(ops, london.id, null, { title: 'Paying an invoice', body: 'You can pay your invoice by bank transfer using the details on the invoice. Please quote the invoice number as the reference.' });

  const ask = async (key: string, subject: string, body: string) => openTicket(ex(key).actor, standIds[key], { subject, body });
  {
    const t = await ask('brightbuild', 'Can we bring our own furniture?', 'We have two branded stools we would like to use on our stand. Is that allowed, and do we need to tell anyone?');
    await replyAsStaff(sam, t.id, { body: 'Yes, you can bring your own furniture. Please keep it within your stand and the gangways clear. Deliveries need a delivery slot, which you can book now.', status: 'pending' });
  }
  {
    const t = await ask('evergreen', 'Rigging above our stand', 'We would like to hang a 6 m banner above our stand. Who do we speak to about rigging points, and when do you need the drawings?');
    await assignTicket(ops, t.id, team.showTeam.id);
    await replyAsStaff(sam, t.id, { body: 'Checking with the ExCeL rigging team whether hall N3 has points above N3-501.', internal: true });
  }
  await ask('acme', 'Extra badges for our team', 'We have two more people joining us on the second day of the show. Can we add them to our badges after the deadline?');
  {
    const t = await ask('westbrook', 'Delivery address for samples', 'Can we send paint samples straight to the venue before build-up, or do they have to come with us?');
    await replyAsStaff(ops, t.id, { body: 'You can send them to the venue from the first day of build-up. Use the delivery address on the Deliveries page and book a slot for the courier.', status: 'pending' });
    await replyAsExhibitor(ex('westbrook').actor, standIds.westbrook, t.id, { body: 'Thanks. Our courier can only do the day before build-up. Is there anywhere that can take them then?' });
  }
  {
    const t = await ask('quantum', 'Wifi password', 'Is there wifi on the stands, and if so what is the password?');
    await replyAsStaff(sam, t.id, { body: 'Wifi is not included with stands. You can order a wired internet connection in the shop, under Internet and lead scanning.', status: 'closed' });
  }
  {
    const t = await ask('keystone', 'Change of invoice address', 'Our accounts team has moved. Can our invoice go to our new address: 4 Foundry Yard, Nottingham?');
    await assignTicket(ops, t.id, team.showAdmin.id);
    await replyAsStaff(ops, t.id, { body: 'Finance need the change in writing from a director before we reissue. Asked Kofi for it by email.', internal: true });
  }
  {
    const t = await ask('northgate', 'Paying our invoice', 'Can we pay our invoice in two parts, half now and half after the show?');
    await replyAsStaff(sam, t.id, { body: 'I’m afraid invoices need paying in full before the show. If that’s a problem, let us know and I’ll ask finance.', status: 'pending' });
  }
  {
    const t = await ask('helix', 'Starting build-up early', 'Our stand has a lot of plumbing. Could our contractor start the evening before build-up?');
    await replyAsStaff(ops, t.id, { body: 'Sorry, the halls are not open before build-up starts. Your contractor can start at 08:00 on the first day.', status: 'closed' });
  }
  {
    const t = await ask('aspen', 'Power for our fridge overnight', 'Our display fridge needs to stay on overnight. Is the standard socket enough?');
    await replyAsStaff(sam, t.id, { body: 'Standard sockets are switched off at night. Order the 24-hour power supply in the shop and your fridge stays on.', status: 'pending' });
    await replyAsExhibitor(ex('aspen').actor, standIds.aspen, t.id, { body: 'Ordered, thank you!' });
    await closeTicketAsExhibitor(ex('aspen').actor, standIds.aspen, t.id);
  }
  {
    const t = await ask('thermaflow', 'We missed the fascia deadline', 'Sorry, we missed the date for our fascia name. Is it too late? It should read THERMAFLOW HEATING.');
    await assignTicket(ops, t.id, team.showTeam.id);
  }

  // The AI assistant: its set-up, conversations and questions it could not answer ---------------
  await ensureDemoAssistant(london.id, admin.id);
  const converse = async (key: string, messages: [role: 'user' | 'assistant', text: string][], opts: { closed?: boolean; daysAgo: number }) => {
    const created = ago(opts.daysAgo);
    const [c] = await db
      .insert(assistantConversations)
      .values({ editionId: london.id, standId: standIds[key], userId: people[key].id, closedAt: opts.closed ? new Date(created.getTime() + 600_000) : null, createdAt: created, updatedAt: created })
      .returning();
    let tick = created.getTime();
    for (const [role, content] of messages) {
      tick += 45_000;
      await db.insert(assistantMessages).values({ conversationId: c.id, role, content, createdAt: new Date(tick) });
    }
    return c;
  };
  await converse(
    'acme',
    [
      ['user', 'What do I still need to do?'],
      ['assistant', `You have one thing left on your checklist: the **health and safety declaration**, due ${longDate(before(28))}. Your fascia name, on-site contact and rules are done, and your order for furniture and electrics is in.`],
      ['user', 'Do I need to order cleaning?'],
      ['assistant', 'No, every shell scheme stand gets a free clean before the doors open on the first morning. If you want your stand cleaned every day of the show, you can order a **daily stand clean** in the shop.'],
    ],
    { closed: true, daysAgo: 6 },
  );
  await converse(
    'acme',
    [
      ['user', 'When can I start building my stand?'],
      ['assistant', `Shell scheme stands are ready from 14:00 the day after build-up starts, so from ${longDate(new Date(buildUp.getTime() + DAY))}. All work must finish by 20:00 on the day before the show opens.`],
    ],
    { daysAgo: 1 },
  );
  await converse(
    'evergreen',
    [
      ['user', 'What height can our stand be?'],
      ['assistant', 'Space-only stands can be up to 4 m high. Anything taller, or with a second level, counts as a complex structure and needs structural calculations in your stand pack.'],
      ['user', 'Can we fly a drone on our stand to film the show?'],
      ['assistant', 'I don’t have information about drones in the manual, so I’ve noted your question for the show team. Would you like me to pass it to them?'],
    ],
    { daysAgo: 3 },
  );
  const quiet = await converse(
    'keystone',
    [
      ['user', 'Can we sell products from our stand during the show?'],
      ['assistant', 'I can’t find anything about selling on the stand in the manual, so I’ve noted it for the show team. I can pass the question on to them if you like.'],
    ],
    { daysAgo: 2 },
  );
  await converse(
    'brightbuild',
    [
      ['user', 'How do I book a delivery slot?'],
      ['assistant', 'Every vehicle needs a delivery slot, and slots are open now. The **Deliveries and vehicle access** page in the manual explains how to book one.'],
    ],
    { closed: true, daysAgo: 8 },
  );
  await db.insert(assistantUnanswered).values([
    { editionId: london.id, question: 'Can we fly a drone on our stand to film the show?', createdAt: ago(3) },
    { editionId: london.id, question: 'Can we sell products from our stand during the show?', conversationId: quiet.id, createdAt: ago(2) },
    { editionId: london.id, question: 'Is there somewhere to store empty packaging during the show?', createdAt: ago(1) },
    { editionId: london.id, question: 'Is there a prayer room at ExCeL?', resolvedAt: ago(4), resolvedBy: team.showAdmin.id, createdAt: ago(9) },
  ]);

  // Announcements ----------------------------------------------------------------------------
  await createAnnouncement(ops, london.id, {
    title: 'Delivery slots are open',
    bodyHtml: '<p>Every vehicle coming to build-up needs a delivery slot. See <em>Deliveries and vehicle access</em> in the manual to book yours.</p>',
    when: 'now',
    pinned: true,
  });
  await createAnnouncement(ops, london.id, {
    title: 'Free stand clean on the first morning',
    bodyHtml: '<p>Every shell scheme stand gets a free clean before the doors open on the first day of the show.</p>',
    visibleToTypes: [shell.id],
    when: 'now',
  });
  await createAnnouncement(ops, london.id, {
    title: 'Space-only packs: four weeks to go',
    bodyHtml: '<p>Stand packs are due four weeks before build-up. Packs sent late may not be reviewed in time.</p>',
    visibleToTypes: [space.id],
    when: 'now',
  });
  await createAnnouncement(ops, london.id, {
    title: 'Hall N3 opens at 07:00 on build-up day',
    bodyHtml: '<p>To give space-only contractors more time, hall N3 opens an hour early on the first day of build-up.</p>',
    when: 'scheduled',
    publishAt: before(7),
  });
  await createAnnouncement(ops, london.id, { title: 'The show guide is out', bodyHtml: '<p>The show guide is now online. Check your entry.</p>', when: 'draft' });

  // Emails -----------------------------------------------------------------------------------
  const welcome = await createCampaign(ops, london.id, {
    name: 'Welcome to BuildExpo London',
    subject: `Welcome to BuildExpo London ${year}`,
    blocks: [
      { type: 'heading', text: 'Welcome to BuildExpo London' },
      { type: 'paragraph', text: 'Your online exhibitor manual is ready. Your checklist shows everything your stand needs to do and when it is due.' },
      { type: 'tasks_due' },
    ],
    filter: { audience: 'main_contacts' },
  });
  await sendCampaign(ops, welcome.id);
  const electricsReminder = await createCampaign(ops, london.id, {
    name: 'Electrics reminder',
    subject: 'Last chance to order your stand electrics',
    blocks: [{ type: 'paragraph', text: 'Orders for stand electrics close soon. After that, late prices apply.' }],
    filter: { audience: 'main_contacts', categoryNotOrderedId: electrics.id },
  });
  await sendCampaign(ops, electricsReminder.id, { at: before(26) });
  await createCampaign(ops, london.id, {
    name: 'Show guide entries',
    subject: 'Check your show guide entry',
    blocks: [{ type: 'paragraph', text: 'Your show guide entry is due soon. Add it from your checklist.' }],
    filter: { audience: 'main_contacts', taskNotDoneId: guide.id },
  });

  // Notes, a pending staff invitation and library templates ----------------------------------------
  await addExhibitorNote(ops, london.id, companyIds.acme, 'Prefers to pay on invoice. Always quote their PO number.');
  await addExhibitorNote(sam, london.id, companyIds.northgate, 'Invoice overdue. Sent a reminder by phone; Nadia says it is with their accounts team.');
  await addExhibitorNote(ops, london.id, companyIds.fortis, 'Their contractor (Apex) has not joined yet. Chase at the end of the week.');
  await addExhibitorNote(sam, london.id, companyIds.thermaflow, 'Called about the fascia deadline. Happy to accept it late.');
  await inviteStaff(ops, london.id, 'nina@buildexpo.test', { role: 'show_team', permissions: ['helpdesk', 'manage_exhibitors'] });
  for (const item of [await savePageToLibrary(actor, hsPage.id), await saveTaskToLibrary(actor, contact.id)]) {
    await db.update(libraryItems).set({ isDemo: true }).where(eq(libraryItems.id, item.id));
  }

  // Green Homes Live: still being set up ------------------------------------------------------------
  const springDay = mondayAfter(150);
  const springBuild = at(springDay, '08:00');
  const springOpen = at(addDays(springDay, 2), '10:00');
  const springYear = springOpen.toLocaleDateString('en-GB', { year: 'numeric', timeZone: 'Europe/London' });
  const homesEdition = await createEdition(actor, homes.id, {
    name: `Green Homes Live ${springYear}`,
    venue: 'NEC',
    city: 'Birmingham',
    buildUpStartsAt: springBuild,
    openStartsAt: springOpen,
    openEndsAt: at(addDays(springDay, 3), '17:00'),
    breakdownEndsAt: at(addDays(springDay, 4), '18:00'),
  });
  await updateEditionBranding(actor, homesEdition.id, { primaryColor: '#2f6f3e', accentColor: '#c98a1b' });
  await db.insert(editionStaff).values([
    { editionId: homesEdition.id, userId: team.showAdmin.id, role: 'show_admin', permissions: [], addedBy: admin.id },
    { editionId: homesEdition.id, userId: team.marketing.id, role: 'show_team', permissions: ['edit_content', 'send_emails'], addedBy: admin.id },
  ]);
  const homesTypes = await db.select().from(exhibitorTypes).where(eq(exhibitorTypes.editionId, homesEdition.id));
  const homesShell = homesTypes.find((t) => t.key === 'shell_scheme')!;
  const homesSpace = homesTypes.find((t) => t.key === 'space_only')!;
  const [hall1] = await db.insert(halls).values({ editionId: homesEdition.id, name: 'Hall 1', sort: 1 }).returning();
  await createPage(ops, homesEdition.id, { title: `Welcome to Green Homes Live ${springYear}`, bodyHtml: '<p>The manual for Green Homes Live is being written. Check back soon.</p>', published: true, pinned: true });
  await createPage(ops, homesEdition.id, { title: 'Getting to the NEC', bodyHtml: '<p>The NEC is next to Birmingham International station and Birmingham Airport.</p>', published: true });
  await createPage(ops, homesEdition.id, { title: 'Health and safety', bodyHtml: '<p>To follow.</p>', published: false });
  await createTask(ops, homesEdition.id, {
    title: 'Your on-site contact',
    kind: 'form',
    formSchema: [
      { id: 'name', type: 'text', label: 'Name', required: true },
      { id: 'mobile', type: 'phone', label: 'Mobile number', required: true },
    ],
    deadline: { mode: 'offset', offsetDays: 21 },
    published: true,
    requirements: { [homesShell.id]: 'required', [homesSpace.id]: 'required' },
  });
  const homesFurniture = await createCategory(ops, homesEdition.id, { name: 'Furniture', supplierId: supplierRows.furniture.id, orderByOffsetDays: 21, commissionType: 'percent', commissionValue: 1500 });
  await createProduct(ops, homesEdition.id, { categoryId: homesFurniture.id, name: 'Folding chair', code: 'FUR-CH1', pricePence: 1800, vatRateBps: 2000 });
  await createProduct(ops, homesEdition.id, { categoryId: homesFurniture.id, name: 'Poseur table', code: 'FUR-PT1', pricePence: 4500, vatRateBps: 2000 });
  const homesStands: [string, string | null, string, typeof homesShell, number, number][] = [
    ['G-12', companyIds.acme, '', homesShell, 3, 3],
    ['G-14', companyIds.sunfield, '', homesShell, 3, 3],
    ['G-20', companyIds.helix, '', homesSpace, 6, 6],
    ['G-31', null, 'Eco Retrofit Partners', homesShell, 3, 2],
    ['G-33', null, 'HeatWise Controls', homesShell, 3, 3],
    ['G-40', null, 'Rainwater Harvest Co', homesShell, 4, 3],
    ['G-52', null, 'TimberLoft Insulation', homesSpace, 9, 6],
    ['G-60', null, 'Watt Battery Storage', homesShell, 3, 3],
  ];
  for (const [number, existing, newName, type, w, d] of homesStands) {
    const companyId =
      existing ?? (await db.insert(companies).values({ name: newName, country: 'United Kingdom', isDemo: true, website: `https://www.${newName.toLowerCase().replace(/[^a-z]+/g, '')}.example` }).returning())[0].id;
    await db.insert(stands).values({ editionId: homesEdition.id, number, exhibitorTypeId: type.id, hallId: hall1.id, companyId, widthM: String(w), depthM: String(d), sizeSqm: String(w * d), openSides: type.isSpaceOnly ? 3 : 1 });
  }
  clearDemoFlags();

  await addDemoBaskets();

  // Done: remember which version is loaded. -----------------------------------------------------
  await setDemoState({ version: DEMO_VERSION, loadedAt: startedAt.toISOString() }, undefined, admin.id);
}

/** Changes from one demo version to the next that can be made to the demo already there. */
const DEMO_UPGRADES: Record<number, () => Promise<string>> = {
  2: async () => {
    await addDemoBaskets();
    return 'Added open baskets to the demo (version 3), keeping everything else as it was.';
  },
};

/**
 * Version 3: baskets left without ordering, at different stages, so the basket reminders and the
 * Open baskets page can be tried. Stands that already have something in their basket are left alone.
 */
async function addDemoBaskets() {
  const db = await getDb();
  const [edition] = await db.select().from(editions).where(eq(editions.slug, DEMO_EDITION_SLUG)).limit(1);
  if (!edition) return;
  const byCode = new Map((await db.select().from(products).where(eq(products.editionId, edition.id))).map((p) => [p.code, p]));
  const now = Date.now();
  const HOUR = 3_600_000;
  type Plan = { stand: string; items: [code: string, quantity: number, options?: Record<string, string>][]; leftHoursAgo: number; remindedHoursAgo: number[] };
  const plans: Plan[] = [
    // Left two days ago: the first reminder goes the next morning.
    { stand: 'N1-214', items: [['ELE-LED', 2], ['FUR-LR1', 1]], leftHoursAgo: 50, remindedHoursAgo: [] },
    // Reminded once; the second reminder is due.
    { stand: 'N2-312', items: [['AV-55', 1], ['NET-W1', 1]], leftHoursAgo: 6 * 24, remindedHoursAgo: [5 * 24] },
    // Reminded twice and still not ordered: one for the team to call.
    { stand: 'N1-132', items: [['FUR-SF2', 1], ['FUR-PT1', 2, { Top: 'White' }]], leftHoursAgo: 12 * 24, remindedHoursAgo: [11 * 24, 8 * 24] },
    // Left this morning: nothing yet.
    { stand: 'N3-620', items: [['ELE-3P32', 1]], leftHoursAgo: 3, remindedHoursAgo: [] },
  ];
  for (const plan of plans) {
    const [stand] = await db.select().from(stands).where(and(eq(stands.editionId, edition.id), eq(stands.number, plan.stand))).limit(1);
    if (!stand?.companyId) continue;
    const [already] = await db.select({ id: cartItems.id }).from(cartItems).where(eq(cartItems.standId, stand.id)).limit(1);
    if (already) continue;
    const [contact] = await db
      .select({ id: companyMembers.userId })
      .from(companyMembers)
      .where(and(eq(companyMembers.companyId, stand.companyId), eq(companyMembers.role, 'main_contact')))
      .limit(1);
    const left = new Date(now - plan.leftHoursAgo * HOUR);
    for (const [code, quantity, options] of plan.items) {
      const p = byCode.get(code);
      if (!p) continue;
      await db.insert(cartItems).values({ standId: stand.id, productId: p.id, quantity, options: options ?? {}, addedBy: contact?.id ?? null, createdAt: left, updatedAt: left });
    }
    for (const [i, hours] of plan.remindedHoursAgo.entries()) {
      await db
        .insert(reminderLog)
        .values({ editionId: edition.id, standId: stand.id, subject: basketCycle(left), step: `r${i + 1}`, channel: 'email', createdAt: new Date(now - hours * HOUR) })
        .onConflictDoNothing();
    }
  }
  // Lumen Lighting ordered the day after a basket reminder, so "Ordered after a reminder" has an example.
  const [lumen] = await db
    .select({ id: orders.id, standId: orders.standId, createdAt: orders.createdAt })
    .from(orders)
    .innerJoin(stands, eq(stands.id, orders.standId))
    .where(and(eq(orders.editionId, edition.id), eq(stands.number, 'N1-126'), inArray(orders.status, ['paid', 'partially_refunded'])))
    .limit(1);
  if (lumen) {
    await db
      .insert(reminderLog)
      .values({ editionId: edition.id, standId: lumen.standId, subject: basketCycle(new Date(lumen.createdAt.getTime() - 2 * 24 * HOUR)), step: 'r1', channel: 'email', createdAt: new Date(lumen.createdAt.getTime() - 24 * HOUR) })
      .onConflictDoNothing();
  }
}
