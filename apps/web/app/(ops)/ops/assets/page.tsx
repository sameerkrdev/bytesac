import { Suspense } from "react";
import { AssetsTable } from "@/components/ops/assets/assets-table";

export default function OpsAssetsPage() {
  return <Suspense><AssetsTable /></Suspense>; // useSearchParams needs a Suspense boundary
}
