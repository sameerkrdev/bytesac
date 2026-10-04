import { Suspense, type ReactNode } from "react";
import { WorkspaceLayout } from "@/components/organization/workspace-layout";

/** Every manager workspace page shares the sidebar frame. `useSearchParams` (org switcher) needs the Suspense boundary. */
export default function OrganizationLayout({ children }: { children: ReactNode }) {
  return <Suspense><WorkspaceLayout>{children}</WorkspaceLayout></Suspense>;
}
