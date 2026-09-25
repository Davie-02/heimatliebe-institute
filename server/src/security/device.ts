/**
 * A short, human description of the browser and system in a User-Agent
 * header ("Chrome on Android"), for sign-in alert emails. Deliberately
 * rough — it only has to be recognisable to the account owner.
 */
export function describeDevice(userAgent: string | undefined): string {
  const ua = userAgent ?? "";
  if (!ua) return "Unknown device";

  const browser =
    /Edg\//.test(ua) ? "Edge"
    : /OPR\/|Opera/.test(ua) ? "Opera"
    : /SamsungBrowser/.test(ua) ? "Samsung Internet"
    : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari"
    : "A browser";

  const system =
    /iPhone|iPad|iPod/.test(ua) ? "iPhone/iPad"
    : /Android/.test(ua) ? "Android"
    : /Windows/.test(ua) ? "Windows"
    : /Mac OS X|Macintosh/.test(ua) ? "Mac"
    : /Linux/.test(ua) ? "Linux"
    : "an unknown system";

  return `${browser} on ${system}`;
}
