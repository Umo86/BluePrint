export const TASK_KIND_LABELS: Record<string, string> = {
  form: 'Form',
  upload: 'Document upload',
  declaration: 'Declaration',
  info: 'Information to read',
  order: 'Order from the shop',
  contractor_nomination: 'Nominate a stand contractor',
  space_only_pack: 'Space-only stand pack',
};

export const TASK_KIND_HELP: Record<string, string> = {
  form: 'Questions the exhibitor answers.',
  upload: 'The exhibitor uploads one or more documents.',
  declaration: 'The exhibitor confirms a statement and signs with their name.',
  info: 'Something to read; the exhibitor marks it as read.',
  order: 'Completed when the exhibitor pays for an order in a chosen shop category.',
  contractor_nomination: 'Space-only exhibitors tell you who is building their stand.',
  space_only_pack: 'Drawings, risk assessment and the rest of the space-only pack, reviewed by your team.',
};

export const REQUIREMENT_LABELS: Record<string, string> = {
  required: 'Required',
  if_applicable: 'If it applies to them',
  optional: 'Optional',
  hidden: 'Not shown',
};

export const TASK_STATE_LABELS: Record<string, { label: string; color: string }> = {
  to_do: { label: 'To do', color: 'gray' },
  overdue: { label: 'Overdue', color: 'red' },
  draft: { label: 'Started', color: 'yellow' },
  submitted: { label: 'Waiting for review', color: 'blue' },
  completed: { label: 'Done', color: 'green' },
  approved: { label: 'Approved', color: 'green' },
  changes_needed: { label: 'Changes needed', color: 'orange' },
  rejected: { label: 'Not accepted', color: 'red' },
  not_needed: { label: 'Not needed', color: 'gray' },
};
