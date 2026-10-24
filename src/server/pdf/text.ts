import 'server-only';
import { rgb, type PDFFont } from 'pdf-lib';

export function hexToRgb(hex: string | null | undefined) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex ?? '');
  return m ? rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255) : rgb(0.18, 0.32, 0.69);
}

/** The standard PDF fonts only cover WinAnsi characters; replace anything else so text never fails to draw. */
export function safe(text: string) {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7e\u00a0-\u00ff\u00a3\u20ac]/g, '?');
}

/** Breaks text into lines that fit the width; words longer than a whole line are split. */
export function wrap(text: string, font: PDFFont, size: number, width: number) {
  const lines: string[] = [];
  for (const para of text.split(/\r?\n/).map(safe)) {
    let line = '';
    for (let word of para.split(/\s+/)) {
      while (font.widthOfTextAtSize(word, size) > width && word.length > 1) {
        let cut = word.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(word.slice(0, cut), size) > width) cut -= 1;
        if (line) {
          lines.push(line);
          line = '';
        }
        lines.push(word.slice(0, cut));
        word = word.slice(cut);
      }
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

/** Shortens text to fit the width, adding an ellipsis. */
export function fit(text: string, font: PDFFont, size: number, width: number) {
  let t = safe(text);
  if (font.widthOfTextAtSize(t, size) <= width) return t;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}...`, size) > width) t = t.slice(0, -1);
  return `${t}...`;
}
