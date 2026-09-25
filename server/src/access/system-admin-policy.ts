/**
 * Extra rules for system administrator (OWNER) accounts — the keys to everything:
 *  - two-step verification is mandatory (SYSTEM_ADMIN_REQUIRE_2FA, on unless set to "false");
 *    until it is set up, only the routes needed to set it up work;
 *  - optionally, they may only be used from listed network addresses
 *    (SYSTEM_ADMIN_ALLOWED_IPS="41.70.1.2, 102.68.3.4");
 *  - no "keep me signed in", and they sign in only through their own portal (/admin/login).
 */
export function ownerTwoFactorRequired(): boolean {
  return (process.env.SYSTEM_ADMIN_REQUIRE_2FA ?? "true").toLowerCase() !== "false";
}

/** Routes an owner may use before finishing two-step setup. */
const SETUP_ROUTES = /^\/(api\/)?auth\/(session|logout|2fa\/setup|2fa\/enable|change-password|sign-out-everywhere)\/?$/;

export function allowedBeforeTwoFactorSetup(path: string): boolean {
  return SETUP_ROUTES.test(path);
}

export function ownerIpAllowed(ip: string | undefined): boolean {
  const list = (process.env.SYSTEM_ADMIN_ALLOWED_IPS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (list.length === 0) return true;
  const clean = (ip ?? "").replace(/^::ffff:/, "");
  return list.includes(clean);
}
