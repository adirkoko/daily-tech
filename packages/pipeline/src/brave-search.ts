import { isCalendarDate } from "@daily-tech/core";

import type {
  NewsSearchProvider,
  NewsSearchRequest,
  SearchHit,
} from "./agents.js";

export interface BraveSearchProviderOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly country?: string;
  readonly searchLanguage?: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch;
}

export class SearchProviderError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null, cause?: unknown) {
    super(message, { cause });
    this.name = "SearchProviderError";
    this.status = status;
  }
}

export class BraveSearchProvider implements NewsSearchProvider {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #country: string;
  readonly #searchLanguage: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: BraveSearchProviderOptions) {
    if (options.apiKey.trim().length === 0) {
      throw new TypeError("apiKey cannot be empty.");
    }
    this.#apiKey = options.apiKey;
    this.#baseUrl = (
      options.baseUrl ?? "https://api.search.brave.com/res/v1/web/search"
    ).replace(/\/+$/u, "");
    const parsedUrl = new URL(this.#baseUrl);
    if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
      throw new TypeError("baseUrl must use HTTP or HTTPS.");
    }
    this.#country = options.country ?? "ALL";
    this.#searchLanguage = options.searchLanguage ?? "en";
    this.#timeoutMs = options.timeoutMs ?? 30_000;
    if (!Number.isInteger(this.#timeoutMs) || this.#timeoutMs < 1) {
      throw new RangeError("timeoutMs must be a positive integer.");
    }
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async search(request: NewsSearchRequest): Promise<readonly SearchHit[]> {
    validateRequest(request);
    const url = new URL(this.#baseUrl);
    url.search = new URLSearchParams({
      q: request.query,
      count: String(request.limit),
      country: this.#country,
      search_lang: this.#searchLanguage,
      ui_lang: "en-US",
      safesearch: "moderate",
      freshness: `${request.date}to${request.date}`,
      result_filter: "web,news",
      text_decorations: "false",
      spellcheck: "true",
    }).toString();

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), this.#timeoutMs);
    try {
      const response = await this.#fetch(url, {
        headers: {
          accept: "application/json",
          "x-subscription-token": this.#apiKey,
          "x-loc-timezone": "Asia/Jerusalem",
        },
        signal: abortController.signal,
      });
      if (!response.ok) {
        const body = (await response.text()).slice(0, 500);
        throw new SearchProviderError(
          `Search provider returned HTTP ${response.status}${body ? `: ${body}` : "."}`,
          response.status,
        );
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch (error) {
        throw new SearchProviderError(
          "Search provider returned invalid JSON.",
          response.status,
          error,
        );
      }
      return parseSearchResponse(payload, request.limit);
    } catch (error) {
      if (error instanceof SearchProviderError) {
        throw error;
      }
      const message = abortController.signal.aborted
        ? "Search provider request timed out."
        : "Search provider request failed.";
      throw new SearchProviderError(message, null, error);
    } finally {
      clearTimeout(timeout);
    }
  }
}

function parseSearchResponse(payload: unknown, limit: number): readonly SearchHit[] {
  const root = asRecord(payload);
  const resultGroups = [
    resultArray(root.web),
    resultArray(root.news),
  ];
  const byUrl = new Map<string, SearchHit>();
  const longestGroup = Math.max(...resultGroups.map(({ length }) => length));
  for (let index = 0; index < longestGroup; index += 1) {
    for (const group of resultGroups) {
      const result = group[index];
      if (result === undefined) {
        continue;
      }
      const hit = mapSearchResult(result);
      if (hit !== null && !byUrl.has(hit.url)) {
        byUrl.set(hit.url, hit);
        if (byUrl.size === limit) {
          return [...byUrl.values()];
        }
      }
    }
  }
  return [...byUrl.values()];
}

function mapSearchResult(result: Record<string, unknown>): SearchHit | null {
  const url = optionalString(result.url);
  const title = optionalString(result.title);
  if (url === null || title === null || !isHttpUrl(url)) {
    return null;
  }
  const profile = asRecordOrNull(result.profile);
  const publisher =
    optionalString(profile?.long_name) ??
    optionalString(profile?.name) ??
    new URL(url).hostname;
  const snippet =
    optionalString(result.description) ??
    (Array.isArray(result.extra_snippets)
      ? result.extra_snippets
          .filter((value): value is string => typeof value === "string")
          .join(" ")
      : null) ??
    title;
  return {
    url,
    title,
    snippet,
    publisher,
    publishedAt: normalizeTimestamp(result.page_age),
  };
}

function resultArray(value: unknown): readonly Record<string, unknown>[] {
  const group = asRecordOrNull(value);
  return Array.isArray(group?.results)
    ? group.results.filter(
        (result): result is Record<string, unknown> => asRecordOrNull(result) !== null,
      )
    : [];
}

function normalizeTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  const withZone = /(?:Z|[+-]\d{2}:?\d{2})$/u.test(value) ? value : `${value}Z`;
  const parsed = new Date(withZone);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function validateRequest(request: NewsSearchRequest): void {
  const query = request.query.trim();
  if (query.length === 0 || query.length > 400 || query.split(/\s+/u).length > 50) {
    throw new RangeError("query must contain 1-400 characters and at most 50 words.");
  }
  if (!isCalendarDate(request.date)) {
    throw new TypeError("date must use YYYY-MM-DD format.");
  }
  if (!Number.isInteger(request.limit) || request.limit < 1 || request.limit > 20) {
    throw new RangeError("Brave Search limit must be an integer between 1 and 20.");
  }
  if (
    Number.isNaN(request.start.getTime()) ||
    Number.isNaN(request.endExclusive.getTime()) ||
    request.start >= request.endExclusive
  ) {
    throw new RangeError("Search time window is invalid.");
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return asRecordOrNull(value) ?? {};
}

function asRecordOrNull(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}
