import { z } from "zod";

export const waitlistJoinSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(320),
  phone: z.string().trim().max(40).optional(),
  country: z.string().trim().length(2).regex(/^[A-Za-z]{2}$/).transform((c) => c.toUpperCase()).optional(),
});

export type WaitlistJoinRequest = z.infer<typeof waitlistJoinSchema>;

export const waitlistJoinResponseSchema = z.strictObject({
  ok: z.literal(true),
  joined: z.boolean(),
  /** False when the welcome email could not be sent; it is retried on the next join with the same email. */
  emailSent: z.boolean(),
});

export type WaitlistJoinResponse = z.infer<typeof waitlistJoinResponseSchema>;
