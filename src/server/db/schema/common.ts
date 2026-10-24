import { timestamp, uuid } from 'drizzle-orm/pg-core';

/** Timestamps are always stored with time zone. */
export const tz = { withTimezone: true } as const;

export const id = () => uuid('id').primaryKey().defaultRandom();

export const createdAt = () => timestamp('created_at', tz).notNull().defaultNow();

export const updatedAt = () =>
  timestamp('updated_at', tz)
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/** Commission is either a percentage in basis points (1000 = 10%) or a fixed amount in pence. */
export const COMMISSION_TYPES = ['percent', 'fixed'] as const;
export type CommissionType = (typeof COMMISSION_TYPES)[number];
