# Email: sending, deliverability, reminders and updates

BluePrint sends all email through **Resend**. This page covers setting it up so emails reach inboxes (not spam), and how the show team uses emails.

## What BluePrint sends

| Kind | Examples | Can people unsubscribe? |
| --- | --- | --- |
| Security | Sign-in codes | No. Always sent, even to addresses that bounced before. Fixed wording. |
| Service | Invitations, order confirmations, approvals, refunds | No (they are about the person's own stand). |
| Reminders | Deadline reminders | No, but a task marked "not needed" stops them. |
| Basket reminders | "Your basket for stand N1-214 is waiting" | No, but emptying the basket or ordering stops them. Each show can switch them off (Orders → Open baskets). |
| Updates (campaigns) | "Build-up times have changed" | Yes: one-click unsubscribe, per show. |

Every email is recorded (Emails → Sent, and on each exhibitor's record) with its delivery status.

## 1. Set up the sending domain in Resend (once per show brand)

Use a **subdomain** for each show so its reputation is separate from your company's own mail, for example `mail.yourshow.com`. Use a second subdomain for updates if you send many, for example `news.yourshow.com`.

1. In Resend → **Domains**, add the subdomain and choose the EU region.
2. Add the DNS records Resend shows at your DNS provider:
   - **SPF** (TXT on the `send` subdomain Resend names): authorises Resend to send for the domain.
   - **DKIM** (TXT `resend._domainkey…`): signs each email so receivers can tell it was not altered or forged.
   - **MX** for bounce handling (on the `send` subdomain).
3. Wait until Resend shows the domain as **Verified**.
4. Add a **DMARC** record for the parent domain (TXT `_dmarc.ukconstructionweek.com`). Start with monitoring, then tighten:
   - Week 1–2: `v=DMARC1; p=none; rua=mailto:dmarc@yourcompany.com; adkim=s; aspf=s`
   - Once reports show only legitimate mail: `p=quarantine`, then `p=reject`.
   DMARC tells inbox providers to trust mail that passes SPF/DKIM for your domain and to reject imitations; Gmail and Yahoo require it for bulk senders.
5. Optional but recommended: set up **BIMI** later for the logo in Gmail.

## 2. Connect BluePrint

Environment variables:

- `EMAIL_PROVIDER=resend`
- `RESEND_API_KEY`: a **sending-only** API key.
- `RESEND_WEBHOOK_SECRET`: from the webhook below.
- `EMAIL_DEFAULT_FROM`: fallback sender, for example `BluePrint <no-reply@mail.yourcompany.com>`.

Then in BluePrint:

- **Super admin → Platform settings → Email defaults**: default sender name and address (on a verified domain).
- **Each show → Show settings → Email**: the show's sender name, address and reply-to (on that show's verified subdomain), and a separate address for updates if you have one.

## 3. Delivery tracking (Resend webhook)

In Resend → **Webhooks**, add `https://<your domain>/api/resend/webhook` with the events `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.opened`, `email.clicked`, `email.bounced`, `email.complained`, `email.failed`. Copy its signing secret into `RESEND_WEBHOOK_SECRET`.

BluePrint checks every webhook's signature and time (within five minutes) and ignores repeats. Hard bounces and spam complaints add the address to the **blocked list** (Super admin → System) so BluePrint stops emailing it, which protects your sending reputation. Sign-in codes still go, so nobody is locked out; an address can be unblocked from the System page.

## 4. Scheduled jobs

`vercel.json` runs these on Vercel Cron (times are UTC):

| Job | When | What |
| --- | --- | --- |
| `send-queue` | every 10 minutes | Sends queued update emails in batches and retries failed sends (three tries, at least 15 minutes apart). |
| `reminders` | 07:00 UTC (8am UK summer time) | Deadline reminders to exhibitors and the team's morning summary. |
| `housekeeping` | 02:30 UTC | Releases abandoned checkouts, sends waiting supplier payouts, removes expired sign-in records and unfinished uploads, deletes order artwork that was never ordered (after 30 days), and deletes email logs older than the retention period. |

Set `CRON_SECRET` (a long random value); Vercel sends it automatically. Calls without it get "not found". Super admins can also run any job from **Super admin → System**.

## Reminders

Each published task with a deadline that applies to a stand (required or "if it applies") is reminded at its steps: 14, 7 and 1 days before by default (Platform settings → Reminders), or the task's own steps, and once when overdue. Each stand gets one email listing everything due within the next month. Each step is recorded before sending, so nobody gets the same reminder twice. Tasks that are done, marked not needed, waiting for the team, or closed are never chased.

## Standard emails the team can reword

Under **Emails → Standard emails** each show can reword: the invitation to the exhibitor portal, deadline reminders and order confirmations. The editor has a live preview, the generated HTML, the plain-text version and "Send me a test". Text is always escaped; the optional HTML block is cleaned of scripts, forms and tracking. Required parts (for example the invitation link) cannot be removed. "Use the standard wording" undoes changes.

## Updates to exhibitors (campaigns)

**Emails → Updates to exhibitors**: write the email, choose who gets it (main contacts or everyone; by stand type, hall, a task not done, a shop category not ordered from, or people who have never signed in), send yourself a test, then send now or schedule it. The audience count excludes people who unsubscribed. Up to 5,000 update emails per show per day.

Every update has an unsubscribe link and the `List-Unsubscribe` / one-click headers Gmail and Yahoo require. Unsubscribing only stops updates for that show; service emails and reminders still arrive.

## Deliverability checklist

- SPF, DKIM and DMARC pass (check a test email's headers: `spf=pass`, `dkim=pass`, `dmarc=pass`).
- Each show sends from its own verified subdomain; updates from a separate one if volume is high.
- Every email has a plain-text version (BluePrint adds it automatically).
- Keep the bounce rate low: import clean contact lists, and let BluePrint block bounced addresses.
- Avoid sending large updates to people who have never signed in, all at once, early in the year.

## Basket reminders (cart abandonment)

When an exhibitor puts services in their basket and leaves without ordering, BluePrint emails the people who filled the basket the morning after (with the deadline reminders, 07:00 UTC), and again four days after the basket was last changed. The email lists the basket, its total with VAT, and the next date that matters: the end of an early-bird price, a price rise, or a category's ordering deadline.

- Any change to the basket starts the count again; ordering empties the basket, so the reminders stop.
- A basket being paid for by card at the time is left alone.
- The show team sees every open basket under **Orders → Open baskets**: what is in it, its value, who filled it, the reminders sent, and the orders placed within two weeks of a reminder. "Send reminder now" sends one straight away (at most once every 12 hours per stand).
- The timing (or switching them off) is set per show on the same page. The wording is under **Emails → Basket reminder**.
- The team's morning summary says how many baskets have been left for more than a day.
