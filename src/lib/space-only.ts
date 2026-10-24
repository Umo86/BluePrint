/** Documents a space-only stand pack can be asked for. Shared by settings, the exhibitor portal and reviewers. */
export const SPACE_ONLY_DOCS: { key: string; label: string; help: string }[] = [
  { key: 'drawings', label: 'Stand drawings', help: 'Plan, elevations and a 3D view with dimensions and heights.' },
  { key: 'risk_assessment', label: 'Risk assessment', help: 'Build-up and breakdown hazards and how they are controlled.' },
  { key: 'method_statement', label: 'Method statement', help: 'How the stand will be built and taken down, step by step.' },
  { key: 'construction_phase_plan', label: 'Construction phase plan', help: 'Required under CDM 2015 for every space-only build.' },
  { key: 'contractor_insurance', label: 'Contractor’s public liability insurance', help: 'Certificate showing cover and expiry date.' },
  { key: 'hs_declaration', label: 'Health and safety declaration', help: 'Signed by the stand contractor.' },
  { key: 'structural_calculations', label: 'Structural calculations', help: 'From a qualified engineer, for complex stands.' },
  { key: 'rigging_plan', label: 'Rigging plan', help: 'Anything hung from the venue roof.' },
  { key: 'fire_certificates', label: 'Fire retardancy certificates', help: 'For materials, fabrics and drapes.' },
  { key: 'electrical_plan', label: 'Electrical plan', help: 'Power points, lighting and loads.' },
];

export const SPACE_ONLY_DOC_LABELS: Record<string, string> = Object.fromEntries(SPACE_ONLY_DOCS.map((d) => [d.key, d.label]));

export type SpaceOnlyRulesLike = {
  maxHeightM: number;
  maxPlatformMm: number;
  stepsMakeComplex: boolean;
  minInsuranceGbp: number;
  requiredDocs: string[];
  complexDocs: string[];
};

export type Declared = {
  heightM: number | null;
  platformMm: number | null;
  hasSteps: boolean;
  insuranceCoverGbp: number | null;
  /** YYYY-MM-DD */
  insuranceExpiresOn: string | null;
};

/**
 * Works out whether a stand counts as complex and what is still missing from its pack.
 * `missing` items stop the pack being sent; `warnings` are for the reviewer's attention.
 */
export function checkPack(rules: SpaceOnlyRulesLike, declared: Declared, documents: Record<string, string[] | undefined>, opts: { breakdownEndsAt?: Date | string | null } = {}) {
  const missing: string[] = [];
  const warnings: string[] = [];
  const complexReasons: string[] = [];
  if (declared.heightM === null || declared.heightM === undefined) missing.push('The stand’s highest point');
  else if (declared.heightM > rules.maxHeightM) complexReasons.push(`taller than ${rules.maxHeightM} m`);
  if (declared.platformMm === null || declared.platformMm === undefined) missing.push('The platform height (enter 0 if there is none)');
  else if (declared.platformMm > rules.maxPlatformMm) complexReasons.push(`a platform higher than ${rules.maxPlatformMm} mm`);
  if (rules.stepsMakeComplex && declared.hasSteps) complexReasons.push('steps or a second level');
  const isComplex = complexReasons.length > 0;

  if (declared.insuranceCoverGbp === null || declared.insuranceCoverGbp === undefined) missing.push('The contractor’s insurance cover');
  else if (declared.insuranceCoverGbp < rules.minInsuranceGbp) {
    missing.push(`Insurance cover of at least £${rules.minInsuranceGbp.toLocaleString('en-GB')} (you entered £${declared.insuranceCoverGbp.toLocaleString('en-GB')})`);
  }
  if (!declared.insuranceExpiresOn) missing.push('The insurance expiry date');
  else if (opts.breakdownEndsAt && new Date(`${declared.insuranceExpiresOn}T23:59:59Z`) < new Date(opts.breakdownEndsAt)) {
    missing.push('Insurance that lasts until the end of breakdown');
  }

  const needed = [...new Set([...rules.requiredDocs, ...(isComplex ? rules.complexDocs : [])])];
  for (const key of needed) {
    if (!(documents[key] ?? []).length) missing.push(SPACE_ONLY_DOC_LABELS[key] ?? key);
  }
  if (isComplex) warnings.push(`Counts as a complex stand: ${complexReasons.join(', ')}.`);
  return { isComplex, complexReasons, neededDocs: needed, missing, warnings, complete: missing.length === 0 };
}

export const PACK_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  not_started: { label: 'Not sent yet', color: 'gray' },
  submitted: { label: 'Sent, waiting for review', color: 'blue' },
  under_review: { label: 'Being reviewed', color: 'blue' },
  changes_needed: { label: 'Changes needed', color: 'orange' },
  approved: { label: 'Approved', color: 'green' },
  approved_with_conditions: { label: 'Approved with conditions', color: 'lime' },
  rejected: { label: 'Not approved', color: 'red' },
};
