import { AllocationRing } from "@/components/visual/allocation-ring";

/*
 * Illustrative app screens rendered as real code inside the device frames (never baked into images). Every size is in
 * `cqw` (percent of the screen width), so the screen scales with the device. Content is labelled as an example.
 */

const SLICES = [
  { key: "btc", label: "BTC", bps: 3500 }, { key: "eth", label: "ETH", bps: 3000 }, { key: "sol", label: "SOL", bps: 2000 }, { key: "rwa", label: "T-bills", bps: 1500 },
];

/** An example basket screen: name, target ring, weights and the two choices of a version update. */
export function ExampleBasketScreen() {
  return (
    <div className="flex h-full flex-col bg-[#F7F8FA] px-[7cqw] pt-[17cqw] pb-[8cqw] text-[#0F1E3A]" style={{ fontSize: "4.4cqw" }}>
      <div className="flex items-center justify-between text-[#68728A]" style={{ fontSize: "3.4cqw" }}>
        <span className="font-mono tracking-[0.08em] uppercase">Example basket</span>
        <span className="rounded-full bg-[#E8EEFC] px-[2.6cqw] py-[0.8cqw] font-mono text-[#3D63D9]">v3</span>
      </div>
      <p className="mt-[3cqw] leading-tight font-light tracking-tight" style={{ fontSize: "8.2cqw" }}>Core Crypto Index</p>
      <p className="mt-[1.5cqw] text-[#56627A]" style={{ fontSize: "3.6cqw" }}>By an example organization</p>
      <div className="mt-[7cqw] grid place-items-center">
        <div style={{ width: "58cqw" }}>
          <AllocationRing slices={SLICES} size={240} thickness={22} className="!size-full aspect-square [&>svg]:size-full" label="Example target allocation">
            <div className="text-center"><p className="font-light" style={{ fontSize: "9cqw" }}>4</p><p className="text-[#56627A]" style={{ fontSize: "3.2cqw" }}>assets</p></div>
          </AllocationRing>
        </div>
      </div>
      <ul className="mt-[7cqw] space-y-[2.4cqw]">
        {SLICES.map((s) => (
          <li key={s.key} className="flex items-center justify-between border-b border-[#E2E7EF] pb-[2.4cqw]">
            <span>{s.label}</span><span className="font-mono">{s.bps / 100}%</span>
          </li>
        ))}
      </ul>
      <div className="mt-auto grid gap-[2.4cqw]" style={{ fontSize: "3.8cqw" }}>
        <span className="grid place-items-center rounded-full bg-[#1C2B4A] py-[3.4cqw] text-white">Review update</span>
        <span className="grid place-items-center rounded-full border border-[#CBD3DF] py-[3.4cqw] text-[#56627A]">Skip this version</span>
      </div>
    </div>
  );
}
