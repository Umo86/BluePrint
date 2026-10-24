# Security

How BluePrint protects accounts and data, what was checked before launch, and what Media10 needs to do to keep it secure. For setting the site up, see [deployment](deployment.md).

BluePrint holds personal and commercial information about exhibitors, contractors and suppliers: names and contact details, stand plans, risk assessments and insurance documents, orders, invoices, help desk messages and assistant conversations. Card details never reach BluePrint.

## Signing in

- **Emailed codes.** People sign in with a six-digit code sent to their work email. Each code works once, for 10 minutes, and allows five tries.
  - **Asking for codes.** An address can get five codes every 15 minutes from each network, and 30 an hour in all. One network (a venue or an office) can ask for up to 100 codes every 15 minutes, so a whole build-up crew on the venue Wi-Fi is not blocked.
  - **Guessing.** An address allows ten guesses every 15 minutes and 100 a day. Guesses only count while a code is actually waiting, so strangers can't lock someone out by typing wrong codes for them.
- **Passwords (optional).** Passwords must be at least 12 characters and not a known common password. They are stored with Argon2id. After ten wrong passwords, password sign-in pauses for 15 minutes; codes still work. A password can only be set or removed within 15 minutes of signing in, and the person gets an email whenever it changes.
- **Two-factor sign-in.** Every super admin and show team member must use an authenticator app (with ten single-use recovery codes). Exhibitors, contractors and suppliers can turn it on too, and from then on it is always asked for. Like a password, it can only be turned on within 15 minutes of signing in, so someone at a borrowed, open browser can't lock the owner out. Turning it on signs out the person's other devices and emails them.
- **No clues for attackers.** The sign-in page answers the same way, and takes the same time, whether or not an address has an account.
- **Sessions.** Each sign-in gets a new random 256-bit token, stored only as a fingerprint (hash). The cookie can't be read by page scripts, is only sent over HTTPS, and isn't sent by other websites. Passing two-factor issues a fresh token. Staff are signed out after 12 hours of inactivity and after 7 days in all; everyone else after 30 days. People can see their devices and sign them out (Account and security). Super admins can sign anyone out everywhere or disable an account, which ends all of its sessions at once.

## Invitations

- Links work for 14 days and only once.
- Accepting always needs a code emailed to the invited address (unless the person is already signed in as that address), so a forwarded or leaked link is useless on its own.
- Nobody can invite themselves.
- Someone invited by one show's team joins the company for that show only. They cannot see the company's stands, orders or documents at other shows unless that show's team invites them too.

## Who can see and do what

Every request is checked on the server against the person's role and the record involved. Hiding a button is never the only protection.

| Person | Can reach |
| --- | --- |
| Super admin | Everything. |
| Show admin | Everything in their own shows. |
| Show team | Only the areas ticked for them (manual and tasks, exhibitors and stands, space-only approvals, orders and refunds, emails, help desk, reports) in their own shows. Exhibitors' documents open only for people with exhibitor, help desk or space-only rights. |
| Health and safety reviewer | Only the space-only review queue and its documents. |
| Exhibitor | Only their own company's stands, at the shows they were invited for. Paying needs payment rights. |
| Contractor | Only the space-only stands they were nominated for. |
| Supplier | Only their own catalogue, their orders and their payouts. |

- **Viewing as an exhibitor** (to help someone) is read-only. It covers that exhibitor's portal at one show only, never their other shows, staff work or supplier account. It is re-checked on every page and recorded in the audit log.
- **A company's people.** A show team that removes someone takes them off its own shows only; their access at other shows stays. Changing someone's role or payment rights needs rights covering every show they act at.
- **Shared company details.** The name, address, VAT number and "pay on invoice" setting are shared with every show, and print on their invoices. They can only be changed by super admins, staff who manage exhibitors at every show the company exhibits at, or a main contact for all of those shows.
- **Supplier details** (shared by every show) can only be changed by super admins or the supplier's own people.

## Files

- **Accepted files.** PDF, Word, Excel, PowerPoint, images and (for stand plans) DWG drawings, each type with a size limit. SVG and HTML are refused because they can carry scripts. Each file is checked by its actual content, not its name.
- **Storage.** Files are kept privately in Cloudflare R2 under names BluePrint generates. Browsers upload directly with a link that lasts ten minutes.
- **Downloads.** BluePrint first checks the person may see the file, then hands out a link that lasts one minute and is served from the storage address, not BluePrint's own. Only logos, branding and product photos are public.
- **Internal notes.** Files added to an internal help desk note can never be opened by the exhibitor.
- **Not virus-scanned.** Staff should open exhibitors' documents with normal care. Add a scanning service if Media10's IT policy needs one.

## Payments

- **Card details never touch BluePrint.** Card payments use Stripe Checkout, so BluePrint stays outside most card-security (PCI DSS) requirements.
- **Prices.** Prices, VAT and totals are always worked out on the server from the catalogue. The browser only says what was chosen.
- **Stripe messages.** BluePrint checks the signature and age of every message from Stripe and applies each one once only.
- **Refunds.** A refund can never be more than was paid. If Stripe later reports that a card refund failed, the orders team is emailed straight away.
- **Payout accounts.** A supplier's Stripe account is linked once, by Stripe's own onboarding, and can't be swapped for someone else's.

See [payments](payments.md) for the money model.

## Email

- Sent through Resend from domains with SPF, DKIM and DMARC (see [email](email.md)).
- **Records without secrets.** Sign-in codes, invitation links and unsubscribe links are removed from the stored copy once an email has been sent, and are never shown to staff in the email log.
- **No injected content.** Text people type is escaped, so it can't add HTML or extra email headers. The optional HTML block in templates is cleaned of scripts, forms and tracking.
- **Unsubscribing.** Update emails carry one-click unsubscribe links that can't be forged.

## The exhibitor assistant

- It works only on the signed-in exhibitor's own stand. BluePrint fixes which stand that is; the model never chooses it.
- It can't change anything without the exhibitor pressing a button.
- Links in its replies only open BluePrint pages or secure websites, and links to other websites always show their real address.
- Each person, and each show, has a daily limit.
- Conversations are deleted after 12 months by default.
- Anthropic does not train its models on data sent through its API.

See [assistant](assistant.md).

## Protection built into every page

- **Content Security Policy.** Each page load gets a fresh nonce, so scripts that BluePrint didn't add can't run. Pages can't be put inside another site's frame.
- **HTTPS.** The site is HTTPS only (HSTS), and browsers are told not to guess file types.
- **Forged requests.** Changes are only accepted from BluePrint's own pages, and cookies are not sent by other websites.
- **Redirects.** "Go back to where you were" links can only lead to pages on BluePrint.
- **Input checks.** Every form is validated on the server. Rich text (manual pages, announcements) is cleaned before it is stored and again before it is shown.
- **Spreadsheets.** Excel and CSV downloads can't run formulas planted in a cell.
- **Rate limits.** Sign-in, two-factor, invitations, questions to the team, the assistant and bulk emails all have limits.
- **Test-only tools.** The test mailbox, payment simulator and practice assistant only ever run on a developer's own computer. A live site refuses to start without its real settings.

## Records and data protection

- **Audit log.** Sign-ins, failed codes, changes to people and permissions, exports, refunds, viewing as someone, and staff reading assistant conversations are all recorded. Super admins can search and download it.
- **Data requests.** Super admin → Privacy (GDPR) finds everything about a person, exports it, and erases or anonymises it on request.
- **Retention.** Each kind of record has its own retention period, set under Platform settings → Data retention:

  | Record | Kept for (default) |
  | --- | --- |
  | Orders | 6 years |
  | Space-only packs | 6 years after the show |
  | Incident records | 3 years |
  | Inactive contacts | 3 years |
  | Email logs | 24 months |
  | Assistant conversations | 12 months |

  The nightly tidy-up deletes records once their period ends.
- **Encryption.**
  - Neon and R2 encrypt everything they store.
  - Two-factor keys are encrypted again with AES-256-GCM under `APP_ENCRYPTION_KEY`.
  - Codes, tokens and recovery codes are stored only as fingerprints (hashes).
- **Sub-processors.** Media10's privacy notice and records of processing should name:
  - Vercel (hosting);
  - Neon (database, London);
  - Cloudflare (files);
  - Resend (email);
  - Stripe (payments);
  - Anthropic (assistant, if switched on).

## Changing the encryption key

`APP_ENCRYPTION_KEY` protects two-factor keys and signs unsubscribe links. To change it (for example, if it may have leaked):

1. Generate a new key (`openssl rand -base64 32`).
2. In Vercel, set `APP_ENCRYPTION_KEY_PREVIOUS` to the old key and `APP_ENCRYPTION_KEY` to the new one, then redeploy.
3. From a trusted computer with the same settings, run `npm run secrets:reencrypt`. It moves every two-factor key onto the new key and reports any it could not read (those people need their two-factor reset by a super admin).
4. Keep `APP_ENCRYPTION_KEY_PREVIOUS` for a few weeks so unsubscribe links in recent emails still work, then remove it and redeploy.

## What was checked before launch

- **Automated tests.** 204 unit and integration tests, including tests that each kind of person can only reach what they should. There are also browser journeys through the exhibitor portal, the show dashboard, the super admin dashboard, the shop, space-only approvals, the help desk and the assistant, run against both the development and the production build.
- **Independent security review.** On 24 October 2026, three separate reviewers read the code without seeing the author's reasoning. They covered:
  - sign-in and administration;
  - access control and files;
  - payments, email and the assistant.

  Everything they found was fixed and covered by new tests:
  - Invitation links could be used without the invited mailbox.
  - Viewing as an exhibitor reached beyond the one show.
  - Exhibitor memberships covered every show.
  - Some files were open to any show team member.
  - A redirect could be tricked into leaving the site.
  - Optional two-factor was not enforced.
  - Code guesses were not counted atomically.
  - The local test settings could have exposed a test mailbox.
  - Assistant links could hide their destination.

  A fourth reviewer then checked the fixes themselves. That found and closed the remaining gaps:
  - a second redirect trick (`/.//`);
  - wrong codes that could lock someone out;
  - two-factor being turned on from a borrowed session;
  - space-only emails, contact lists, shared company details and imports that still crossed shows;
  - invitations that couldn't be cancelled once their stand was gone.
- **Dependencies.** `npm audit` reports no known vulnerabilities (24 October 2026).

## Keeping it secure

- **Before launch, and yearly after.** Have an independent penetration test done by a CREST-accredited tester. Align with Cyber Essentials if Media10 holds it.
- **Accounts.** Turn on two-factor for every Vercel, Neon, Cloudflare, Stripe, Resend and Anthropic account. Give access to as few people as possible. Keep at least two super admins.
- **Leavers.** When someone leaves Media10, disable their BluePrint account and remove them from the service accounts.
- **Updates.** Check dependency updates monthly (`npm audit`, or GitHub's Dependabot), and apply security updates promptly.
- **Monitoring.** Watch Vercel's logs and BluePrint's audit log for unusual activity. Stripe and Resend both send alerts for problems.
- **Incidents.** If you suspect a breach:
  - revoke the affected keys;
  - disable or sign out the accounts involved;
  - keep the audit log;
  - follow Media10's breach procedure. Personal data breaches may need reporting to the ICO within 72 hours.

## Known limits

- **Flooding someone with codes.** Someone who knows a person's address can request codes for it until the hourly ceiling is reached (each request emails the person), which stops new codes for up to an hour. They can't sign in themselves.
- **Role and payment rights are per company.** Someone who is a main contact (or can pay) for a company keeps that role at every show they are added to. Only a super admin can change it if they act at shows the show team doesn't cover.
- **Network limits on Vercel only.** The per-network limits rely on the visitor address Vercel provides, so they assume BluePrint runs on Vercel.
- **Shared company records.** Company records are shared between shows, so a show team that reuses a company can see its name and details, but not its people, orders or documents at other shows.
