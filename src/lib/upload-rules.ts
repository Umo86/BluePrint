/** Upload limits shared by the browser (to warn early) and the server (which enforces them). */

export type UploadPurpose =
  | 'submission'
  | 'space_only'
  | 'manual'
  | 'branding'
  | 'product'
  | 'invoice'
  | 'certificate'
  | 'company_logo'
  | 'ticket';

const MB = 1024 * 1024;
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
export const DOC_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
];
export const DRAWING_TYPES = ['image/vnd.dwg', 'application/x-dwg', 'image/x-dwg'];

/** What each kind of upload may be. SVG and HTML are never accepted (they can carry scripts). */
export const UPLOAD_RULES: Record<UploadPurpose, { maxBytes: number; types: string[]; isPublic: boolean; label: string }> = {
  branding: { maxBytes: 5 * MB, types: IMAGE_TYPES, isPublic: true, label: 'PNG, JPG, WebP or GIF up to 5 MB' },
  company_logo: { maxBytes: 5 * MB, types: IMAGE_TYPES, isPublic: true, label: 'PNG, JPG, WebP or GIF up to 5 MB' },
  product: { maxBytes: 10 * MB, types: IMAGE_TYPES, isPublic: true, label: 'PNG, JPG, WebP or GIF up to 10 MB' },
  manual: { maxBytes: 25 * MB, types: [...DOC_TYPES, ...IMAGE_TYPES], isPublic: false, label: 'PDF, Word, Excel, PowerPoint or an image, up to 25 MB' },
  submission: { maxBytes: 25 * MB, types: [...DOC_TYPES, ...IMAGE_TYPES], isPublic: false, label: 'PDF, Word, Excel, PowerPoint or an image, up to 25 MB' },
  space_only: { maxBytes: 100 * MB, types: [...DOC_TYPES, ...IMAGE_TYPES, ...DRAWING_TYPES], isPublic: false, label: 'PDF, DWG, Word, Excel or an image, up to 100 MB' },
  ticket: { maxBytes: 10 * MB, types: ['application/pdf', ...IMAGE_TYPES], isPublic: false, label: 'PDF or an image, up to 10 MB' },
  // Made by BluePrint itself, never uploaded through the browser.
  invoice: { maxBytes: 10 * MB, types: ['application/pdf'], isPublic: false, label: 'PDF' },
  certificate: { maxBytes: 10 * MB, types: ['application/pdf'], isPublic: false, label: 'PDF' },
};

export function formatBytes(n: number) {
  if (n < 1024) return `${n} bytes`;
  if (n < MB) return `${Math.round(n / 1024)} KB`;
  return `${(n / MB).toFixed(n < 10 * MB ? 1 : 0)} MB`;
}
