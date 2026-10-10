import { ApiError } from "@repo/api-client";
import { describeError } from "@repo/app-core";
import { previewGateLoginSchema } from "@repo/validator";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { AppText } from "@/components/ui/app-text";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Screen } from "@/components/ui/screen";
import { Sky } from "@/components/ui/sky";
import { TextField } from "@/components/ui/text-field";
import { api } from "@/lib/api";
import { previewToken } from "@/lib/preview-gate";

/** Soft launch: team preview credentials first, then the usual wallet sign-in. */
export default function PreviewAccessScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const login = useMutation({
    mutationFn: async () => {
      const parsed = previewGateLoginSchema.safeParse({ email, password });
      if (!parsed.success) throw new Error("Enter a valid email and password.");
      const res = await api.previewGateLogin(parsed.data);
      if (!res.token) throw new Error("Preview access is not available for the app.");
      await previewToken.set(res.token);
    },
    onMutate: () => setProblem(null),
    onSuccess: () => {
      qc.setQueryData(["preview-token"], "set");
      router.replace("/(auth)/sign-in");
    },
    onError: (err) => setProblem(err instanceof ApiError ? describeError(err.code).title : err.message),
  });
  return (
    <Screen edges={["left", "right", "bottom"]} backdrop={<Sky height={340} />}>
      <View className="gap-2 pt-20">
        <AppText variant="eyebrow" tone="muted">Internal preview</AppText>
        <AppText variant="display" accessibilityRole="header">Team access</AppText>
        <AppText tone="muted">Bytesac is in soft launch. Sign in with your team preview credentials, then connect your wallet.</AppText>
      </View>
      <Card className="gap-5">
        <TextField label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="username" />
        <TextField label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" textContentType="password" />
        {problem ? <AppText tone="danger" accessibilityRole="alert">{problem}</AppText> : null}
        <Button size="lg" loading={login.isPending} disabled={login.isPending} onPress={() => login.mutate()}>Continue</Button>
      </Card>
    </Screen>
  );
}
