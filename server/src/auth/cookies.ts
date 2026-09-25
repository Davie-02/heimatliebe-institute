/** Shared by anything that needs to read a single cookie by name from a raw
 * Cookie header — the CSRF check, JwtAuthGuard and the optional student guard
 * all parse cookies the same way, so this is the one place that does it. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    return decodeURIComponent(part.slice(separator + 1).trim());
  }

  return undefined;
}
