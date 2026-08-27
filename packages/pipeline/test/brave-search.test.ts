import { describe, expect, it, vi } from "vitest";

import {
  BraveSearchProvider,
  SearchProviderError,
  type NewsSearchRequest,
} from "../src/index.js";

const request: NewsSearchRequest = {
  query: "major technology launch",
  date: "2026-08-27",
  start: new Date("2026-08-26T21:00:00.000Z"),
  endExclusive: new Date("2026-08-27T21:00:00.000Z"),
  limit: 10,
};

describe("BraveSearchProvider", () => {
  it("uses exact-date freshness and maps web/news results", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          web: {
            results: [
              {
                title: "Official announcement",
                url: "https://company.example/news",
                description: "A product was launched.",
                page_age: "2026-08-27T10:00:00",
                profile: { long_name: "Example Company" },
              },
            ],
          },
          news: {
            results: [
              {
                title: "News coverage",
                url: "https://news.example/story",
                description: "Coverage of the launch.",
                page_age: "2026-08-27T11:00:00Z",
              },
              {
                title: "Duplicate",
                url: "https://company.example/news",
                description: "Duplicate URL.",
              },
            ],
          },
        }),
        { status: 200 },
      ),
    );
    const provider = new BraveSearchProvider({
      apiKey: "brave-secret",
      fetch: fetchMock,
    });

    const results = await provider.search(request);

    expect(results).toEqual([
      {
        title: "Official announcement",
        url: "https://company.example/news",
        snippet: "A product was launched.",
        publisher: "Example Company",
        publishedAt: "2026-08-27T10:00:00.000Z",
      },
      {
        title: "News coverage",
        url: "https://news.example/story",
        snippet: "Coverage of the launch.",
        publisher: "news.example",
        publishedAt: "2026-08-27T11:00:00.000Z",
      },
    ]);
    const [calledUrl, init] = fetchMock.mock.calls[0] ?? [];
    const url = new URL(String(calledUrl));
    expect(url.searchParams.get("freshness")).toBe(
      "2026-08-27to2026-08-27",
    );
    expect(url.searchParams.get("result_filter")).toBe("web,news");
    expect(init?.headers).toEqual(
      expect.objectContaining({ "x-subscription-token": "brave-secret" }),
    );
  });

  it("surfaces HTTP errors without exposing the API key", async () => {
    const provider = new BraveSearchProvider({
      apiKey: "do-not-leak",
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        new Response("rate limited", { status: 429 }),
      ),
    });

    const error = await provider.search(request).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SearchProviderError);
    expect((error as SearchProviderError).status).toBe(429);
    expect((error as Error).message).not.toContain("do-not-leak");
  });

  it("validates provider configuration and Brave request limits", async () => {
    expect(() => new BraveSearchProvider({ apiKey: "" })).toThrow(TypeError);
    const provider = new BraveSearchProvider({ apiKey: "key" });
    await expect(provider.search({ ...request, limit: 21 })).rejects.toThrow(
      RangeError,
    );
    await expect(provider.search({ ...request, query: " " })).rejects.toThrow(
      RangeError,
    );
  });
});
