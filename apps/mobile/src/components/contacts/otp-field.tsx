import { normalizeOtp } from "@repo/api-client";
import { TextField } from "@/components/ui/text-field";

export function OtpField({ value, onChange }: { value: string; onChange(v: string): void }) {
  return (
    <TextField label="6-digit code" value={value} onChangeText={(t) => onChange(normalizeOtp(t))}
      keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="sms-otp" maxLength={9} />
  );
}
