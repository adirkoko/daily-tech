# @daily-tech/pipeline

The daily brief orchestration layer for Daily Tech.

## Implemented foundation

- Previous-day windows based on `Asia/Jerusalem`, including 23-hour and 25-hour DST
  transition days.
- Separate ports for research, filtering, writing, editorial review, and missing-news
  review. Implementations can use one model while keeping agent roles isolated.
- A bounded review/revision loop with missing-item deduplication.
- Deterministic artifact validation through `@daily-tech/core` before persistence.
- Failure reporting and structured stage/run events. The sink is never called with an
  invalid or partial artifact.
- Token and provider-cost aggregation across AI stages.
- A small OpenAI-compatible chat-completions client with timeouts, cancellation, JSON
  mode, error sanitization, and caller-owned response parsing.

## Integration model

`DailyBriefPipeline` receives every external capability as a dependency. Production
adapters will connect these ports to prompts/search, filesystem + SQLite persistence,
operational logging, and system tickets. Tests use in-memory fakes and never call an
AI provider or the network.
