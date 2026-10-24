'use client';

import { RichTextEditor as MantineRTE, Link } from '@mantine/tiptap';
import { useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useRef } from 'react';

type Props = { value: string; onChange: (html: string) => void; minHeight?: number; label?: string };

/** The page editor: headings, lists, links and tables-free formatting. Output is sanitised on the server. */
export function RichTextEditor({ value, onChange, minHeight = 240, label }: Props) {
  // The last HTML this editor reported. A different `value` means the page changed it (for
  // example by adding a download link), so the editor is updated to match.
  const lastEmitted = useRef(value);
  const editor = useEditor({
    extensions: [StarterKit.configure({ link: false, heading: { levels: [2, 3, 4] } }), Link.configure({ openOnClick: false, autolink: true })],
    content: value,
    immediatelyRender: false,
    onUpdate: ({ editor: e }) => {
      const html = e.getHTML();
      lastEmitted.current = html;
      onChange(html);
    },
  });

  useEffect(() => {
    if (editor && value !== lastEmitted.current && value !== editor.getHTML()) {
      editor.commands.setContent(value, { emitUpdate: false });
      lastEmitted.current = value;
    }
  }, [value, editor]);

  return (
    <div>
      {label ? (
        <div style={{ fontSize: 'var(--mantine-font-size-sm)', fontWeight: 600, marginBottom: 6 }}>{label}</div>
      ) : null}
      <MantineRTE editor={editor} aria-label={label ?? 'Rich text editor'}>
        <MantineRTE.Toolbar sticky stickyOffset={60}>
          <MantineRTE.ControlsGroup>
            <MantineRTE.Bold />
            <MantineRTE.Italic />
            <MantineRTE.Underline />
            <MantineRTE.Strikethrough />
          </MantineRTE.ControlsGroup>
          <MantineRTE.ControlsGroup>
            <MantineRTE.H2 />
            <MantineRTE.H3 />
            <MantineRTE.H4 />
          </MantineRTE.ControlsGroup>
          <MantineRTE.ControlsGroup>
            <MantineRTE.BulletList />
            <MantineRTE.OrderedList />
            <MantineRTE.Blockquote />
            <MantineRTE.Hr />
          </MantineRTE.ControlsGroup>
          <MantineRTE.ControlsGroup>
            <MantineRTE.Link />
            <MantineRTE.Unlink />
          </MantineRTE.ControlsGroup>
          <MantineRTE.ControlsGroup>
            <MantineRTE.Undo />
            <MantineRTE.Redo />
          </MantineRTE.ControlsGroup>
        </MantineRTE.Toolbar>
        <MantineRTE.Content style={{ minHeight }} />
      </MantineRTE>
    </div>
  );
}
