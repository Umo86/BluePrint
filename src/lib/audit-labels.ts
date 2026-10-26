/**
 * Plain-English names for audit log actions, so super admins can read the log without knowing the codes.
 * The code is still shown beside it (and is what the "Action" filter searches).
 */
const LABELS: Record<string, string> = {
  // Signing in and security
  'auth.code_requested': 'Asked for a sign-in code',
  'auth.code_requested_no_account': 'Sign-in code asked for an unknown address',
  'auth.code_failed': 'Wrong sign-in code',
  'auth.sign_in': 'Signed in',
  'auth.sign_out': 'Signed out',
  'auth.signed_out_other_devices': 'Signed out their other devices',
  'auth.session_revoked': 'Signed out a device',
  'auth.password_set': 'Set a password',
  'auth.password_removed': 'Removed their password',
  'auth.password_failed': 'Wrong password',
  'auth.password_locked': 'Password sign-in paused after too many tries',
  'auth.2fa_enabled': 'Turned on two-factor',
  'auth.2fa_passed': 'Passed two-factor',
  'auth.2fa_failed': 'Wrong two-factor code',
  'auth.2fa_reset': 'Reset someone’s two-factor',
  'account.profile_updated': 'Updated their profile',
  'account.updated': 'Updated their account',
  'view_as.start': 'Started viewing as an exhibitor',
  'view_as.stop': 'Stopped viewing as an exhibitor',

  // People
  'user.updated': 'Updated a person',
  'user.disabled': 'Disabled an account',
  'user.enabled': 'Re-enabled an account',
  'user.sessions_revoked': 'Signed someone out everywhere',
  'user.super_admin_granted': 'Made someone a super admin',
  'user.super_admin_removed': 'Removed someone’s super admin access',
  'invitation.created': 'Invited someone',
  'invitation.bulk_sent': 'Sent invitations in bulk',
  'invitation.revoked': 'Cancelled an invitation',
  'invitation.accepted': 'Accepted an invitation',
  'staff.role_changed': 'Changed a team member’s role',
  'staff.removed': 'Removed a team member',

  // Shows and set-up
  'show.created': 'Created a show',
  'show.updated': 'Updated a show',
  'show.archived': 'Archived a show',
  'show.restored': 'Restored a show',
  'show.deleted': 'Deleted a show',
  'edition.created': 'Created an edition',
  'edition.updated': 'Updated an edition',
  'edition.cloned': 'Cloned an edition',
  'edition.deleted': 'Deleted an edition',
  'edition.branding_updated': 'Changed show branding',
  'edition.commercial_updated': 'Changed fees and commission',
  'edition.email_settings_updated': 'Changed show email settings',
  'edition.space_only_rules_updated': 'Changed space-only rules',
  'hall.created': 'Added a hall',
  'hall.renamed': 'Renamed a hall',
  'hall.deleted': 'Deleted a hall',
  'exhibitor_type.created': 'Added a stand type',
  'exhibitor_type.updated': 'Updated a stand type',
  'exhibitor_type.deleted': 'Deleted a stand type',
  'settings.updated': 'Changed platform settings',
  'library.created': 'Added a library template',
  'library.updated': 'Updated a library template',
  'library.deleted': 'Deleted a library template',

  // Exhibitors and stands
  'company.created': 'Added a company',
  'company.updated': 'Updated a company',
  'company.archived': 'Archived a company',
  'company.restored': 'Restored a company',
  'company.invoice_allowed_changed': 'Changed pay-on-invoice',
  'company.member_access_changed': 'Changed a contact’s access',
  'company.member_removed': 'Removed a company contact',
  'company.member_removed_from_shows': 'Removed a contact from some shows',
  'exhibitor.added': 'Added an exhibitor',
  'exhibitor.note_added': 'Added a note on an exhibitor',
  'exhibitor.note_deleted': 'Deleted a note on an exhibitor',
  'exhibitors.imported': 'Imported exhibitors',
  'stand.created': 'Added a stand',
  'stand.updated': 'Updated a stand',
  'stand.cancelled': 'Cancelled a stand',
  'stand.restored': 'Restored a stand',
  'stand.deleted': 'Deleted a stand',

  // Manual, tasks and forms
  'manual.page_created': 'Added a manual page',
  'manual.page_updated': 'Updated a manual page',
  'manual.page_deleted': 'Deleted a manual page',
  'task.created': 'Added a task',
  'task.updated': 'Updated a task',
  'task.deleted': 'Deleted a task',
  'submission.saved': 'Saved a task as a draft',
  'submission.submitted': 'Submitted a task',
  'submission.not_needed': 'Marked a task as not needed',
  'submission.read': 'Marked a task as read',
  'submission.undo': 'Undid a task mark',
  'submission.approved': 'Approved a task',
  'submission.changes_needed': 'Asked for changes to a task',
  'submission.rejected': 'Rejected a task',
  'submission.completed': 'Marked a task as complete',
  'submission.reopened': 'Reopened a submitted task',
  'submission.deadline_extended': 'Gave a stand more time',
  'submission.exported': 'Downloaded task answers',
  'file.uploaded': 'Uploaded a file',
  'file.rejected': 'A file was refused',
  'file.deleted': 'Deleted a file',

  // Space-only
  'space_only.contractor_nominated': 'Nominated a stand contractor',
  'space_only.contractor_removed': 'Removed a stand contractor',
  'space_only.submitted': 'Sent a space-only pack for review',
  'space_only.comment': 'Commented on a space-only pack',
  'space_only.under_review': 'Started reviewing a space-only pack',
  'space_only.approved': 'Approved a space-only pack',
  'space_only.approved_with_conditions': 'Approved a space-only pack with conditions',
  'space_only.changes_needed': 'Asked for changes to a space-only pack',
  'space_only.rejected': 'Rejected a space-only pack',

  // Shop, orders and payments
  'shop.category_created': 'Added a shop category',
  'shop.category_updated': 'Updated a shop category',
  'shop.category_deleted': 'Deleted a shop category',
  'shop.product_created': 'Added a product',
  'shop.product_updated': 'Updated a product',
  'shop.product_deleted': 'Deleted a product',
  'shop.supplier_product_created': 'Supplier added a product',
  'shop.supplier_product_updated': 'Supplier changed a product',
  'shop.supplier_product_submitted': 'Supplier sent a product for approval',
  'shop.supplier_product_withdrawn': 'Supplier withdrew a product',
  'shop.order_placed': 'Placed an order',
  'shop.order_paid': 'Order paid',
  'shop.invoice_paid': 'Invoice marked as paid',
  'shop.order_cancelled': 'Cancelled an order',
  'shop.order_refunded': 'Refunded an order',
  'shop.refund_failed': 'A card refund failed',
  'shop.checkout_cancelled': 'Card checkout cancelled',
  'shop.checkout_expired': 'Card checkout expired',
  'shop.payment_failed': 'A card payment failed',
  'shop.payment_problem': 'A payment needs attention',
  'shop.follow_up_failed': 'A payment follow-up failed',
  'shop.line_fulfilment': 'Supplier updated an order line',
  'shop.orders_exported': 'Downloaded orders',
  'shop.transfer_failed': 'A supplier payout failed',
  'shop.transfer_retried': 'Retried a supplier payout',
  'shop.transfers_retried': 'Retried waiting supplier payouts',
  'shop.transfer_reversal_failed': 'A payout reversal failed',
  'shop.manual_payout_settled': 'Marked a payout as paid by hand',

  // Suppliers
  'supplier.created': 'Added a supplier',
  'supplier.updated': 'Updated a supplier',
  'supplier.disabled': 'Disabled a supplier',
  'supplier.enabled': 'Re-enabled a supplier',
  'supplier.commission_updated': 'Changed a supplier’s commission',
  'supplier.user_removed': 'Removed someone from a supplier',
  'supplier.stripe_account_created': 'Started a supplier’s Stripe set-up',
  'supplier.stripe_onboarded': 'Supplier finished Stripe set-up',
  'supplier.orders_exported': 'Supplier downloaded orders',

  // Emails, announcements and help
  'email.template_saved': 'Reworded a standard email',
  'email.template_reset': 'Reset a standard email',
  'email.retry_failed': 'Retried failed emails',
  'email.suppression_removed': 'Unblocked an email address',
  'email.unsubscribed': 'Unsubscribed from updates',
  'campaign.created': 'Drafted an email to exhibitors',
  'campaign.updated': 'Edited an email to exhibitors',
  'campaign.scheduled': 'Scheduled an email to exhibitors',
  'campaign.unscheduled': 'Unscheduled an email to exhibitors',
  'campaign.sent': 'Sent an email to exhibitors',
  'campaign.deleted': 'Deleted an email to exhibitors',
  'announcement.created': 'Added an announcement',
  'announcement.updated': 'Updated an announcement',
  'announcement.published': 'Published an announcement',
  'announcement.unpublished': 'Unpublished an announcement',
  'announcement.deleted': 'Deleted an announcement',
  'ticket.opened': 'Asked the team a question',
  'ticket.replied': 'Replied on the help desk',
  'ticket.note_added': 'Added an internal note',
  'ticket.assigned': 'Assigned a help desk question',
  'ticket.status_changed': 'Changed a help desk question’s status',
  'ticket.closed': 'Closed a help desk question',
  'saved_reply.created': 'Added a saved reply',
  'saved_reply.updated': 'Updated a saved reply',
  'saved_reply.deleted': 'Deleted a saved reply',
  'assistant.conversation_viewed': 'Read an assistant conversation',
  'assistant.faq_created': 'Added an assistant answer',
  'assistant.faq_updated': 'Updated an assistant answer',
  'assistant.faq_deleted': 'Deleted an assistant answer',
  'assistant.unanswered_resolved': 'Resolved an unanswered question',
  'assistant.form_filled': 'Assistant filled in a form',

  // Records, privacy and system
  'report.downloaded': 'Downloaded a report',
  'audit_log.exported': 'Downloaded the audit log',
  'gdpr.lookup': 'Looked up a person’s data',
  'gdpr.exported': 'Downloaded a person’s data',
  'gdpr.anonymised': 'Erased a person’s details',
  'gdpr.address_erased': 'Erased an email address',
  'cron.run_manually': 'Ran a scheduled job by hand',
};

const AREAS: Record<string, string> = {
  auth: 'Sign-in',
  account: 'Account',
  user: 'People',
  invitation: 'Invitations',
  staff: 'Team',
  show: 'Shows',
  edition: 'Editions',
  hall: 'Halls',
  exhibitor_type: 'Stand types',
  settings: 'Settings',
  library: 'Library',
  company: 'Companies',
  exhibitor: 'Exhibitors',
  exhibitors: 'Exhibitors',
  stand: 'Stands',
  manual: 'Manual',
  task: 'Tasks',
  submission: 'Tasks',
  file: 'Files',
  space_only: 'Space-only',
  shop: 'Shop',
  supplier: 'Suppliers',
  email: 'Email',
  campaign: 'Email',
  announcement: 'Announcements',
  ticket: 'Help desk',
  saved_reply: 'Help desk',
  assistant: 'Assistant',
  report: 'Reports',
  audit_log: 'Audit log',
  gdpr: 'Privacy',
  cron: 'Scheduled jobs',
  view_as: 'View as',
};

export function hasAuditLabel(action: string) {
  return Object.prototype.hasOwnProperty.call(LABELS, action);
}

/** "shop.order_refunded" → "Refunded an order"; unknown codes become readable words. */
export function auditActionLabel(action: string): string {
  const known = LABELS[action];
  if (known) return known;
  const [area, ...rest] = action.split('.');
  const words = rest.join(' ').replace(/_/g, ' ').replace(/\b2fa\b/g, 'two-factor').trim();
  const label = words ? words.charAt(0).toUpperCase() + words.slice(1) : action;
  return AREAS[area] ? `${AREAS[area]}: ${label.charAt(0).toLowerCase()}${label.slice(1)}` : label;
}

const DETAIL_VALUES: Record<string, string> = {
  totp: 'authenticator app',
  recovery_code: 'recovery code',
  email_code: 'emailed code',
  password: 'password',
};

/** Audit details as short "key: value" lines instead of raw JSON. */
export function auditDetailLines(details: Record<string, unknown> | null | undefined): string[] {
  if (!details) return [];
  return Object.entries(details)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => {
      const key = k
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/_/g, ' ')
        .toLowerCase();
      let value: string;
      if (typeof v === 'string') value = DETAIL_VALUES[v] ?? v;
      else if (typeof v === 'number' || typeof v === 'boolean') value = String(v);
      else if (Array.isArray(v)) value = v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ');
      else value = JSON.stringify(v);
      return `${key.charAt(0).toUpperCase()}${key.slice(1)}: ${value}`;
    });
}
