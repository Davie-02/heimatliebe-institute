import { BadRequestException } from "@nestjs/common";
import { cleanContent } from "./site-content.service";
import { SITE_DEFAULTS } from "./defaults";

describe("cleanContent", () => {
  it("accepts values shaped like the defaults", () => {
    const out = cleanContent(SITE_DEFAULTS, { heroTagline: "  Hello  ", stats: [{ num: "5", label: "Levels" }] });
    expect(out).toEqual({ heroTagline: "Hello", stats: [{ num: "5", label: "Levels" }] });
  });

  it("refuses unknown settings and wrong kinds of values", () => {
    expect(() => cleanContent(SITE_DEFAULTS, { secretFlag: true })).toThrow(BadRequestException);
    expect(() => cleanContent(SITE_DEFAULTS, { heroTagline: 5 })).toThrow(BadRequestException);
    expect(() => cleanContent(SITE_DEFAULTS, { stats: [{ num: "1", label: "x", extra: "y" }] })).toThrow(BadRequestException);
  });

  it("only allows safe links", () => {
    expect(() => cleanContent(SITE_DEFAULTS, { socialFacebook: "javascript:alert(1)" })).toThrow(BadRequestException);
    expect(cleanContent(SITE_DEFAULTS, { socialFacebook: "https://facebook.com/heimatliebe" })).toEqual({ socialFacebook: "https://facebook.com/heimatliebe" });
  });
});
