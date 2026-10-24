import { Anchor, List, ListItem, Text } from '@mantine/core';
import type { ReactNode } from 'react';

/**
 * Renders the assistant's replies: paragraphs, bullet lists, **bold** and [links](/portal/...).
 * Built from React elements (never HTML strings), and only links into BluePrint or to https
 * websites are made clickable, so a reply cannot inject markup or scripts. Links to other websites
 * always show where they really go, so a link labelled with a trusted name cannot hide another site.
 */

export function safeHref(url: string): string | null {
  const u = url.trim();
  if (/^\/(portal|files)\//.test(u) && !u.startsWith('//') && !u.includes('\\')) return u;
  if (!/^https:\/\/[^\s]+$/i.test(u)) return null;
  try {
    const parsed = new URL(u);
    if (parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/** The website a link goes to, shown beside its label unless the label already says it. */
export function visibleHost(label: string, href: string): string | null {
  const host = new URL(href).hostname.replace(/^www\./, '');
  const shown = label.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
  return shown === host || shown.startsWith(`${host}/`) ? null : host;
}

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\[([^\]]{1,200})\]\(([^)\s]{1,500})\)|\*\*([^*]{1,300})\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) {
      const href = safeHref(m[2]);
      const external = href?.startsWith('https://');
      out.push(
        href ? (
          <Anchor key={`${key}-${i++}`} href={href} {...(external ? { target: '_blank', rel: 'noopener noreferrer nofollow' } : {})}>
            {m[1]}
          </Anchor>
        ) : (
          m[1]
        ),
      );
      const host = external && href ? visibleHost(m[1], href) : null;
      if (host) {
        out.push(
          <Text key={`${key}-${i++}`} span fz="xs" c="dimmed">
            {' '}
            ({host})
          </Text>,
        );
      }
    } else if (m[3] !== undefined) {
      out.push(<strong key={`${key}-${i++}`}>{m[3]}</strong>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function ChatText({ text }: { text: string }) {
  const blocks = text.replace(/\r\n/g, '\n').split(/\n{2,}/);
  return (
    <>
      {blocks.map((block, b) => {
        const lines = block.split('\n');
        const isList = lines.every((l) => /^\s*[-*•]\s+/.test(l));
        if (isList) {
          return (
            <List key={b} size="sm" spacing={2} mb={6}>
              {lines.map((l, i) => (
                <ListItem key={i}>{inline(l.replace(/^\s*[-*•]\s+/, ''), `${b}-${i}`)}</ListItem>
              ))}
            </List>
          );
        }
        return (
          <Text key={b} fz="sm" mb={6} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {lines.map((l, i) => (
              <span key={i}>
                {inline(l, `${b}-${i}`)}
                {i < lines.length - 1 ? '\n' : null}
              </span>
            ))}
          </Text>
        );
      })}
    </>
  );
}
