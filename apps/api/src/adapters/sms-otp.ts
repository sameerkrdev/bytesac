export interface SmsOtpProvider {
  start(input: { to: string }): Promise<{ providerRef: string }>;
  check(input: { to: string; code: string }): Promise<"approved" | "rejected">;
}
