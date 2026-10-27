import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { COMMISSION_TYPES, createdAt, id, tz, updatedAt } from './common';
import { companies, users } from './core';
import { editions, stands } from './events';

export const suppliers = pgTable(
  'suppliers',
  {
    id: id(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    phone: text('phone'),
    website: text('website'),
    /** Stripe connected account id (acct_...). Never keys or bank details. */
    stripeAccountId: text('stripe_account_id'),
    stripeChargesEnabled: boolean('stripe_charges_enabled').notNull().default(false),
    stripePayoutsEnabled: boolean('stripe_payouts_enabled').notNull().default(false),
    stripeDetailsSubmitted: boolean('stripe_details_submitted').notNull().default(false),
    commissionType: text('commission_type', { enum: COMMISSION_TYPES }),
    commissionValue: integer('commission_value'),
    /** VAT-registered suppliers are paid VAT on their share; others are paid their share only. */
    vatRegistered: boolean('vat_registered').notNull().default(true),
    status: text('status', { enum: ['active', 'disabled'] }).notNull().default('active'),
    /** An invented supplier from the demo data, removed with it. Its payouts are always practice ones. */
    isDemo: boolean('is_demo').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('suppliers_stripe_unique').on(t.stripeAccountId)],
);

export const supplierUsers = pgTable(
  'supplier_users',
  {
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.supplierId, t.userId] }), index('supplier_users_user_idx').on(t.userId)],
);

export const serviceCategories = pgTable(
  'service_categories',
  {
    id: id(),
    editionId: uuid('edition_id')
      .notNull()
      .references(() => editions.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    /** Null means the organiser fulfils the category itself. */
    supplierId: uuid('supplier_id').references(() => suppliers.id, { onDelete: 'set null' }),
    commissionType: text('commission_type', { enum: COMMISSION_TYPES }),
    commissionValue: integer('commission_value'),
    /** Days before build-up by which orders should be placed. */
    orderByOffsetDays: integer('order_by_offset_days'),
    visibleToTypes: jsonb('visible_to_types').$type<string[]>().notNull().default([]),
    sort: integer('sort').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('service_categories_edition_idx').on(t.editionId)],
);

export type ProductOption = { name: string; values: string[] };
export type ProductDetailField = { id: string; label: string; type: 'text' | 'textarea' | 'file'; required?: boolean };

export const PRODUCT_STATUSES = ['draft', 'pending_approval', 'approved', 'rejected', 'archived'] as const;

export const products = pgTable(
  'products',
  {
    id: id(),
    editionId: uuid('edition_id')
      .notNull()
      .references(() => editions.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => serviceCategories.id, { onDelete: 'cascade' }),
    supplierId: uuid('supplier_id').references(() => suppliers.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    /** The supplier's own product code (SKU), if they use one. */
    code: text('code'),
    description: text('description'),
    imageFileId: uuid('image_file_id'),
    unit: text('unit').notNull().default('each'),
    /** Prices are net of VAT, in pence. */
    pricePence: integer('price_pence').notNull(),
    earlyPricePence: integer('early_price_pence'),
    earlyUntilOffsetDays: integer('early_until_offset_days'),
    latePricePence: integer('late_price_pence'),
    lateFromOffsetDays: integer('late_from_offset_days'),
    vatRateBps: integer('vat_rate_bps').notNull().default(2000),
    options: jsonb('options').$type<ProductOption[]>().notNull().default([]),
    requiredDetails: jsonb('required_details').$type<ProductDetailField[]>().notNull().default([]),
    stockLimit: integer('stock_limit'),
    visibleToTypes: jsonb('visible_to_types').$type<string[]>().notNull().default([]),
    status: text('status', { enum: PRODUCT_STATUSES }).notNull().default('draft'),
    rejectionReason: text('rejection_reason'),
    commissionType: text('commission_type', { enum: COMMISSION_TYPES }),
    commissionValue: integer('commission_value'),
    sort: integer('sort').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('products_edition_idx').on(t.editionId), index('products_category_idx').on(t.categoryId)],
);

export const cartItems = pgTable(
  'cart_items',
  {
    id: id(),
    standId: uuid('stand_id')
      .notNull()
      .references(() => stands.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    quantity: integer('quantity').notNull(),
    options: jsonb('options').$type<Record<string, string>>().notNull().default({}),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
    addedBy: uuid('added_by'),
    createdAt: createdAt(),
  },
  (t) => [index('cart_items_stand_idx').on(t.standId)],
);

export const ORDER_STATUSES = [
  'pending_payment',
  'paid',
  'invoiced',
  'cancelled',
  'refunded',
  'partially_refunded',
  'payment_failed',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const FEE_MODES = ['exhibitor_pays', 'deduct_from_supplier'] as const;
export type FeeMode = (typeof FEE_MODES)[number];

export const orders = pgTable(
  'orders',
  {
    id: id(),
    number: text('number').notNull(),
    editionId: uuid('edition_id')
      .notNull()
      .references(() => editions.id, { onDelete: 'restrict' }),
    standId: uuid('stand_id')
      .notNull()
      .references(() => stands.id, { onDelete: 'restrict' }),
    companyId: uuid('company_id').references(() => companies.id, { onDelete: 'set null' }),
    placedBy: uuid('placed_by'),
    status: text('status', { enum: ORDER_STATUSES }).notNull().default('pending_payment'),
    paymentMethod: text('payment_method', { enum: ['card', 'invoice'] }).notNull(),
    feeMode: text('fee_mode', { enum: FEE_MODES }).notNull(),
    currency: text('currency').notNull().default('GBP'),
    /** All amounts in pence. */
    netPence: integer('net_pence').notNull(),
    vatPence: integer('vat_pence').notNull(),
    commissionPence: integer('commission_pence').notNull(),
    cardFeePence: integer('card_fee_pence').notNull().default(0),
    totalPence: integer('total_pence').notNull(),
    refundedPence: integer('refunded_pence').notNull().default(0),
    poNumber: text('po_number'),
    /** Invoice orders: when payment is due. */
    dueAt: timestamp('due_at', tz),
    /** Invoice orders: the bank reference finance recorded when marking it paid. */
    paymentReference: text('payment_reference'),
    stripeCheckoutSessionId: text('stripe_checkout_session_id'),
    stripePaymentIntentId: text('stripe_payment_intent_id'),
    stripeChargeId: text('stripe_charge_id'),
    paidAt: timestamp('paid_at', tz),
    cancelledAt: timestamp('cancelled_at', tz),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('orders_number_unique').on(t.number),
    index('orders_edition_idx').on(t.editionId),
    index('orders_stand_idx').on(t.standId),
    uniqueIndex('orders_checkout_unique').on(t.stripeCheckoutSessionId),
  ],
);

export const FULFILMENT_STATUSES = ['received', 'confirmed', 'delivered', 'cancelled'] as const;

export const orderLines = pgTable(
  'order_lines',
  {
    id: id(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    productId: uuid('product_id').references(() => products.id, { onDelete: 'set null' }),
    supplierId: uuid('supplier_id').references(() => suppliers.id, { onDelete: 'set null' }),
    categoryId: uuid('category_id'),
    description: text('description').notNull(),
    /** The product code when the order was placed. */
    productCode: text('product_code'),
    quantity: integer('quantity').notNull(),
    unitPricePence: integer('unit_price_pence').notNull(),
    vatRateBps: integer('vat_rate_bps').notNull(),
    netPence: integer('net_pence').notNull(),
    vatPence: integer('vat_pence').notNull(),
    commissionPence: integer('commission_pence').notNull(),
    cardFeeSharePence: integer('card_fee_share_pence').notNull().default(0),
    supplierPayoutPence: integer('supplier_payout_pence').notNull(),
    options: jsonb('options').$type<Record<string, string>>().notNull().default({}),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
    fulfilmentStatus: text('fulfilment_status', { enum: FULFILMENT_STATUSES }).notNull().default('received'),
    refundedPence: integer('refunded_pence').notNull().default(0),
    /** The basket item this line came from, so only those items are cleared once paid. */
    cartItemId: uuid('cart_item_id'),
  },
  (t) => [index('order_lines_order_idx').on(t.orderId), index('order_lines_supplier_idx').on(t.supplierId)],
);

export const supplierTransfers = pgTable(
  'supplier_transfers',
  {
    id: id(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'restrict' }),
    amountPence: integer('amount_pence').notNull(),
    reversedPence: integer('reversed_pence').notNull().default(0),
    stripeTransferId: text('stripe_transfer_id'),
    status: text('status', { enum: ['pending', 'created', 'failed', 'reversed', 'partially_reversed', 'manual'] })
      .notNull()
      .default('pending'),
    error: text('error'),
    /** Manual payouts (invoice orders): when finance paid the supplier, and their reference. */
    settledAt: timestamp('settled_at', tz),
    reference: text('reference'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('supplier_transfers_unique').on(t.orderId, t.supplierId), index('supplier_transfers_supplier_idx').on(t.supplierId)],
);

export const refunds = pgTable(
  'refunds',
  {
    id: id(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    orderLineId: uuid('order_line_id'),
    amountPence: integer('amount_pence').notNull(),
    /** How the refund splits across order lines (line id to pence), and any card fee returned. */
    lineAmounts: jsonb('line_amounts').$type<Record<string, number>>().notNull().default({}),
    cardFeePence: integer('card_fee_pence').notNull().default(0),
    error: text('error'),
    /** When the refund was applied to the order, its lines and the supplier payouts (exactly once). */
    appliedAt: timestamp('applied_at', tz),
    reason: text('reason'),
    stripeRefundId: text('stripe_refund_id'),
    status: text('status', { enum: ['pending', 'succeeded', 'failed', 'manual'] }).notNull().default('pending'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
  },
  (t) => [index('refunds_order_idx').on(t.orderId)],
);

export const invoices = pgTable(
  'invoices',
  {
    id: id(),
    number: text('number').notNull(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['invoice', 'receipt', 'credit_note'] }).notNull(),
    /** Credit notes: the refund they record (one credit note per refund). */
    refundId: uuid('refund_id'),
    totalPence: integer('total_pence').notNull(),
    fileId: uuid('file_id'),
    issuedAt: timestamp('issued_at', tz).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('invoices_number_unique').on(t.number), index('invoices_order_idx').on(t.orderId), uniqueIndex('invoices_refund_unique').on(t.refundId)],
);

/** Stripe webhook events already processed, so a retried event is never applied twice. */
export const stripeEvents = pgTable('stripe_events', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  receivedAt: timestamp('received_at', tz).notNull().defaultNow(),
  processedAt: timestamp('processed_at', tz),
  error: text('error'),
});
