import { Download, Smartphone } from "lucide-react";
import { ExampleBasketScreen } from "@/components/visual/phone-screens";
import { Phone } from "@/components/visual/scenery";
import { cn } from "@/lib/utils";

/*
 * Mobile app call to action. Store links come from NEXT_PUBLIC_IOS_APP_URL / NEXT_PUBLIC_ANDROID_APP_URL; until the app
 * is published those are unset and the buttons say "Coming soon" instead of linking anywhere.
 */
const STORES = [
  { key: "ios", label: "App Store", platform: "iPhone", url: process.env.NEXT_PUBLIC_IOS_APP_URL },
  { key: "android", label: "Google Play", platform: "Android", url: process.env.NEXT_PUBLIC_ANDROID_APP_URL },
] as const;

/** The pair of store buttons; reusable in the footer, on home and in the dedicated section. */
export function StoreButtons({ className, size = "md" }: { className?: string; size?: "sm" | "md" }) {
  const base = cn("inline-flex items-center gap-2.5 rounded-control border transition-colors", size === "sm" ? "min-h-10 px-3 text-xs" : "min-h-12 px-4 text-sm");
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {STORES.map((s) => s.url ? (
        <a key={s.key} href={s.url} rel="noopener" className={cn(base, "border-primary bg-primary text-primary-ink hover:bg-primary-hover")}>
          <Download aria-hidden className="size-4" />
          <span className="text-left leading-tight"><span className="block text-[0.625rem] opacity-75">Download on</span>{s.label}</span>
        </a>
      ) : (
        <span key={s.key} className={cn(base, "border-line bg-surface text-ink-muted")} aria-label={`${s.label}: coming soon`}>
          <Smartphone aria-hidden className="size-4" />
          <span className="text-left leading-tight"><span className="block text-[0.625rem] text-ink-faint">Coming soon</span>{s.label}</span>
        </span>
      ))}
    </div>
  );
}

/** A dedicated, compact band: the phone, one line of why, the store buttons. */
export function DownloadApp({ className, headingLevel: H = "h2" }: { className?: string; headingLevel?: "h2" | "h3" }) {
  return (
    <section aria-labelledby="download-app-title" className={cn("relative isolate overflow-hidden rounded-shell border border-line bg-surface", className)}>
      <div aria-hidden className="sky-field absolute inset-y-0 right-0 -z-10 hidden w-1/2 opacity-60 [mask-image:linear-gradient(90deg,transparent,#000_40%)] md:block" />
      <div className="grid items-center gap-8 p-7 sm:p-10 md:grid-cols-[minmax(0,1fr)_auto] md:py-0 md:pr-16">
        <div className="max-w-md space-y-4 md:py-12">
          <p className="type-eyebrow text-ink-faint">Bytesac on your phone</p>
          <H id="download-app-title" className="type-title text-ink">Follow your baskets from your pocket.</H>
          <p className="text-ink-muted">Get a notice when a manager publishes a new version, see what changed, and decide whether to take part.</p>
          <StoreButtons className="pt-2" />
        </div>
        <div className="mx-auto w-40 translate-y-10 sm:w-48 md:translate-y-16">
          <Phone screen={<ExampleBasketScreen />} sizes="192px" />
        </div>
      </div>
    </section>
  );
}
