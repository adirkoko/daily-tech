import { describe, expect, it, vi } from "vitest";

import {
  InvalidAiResponseError,
  OpenAiCompatibleCompletionClient,
  OpenAiResponsesWebResearchClient,
  parseResponsesPayload,
} from "../src/index.js";

describe("AI clients", () => {
  it("maps a compatible chat completion for writing", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({
        model: "writer-model",
        choices: [{ message: { content: "{\"markdown\":\"ok\"}" } }],
        usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
      }), { status: 200 }),
    );
    const client = new OpenAiCompatibleCompletionClient({
      apiKey: "secret",
      model: "writer-model",
      baseUrl: "https://provider.example/v1/",
      fetch: fetchMock,
    });

    await expect(client.complete({
      messages: [{ role: "user", content: "write" }],
      responseFormat: "json",
    })).resolves.toMatchObject({
      content: "{\"markdown\":\"ok\"}",
      usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 },
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://provider.example/v1/chat/completions");
  });

  it("forces a web-search tool and strict structured output in Responses API", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(responsesPayload()), { status: 200 }),
    );
    const client = new OpenAiResponsesWebResearchClient({
      apiKey: "secret",
      model: "research-model",
      fetch: fetchMock,
    });

    const result = await client.execute({
      instructions: "Research the target day.",
      input: { date: "2026-08-27" },
      schemaName: "research",
      schema: { type: "object" },
    });

    expect(result).toMatchObject({
      content: "{\"stories\":[]}",
      webSearchCalls: 1,
      citations: [{ url: "https://example.com/news", title: "News" }],
      usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      tools: [{ type: "web_search" }],
      tool_choice: "required",
      include: ["web_search_call.action.sources"],
      text: { format: { type: "json_schema", strict: true } },
      store: false,
    });
  });

  it("fails closed when web search or machine-readable citations are absent", () => {
    expect(() => parseResponsesPayload({
      ...responsesPayload(),
      output: [{ type: "message", content: [{ type: "output_text", text: "{}", annotations: [] }] }],
    })).toThrow(InvalidAiResponseError);
    expect(() => parseResponsesPayload({
      ...responsesPayload(),
      output: [
        { type: "web_search_call", action: { sources: [] } },
        { type: "message", content: [{ type: "output_text", text: "{}", annotations: [] }] },
      ],
    })).toThrow(/citations/u);
  });
});

function responsesPayload(): Record<string, unknown> {
  return {
    status: "completed",
    model: "research-model",
    output: [
      {
        type: "web_search_call",
        action: { sources: [{ url: "https://example.com/news", title: "News" }] },
      },
      {
        type: "message",
        content: [{
          type: "output_text",
          text: "{\"stories\":[]}",
          annotations: [{
            type: "url_citation",
            url: "https://example.com/news",
            title: "News",
          }],
        }],
      },
    ],
    usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
  };
}
