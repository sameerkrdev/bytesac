/** BullMQ bundles its own ioredis; pass connection options (not an instance) to avoid version mismatch. */
export function redisOptionsFromUrl(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname.replace(/^\[|\]$/g, ""),
    port: Number(u.port || 6379),
    username: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname.length > 1 ? Number(u.pathname.slice(1)) : undefined,
    tls: u.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}
