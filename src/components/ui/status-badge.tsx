import { Badge } from '@mantine/core';

const COLOURS: Record<string, string> = {
  draft: 'gray',
  live: 'green',
  onsite: 'teal',
  closed: 'blue',
  archived: 'dark',
  active: 'green',
  disabled: 'red',
  invited: 'yellow',
  submitted: 'blue',
  approved: 'green',
  approved_with_conditions: 'lime',
  changes_needed: 'orange',
  rejected: 'red',
  completed: 'green',
  not_needed: 'gray',
  overdue: 'red',
  to_do: 'gray',
  under_review: 'blue',
  not_started: 'gray',
  pending_payment: 'yellow',
  paid: 'green',
  invoiced: 'blue',
  cancelled: 'gray',
  refunded: 'grape',
  partially_refunded: 'grape',
  payment_failed: 'red',
  received: 'blue',
  confirmed: 'teal',
  delivered: 'green',
  pending_approval: 'yellow',
  open: 'orange',
  pending: 'yellow',
  sent: 'blue',
  queued: 'gray',
  opened: 'teal',
  clicked: 'green',
  bounced: 'red',
  complained: 'red',
  failed: 'red',
  suppressed: 'gray',
  ok: 'green',
  error: 'red',
  running: 'blue',
};

export function labelFor(status: string) {
  const s = status.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return (
    <Badge color={COLOURS[status] ?? 'gray'} variant="light" radius="sm">
      {label ?? labelFor(status)}
    </Badge>
  );
}
