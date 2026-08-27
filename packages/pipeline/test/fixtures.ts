import type { BriefArtifact } from "@daily-tech/core";

import type {
  BriefDraft,
  ResearchCandidate,
  StageResult,
} from "../src/index.js";

export const firstCandidate: ResearchCandidate = {
  id: "model-launch",
  headline: "מודל חדש הושק",
  summary: "החברה השיקה מודל חדש למפתחים.",
  occurredAt: "2026-08-27T10:00:00.000Z",
  companies: ["OpenAI"],
  topics: ["AI models"],
  sources: [
    {
      url: "https://example.com/model",
      title: "Model announcement",
      publisher: "OpenAI",
      publishedAt: "2026-08-27T10:00:00.000Z",
      type: "official_blog",
    },
  ],
};

export const secondCandidate: ResearchCandidate = {
  id: "tool-update",
  headline: "כלי פיתוח קיבל עדכון",
  summary: "נוספה יכולת חדשה לכלי הפיתוח.",
  occurredAt: "2026-08-27T14:00:00.000Z",
  companies: ["Google"],
  topics: ["Developer tools"],
  sources: [
    {
      url: "https://example.com/tool",
      title: "Tool update",
      publisher: "Google",
      publishedAt: "2026-08-27T14:00:00.000Z",
      type: "release_notes",
    },
  ],
};

export const oneItemDraft: BriefDraft = {
  markdown: `# Daily Tech — 27 באוגוסט 2026

יום עם התפתחות חשובה אחת.

## ההתפתחויות המשמעותיות

### מודל חדש הושק

המודל זמין למפתחים. [OpenAI](https://example.com/model)
`,
  metadata: {
    summary: "יום עם התפתחות חשובה אחת.",
    significant_items: 1,
    worth_watching_items: 0,
    day_intensity: "medium",
    companies: ["OpenAI"],
    topics: ["AI models"],
    developments: ["מודל חדש הושק"],
  },
};

export const twoItemDraft: BriefDraft = {
  markdown: `# Daily Tech — 27 באוגוסט 2026

יום עם שתי התפתחויות חשובות.

## ההתפתחויות המשמעותיות

### מודל חדש הושק

המודל זמין למפתחים. [OpenAI](https://example.com/model)

### כלי פיתוח קיבל עדכון

נוספה יכולת חדשה. [Google](https://example.com/tool)
`,
  metadata: {
    summary: "יום עם שתי התפתחויות חשובות.",
    significant_items: 2,
    worth_watching_items: 0,
    day_intensity: "high",
    companies: ["OpenAI", "Google"],
    topics: ["AI models", "Developer tools"],
    developments: ["מודל חדש הושק", "כלי פיתוח קיבל עדכון"],
  },
};

export function stageResult<T>(value: T): StageResult<T> {
  return { value };
}

export const validArtifact: BriefArtifact = {
  filePath:
    "tech_briefs/daily/2026/august/2026-08-27/2026-08-27-tech_briefs.md",
  content: oneItemDraft.markdown,
  metadata: {
    date: "2026-08-27",
    ...oneItemDraft.metadata,
    status: "ready",
    source_count: 1,
    created_at: "2026-08-28T01:00:00.000Z",
    published_at: null,
    updated_at: null,
  },
};
