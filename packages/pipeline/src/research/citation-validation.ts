import type { ProviderCitation } from "../ai/contracts.js";

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

  require(url: string, path = "source.url"): string {
    let canonical: string;
    try {
      canonical = canonicalizeUrl(url);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "invalid URL";
      throw new TypeError(`${path} is invalid (${reason}); value=${displayValue(url)}`, {
        cause: error,
      });
    }
    if (!this.#byUrl.has(canonical)) {
      throw new TypeError(
        `${path} was not present in provider citations; value=${displayValue(url)}; canonical=${displayValue(canonical)}`,
      );
    }
    return canonical;
  }
}

function displayValue(value: string): string {
  const maximumLength = 500;
  const shortened = value.length > maximumLength
    ? `${value.slice(0, maximumLength)}…`
    : value;
  return JSON.stringify(shortened);
}

/**
 * Deliberately structural only: protocol, host, default port, trailing slash,
 * fragment. No tracking-parameter stripping — that defends against a superficial
 * URL mismatch that has no evidence of actually happening, at the cost of a
 * hand-maintained list that's always incomplete.
 */
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
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/u, "");
  return url.toString();
}
