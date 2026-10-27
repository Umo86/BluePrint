import { getTableName, sql, type AnyColumn } from 'drizzle-orm';

/**
 * A column written with its table's name, as "companies"."id".
 *
 * Drizzle leaves column names unqualified in a query on a single table. Inside a raw subquery such
 * as `(select count(*) from stands where stands.company_id = ${companies.id})`, a bare "id" means the
 * subquery's own table, so the outer column must be qualified for the subquery to refer to it.
 */
export function qualified(column: AnyColumn) {
  return sql`${sql.identifier(getTableName(column.table))}.${sql.identifier(column.name)}`;
}
