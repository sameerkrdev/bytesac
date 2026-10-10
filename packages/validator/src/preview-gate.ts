import { z } from "zod";

export const previewGateLoginSchema = z.strictObject({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(256),
});

export type PreviewGateLoginRequest = z.infer<typeof previewGateLoginSchema>;

export const previewGateLoginResponseSchema = z.strictObject({
  ok: z.literal(true),
  expiresAt: z.string(),
  /** Only for the mobile client (X-Client: mobile), which stores it in the secure store and sends it as X-Preview-Token. */
  token: z.string().optional(),
});

export type PreviewGateLoginResponse = z.infer<typeof previewGateLoginResponseSchema>;
