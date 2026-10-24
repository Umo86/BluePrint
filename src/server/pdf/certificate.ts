import 'server-only';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

export type CertificateInput = {
  reference: string;
  showName: string;
  editionName: string;
  venue: string | null;
  standNumber: string;
  hall: string | null;
  exhibitor: string;
  contractor: string | null;
  version: number;
  approvedAt: Date;
  approvedBy: string;
  conditions: string | null;
  buildUp: Date | null;
  breakdownEnds: Date | null;
  brandColor?: string | null;
};

function hexToRgb(hex: string | null | undefined) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex ?? '');
  return m ? rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255) : rgb(0.18, 0.32, 0.69);
}

// The standard PDF fonts only cover WinAnsi characters; replace anything else so text never fails to draw.
function safe(text: string) {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7e -ÿ£€]/g, '?');
}

function wrap(text: string, font: PDFFont, size: number, width: number) {
  const lines: string[] = [];
  for (const para of safe(text).split(/\r?\n/)) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > width && line) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    lines.push(line);
  }
  return lines;
}

const fmt = (d: Date | null) =>
  d ? d.toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }) : 'To be confirmed';

/** The permission-to-build certificate for an approved space-only stand. */
export async function renderCertificate(input: CertificateInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Permission to build - stand ${safe(input.standNumber)}`);
  pdf.setAuthor('BluePrint');
  pdf.setCreator('BluePrint');
  const page: PDFPage = pdf.addPage([595.28, 841.89]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const brand = hexToRgb(input.brandColor);
  const { width, height } = page.getSize();
  const margin = 56;
  let y = height - margin;

  page.drawRectangle({ x: 0, y: height - 110, width, height: 110, color: brand });
  page.drawText('PERMISSION TO BUILD', { x: margin, y: height - 60, size: 22, font: bold, color: rgb(1, 1, 1) });
  page.drawText(safe(`${input.editionName}${input.venue ? ` - ${input.venue}` : ''}`), { x: margin, y: height - 86, size: 12, font: regular, color: rgb(1, 1, 1) });
  y = height - 150;

  const row = (label: string, value: string) => {
    page.drawText(safe(label), { x: margin, y, size: 10, font: bold, color: rgb(0.35, 0.35, 0.4) });
    const lines = wrap(value, regular, 12, width - margin * 2 - 150);
    lines.forEach((l, i) => page.drawText(l, { x: margin + 150, y: y - i * 16, size: 12, font: regular, color: rgb(0.1, 0.1, 0.15) }));
    y -= Math.max(1, lines.length) * 16 + 10;
  };
  row('Stand', `${input.standNumber}${input.hall ? `, hall ${input.hall}` : ''}`);
  row('Exhibitor', input.exhibitor);
  row('Stand contractor', input.contractor ?? 'Built by the exhibitor');
  row('Approved pack', `Version ${input.version}`);
  row('Approved on', fmt(input.approvedAt));
  row('Approved by', `${input.approvedBy} for ${input.showName}`);
  row('Build-up starts', fmt(input.buildUp));
  row('Breakdown ends', fmt(input.breakdownEnds));
  row('Reference', input.reference);

  y -= 10;
  page.drawText('Conditions', { x: margin, y, size: 13, font: bold, color: brand });
  y -= 20;
  const conditions = input.conditions?.trim() || 'No extra conditions. Build exactly as shown in the approved pack.';
  for (const line of wrap(conditions, regular, 11, width - margin * 2)) {
    page.drawText(line, { x: margin, y, size: 11, font: regular, color: rgb(0.1, 0.1, 0.15) });
    y -= 15;
  }

  y -= 20;
  const terms = [
    'This permission covers the stand exactly as shown in the approved pack. Any change to the design, height or structure must be approved again before build-up.',
    'Keep this certificate on the stand during build-up, the show and breakdown. Venue and organiser staff may ask to see it.',
    'The stand contractor remains responsible for safe working under the Construction (Design and Management) Regulations 2015.',
  ];
  for (const t of terms) {
    for (const line of wrap(t, regular, 9, width - margin * 2)) {
      page.drawText(line, { x: margin, y, size: 9, font: regular, color: rgb(0.35, 0.35, 0.4) });
      y -= 12;
    }
    y -= 6;
  }
  page.drawText(safe(`Issued by BluePrint for ${input.showName}. Reference ${input.reference}.`), { x: margin, y: 40, size: 8, font: regular, color: rgb(0.5, 0.5, 0.55) });
  return pdf.save();
}
