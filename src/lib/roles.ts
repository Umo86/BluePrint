import type { EditionPermission, EditionRole } from '@/server/db/schema';

export const ROLE_OPTIONS: { value: EditionRole; label: string; description: string }[] = [
  { value: 'show_admin', label: 'Show admin', description: 'Everything in this edition, including the team, emails and settings.' },
  { value: 'show_team', label: 'Show team', description: 'Only the areas ticked below.' },
  { value: 'hs_reviewer', label: 'Health and safety reviewer', description: 'Only the space-only review queue, for example an outside H&S consultant.' },
];

export const ROLE_LABELS: Record<string, string> = Object.fromEntries(ROLE_OPTIONS.map((r) => [r.value, r.label]));

/** Every permission a show team member can be given. "view" is always included. */
export const PERMISSION_OPTIONS: { value: EditionPermission; label: string; description: string }[] = [
  { value: 'edit_content', label: 'Manual and tasks', description: 'Edit manual pages, tasks, forms, deadlines and branding.' },
  { value: 'manage_exhibitors', label: 'Exhibitors and stands', description: 'Add exhibitors, stands and contacts; send invitations; review submissions.' },
  { value: 'review_space_only', label: 'Space-only approvals', description: 'Review and approve space-only stand packs.' },
  { value: 'manage_orders', label: 'Orders and services', description: 'See and change orders, prices, suppliers and refunds.' },
  { value: 'send_emails', label: 'Emails', description: 'Edit email templates and send reminders and campaigns.' },
  { value: 'helpdesk', label: 'Help desk', description: 'Answer exhibitor questions and the assistant’s hand-offs.' },
  { value: 'view_reports', label: 'Reports', description: 'See reports and download spreadsheets.' },
];

export const PERMISSION_LABELS: Record<string, string> = {
  view: 'View',
  ...Object.fromEntries(PERMISSION_OPTIONS.map((p) => [p.value, p.label])),
};
