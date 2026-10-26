# Deploying and running BluePrint

BluePrint runs on **Vercel**, with a **Neon** Postgres database, **Cloudflare R2** for uploaded files, **Resend** for email, **Stripe** for card payments and supplier payouts, and (optionally) **Claude** for the exhibitor assistant. This guide sets up a live site from nothing. Allow half a day, plus time for DNS to settle.

The other guides go deeper on each area: [email](email.md), [payments](payments.md), [assistant](assistant.md), [reports](reports.md) and [security](security.md).

## 1. Accounts you need

| Service | Used for | Plan and settings |
| --- | --- | --- |
| Vercel | Hosts the site and runs the scheduled jobs | **Pro**. Hobby is for non-commercial use and only runs scheduled jobs once a day, while BluePrint's email queue runs every 10 minutes. Functions run in London (`lhr1`, set in `vercel.json`). |
| Neon | The database | Region **AWS Europe West 2 (London)**. A paid plan gives a longer restore window. |
| Cloudflare R2 | Uploaded files (stand plans, risk assessments, insurance, logos, product photos) | Any plan. EU jurisdiction recommended. |
| Resend | All email | EU region. See [email](email.md). |
| Stripe | Card payments and supplier payouts | Only needed when you take card payments. See [payments](payments.md). |
| Anthropic (Claude Console) | The exhibitor assistant | Optional. See [assistant](assistant.md). |

Use one shared company login (with two-factor) for each service rather than someone's personal account, and record who has access.

## 2. Database (Neon)

1. Create a project in **AWS Europe West 2 (London)** with the latest Postgres version.
2. Copy the **pooled** connection string (the host name contains `-pooler`) and end it with `?sslmode=verify-full` (Neon shows `sslmode=require&channel_binding=require`, which also works but logs a warning on every start). This is `DATABASE_URL`.
3. Create a branch called `staging` for a test site (optional but recommended). Its own connection string goes in Vercel's **Preview** environment, so test builds never touch live data.
4. In the project settings, set the restore window (history retention) as long as your plan allows.

## 3. File storage (Cloudflare R2)

1. **R2 → Create bucket**, for example `blueprint-files`. Under **Location**, choose the **European Union** jurisdiction to keep files in the EU (this cannot be changed later) and set `R2_JURISDICTION=eu`.
2. Leave public access **off**: no `r2.dev` address and no custom domain. BluePrint checks who is asking and then hands out a download link that lasts one minute.
3. Bucket → **Settings → CORS policy → Add CORS policy**, JSON tab, with your site's address:

   ```json
   [
     {
       "AllowedOrigins": ["https://blueprint.yourcompany.com"],
       "AllowedMethods": ["PUT"],
       "AllowedHeaders": ["Content-Type"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

   Browsers upload straight to R2 with a ten-minute signed link; BluePrint then checks what arrived. Downloads need no CORS rule.
4. **R2 → Manage API tokens → Create API token** with **Object Read & Write**, limited to this bucket. Copy the access key ID and secret. The account ID is on the R2 overview page.

## 4. Email (Resend)

Follow sections 1 to 3 of the [email guide](email.md): verify a sending subdomain with SPF, DKIM and DMARC, create a sending-only API key, and add the delivery webhook once the site is live.

## 5. Create the Vercel project

1. **Add New → Project** and import the Git repository. Vercel detects Next.js.
2. Nothing to change under **Build and Deployment**: `vercel.json` sets the build command to `npm run db:migrate && npm run build`, so database changes are applied before each deployment goes live. They only ever add to the database, so the previous version keeps working if you roll back. A deployment without `DATABASE_URL` skips the migrations.
3. **Settings → Environment Variables**. Set these for **Production** (and staging equivalents for **Preview**, or turn preview deployments off):

| Variable | Required | What it is |
| --- | --- | --- |
| `APP_URL` | Yes | The site's address, for example `https://blueprint.yourcompany.com`. Used in email links and to check that requests come from the site itself. Before you add your own domain, use the production address under **Settings → Domains** (such as `https://blue-print-xyz.vercel.app`), not a deployment's own address: Vercel puts those behind its sign-in. |
| `DATABASE_URL` | Yes | Neon's pooled connection string (step 2). |
| `DATABASE_URL_UNPOOLED` | No | Neon's direct connection string. When set, database changes during deployment use it, as Neon recommends; otherwise they use `DATABASE_URL`. |
| `APP_ENCRYPTION_KEY` | Yes | 32 random bytes, base64: `openssl rand -base64 32`. Encrypts two-factor keys. Keep a copy in the company password manager. |
| `CRON_SECRET` | Yes | A long random value: `openssl rand -hex 32`. Vercel sends it with each scheduled job. |
| `EMAIL_PROVIDER` | For email | `resend` |
| `RESEND_API_KEY` | For email | Sending-only key (step 4). |
| `RESEND_WEBHOOK_SECRET` | For email | From the Resend webhook ([email guide](email.md), section 3). |
| `EMAIL_DEFAULT_FROM` | For email | Fallback sender on a verified domain, for example `BluePrint <no-reply@mail.yourcompany.com>`. |
| `STORAGE_PROVIDER` | For files | `r2` |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | For files | From step 3. |
| `R2_JURISDICTION` | If EU | `eu` when the bucket uses the EU jurisdiction. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET` | For card payments | See [payments](payments.md). Without them card payment is off, and only companies allowed to pay on invoice can order. |
| `ANTHROPIC_API_KEY` | For the assistant | See [assistant](assistant.md). Without it the assistant is hidden. |
| `TWO_FACTOR` | No | `off` switches two-factor sign-in off for everyone, for example while the site is being tried out. Leave it unset (on) for a live site. |
| `TEST_LOGIN_EMAIL`, `TEST_LOGIN_PASSWORD` | No | A test account shown on the sign-in page (as the super admin) while the site is being tried out. |
| `TEST_LOGINS` | No | More test accounts for the sign-in page, one per kind of account, as JSON: `[{"role":"Show admin","email":"olivia@buildexpo.test","password":"…"}]`. Each one signs straight in. |
| `DEMO_DATA` | No | `load` adds the demo data during the build (`npm run demo`): an invented organiser's two shows with a show team, exhibitors, a contractor, suppliers, orders and questions, and gives the `TEST_LOGINS` accounts their passwords. It adds the shows once; later builds only refresh the passwords. |

   The site refuses to start if a required value is missing, and says which one.

   Email and file storage can be added later. Until `RESEND_API_KEY` is set, emails are recorded on each person's record as not sent (with sign-in codes and links taken out), so nobody receives sign-in codes: people who have set a password can still sign in with it. Until all the R2 settings are in, uploads are switched off with a message, and invoices and permission-to-build certificates are not stored. The super admin overview lists what is still to set up. Redeploy after adding them.
4. **Deploy**, then **Settings → Domains**: add your address (for example `blueprint.yourcompany.com`) and create the DNS record Vercel shows. `APP_URL` must match it exactly.
5. Keep **Deployment Protection** on for preview deployments.

## 6. The first super admin

From a computer with the code and Node.js 22 or later:

```bash
npm ci
DATABASE_URL="postgres://…" APP_URL="https://blueprint.yourcompany.com" \
BOOTSTRAP_SUPER_ADMIN_EMAIL="you@yourcompany.com" npm run bootstrap
```

It prints an invitation link that works for 48 hours. Open it, enter the code emailed to you and set up two-factor with an authenticator app. Then invite a second super admin from **Super admin → Users**, so nobody is ever locked out.

## 7. Connect the rest

- **Stripe** webhooks and Connect: [payments](payments.md), "Connecting Stripe".
- **Resend** webhook: [email](email.md), section 3.
- **Platform settings**: email defaults, invoice details (company name, address, VAT number, bank details), reminder steps, data retention, the assistant.
- **Super admin → System** shows whether each service is connected and when each scheduled job last ran.

## 8. Before the first show goes live

- [ ] **Super admin → System** shows every service connected.
- [ ] A test email arrives in Gmail and Outlook, not spam, and its headers show `spf=pass`, `dkim=pass` and `dmarc=pass`.
- [ ] Upload a file from the exhibitor portal and open it again (checks R2 and its CORS rule).
- [ ] On the staging site with Stripe test keys: pay for an order by card, refund part of it, and check the supplier's transfer and the credit note.
- [ ] Finance has agreed the money model in [payments](payments.md): commission, supplier VAT status, the card fee and its VAT treatment, invoice bank details and payment terms.
- [ ] Your privacy notice lists the sub-processors (Vercel, Neon, Cloudflare, Resend, Stripe, and Anthropic if the assistant is on) and the retention periods in Platform settings.
- [ ] Two-factor sign-in is on (`TWO_FACTOR` not set to `off`), the test login settings (`TEST_LOGIN_*`, `TEST_LOGINS`) and `DEMO_DATA` are removed, and the demo shows (BuildExpo, Green Homes Live) are deleted in **Super admin → Shows** and their accounts disabled in **Super admin → Users**.
- [ ] At least two super admins, both with two-factor.

## Running BluePrint

**Updates.** Merging to the main branch builds, migrates and deploys automatically. If something goes wrong, use **Instant Rollback** on the previous deployment in Vercel.

**Scheduled jobs** run from `vercel.json` (sending queued email every 10 minutes, reminders at 07:00 UTC, the nightly tidy-up at 02:30 UTC). Each one can also be run by hand from **Super admin → System**.

**Logs.** Vercel → **Logs** shows every request and error. **Super admin → Audit log** shows who did what, and can be downloaded.

**Backups.** Neon keeps a continuous history, so the database can be restored to any moment in the restore window (Neon console → **Restore**). Take a Neon snapshot before big changes, such as importing a show's exhibitors. Files in R2 are not versioned: a file deleted in BluePrint is gone.

**Rotating secrets.** For any API key or webhook secret: create the new one in the provider, update it in Vercel, redeploy, then delete the old one. `CRON_SECRET` can be changed at any time. For `APP_ENCRYPTION_KEY`, see [security](security.md).

**If something looks wrong** (an unexpected admin, odd downloads, a leaked key): revoke the key at the provider, disable the account or sign the person out everywhere from their page in **Super admin → Users**, check the audit log, and follow your data-breach procedure. Personal data breaches may need reporting to the ICO within 72 hours.

## Working on the code

See the [README](../README.md) for running BluePrint on your own computer and for the tests.
