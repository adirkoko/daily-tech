import { describe, expect, it, vi } from "vitest";

import {
  InvalidAiResponseError,
  OpenAiCompatibleCompletionClient,
  OpenAiResponsesWebResearchClient,
  parseJsonResult,
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
      responseFormat: {
        type: "json_schema",
        name: "brief",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["markdown"],
          properties: { markdown: { type: "string" } },
        },
      },
    })).resolves.toMatchObject({
      content: "{\"markdown\":\"ok\"}",
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://provider.example/v1/chat/completions");
    expect(requestBody(fetchMock)).toMatchObject({
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "brief",
          strict: true,
          schema: {
            properties: { markdown: { type: "string" } },
          },
        },
      },
    });
  });

  it("omits temperature by default, including for a default-only model", async () => {
    const fetchMock = completionFetchMock();
    const client = new OpenAiCompatibleCompletionClient({
      apiKey: "secret",
      model: "gpt-5.6-luna",
      fetch: fetchMock,
    });

    await client.complete({
      messages: [{ role: "user", content: "write" }],
    });

    const body = requestBody(fetchMock);
    expect(body).not.toHaveProperty("temperature");
  });

  it("keeps an explicit custom-temperature opt-in for a known provider need", async () => {
    const fetchMock = completionFetchMock();
    const client = new OpenAiCompatibleCompletionClient({
      apiKey: "secret",
      model: "provider-model-with-custom-temperature",
      fetch: fetchMock,
    });
    await client.complete({
      messages: [{ role: "user", content: "write" }],
      temperature: 0.2,
    });
    expect(requestBody(fetchMock)).toMatchObject({ temperature: 0.2 });
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
      citations: [{ url: "https://example.com/news", title: "News" }],
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

  it("retries a completion request once after a 429 and succeeds", async () => {
    const sleep = vi.fn(async () => undefined);
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        model: "writer-model",
        choices: [{ message: { content: "ok" } }],
      }), { status: 200 }));
    const client = new OpenAiCompatibleCompletionClient({
      apiKey: "secret",
      model: "writer-model",
      fetch: fetchMock,
      retry: { sleep },
    });

    await expect(client.complete({ messages: [{ role: "user", content: "write" }] }))
      .resolves.toMatchObject({ content: "ok" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledOnce();
  });

  it("does not retry a completion request after a non-retryable 400", async () => {
    const sleep = vi.fn(async () => undefined);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("bad request", { status: 400 }),
    );
    const client = new OpenAiCompatibleCompletionClient({
      apiKey: "secret",
      model: "writer-model",
      fetch: fetchMock,
      retry: { sleep },
    });

    await expect(client.complete({ messages: [{ role: "user", content: "write" }] }))
      .rejects.toMatchObject({ status: 400 });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries a web-research request after a 429 with the provider's Retry-After header", async () => {
    const sleep = vi.fn(async () => undefined);
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("rate limited", { status: 429, headers: { "retry-after": "2" } }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(responsesPayload()), { status: 200 }));
    const client = new OpenAiResponsesWebResearchClient({
      apiKey: "secret",
      model: "research-model",
      fetch: fetchMock,
      retry: { sleep },
    });

    const result = await client.execute({
      instructions: "Research the target day.",
      input: { date: "2026-08-27" },
      schemaName: "research",
      schema: { type: "object" },
    });

    expect(result.content).toBe("{\"stories\":[]}");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2_000, undefined);
  });

  it("retries a web-research request that returned no machine-readable citations", async () => {
    const sleep = vi.fn(async () => undefined);
    const flakyPayload = {
      ...responsesPayload(),
      output: [
        { type: "web_search_call", action: { sources: [] } },
        { type: "message", content: [{ type: "output_text", text: "{\"stories\":[]}", annotations: [] }] },
      ],
    };
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(flakyPayload), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(responsesPayload()), { status: 200 }));
    const client = new OpenAiResponsesWebResearchClient({
      apiKey: "secret",
      model: "research-model",
      fetch: fetchMock,
      retry: { sleep },
    });

    const result = await client.execute({
      instructions: "Research the target day.",
      input: { date: "2026-08-27" },
      schemaName: "research",
      schema: { type: "object" },
    });

    expect(result.content).toBe("{\"stories\":[]}");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("distinguishes invalid JSON syntax from validation after parsing", () => {
    expect(() => parseJsonResult("not-json", () => null)).toThrowError(
      new InvalidAiResponseError("AI response content was not valid JSON."),
    );
    expect(() => parseJsonResult("{}", () => {
      throw new TypeError("schema field is missing");
    })).toThrowError(TypeError);
    expect(() => parseJsonResult("{}", () => {
      throw new TypeError("schema field is missing");
    })).toThrow(/schema field is missing/u);
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

function completionFetchMock(): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify({
      model: "writer-model",
      choices: [{ message: { content: "ok" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }), { status: 200 }),
  );
}

function requestBody(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>): Record<string, unknown> {
  return JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
}
