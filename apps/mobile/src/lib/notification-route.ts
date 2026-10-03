import type { Href } from "expo-router";

/** Maps a notification link (a web path from the API) to the mobile route that shows the same thing. Unknown paths fall back to the portfolio. */
export function mobileRoute(link: string): Href {
  const path = link.split("?")[0]!;
  let m = /^\/portfolio\/repair\/([^/]+)$/.exec(path);
  if (m) return `/repair/${m[1]}` as Href;
  m = /^\/portfolio\/([^/]+)\/rebalance$/.exec(path);
  if (m) return `/rebalance/${m[1]}` as Href;
  m = /^\/baskets\/([^/]+)$/.exec(path);
  if (m) return `/basket/${m[1]}` as Href;
  return "/(app)/(tabs)/portfolio";
}
