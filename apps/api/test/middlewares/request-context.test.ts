import { describe, expect, it } from "vitest";
import { ipPrefixOf } from "@/middlewares/request-context.middleware";

describe("ipPrefixOf", () => {
  it("IPv4 /24", () => expect(ipPrefixOf("203.0.113.77")).toBe("203.0.113.0/24"));
  it("IPv4-mapped IPv6", () => expect(ipPrefixOf("::ffff:203.0.113.77")).toBe("203.0.113.0/24"));
  it("IPv6 /48", () => expect(ipPrefixOf("2001:db8:abcd:12::1")).toBe("2001:db8:abcd::/48"));
  it("compressed IPv6", () => expect(ipPrefixOf("2001:db8::1")).toBe("2001:db8:0::/48"));
  it("garbage", () => expect(ipPrefixOf("not-an-ip")).toBeNull());
});
