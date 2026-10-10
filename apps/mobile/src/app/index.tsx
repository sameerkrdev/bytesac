import { useQuery } from "@tanstack/react-query";
import { Redirect } from "expo-router";
import { BrandedSplash } from "@/components/brand/splash";
import { useAuth } from "@/lib/auth-context";
import { previewGateEnabled, previewToken } from "@/lib/preview-gate";

export default function Index() {
  const { status } = useAuth();
  const gate = useQuery({ queryKey: ["preview-token"], queryFn: () => previewToken.get(), enabled: previewGateEnabled() });
  if (status === "loading" || gate.isLoading) return <BrandedSplash />;
  if (previewGateEnabled() && !gate.data) return <Redirect href="/(auth)/preview-access" />;
  return <Redirect href={status === "signedIn" ? "/(app)/(tabs)/home" : "/(auth)/sign-in"} />;
}
