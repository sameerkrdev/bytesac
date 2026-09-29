import { z } from "zod";

const shape = {
  rebalance: z.boolean(),
  portfolioUpdates: z.boolean(),
  managerUpdates: z.boolean(),
  offers: z.boolean(),
  productUpdates: z.boolean(),
  marketing: z.boolean(),
};

export const notificationPreferencesSchema = z.strictObject(shape);
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;

export const updateNotificationPreferencesSchema = z
  .strictObject(shape)
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "At least one preference is required" });
export type UpdateNotificationPreferences = z.infer<typeof updateNotificationPreferencesSchema>;
