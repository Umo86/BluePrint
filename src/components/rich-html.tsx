import { Typography } from '@mantine/core';
import { sanitizeRichText } from '@/server/security/sanitize';

/**
 * Shows page or task text written in the editor. It was cleaned when saved and is cleaned again
 * here, so nothing that slipped into the database can run as script.
 */
export function RichHtml({ html }: { html: string }) {
  const clean = sanitizeRichText(html ?? '');
  if (!clean) return null;
  return (
    <Typography>
      <div dangerouslySetInnerHTML={{ __html: clean }} />
    </Typography>
  );
}
