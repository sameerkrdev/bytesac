import { normalizeOtp } from "@repo/app-core";
import { TextField } from "@/components/ui/text-field";

export function OtpField({ value, onChange, error }: { value: string; onChange(v: string): void; error?: string | null }) {
  return (
    <TextField label="6-digit code" value={value} onChangeText={(t) => onChange(normalizeOtp(t))}
      keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="sms-otp" maxLength={9} error={error} />
  );
}
