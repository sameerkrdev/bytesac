/** One date style everywhere: "8 Apr 2026" (locale order, short month). */
export const formatDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
