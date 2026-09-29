export const toIso = (d: Date): string => d.toISOString();
export const toIsoOrNull = (d: Date | null): string | null => (d ? d.toISOString() : null);
