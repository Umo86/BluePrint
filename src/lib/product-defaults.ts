/** Values the product form works with (shared by the show team and supplier pages). */
export type ProductFormValues = {
  categoryId: string;
  name: string;
  description: string;
  imageFileId: string | null;
  unit: string;
  pricePence: number;
  earlyPricePence: number | null;
  earlyUntilOffsetDays: number | null;
  latePricePence: number | null;
  lateFromOffsetDays: number | null;
  vatRateBps: number;
  options: { name: string; values: string[] }[];
  requiredDetails: { id: string; label: string; type: 'text' | 'textarea'; required?: boolean }[];
  stockLimit: number | null;
  visibleToTypes: string[];
  commissionType: 'percent' | 'fixed' | null;
  commissionValue: number | null;
};

export function emptyProduct(categoryId: string, vatRateBps: number): ProductFormValues {
  return {
    categoryId,
    name: '',
    description: '',
    imageFileId: null,
    unit: 'each',
    pricePence: 0,
    earlyPricePence: null,
    earlyUntilOffsetDays: null,
    latePricePence: null,
    lateFromOffsetDays: null,
    vatRateBps,
    options: [],
    requiredDetails: [],
    stockLimit: null,
    visibleToTypes: [],
    commissionType: null,
    commissionValue: null,
  };
}
