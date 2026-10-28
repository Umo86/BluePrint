'use client';

import { useMemo, useState } from 'react';
import {
  ActionIcon,
  Badge,
  Checkbox,
  Group,
  Menu,
  Select,
  Stack,
  Table,
  TableScrollContainer,
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { IconDots, IconSearch } from '@tabler/icons-react';
import { useAction } from '@/lib/use-action';
import { PERMISSION_OPTIONS } from '@/lib/roles';
import type { EditionPermission, EditionRole } from '@/server/db/schema';
import { setLibraryRightAction, setStaffAccessAction } from '@/app/admin/actions';

export type RightsRow = {
  userId: string;
  name: string;
  email: string;
  jobTitle?: string | null;
  status?: string;
  /** Super admins have every right in every show (only shown on the super admin's list). */
  isSuperAdmin?: boolean;
  canAddToLibrary?: boolean;
  /** Their role in this show, or null when they are not on its team. */
  role: EditionRole | null;
  permissions: string[];
  showCount?: number;
};

type Access = { role: EditionRole; permissions: EditionPermission[] } | null;

const NOT_ON_SHOW = 'none';
const ROLE_CHOICES: { value: EditionRole; label: string }[] = [
  { value: 'show_admin', label: 'Show admin' },
  { value: 'show_team', label: 'Show team' },
  { value: 'hs_reviewer', label: 'H&S reviewer' },
];

/** Refunds are made from the orders pages, so the refunds right brings orders with it (the server does the same). */
function toggled(perms: EditionPermission[], p: EditionPermission): EditionPermission[] {
  let next = perms.includes(p) ? perms.filter((x) => x !== p) : [...perms, p];
  if (p === 'refunds' && next.includes('refunds') && !next.includes('manage_orders')) next = [...next, 'manage_orders'];
  if (p === 'manage_orders' && !next.includes('manage_orders')) next = next.filter((x) => x !== 'refunds');
  return next;
}

function holds(row: RightsRow, p: EditionPermission) {
  if (row.isSuperAdmin || row.role === 'show_admin') return true;
  if (row.role === 'hs_reviewer') return p === 'review_space_only';
  return row.role === 'show_team' && row.permissions.includes(p);
}

/**
 * Everyone with a tick box for each right in one show. A tick or a new role saves straight away.
 * "show" lists the show's own team (for its show admins); "platform" lists everyone who works on any
 * show, so a super admin can also add people to this show and give the library right.
 */
export function RightsMatrix({
  editionId,
  rows: initialRows,
  mode,
  currentUserId,
  viewerIsSuperAdmin = false,
}: {
  editionId: string;
  rows: RightsRow[];
  mode: 'show' | 'platform';
  currentUserId?: string;
  viewerIsSuperAdmin?: boolean;
}) {
  const [rows, setRows] = useState(initialRows);
  const [state, setState] = useState<Record<string, 'saving' | 'saved' | undefined>>({});
  const [q, setQ] = useState('');
  const save = useAction(setStaffAccessAction);
  const library = useAction(setLibraryRightAction);

  const shown = useMemo(() => {
    const words = q.trim().toLowerCase();
    if (!words) return rows;
    return rows.filter((r) => `${r.name} ${r.email} ${r.jobTitle ?? ''}`.toLowerCase().includes(words));
  }, [rows, q]);
  const onShow = rows.filter((r) => r.role !== null).length;

  const mark = (userId: string, s: 'saving' | 'saved' | undefined) => setState((x) => ({ ...x, [userId]: s }));
  const patch = (userId: string, change: Partial<RightsRow>) => setRows((rs) => rs.map((r) => (r.userId === userId ? { ...r, ...change } : r)));

  const apply = async (row: RightsRow, access: Access) => {
    const before = { role: row.role, permissions: row.permissions };
    patch(row.userId, { role: access?.role ?? null, permissions: access?.role === 'show_team' ? access.permissions : [] });
    mark(row.userId, 'saving');
    const res = await save.run(editionId, row.userId, access);
    if (!res.ok) {
      patch(row.userId, before);
      mark(row.userId, undefined);
      return;
    }
    // On a show's own list, someone taken off the team leaves the list.
    if (access === null && mode === 'show') {
      setRows((rs) => rs.filter((r) => r.userId !== row.userId));
      return;
    }
    mark(row.userId, 'saved');
    setTimeout(() => setState((x) => (x[row.userId] === 'saved' ? { ...x, [row.userId]: undefined } : x)), 2500);
  };

  const confirmRemoval = (row: RightsRow) =>
    modals.openConfirmModal({
      title: `Take ${row.name || row.email} off this show?`,
      children: <Text fz="sm">They lose access to this show straight away. Their account and other shows are not affected.</Text>,
      labels: { confirm: 'Take off the show', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: () => apply(row, null),
    });

  const changeRole = (row: RightsRow, value: string | null) => {
    if (!value || value === (row.role ?? NOT_ON_SHOW)) return;
    if (value === NOT_ON_SHOW) return confirmRemoval(row);
    const role = value as EditionRole;
    apply(row, { role, permissions: role === 'show_team' && row.role === 'show_team' ? (row.permissions as EditionPermission[]) : [] });
  };

  const tick = (row: RightsRow, p: EditionPermission) => {
    // Ticking a right for someone not on the show adds them to its team with that right.
    const current = row.role === 'show_team' ? (row.permissions as EditionPermission[]) : [];
    apply(row, { role: 'show_team', permissions: toggled(current, p) });
  };

  const setLibrary = async (row: RightsRow, value: boolean) => {
    patch(row.userId, { canAddToLibrary: value });
    const res = await library.run(row.userId, value);
    if (!res.ok) patch(row.userId, { canAddToLibrary: !value });
  };

  return (
    <Stack gap="sm">
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <TextInput
          aria-label="Search people"
          placeholder="Search by name, email or job title"
          leftSection={<IconSearch size={16} />}
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
          w={320}
          maw="100%"
        />
        <Text fz="sm" c="dimmed">
          {mode === 'platform' ? `${onShow} of ${rows.length} people are on this show’s team.` : `${rows.length} ${rows.length === 1 ? 'person' : 'people'} on the team.`}
        </Text>
      </Group>
      <TableScrollContainer minWidth={mode === 'platform' ? 920 : 850}>
        <Table verticalSpacing="xs" horizontalSpacing={6} highlightOnHover>
          <TableThead>
            <TableTr>
              <TableTh miw={180} style={{ position: 'sticky', left: 0, zIndex: 2, background: 'var(--mantine-color-body)' }}>
                Person
              </TableTh>
              <TableTh w={136}>Role in this show</TableTh>
              {PERMISSION_OPTIONS.map((p) => (
                <TableTh key={p.value} w={66} ta="center" px={2}>
                  <Tooltip label={`${p.label}: ${p.description}`} multiline w={240} withArrow>
                    <Text fz="xs" fw={600} style={{ cursor: 'help' }}>
                      {p.short}
                    </Text>
                  </Tooltip>
                </TableTh>
              ))}
              {mode === 'platform' ? (
                <TableTh w={76} ta="center" px={2} style={{ borderLeft: '1px solid var(--mantine-color-default-border)' }}>
                  <Tooltip label="Save tasks and manual pages from their shows into the shared library. Applies to every show." multiline w={240} withArrow>
                    <Text fz="xs" fw={600} style={{ cursor: 'help' }}>
                      Library (all shows)
                    </Text>
                  </Tooltip>
                </TableTh>
              ) : (
                <TableTh w={40} />
              )}
            </TableTr>
          </TableThead>
          <TableTbody>
            {shown.map((r) => {
              const who = r.name || r.email;
              const self = r.userId === currentUserId;
              const fixed = r.isSuperAdmin || r.role === 'show_admin' || r.role === 'hs_reviewer';
              const roleLocked = r.isSuperAdmin || (self && !viewerIsSuperAdmin);
              return (
                <TableTr key={r.userId} style={r.role === null && !r.isSuperAdmin ? { opacity: 0.85 } : undefined}>
                  <TableTd style={{ position: 'sticky', left: 0, zIndex: 1, background: 'var(--mantine-color-body)' }}>
                    <Group gap={6} wrap="nowrap">
                      <Text fz="sm" fw={600}>
                        {who}
                      </Text>
                      {r.status === 'disabled' ? (
                        <Badge size="xs" color="gray" variant="light">
                          Disabled
                        </Badge>
                      ) : null}
                      <Text fz="xs" c={state[r.userId] === 'saved' ? 'green' : 'dimmed'} aria-live="polite">
                        {state[r.userId] === 'saving' ? 'Saving…' : state[r.userId] === 'saved' ? 'Saved' : ''}
                      </Text>
                    </Group>
                    <Text fz="xs" c="dimmed">
                      {r.email}
                      {r.jobTitle ? ` · ${r.jobTitle}` : ''}
                    </Text>
                  </TableTd>
                  <TableTd>
                    {r.isSuperAdmin ? (
                      <Stack gap={0}>
                        <Badge color="red" variant="light" w="fit-content">
                          Super admin
                        </Badge>
                        <Text fz="xs" c="dimmed">
                          Every right in every show
                        </Text>
                      </Stack>
                    ) : (
                      <Select
                        aria-label={`Role in this show for ${who}`}
                        size="xs"
                        data={[...(mode === 'platform' ? [{ value: NOT_ON_SHOW, label: 'Not on this show' }] : []), ...ROLE_CHOICES]}
                        value={r.role ?? NOT_ON_SHOW}
                        onChange={(v) => changeRole(r, v)}
                        allowDeselect={false}
                        disabled={roleLocked}
                        title={roleLocked && self ? 'Ask another show admin to change your own role.' : undefined}
                      />
                    )}
                  </TableTd>
                  {PERMISSION_OPTIONS.map((p) => (
                    <TableTd key={p.value} ta="center">
                      <Checkbox
                        aria-label={`${p.label} for ${who}`}
                        checked={holds(r, p.value)}
                        disabled={fixed || (r.role === null && mode === 'show')}
                        onChange={() => tick(r, p.value)}
                        styles={{ body: { justifyContent: 'center' } }}
                      />
                    </TableTd>
                  ))}
                  {mode === 'platform' ? (
                    <TableTd ta="center" style={{ borderLeft: '1px solid var(--mantine-color-default-border)' }}>
                      <Checkbox
                        aria-label={`Library for ${who}`}
                        checked={Boolean(r.isSuperAdmin || r.canAddToLibrary)}
                        disabled={r.isSuperAdmin}
                        onChange={(e) => setLibrary(r, e.currentTarget.checked)}
                        styles={{ body: { justifyContent: 'center' } }}
                      />
                    </TableTd>
                  ) : (
                    <TableTd>
                      <Menu position="bottom-end">
                        <Menu.Target>
                          <ActionIcon variant="subtle" aria-label={`More for ${who}`}>
                            <IconDots size={16} />
                          </ActionIcon>
                        </Menu.Target>
                        <Menu.Dropdown>
                          <Menu.Item color="red" disabled={self && !viewerIsSuperAdmin} onClick={() => confirmRemoval(r)}>
                            Remove from the team
                          </Menu.Item>
                        </Menu.Dropdown>
                      </Menu>
                    </TableTd>
                  )}
                </TableTr>
              );
            })}
          </TableTbody>
        </Table>
      </TableScrollContainer>
      {!shown.length ? (
        <Text fz="sm" c="dimmed">
          {rows.length ? 'Nobody matches.' : 'Nobody on the team yet.'}
        </Text>
      ) : null}
      <Text fz="xs" c="dimmed">
        Show admins have every right in their show, including the team and settings. H&amp;S reviewers only see the space-only review queue.
        {mode === 'platform' ? ' Ticking a right for someone not on this show adds them to its team.' : ''} Hover over a column to see what it allows.
      </Text>
    </Stack>
  );
}
