/**
 * Task forms: the field definitions the show team builds, and the checks applied to exhibitors'
 * answers. Used by the browser (instant feedback) and the server (which always re-checks).
 */
import { z } from 'zod';
import type { FormField, FormFieldType } from '@/server/db/schema';

export type { FormField, FormFieldType };

export const FIELD_TYPES: { value: FormFieldType; label: string; help: string }[] = [
  { value: 'heading', label: 'Heading', help: 'A title or instructions between questions.' },
  { value: 'text', label: 'Short answer', help: 'One line of text.' },
  { value: 'textarea', label: 'Long answer', help: 'Several lines of text.' },
  { value: 'number', label: 'Number', help: 'A number, with optional limits.' },
  { value: 'email', label: 'Email address', help: 'Checked to be a valid address.' },
  { value: 'phone', label: 'Phone number', help: 'A phone number.' },
  { value: 'select', label: 'Choose one', help: 'Pick one option from a list.' },
  { value: 'multiselect', label: 'Choose several', help: 'Pick any number of options.' },
  { value: 'date', label: 'Date', help: 'A calendar date.' },
  { value: 'checkbox', label: 'Tick box', help: 'Yes or no.' },
  { value: 'file', label: 'File upload', help: 'PDF, Office documents or images.' },
  { value: 'declaration', label: 'Declaration', help: 'A statement they confirm and sign with their name.' },
  { value: 'repeater', label: 'Repeating rows', help: 'For example one row per vehicle or per staff member.' },
];

const NESTED_TYPES: FormFieldType[] = ['text', 'textarea', 'number', 'email', 'phone', 'select', 'date', 'checkbox'];
const ID = /^[a-z0-9_]{1,40}$/;

const baseField = z.object({
  id: z.string().regex(ID),
  type: z.enum(['heading', 'text', 'textarea', 'number', 'email', 'phone', 'select', 'multiselect', 'date', 'checkbox', 'file', 'declaration', 'repeater']),
  label: z.string().trim().min(1, 'Every question needs a label.').max(300),
  help: z.string().trim().max(1000).optional(),
  required: z.boolean().optional(),
  options: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
  maxLength: z.number().int().min(1).max(20_000).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  statement: z.string().trim().max(5000).optional(),
  maxRows: z.number().int().min(1).max(200).optional(),
  showIf: z.object({ fieldId: z.string().regex(ID), equals: z.union([z.string().max(200), z.boolean()]) }).optional(),
});

export const formFieldSchema: z.ZodType<FormField> = baseField.extend({
  fields: z.array(baseField.extend({ type: z.enum(NESTED_TYPES as [FormFieldType, ...FormFieldType[]]) })).max(20).optional(),
}) as unknown as z.ZodType<FormField>;

/** Checks a whole form definition: unique ids, options where needed, conditions that point at real questions. */
export const formSchemaSchema = z
  .array(formFieldSchema)
  .max(100)
  .superRefine((fields, ctx) => {
    const ids = new Set<string>();
    fields.forEach((f, i) => {
      if (ids.has(f.id)) ctx.addIssue({ code: 'custom', path: [i, 'id'], message: 'Two questions share the same id.' });
      ids.add(f.id);
      if ((f.type === 'select' || f.type === 'multiselect') && !(f.options && f.options.length)) {
        ctx.addIssue({ code: 'custom', path: [i, 'options'], message: `“${f.label}” needs at least one option.` });
      }
      if (f.type === 'repeater' && !(f.fields && f.fields.length)) {
        ctx.addIssue({ code: 'custom', path: [i, 'fields'], message: `“${f.label}” needs at least one column.` });
      }
      if (f.showIf && !fields.slice(0, i).some((x) => x.id === f.showIf!.fieldId)) {
        ctx.addIssue({ code: 'custom', path: [i, 'showIf'], message: `“${f.label}” can only depend on a question above it.` });
      }
      for (const sub of f.fields ?? []) {
        if (sub.type === 'select' && !(sub.options && sub.options.length)) {
          ctx.addIssue({ code: 'custom', path: [i, 'fields'], message: `Column “${sub.label}” needs at least one option.` });
        }
      }
    });
  });

export function newFieldId(existing: string[]): string {
  for (;;) {
    const id = `f_${Math.random().toString(36).slice(2, 8)}`;
    if (!existing.includes(id)) return id;
  }
}

/** Whether a question is shown, given the answers so far (questions with a condition are hidden until it is met). */
export function isVisible(field: FormField, data: Record<string, unknown>): boolean {
  if (!field.showIf) return true;
  const v = data[field.showIf.fieldId];
  if (typeof field.showIf.equals === 'boolean') return Boolean(v) === field.showIf.equals;
  return Array.isArray(v) ? v.includes(field.showIf.equals) : v === field.showIf.equals;
}

export type Declaration = { agreed: boolean; name: string; signedAt?: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const REQUIRED_MESSAGE: Partial<Record<FormFieldType, string>> = {
  declaration: 'Tick the declaration and type your full name.',
  file: 'Upload a file.',
  select: 'Choose an option.',
  multiselect: 'Choose at least one option.',
  repeater: 'Add at least one row.',
  checkbox: 'This must be ticked.',
};

function checkValue(field: FormField, raw: unknown, submit: boolean): { value?: unknown; error?: string } {
  const empty = raw === undefined || raw === null || raw === '' || (Array.isArray(raw) && raw.length === 0);
  if (empty) return submit && field.required ? { error: REQUIRED_MESSAGE[field.type] ?? 'This is required.' } : {};
  switch (field.type) {
    case 'text':
    case 'textarea':
    case 'phone': {
      if (typeof raw !== 'string') return { error: 'Enter text.' };
      const limit = field.maxLength ?? (field.type === 'textarea' ? 10_000 : field.type === 'phone' ? 40 : 2_000);
      const v = raw.trim();
      if (v.length > limit) return { error: `Keep this under ${limit} characters.` };
      if (field.type === 'phone' && !/^[0-9+()\-.\s]{5,40}$/.test(v)) return { error: 'Enter a phone number.' };
      return { value: v };
    }
    case 'email': {
      const v = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
      if (!EMAIL.test(v) || v.length > 254) return { error: 'Enter a valid email address.' };
      return { value: v };
    }
    case 'number': {
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
      if (!Number.isFinite(n)) return { error: 'Enter a number.' };
      if (field.min !== undefined && n < field.min) return { error: `The lowest allowed is ${field.min}.` };
      if (field.max !== undefined && n > field.max) return { error: `The highest allowed is ${field.max}.` };
      return { value: n };
    }
    case 'select':
      return typeof raw === 'string' && (field.options ?? []).includes(raw) ? { value: raw } : { error: 'Choose one of the options.' };
    case 'multiselect': {
      if (!Array.isArray(raw)) return { error: 'Choose from the options.' };
      const opts = field.options ?? [];
      const v = [...new Set(raw.filter((x): x is string => typeof x === 'string' && opts.includes(x)))];
      if (v.length !== raw.length) return { error: 'Choose from the options.' };
      return { value: v };
    }
    case 'date':
      return typeof raw === 'string' && DATE.test(raw) && !Number.isNaN(Date.parse(raw)) ? { value: raw } : { error: 'Enter a date.' };
    case 'checkbox':
      if (typeof raw !== 'boolean') return { error: 'Tick or untick the box.' };
      if (submit && field.required && !raw) return { error: 'This must be ticked.' };
      return { value: raw };
    case 'file': {
      if (!Array.isArray(raw) || raw.some((x) => typeof x !== 'string' || !/^[0-9a-f-]{36}$/i.test(x))) return { error: 'Upload the file again.' };
      if (raw.length > 20) return { error: 'Upload up to 20 files.' };
      return { value: [...new Set(raw as string[])] };
    }
    case 'declaration': {
      const d = raw as Partial<Declaration>;
      if (typeof d !== 'object' || d === null) return { error: 'Confirm the declaration.' };
      const name = typeof d.name === 'string' ? d.name.trim().slice(0, 120) : '';
      const agreed = d.agreed === true;
      if (submit && field.required && (!agreed || !name)) return { error: 'Tick the declaration and type your full name.' };
      if (agreed && !name && submit) return { error: 'Type your full name to sign.' };
      return { value: { agreed, name, signedAt: typeof d.signedAt === 'string' ? d.signedAt : undefined } };
    }
    case 'repeater': {
      if (!Array.isArray(raw)) return { error: 'Add the rows again.' };
      const max = field.maxRows ?? 50;
      if (raw.length > max) return { error: `Add up to ${max} rows.` };
      const rows: Record<string, unknown>[] = [];
      for (const [i, row] of raw.entries()) {
        if (typeof row !== 'object' || row === null) return { error: `Row ${i + 1} is not valid.` };
        const clean: Record<string, unknown> = {};
        for (const sub of field.fields ?? []) {
          const r = checkValue(sub, (row as Record<string, unknown>)[sub.id], submit);
          if (r.error) return { error: `Row ${i + 1}, ${sub.label}: ${r.error}` };
          if (r.value !== undefined) clean[sub.id] = r.value;
        }
        rows.push(clean);
      }
      return { value: rows };
    }
    default:
      return {};
  }
}

/**
 * Checks answers against a form. Drafts are checked for shape only; submitting also checks
 * required questions. Answers to unknown or hidden questions are dropped.
 */
export function validateAnswers(fields: FormField[], data: Record<string, unknown>, opts: { submit: boolean }) {
  const clean: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  const fileIds: string[] = [];
  for (const field of fields) {
    if (field.type === 'heading') continue;
    if (!isVisible(field, { ...data, ...clean })) continue;
    const r = checkValue(field, data[field.id], opts.submit);
    if (r.error) errors[field.id] = r.error;
    else if (r.value !== undefined) {
      clean[field.id] = r.value;
      if (field.type === 'file') fileIds.push(...(r.value as string[]));
    }
  }
  return { clean, errors, fileIds, ok: Object.keys(errors).length === 0 };
}

/** A readable version of an answer, for exports and review screens. */
export function answerToText(field: FormField, value: unknown, fileNames: Record<string, string> = {}): string {
  if (value === undefined || value === null || value === '') return '';
  switch (field.type) {
    case 'checkbox':
      return value ? 'Yes' : 'No';
    case 'multiselect':
      return Array.isArray(value) ? value.join(', ') : '';
    case 'file':
      return Array.isArray(value) ? value.map((id) => fileNames[id] ?? 'file').join(', ') : '';
    case 'declaration': {
      const d = value as Declaration;
      return d.agreed ? `Signed by ${d.name}${d.signedAt ? ` on ${d.signedAt.slice(0, 10)}` : ''}` : 'Not signed';
    }
    case 'repeater':
      return Array.isArray(value)
        ? value.map((row, i) => `${i + 1}. ${(field.fields ?? []).map((f) => `${f.label}: ${answerToText(f, (row as Record<string, unknown>)[f.id])}`).join('; ')}`).join(' | ')
        : '';
    default:
      return String(value);
  }
}
