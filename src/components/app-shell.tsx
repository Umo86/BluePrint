'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Alert,
  AppShell as MantineAppShell,
  Avatar,
  Badge,
  Burger,
  Button,
  Divider,
  Group,
  Menu,
  NavLink,
  ScrollArea,
  Stack,
  Text,
  UnstyledButton,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconChevronDown, IconEye, IconLogout, IconSwitchHorizontal, IconUserCircle } from '@tabler/icons-react';
import { BrandMark } from './brand';
import { signOutAction } from '@/app/(auth)/actions';
import { stopViewAsAction } from '@/app/view-as-actions';

export type NavItem = { label: string; href: string; icon?: React.ReactNode; badge?: string | number | null; exact?: boolean; section?: string };

type Props = {
  title: string;
  subtitle?: string;
  nav: NavItem[];
  user: { name: string; email: string };
  workspaces: { label: string; href: string; description: string }[];
  viewAs?: { name: string; email: string } | null;
  accentColor?: string;
  children: React.ReactNode;
};

function initials(name: string, email: string) {
  const src = name.trim() || email;
  const parts = src.split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
}

export function AppShell({ title, subtitle, nav, user, workspaces, viewAs, children }: Props) {
  const [opened, { toggle, close }] = useDisclosure();
  const pathname = usePathname();
  let lastSection: string | undefined;

  return (
    <MantineAppShell header={{ height: 60 }} navbar={{ width: 260, breakpoint: 'sm', collapsed: { mobile: !opened } }} padding="lg">
      <MantineAppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" aria-label="Open navigation" />
            <Link href="/" aria-label="BluePrint home" style={{ textDecoration: 'none' }}>
              <BrandMark size="md" />
            </Link>
            <Divider orientation="vertical" visibleFrom="sm" />
            <div style={{ minWidth: 0 }}>
              <Text fw={600} fz="sm" truncate>
                {title}
              </Text>
              {subtitle ? (
                <Text fz="xs" c="dimmed" truncate>
                  {subtitle}
                </Text>
              ) : null}
            </div>
          </Group>
          <Group gap="xs" wrap="nowrap">
            {workspaces.length > 1 ? (
              <Menu position="bottom-end" width={280}>
                <Menu.Target>
                  <Button variant="subtle" size="xs" leftSection={<IconSwitchHorizontal size={16} />} visibleFrom="sm">
                    Switch
                  </Button>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Label>Your workspaces</Menu.Label>
                  {workspaces.map((w) => (
                    <Menu.Item key={w.href} component={Link} href={w.href}>
                      <Text fz="sm">{w.label}</Text>
                      <Text fz="xs" c="dimmed">
                        {w.description}
                      </Text>
                    </Menu.Item>
                  ))}
                </Menu.Dropdown>
              </Menu>
            ) : null}
            <Menu position="bottom-end" width={240}>
              <Menu.Target>
                <UnstyledButton aria-label="Account menu">
                  <Group gap={6} wrap="nowrap">
                    <Avatar size={32} radius="xl" color="blueprint">
                      {initials(user.name, user.email)}
                    </Avatar>
                    <IconChevronDown size={14} />
                  </Group>
                </UnstyledButton>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>
                  <Text fz="sm" fw={600} c="var(--mantine-color-text)">
                    {user.name || user.email}
                  </Text>
                  <Text fz="xs">{user.email}</Text>
                </Menu.Label>
                <Menu.Item component={Link} href="/account" leftSection={<IconUserCircle size={16} />}>
                  Account and security
                </Menu.Item>
                <Menu.Divider />
                <Menu.Item color="red" leftSection={<IconLogout size={16} />} onClick={() => signOutAction()}>
                  Sign out
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>
      </MantineAppShell.Header>

      <MantineAppShell.Navbar p="sm">
        <MantineAppShell.Section grow component={ScrollArea}>
          <Stack gap={2}>
            {nav.map((item) => {
              const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + '/');
              const header = item.section && item.section !== lastSection ? item.section : null;
              lastSection = item.section ?? lastSection;
              return (
                <div key={item.href}>
                  {header ? (
                    <Text fz={11} fw={700} c="dimmed" tt="uppercase" mt="sm" mb={4} px="sm">
                      {header}
                    </Text>
                  ) : null}
                  <NavLink
                    component={Link}
                    href={item.href}
                    label={item.label}
                    leftSection={item.icon}
                    active={active}
                    onClick={close}
                    rightSection={item.badge ? <Badge size="sm" variant="light">{item.badge}</Badge> : null}
                    styles={{ root: { borderRadius: 6 } }}
                  />
                </div>
              );
            })}
          </Stack>
        </MantineAppShell.Section>
      </MantineAppShell.Navbar>

      <MantineAppShell.Main bg="var(--mantine-color-gray-0)">
        {viewAs ? (
          <Alert
            color="orange"
            icon={<IconEye size={18} />}
            mb="md"
            title={`Viewing as ${viewAs.name || viewAs.email} (read-only)`}
          >
            <Group justify="space-between" wrap="wrap">
              <Text fz="sm">You see exactly what they see. Nothing can be changed, and this view is logged.</Text>
              <Button size="xs" color="orange" variant="white" onClick={() => stopViewAsAction()}>
                Stop viewing
              </Button>
            </Group>
          </Alert>
        ) : null}
        {children}
      </MantineAppShell.Main>
    </MantineAppShell>
  );
}
