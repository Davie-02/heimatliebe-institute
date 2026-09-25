import { createHmac } from "crypto";
import { isPrivateAddress, signPayload } from "./webhooks.service";

describe("webhooks", () => {
  it("blocks private and local addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.0.10", "172.20.0.1", "169.254.169.254", "::1", "fd00::1", "::ffff:127.0.0.1"]) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
    expect(isPrivateAddress("41.70.12.4")).toBe(false);
    expect(isPrivateAddress("2a00:1450:4001:80b::200e")).toBe(false);
  });

  it("signs timestamp and body together", () => {
    const expected = createHmac("sha256", "s3cret").update("1700000000.{\"a\":1}").digest("hex");
    expect(signPayload("s3cret", "1700000000", "{\"a\":1}")).toBe(expected);
  });
});
