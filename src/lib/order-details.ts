/**
 * Answers an exhibitor gives when ordering a product. Most are text; a product can also ask for a
 * file (such as print artwork), which is stored as `{ file, name }`.
 */
export type FileAnswer = { file: string; name: string };

export function isFileAnswer(v: unknown): v is FileAnswer {
  return typeof v === 'object' && v !== null && typeof (v as FileAnswer).file === 'string' && typeof (v as FileAnswer).name === 'string';
}

/** One answer as plain text (for downloads and one-line summaries). Files show their name. */
export function answerText(v: unknown): string {
  if (isFileAnswer(v)) return `${v.name} (uploaded file)`;
  if (typeof v === 'string') return v;
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.map(answerText).join(', ');
  return JSON.stringify(v);
}

export type DetailEntry = { label: string; text: string; fileId: string | null };

/** Answers ready to show: label, text, and the file to link to when the answer is a file. */
export function detailEntries(details: Record<string, unknown> | null | undefined): DetailEntry[] {
  return Object.entries(details ?? {})
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([label, v]) => (isFileAnswer(v) ? { label, text: v.name, fileId: v.file } : { label, text: answerText(v), fileId: null }));
}
