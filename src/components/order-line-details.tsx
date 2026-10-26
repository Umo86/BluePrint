import { Anchor, Text } from '@mantine/core';
import { detailEntries } from '@/lib/order-details';

/**
 * The answers on an order line or basket item, one per line. Files (such as artwork) link to a
 * download; the server checks who may open them.
 */
export function OrderLineDetails({ details }: { details: Record<string, unknown> | null | undefined }) {
  const entries = detailEntries(details);
  if (!entries.length) return null;
  return (
    <Text component="div" fz="xs" c="dimmed">
      {entries.map((e) => {
        // Questions already end in "?" or ":", so they do not need another colon.
        const label = `${e.label}${/[?:.!]$/.test(e.label.trim()) ? ' ' : ': '}`;
        return (
          <div key={e.label} style={{ whiteSpace: 'pre-wrap' }}>
            {label}
            {e.fileId ? (
              <Anchor href={`/files/${e.fileId}?download=1`} fz="xs">
                {e.text}
              </Anchor>
            ) : (
              e.text
            )}
          </div>
        );
      })}
    </Text>
  );
}
