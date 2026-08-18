// Normalizes URLs (strips tracking params, fragment, default port, trailing
// slash, lowercases host) purely for duplicate-Resource detection before
// saving - two links that differ only by a utm_source param or a trailing
// slash should be treated as the same saved Resource.
export function normalizeResourceUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";

  const removableParams = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "fbclid",
    "gclid"
  ];

  for (const param of removableParams) {
    parsed.searchParams.delete(param);
  }

  if (
    (parsed.protocol === "https:" && parsed.port === "443") ||
    (parsed.protocol === "http:" && parsed.port === "80")
  ) {
    parsed.port = "";
  }

  parsed.hostname = parsed.hostname.toLowerCase();

  if (parsed.pathname !== "/") {
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  }

  return parsed.toString();
}

export function urlsMatch(a: string, b: string): boolean {
  try {
    return normalizeResourceUrl(a) === normalizeResourceUrl(b);
  } catch {
    return a.trim() === b.trim();
  }
}

