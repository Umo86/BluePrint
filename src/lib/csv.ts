/**
 * Builds CSV text. Cells that a spreadsheet would treat as a formula (starting with =, +, -, @,
 * tab or carriage return) are prefixed with an apostrophe so downloaded files cannot run formulas.
 */
export function toCsv(rows: (string | number | boolean | null | undefined | Date)[][]): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function csvCell(value: string | number | boolean | null | undefined | Date): string {
  if (value === null || value === undefined) return '';
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}
