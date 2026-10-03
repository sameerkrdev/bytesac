"use client";

import type { ApiClient } from "@repo/api-client";
import { useQuery } from "@tanstack/react-query";
import { toDisplayError } from "@/lib/errors";
import { LoadingState } from "@/components/layout/states";

/** How holders responded to each published version. Counts only; a cell of 1 to 4 reads "<5" so no individual can be picked out. */
export function Adoption({ bid, client }: { bid: string; client: Pick<ApiClient, "basketAdoption"> }) {
  const q = useQuery({ queryKey: ["basket", bid, "adoption"], queryFn: () => client.basketAdoption(bid), retry: false });
  if (q.isError) return <p role="alert" className="text-sm text-danger">{toDisplayError(q.error).title}</p>;
  if (!q.data) return <LoadingState />;
  if (q.data.versions.length === 0) return <p className="text-sm text-stone">No versions are published yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Adoption by version</caption>
        <thead className="text-xs text-stone">
          <tr>{["Version", "Open positions", "Applied", "Skipped", "Not responded", "In progress"].map((h) => <th key={h} scope="col" className="py-2 pr-4 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody className="text-ivory">
          {q.data.versions.map((v) => (
            <tr key={v.versionId} className="border-t border-border-dark">
              <th scope="row" className="py-2 pr-4 font-medium">Version {v.versionNumber}</th>
              <td className="pr-4">{v.openPositions}</td><td className="pr-4">{v.applied}</td><td className="pr-4">{v.skipped}</td><td className="pr-4">{v.notResponded}</td><td>{v.inProgress}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
