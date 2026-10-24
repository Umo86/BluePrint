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
