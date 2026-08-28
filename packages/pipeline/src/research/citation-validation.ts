import type { ProviderCitation } from "../ai/contracts.js";

const TRACKING_PARAMETERS = new Set([
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "ref",
  "ref_src",
]);

export class CitationIndex {
  readonly #byUrl: ReadonlyMap<string, ProviderCitation>;

  constructor(citations: readonly ProviderCitation[]) {
    if (citations.length === 0) throw new TypeError("At least one provider citation is required.");
    const byUrl = new Map<string, ProviderCitation>();
    for (const citation of citations) {
      byUrl.set(canonicalizeUrl(citation.url), citation);
    }
    this.#byUrl = byUrl;
  }

  require(url: string): string {
    const canonical = canonicalizeUrl(url);
    if (!this.#byUrl.has(canonical)) {
      throw new TypeError("Source URL was not present in provider citations.");
    }
    return canonical;
  }
}

export function canonicalizeUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError("Source URL must use HTTP or HTTPS.");
  }
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === "https:" && url.port === "443") ||
      (url.protocol === "http:" && url.port === "80")) {
    url.port = "";
  }
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("utm_") || TRACKING_PARAMETERS.has(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/u, "");
  return url.toString();
}
