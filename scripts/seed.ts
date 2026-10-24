/**
 * Fills a local database with realistic demo data for trying BluePrint out and for tests.
 *   PGLITE_DIR=.data/demo npm run seed
 *
 * Creates a demo super admin (admin@blueprint.test) whose two-factor key is printed at the end,
 * so you can add it to an authenticator app. Refuses to run against production.
 */
import { eq } from 'drizzle-orm';
import { getDb, closeDb } from '../src/server/db/client';
import { companies, companyMembers, editionStaff, exhibitorTypes, halls, stands, supplierUsers, users } from '../src/server/db/schema';
import { encryptSecret } from '../src/server/security/crypto';
import { generateTotpSecret } from '../src/server/security/totp';
import { createEdition, createShow } from '../src/server/services/editions';
import { createSupplier } from '../src/server/services/suppliers';
import type { Actor } from '../src/server/auth/actor';

const DEMO_ADMIN = 'admin@blueprint.test';

async function main() {
  if (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL) {
    if (process.env.BLUEPRINT_ALLOW_SEED !== 'true') {
      throw new Error('Refusing to seed a production or shared database. Set BLUEPRINT_ALLOW_SEED=true if you really mean it.');
    }
  }
  const db = await getDb();
  const [existing] = await db.select().from(users).where(eq(users.email, DEMO_ADMIN)).limit(1);
  if (existing) {
    console.log('Demo data is already there. Delete the local database folder to start again.');
    await closeDb();
    return;
  }

  const totpSecret = process.env.SEED_TOTP_SECRET || generateTotpSecret();
  const [admin] = await db
    .insert(users)
    .values({
      email: DEMO_ADMIN,
      name: 'Demo Admin',
      isSuperAdmin: true,
      status: 'active',
      totpSecretEnc: encryptSecret(totpSecret),
      totpEnabledAt: new Date(),
    })
    .returning();
  const actor: Actor = {
    userId: admin.id,
    email: admin.email,
    name: admin.name,
    isSuperAdmin: true,
    readOnly: false,
    realUserId: admin.id,
    realEmail: admin.email,
    ip: '127.0.0.1',
    userAgent: 'seed',
  };

  // Shows and editions ------------------------------------------------------
  const ukcw = await createShow(actor, { name: 'UK Construction Week', description: 'The UK’s biggest built environment event.' });
  const london = await createEdition(actor, ukcw.id, {
    name: 'UKCW London 2027',
    slug: 'ukcw-london-2027',
    venue: 'ExCeL London',
    city: 'London',
    buildUpStartsAt: '2027-05-03 08:00',
    openStartsAt: '2027-05-05 09:00',
    openEndsAt: '2027-05-07 17:00',
    breakdownEndsAt: '2027-05-08 18:00',
    status: 'live',
  });
  const futurebuild = await createShow(actor, { name: 'Futurebuild', description: 'Sustainability and the built environment.' });
  await createEdition(actor, futurebuild.id, {
    name: 'Futurebuild 2027',
    slug: 'futurebuild-2027',
    venue: 'ExCeL London',
    city: 'London',
    buildUpStartsAt: '2027-03-01 08:00',
    openStartsAt: '2027-03-02 10:00',
    openEndsAt: '2027-03-04 17:00',
    breakdownEndsAt: '2027-03-05 18:00',
  });
  const stone = await createShow(actor, { name: 'Stone & Surface', description: 'Natural stone, surfaces and finishes.' });
  await createEdition(actor, stone.id, { name: 'Stone & Surface 2027', slug: 'stone-surface-2027', venue: 'NEC', city: 'Birmingham' });

  const types = await db.select().from(exhibitorTypes).where(eq(exhibitorTypes.editionId, london.id));
  const shell = types.find((t) => t.key === 'shell_scheme')!;
  const space = types.find((t) => t.key === 'space_only')!;
  const hallRows = await db
    .insert(halls)
    .values([
      { editionId: london.id, name: 'N1', sort: 1 },
      { editionId: london.id, name: 'N2', sort: 2 },
      { editionId: london.id, name: 'N3', sort: 3 },
    ])
    .returning();

  // Team --------------------------------------------------------------------
  const staff = [
    { email: 'ops@blueprint.test', name: 'Olivia Ops', role: 'show_admin' as const, permissions: [] },
    { email: 'sales@blueprint.test', name: 'Sanjay Sales', role: 'show_team' as const, permissions: ['manage_exhibitors', 'manage_orders', 'view_reports'] },
    { email: 'hs@blueprint.test', name: 'Hannah Safety', role: 'hs_reviewer' as const, permissions: [] },
  ];
  for (const s of staff) {
    const [u] = await db.insert(users).values({ email: s.email, name: s.name, status: 'active' }).returning();
    await db.insert(editionStaff).values({ editionId: london.id, userId: u.id, role: s.role, permissions: s.permissions as never, addedBy: admin.id });
  }

  // Exhibitors ----------------------------------------------------------------
  const exhibitors = [
    { name: 'Acme Insulation Ltd', stand: 'N1-110', type: shell, hall: 0, size: '9', contact: ['Amira Khan', 'amira@acme-insulation.test'] },
    { name: 'BrightBuild Windows', stand: 'N1-214', type: shell, hall: 0, size: '12', contact: ['Ben Carter', 'ben@brightbuild.test'] },
    { name: 'Cladtech Systems', stand: 'N2-305', type: shell, hall: 1, size: '18', contact: ['Chloe Wright', 'chloe@cladtech.test'] },
    { name: 'Dura Roofing Group', stand: 'N2-410', type: shell, hall: 1, size: '9', contact: ['Dev Patel', 'dev@duraroofing.test'] },
    { name: 'Evergreen Timber Frames', stand: 'N3-501', type: space, hall: 2, size: '72', contact: ['Ella Morgan', 'ella@evergreen.test'] },
    { name: 'Fortis Steel', stand: 'N3-620', type: space, hall: 2, size: '120', contact: ['Finn O’Brien', 'finn@fortissteel.test'] },
  ];
  for (const x of exhibitors) {
    const [c] = await db
      .insert(companies)
      .values({ name: x.name, website: `https://www.${x.contact[1].split('@')[1].replace('.test', '.example')}`, country: 'United Kingdom' })
      .returning();
    await db.insert(stands).values({ editionId: london.id, number: x.stand, exhibitorTypeId: x.type.id, hallId: hallRows[x.hall].id, companyId: c.id, sizeSqm: x.size, openSides: 2 });
    const [u] = await db.insert(users).values({ email: x.contact[1], name: x.contact[0], status: 'active' }).returning();
    await db.insert(companyMembers).values({ companyId: c.id, userId: u.id, role: 'main_contact', canPay: true });
  }

  // Suppliers -----------------------------------------------------------------
  const suppliers = [
    { name: 'Expo Furniture Hire', email: 'orders@expofurniture.test', user: ['Fiona Furniture', 'fiona@expofurniture.test'] },
    { name: 'PowerOn Electrical', email: 'orders@poweron.test', user: ['Pete Power', 'pete@poweron.test'] },
    { name: 'ShowSound AV', email: 'orders@showsound.test', user: ['Sophie Sound', 'sophie@showsound.test'] },
  ];
  for (const s of suppliers) {
    const sup = await createSupplier(actor, { name: s.name, email: s.email });
    const [u] = await db.insert(users).values({ email: s.user[1], name: s.user[0], status: 'active' }).returning();
    await db.insert(supplierUsers).values({ supplierId: sup.id, userId: u.id });
  }

  console.log('\nDemo data created.');
  console.log(`Super admin: ${DEMO_ADMIN} (sign in with the emailed code from /dev/mailbox)`);
  console.log(`Two-factor key for your authenticator app: ${totpSecret}`);
  console.log('Show admin: ops@blueprint.test · Exhibitor: amira@acme-insulation.test · Supplier: fiona@expofurniture.test\n');
  await closeDb();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
