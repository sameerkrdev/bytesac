import { Redirect } from "expo-router";
import { useAuth } from "@/lib/auth-context";

export default function Index() {
  const { status } = useAuth();
  if (status === "loading") return null;
  return <Redirect href={status === "signedIn" ? "/(app)/home" : "/(auth)/sign-in"} />;
}
