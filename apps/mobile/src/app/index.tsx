import { Redirect } from "expo-router";
import { BrandedSplash } from "@/components/brand/splash";
import { useAuth } from "@/lib/auth-context";

export default function Index() {
  const { status } = useAuth();
  if (status === "loading") return <BrandedSplash />;
  return <Redirect href={status === "signedIn" ? "/(app)/(tabs)/home" : "/(auth)/sign-in"} />;
}
