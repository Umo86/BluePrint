# BluePrint

BluePrint is an online exhibitor manual and service-ordering platform for exhibition organisers. One site holds all of an organiser's shows, each with its own branding, manual, suppliers and team.

- **Exhibitors** see the manual and the tasks for their stand type (shell scheme or space only), fill in forms, upload documents, order services, ask the show team questions and use the assistant.
- **Contractors** for space-only stands prepare and send the stand pack for health and safety review.
- **Suppliers** manage their catalogue, see their orders and set up payouts.
- **The show team** runs each show from its dashboard: exhibitors and progress, tasks and deadlines, manual pages, reminders and emails, orders and refunds, the help desk, reports.
- **Super admins** control everything: shows and editions, users and permissions, suppliers, the shared library, platform settings, payments, the audit log and data protection requests.

## Guides

| Guide | For |
| --- | --- |
| [Deployment](docs/deployment.md) | Setting up the live site and running it |
| [Security](docs/security.md) | How BluePrint protects accounts and data |
| [Email](docs/email.md) | Sending through Resend, SPF/DKIM/DMARC, reminders and updates |
| [Payments](docs/payments.md) | The money model, Stripe, supplier payouts and refunds (share with finance) |
| [Assistant and help desk](docs/assistant.md) | The exhibitor assistant and the team's help desk |
| [Reports](docs/reports.md) | Progress tracking, service lists and spreadsheets |

## Running it on your computer

You need Node.js 22 or later.

```bash
npm install
npm run seed    # demo shows, exhibitors, suppliers and staff
npm run dev
```

Open http://localhost:3000 (the public homepage; the about page is at `/about`), choose **Sign in**, then **No password? Email me a sign-in code**, and sign in as `admin@blueprint.test`. Sign-in codes appear in the local mailbox at http://localhost:3000/dev/mailbox, and the seed prints the two-factor key to add to an authenticator app. It also prints demo exhibitor, supplier and show admin accounts.

On your computer BluePrint needs no accounts or keys: the database is an embedded Postgres in `.data/`, files are kept in `.data/files`, email goes to the local mailbox, a payment simulator stands in for Stripe and the assistant runs in practice mode. None of these stand-ins can run on a live site.

## Checks

```bash
npm run typecheck   # TypeScript
npm run lint        # ESLint
npm test            # unit and integration tests, on a fresh in-memory database
npm run test:e2e    # browser tests (Playwright) against a freshly seeded development server
npm run build && E2E_MODE=production npm run test:e2e   # the same against a production build
```

The browser tests include automated accessibility checks (WCAG 2.2 A and AA rules, using axe) on the public pages, sign-in and every main page of the exhibitor portal, the supplier portal, the show dashboard and the super admin dashboard. Colours meet the AA contrast ratio, every control has a name for screen readers, and links in text are underlined.

## Look and feel

Black and white with plenty of space, hairlines rather than shadows, and one drafting blue (`#2b50e0`) for links, line drawings and keyboard focus. Titles use Aleo (light), everything else Host Grotesk, and buttons on the public pages Azeret Mono. The fonts are served from the site itself (`@fontsource-variable` packages), so pages make no requests to font services. Colours and fonts are set in `src/theme.ts` and `src/app/globals.css`; the public pages have their own styles in `src/components/site/site.module.css`.

## Changing the database

Edit the schema in `src/server/db/schema/`, then run `npm run db:generate -- --name what_changed` to write a migration into `drizzle/`. Migrations run automatically on your computer and with `npm run db:migrate` on deployment.

## Where things are

| Folder | What |
| --- | --- |
| `src/app/page.tsx`, `src/app/about`, `src/components/site` | Public homepage and about page |
| `src/app/start` | Where signing in leads: the person's workspace, or a choice of workspaces |
| `src/app/portal` | Exhibitor portal |
| `src/app/manage` | Show dashboard for the show team |
| `src/app/admin` | Super admin dashboard |
| `src/app/supplier`, `src/app/contractor` | Supplier portal, contractor pages |
| `src/app/api` | Webhooks (Stripe, Resend), scheduled jobs, uploads |
| `src/server/services` | Business rules; every function checks who is asking |
| `src/server/auth`, `src/server/authz`, `src/server/security` | Sign-in, permissions, security helpers |
| `src/server/assistant` | The exhibitor assistant (Claude) |
| `src/server/email`, `src/server/payments`, `src/server/storage` | Resend, Stripe, R2 |
| `drizzle` | Database migrations |
| `tests` | Unit, integration and browser tests |

Built with Next.js 16, React 19, Mantine, Drizzle ORM and Postgres.
