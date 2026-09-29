export class DeliveryError extends Error {
  constructor(message: string, options?: { cause?: unknown }) { super(message, options); this.name = "DeliveryError"; }
}
export interface EmailSender { sendOtp(input: { to: string; code: string }): Promise<void> }
