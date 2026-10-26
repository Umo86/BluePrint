/** The values the stand form edits (Add exhibitor, Add stand and Change stand). */
export type StandFormValues = {
  number: string;
  exhibitorTypeId: string | null;
  hallId: string | null;
  sizeSqm: number | null;
  widthM: number | null;
  depthM: number | null;
  openSides: number;
  notes: string;
};

export function emptyStandForm(exhibitorTypeId: string | null): StandFormValues {
  return { number: '', exhibitorTypeId, hallId: null, sizeSqm: null, widthM: null, depthM: null, openSides: 1, notes: '' };
}

const num = (v: string | null) => (v === null ? null : Number(v));

/** A stand as stored (numbers come back from the database as strings) turned into form values. */
export function standFormValues(s: {
  number: string;
  exhibitorTypeId: string;
  hallId: string | null;
  sizeSqm: string | null;
  widthM: string | null;
  depthM: string | null;
  openSides: number;
  notes: string | null;
}): StandFormValues {
  return {
    number: s.number,
    exhibitorTypeId: s.exhibitorTypeId,
    hallId: s.hallId,
    sizeSqm: num(s.sizeSqm),
    widthM: num(s.widthM),
    depthM: num(s.depthM),
    openSides: s.openSides,
    notes: s.notes ?? '',
  };
}

/** The area the form shows: width × depth when both are filled in, otherwise what was typed. */
export function formArea(v: Pick<StandFormValues, 'sizeSqm' | 'widthM' | 'depthM'>): number | null {
  if (v.widthM !== null && v.depthM !== null) return Math.round(v.widthM * v.depthM * 100) / 100;
  return v.sizeSqm;
}
