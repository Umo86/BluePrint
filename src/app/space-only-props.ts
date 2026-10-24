import 'server-only';
import type { PackProps } from '@/components/space-only-pack';
import type { packView } from '@/server/services/space-only';

/** Turns the pack view into plain data for the browser component. */
export function toPackProps(v: Awaited<ReturnType<typeof packView>>): PackProps {
  return {
    standId: v.stand.id,
    role: v.role,
    status: v.status,
    conditions: v.pack?.conditions ?? null,
    certificateFileId: v.pack?.certificateFileId ?? null,
    currentVersion: v.pack?.currentVersion ?? 0,
    rules: v.rules,
    breakdownEndsAt: v.edition.breakdownEndsAt?.toISOString() ?? null,
    declared: v.declared,
    documents: v.draft,
    files: Object.fromEntries(Object.entries(v.files).map(([k, f]) => [k, { name: f.name, size: f.size }])),
    contractor: v.contractor
      ? { companyName: v.contractor.contractorCompanyName, contactName: v.contractor.contactName, email: v.contractor.contactEmail, phone: v.contractor.contactPhone, status: v.contractor.status }
      : null,
    reviews: v.reviews.map((r) => ({ ...r, at: r.at.toISOString() })),
    editable: v.editable,
    canNominate: v.canNominate,
    companyName: v.company.name,
  };
}
