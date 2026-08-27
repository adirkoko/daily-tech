import { describe, expect, it, vi } from "vitest";

import {
  AiProviderError,
  InvalidAiResponseError,
  OpenAiCompatibleClient,
  parseJsonCompletion,
} from "../src/index.js";

describe("OpenAiCompatibleClient", () => {
  it("calls the chat-completions API and maps usage", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "test-model-1",
          choices: [{ message: { content: "{\"approved\":true}" } }],
          usage: {
            prompt_tokens: 12,
            completion_tokens: 4,
            total_tokens: 16,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const client = new OpenAiCompatibleClient({
      apiKey: "secret-key",
      model: "test-model",
      baseUrl: "https://provider.example/v1/",
      fetch: fetchMock,
    });

    const completion = await client.complete({
      messages: [{ role: "user", content: "Review this" }],
      responseFormat: "json",
      temperature: 0,
    });

    expect(completion).toEqual({
      content: "{\"approved\":true}",
      model: "test-model-1",
      usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://provider.example/v1/chat/completions");
    expect(init?.headers).toEqual(
      expect.objectContaining({ authorization: "Bearer secret-key" }),
    );
    expect(JSON.parse(String(init?.body))).toEqual(
      expect.objectContaining({
        model: "test-model",
        response_format: { type: "json_object" },
      }),
    );
  });

  it("surfaces provider errors without exposing request credentials", async () => {
    const client = new OpenAiCompatibleClient({
      apiKey: "do-not-leak",
      model: "test-model",
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        new Response("rate limited", { status: 429 }),
      ),
    });

    const error = await client
      .complete({ messages: [{ role: "user", content: "Hello" }] })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AiProviderError);
    expect((error as AiProviderError).status).toBe(429);
    expect((error as Error).message).toContain("rate limited");
    expect((error as Error).message).not.toContain("do-not-leak");
  });

  it("rejects malformed success responses", async () => {
    const client = new OpenAiCompatibleClient({
      apiKey: "key",
      model: "test-model",
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ choices: [] }), { status: 200 }),
      ),
    });

    await expect(
      client.complete({ messages: [{ role: "user", content: "Hello" }] }),
    ).rejects.toBeInstanceOf(InvalidAiResponseError);
  });

  it("classifies a non-JSON success body as an invalid AI response", async () => {
    const client = new OpenAiCompatibleClient({
      apiKey: "key",
      model: "test-model",
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        new Response("not-json", { status: 200 }),
      ),
    });

    await expect(
      client.complete({ messages: [{ role: "user", content: "Hello" }] }),
    ).rejects.toBeInstanceOf(InvalidAiResponseError);
  });

  it("parses typed JSON through a caller-owned parser", () => {
    const parsed = parseJsonCompletion(
      {
        content: "{\"approved\":true}",
        model: "test-model",
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      },
      (value) => {
        if (
          typeof value !== "object" ||
          value === null ||
          !("approved" in value) ||
          typeof value.approved !== "boolean"
        ) {
          throw new TypeError("approved is required");
        }
        return { approved: value.approved };
      },
    );

    expect(parsed).toEqual({ approved: true });
  });

  it("validates client and request configuration", async () => {
    expect(
      () => new OpenAiCompatibleClient({ apiKey: "", model: "test" }),
    ).toThrow(TypeError);
    const client = new OpenAiCompatibleClient({ apiKey: "key", model: "test" });
    await expect(client.complete({ messages: [] })).rejects.toThrow(TypeError);
    await expect(
      client.complete({
        messages: [{ role: "user", content: "Hello" }],
        temperature: 3,
      }),
    ).rejects.toThrow(RangeError);
  });
});
