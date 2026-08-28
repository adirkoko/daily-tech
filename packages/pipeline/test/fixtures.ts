import type { BriefArtifact } from "@daily-tech/core";

import type {
  BriefDraft,
  ResearchedStory,
  ResearchStoryInput,
  StageResult,
} from "../src/index.js";

export const firstStoryInput: ResearchStoryInput = {
  title: "מודל חדש הושק",
  factualSummary: "החברה השיקה מודל חדש למפתחים.",
  whyItMatters: "המודל מוסיף יכולות חדשות למפתחים.",
  keyFacts: ["המודל זמין למפתחים"],
  availability: "זמין כעת",
  category: "ai",
  importance: 4,
  occurredOn: "2026-08-27",
  occurredAt: "2026-08-27T10:00:00.000Z",
  eventDateEvidence: {
    eventDate: "2026-08-27",
    kind: "official_announcement_date",
    sourceUrl: "https://example.com/model",
    explanation: "ההודעה הרשמית פורסמה בתאריך היעד ומתארת את ההשקה כאירוע חדש.",
  },
  companies: ["OpenAI"],
  topics: ["AI models"],
  sources: [
    {
      url: "https://example.com/model",
      title: "Model announcement",
      publisher: "OpenAI",
      publishedOn: "2026-08-27",
      publishedAt: "2026-08-27T10:00:00.000Z",
      type: "official_blog",
    },
  ],
};

export const secondStoryInput: ResearchStoryInput = {
  title: "כלי פיתוח קיבל עדכון",
  factualSummary: "נוספה יכולת חדשה לכלי הפיתוח.",
  whyItMatters: "העדכון מקצר תהליך עבודה נפוץ.",
  keyFacts: ["היכולת זמינה בגרסה החדשה"],
  availability: "זמין בגרסה החדשה",
  category: "developer_tools",
  importance: 3,
  occurredOn: "2026-08-27",
  occurredAt: "2026-08-27T14:00:00.000Z",
  eventDateEvidence: {
    eventDate: "2026-08-27",
    kind: "release_effective_date",
    sourceUrl: "https://example.com/tool",
    explanation: "הערות הגרסה מציינות שהגרסה החדשה פורסמה בתאריך היעד.",
  },
  companies: ["Google"],
  topics: ["Developer tools"],
  sources: [
    {
      url: "https://example.com/tool",
      title: "Tool update",
      publisher: "Google",
      publishedOn: "2026-08-27",
      publishedAt: "2026-08-27T14:00:00.000Z",
      type: "release_notes",
    },
  ],
};

export const firstStory: ResearchedStory = { id: "story-1", ...firstStoryInput };
export const secondStory: ResearchedStory = { id: "story-2", ...secondStoryInput };

export const oneItemDraft: BriefDraft = {
  markdown: `# Daily Tech — 27 באוגוסט 2026

יום עם התפתחות חשובה אחת.

## ההתפתחויות המשמעותיות

### מודל חדש הושק

המודל זמין למפתחים. [OpenAI](https://example.com/model)
`,
  includedStoryIds: ["story-1"],
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
  includedStoryIds: ["story-1", "story-2"],
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
  filePath: "tech_briefs/daily/2026/august/2026-08-27/2026-08-27-tech_briefs.md",
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
