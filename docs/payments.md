# Shop, payments and payouts

How money moves through BluePrint's services shop, and how to connect Stripe. **Agree the money model with finance (and your accountant) before taking live payments.**

## The money model

- **Media10 is the seller of record.** The exhibitor pays Media10 and gets one VAT invoice from Media10 for the whole order, whichever suppliers fulfil it. Numbers are gap-free sequences: orders `ORD-000001`, invoices `INV-000001`, credit notes `CRN-000001`.
- **Suppliers are paid their share.** For each order line: the net price, minus Media10's commission, plus VAT on that share when the supplier is VAT registered (their own supply to Media10). Suppliers who are not VAT registered (switch in Super admin → Suppliers) are paid their share only.
- **Commission** is the first of these that is set: product, category, supplier, edition, platform default. Percentages are in basis points (1000 = 10%); a fixed amount is per order line. Only show admins and super admins can change commission.
- **Lines Media10 provides itself** (categories with no supplier, such as stand cleaning) are 100% Media10's.
- **Card fee** (Platform settings, overridable per edition):
  - *Exhibitor pays it on top*: a "Card processing fee" line is added so that, after Stripe's percentage and fixed fee, Media10 still receives the order total. Shown as a separate line with no VAT. **Check the VAT treatment with your accountant.** UK law bans surcharges on consumer cards; exhibitors are businesses, but confirm before switching this on.
  - *Taken from the supplier's share*: no extra charge; Stripe's fee is split across the order's lines in proportion to their value and each supplier receives that much less.
- **Prices** are entered before VAT. Products can have an early-bird price (until N days before build-up) and a late price (from N days before build-up). The price on the order is the one that applied when it was placed; later product edits never change placed orders.

All money is held in whole pence and VAT is rounded once per line (half away from zero), so the basket, Stripe, the invoice and the reports always agree.

## Paying

- **Card**: the exhibitor is sent to Stripe Checkout (Stripe's own page; BluePrint never sees card details). Checkouts expire after an hour; unpaid orders are released so their stock is free again. Starting a new checkout first closes any earlier open one, so an order cannot be paid twice.
- **Invoice**: only for companies marked "can pay on invoice" (exhibitor record). The order is confirmed immediately, a VAT invoice with your bank details and due date (Platform settings → Invoices) is issued, and finance marks it paid with the bank reference.
- Orders with a total of £0 are confirmed without payment.

Stock limits are checked with the products locked, so two exhibitors cannot buy the last item at the same time.

## Supplier payouts (Stripe Connect)

Separate charges and transfers: Media10 takes the payment into its own Stripe account, then transfers each supplier's share to the supplier's Stripe Express account, tied to the original charge (`source_transaction`), so a transfer never pays out money that has not arrived.

- Suppliers connect from **Supplier portal → Payouts → Set up payouts with Stripe**. Stripe collects their identity and bank details; BluePrint stores only the account id (`acct_…`) and whether payouts are switched on.
- Until a supplier finishes set-up, their payouts wait. They are sent automatically when Stripe reports the account ready (webhook), when the supplier presses "Check status", or when someone retries from the order page or **Super admin → Payments**.
- **Invoice orders** are paid out by finance by bank transfer once the exhibitor has paid. Each is listed as "To pay by hand"; record the payment reference on the order.

## Refunds and cancellations

- **Refund** (order page, needs "manage orders"): choose an amount per line and, optionally, the card fee. Card orders are refunded to the card through Stripe; each supplier's transfer is reversed in proportion to what was refunded on their lines. A credit note is issued and the exhibitor is emailed. Stripe does not return its own fee on refunds.
- **Invoice orders** get a credit note; finance settles it. Cancelling an unpaid invoice order credits it in full.
- Two refunds started at the same moment cannot refund the same money twice.

## Connecting Stripe

1. In the Stripe dashboard, turn on **Connect** (Express accounts, United Kingdom).
2. Set in the hosting environment:
   - `STRIPE_SECRET_KEY`: a secret key (`sk_live_…`), or better a restricted key with write access to Checkout Sessions, Payment Intents (read), Refunds, Transfers, Transfer Reversals, Accounts, Account Links and Login Links.
   - `STRIPE_WEBHOOK_SECRET`: the signing secret of the webhook below.
3. Add a webhook endpoint `https://<your domain>/api/stripe/webhook` for these events:
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `refund.updated`, `refund.failed`.
4. Add a second endpoint (same URL) under **Connect → Events on connected accounts** for `account.updated`, and put its signing secret in `STRIPE_CONNECT_WEBHOOK_SECRET`.
5. Check **Super admin → Payments**: it shows whether Stripe is live or in test mode, when the last webhook arrived, and any payouts needing attention.

Use test keys (`sk_test_…`) on a staging site first; the Payments page shows "test mode" while they are in use.

Every webhook is checked against its Stripe signature (and refused if more than five minutes old) and applied once only. Production refuses to start with a Stripe key but no webhook secret.

## Trying it locally

With no Stripe key on a developer machine, a **payment simulator** stands in for Stripe: "Pay" goes to a local test page instead of Stripe, and supplier set-up to a local test page. No money moves. The simulator never runs on a live web address, even if mis-configured.
