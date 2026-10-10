/** Wire-level names shared by the API and its clients. */
export const SESSION_COOKIE = "bx_session";
export const PREVIEW_GATE_COOKIE = "bx_preview";
/** Mobile has no cookie jar for the gate: it sends the gate token in this header instead. */
export const PREVIEW_GATE_HEADER = "X-Preview-Token";
export const CSRF_HEADER = "X-Requested-With";
export const CSRF_HEADER_VALUE = "bytesac";
export const CLIENT_HEADER = "X-Client";
export const MOBILE_CLIENT = "mobile";
