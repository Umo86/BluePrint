import 'server-only';
import type { CellValue } from 'exceljs';
import { toLocalDateTimeString } from '@/lib/dates';

/**
 * Builds Excel files for reports. Every cell is written as a plain value (text, number or date), never as
 * a formula, so nothing an exhibitor typed can run when the file is opened. Dates are shown in UK time.
 */

export type ColumnType = 'text' | 'number' | 'date' | 'datetime' | 'money' | 'percent';
export type Column = { header: string; key: string; type?: ColumnType; width?: number };
export type SheetSpec = { name: string; columns: Column[]; rows: Record<string, unknown>[] };

const MAX_CELL = 32_000;
// Characters XML (and so Excel) cannot store.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

export function cleanText(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v).replace(CONTROL, '');
  return s.length > MAX_CELL ? `${s.slice(0, MAX_CELL)}…` : s;
}

/** A date shifted so Excel, which has no time zones, shows the UK wall-clock time. */
function ukWallClock(d: Date): Date | null {
  const local = toLocalDateTimeString(d);
  if (!local) return null;
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])));
}

function cellValue(v: unknown, type: ColumnType): CellValue {
  if (v === null || v === undefined || v === '') return null;
  switch (type) {
    case 'number':
    case 'percent': {
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isFinite(n) ? n : cleanText(v);
    }
    case 'money': {
      // Amounts are kept in pence.
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isFinite(n) ? n / 100 : cleanText(v);
    }
    case 'date':
    case 'datetime': {
      const d = v instanceof Date ? v : new Date(String(v));
      if (Number.isNaN(d.getTime())) return cleanText(v);
      return ukWallClock(d);
    }
    default:
      return cleanText(v);
  }
}

const FORMATS: Partial<Record<ColumnType, string>> = {
  money: '£#,##0.00',
  date: 'dd/mm/yyyy',
  datetime: 'dd/mm/yyyy hh:mm',
  percent: '0%',
  number: '#,##0.##',
};

function defaultWidth(c: Column) {
  if (c.width) return c.width;
  if (c.type === 'datetime') return 18;
  if (c.type === 'date') return 12;
  if (c.type === 'money' || c.type === 'number' || c.type === 'percent') return Math.max(12, Math.min(c.header.length + 2, 24));
  return Math.max(14, Math.min(c.header.length + 4, 40));
}

/** Sheet names: at most 31 characters, none of []:*?/\ and unique within the file. */
export function sheetName(raw: string, taken: Set<string>) {
  const base = (cleanText(raw).replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim() || 'Sheet').slice(0, 31);
  let name = base;
  for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${base.slice(0, 31 - String(i).length - 1)} ${i}`;
  taken.add(name.toLowerCase());
  return name;
}

export async function buildWorkbook(sheets: SheetSpec[], about: { title: string; show: string; generatedFor: string; filters?: string[] }) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'BluePrint';
  wb.created = new Date();
  wb.title = cleanText(about.title);
  const taken = new Set<string>();
  for (const s of sheets) {
    const ws = wb.addWorksheet(sheetName(s.name, taken), { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = s.columns.map((c) => ({ header: cleanText(c.header), key: c.key, width: defaultWidth(c) }));
    for (const r of s.rows) {
      const values: Record<string, CellValue> = {};
      for (const c of s.columns) values[c.key] = cellValue(r[c.key], c.type ?? 'text');
      ws.addRow(values);
    }
    s.columns.forEach((c, i) => {
      const fmt = FORMATS[c.type ?? 'text'];
      if (fmt) ws.getColumn(i + 1).numFmt = fmt;
      if (!c.type || c.type === 'text') ws.getColumn(i + 1).alignment = { vertical: 'top', wrapText: false };
    });
    const header = ws.getRow(1);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A93' } };
    header.alignment = { vertical: 'middle' };
    header.height = 20;
    if (s.columns.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: s.columns.length } };
  }
  const info = wb.addWorksheet(sheetName('About this file', taken));
  info.columns = [{ width: 22 }, { width: 80 }];
  const lines: [string, string][] = [
    ['Report', about.title],
    ['Show', about.show],
    ['Downloaded', toLocalDateTimeString(new Date())?.slice(0, 16) ?? ''],
    ['Downloaded by', about.generatedFor],
    ...(about.filters?.length ? ([['Filters', about.filters.join('; ')]] as [string, string][]) : []),
    ['Confidential', 'Contains personal and business information about exhibitors. Keep it within your organisation and delete it when you no longer need it.'],
  ];
  for (const [k, v] of lines) info.addRow([cleanText(k), cleanText(v)]).getCell(1).font = { bold: true };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
