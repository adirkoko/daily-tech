import type { BriefArtifact } from "@daily-tech/core";

import {
  renderBriefMarkdown,
  type BriefDraft,
  type CandidateStory,
  type CandidateStoryInput,
  type DeepResearchedStory,
  type DeepResearchedStoryInput,
} from "../src/index.js";

export const firstCandidateInput: CandidateStoryInput = {
  title: "מודל חדש הושק",
  shortSummary: "החברה השיקה מודל חדש למפתחים.",
  category: "ai",
  importance: 4,
  occurredOn: "2026-08-27",
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
      type: "official_blog",
    },
  ],
};

export const secondCandidateInput: CandidateStoryInput = {
  title: "כלי פיתוח קיבל עדכון",
  shortSummary: "נוספה יכולת חדשה לכלי הפיתוח.",
  category: "developer_tools",
  importance: 3,
  occurredOn: "2026-08-27",
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
      type: "release_notes",
    },
  ],
};

export const firstCandidate: CandidateStory = { id: "story-1", ...firstCandidateInput };
export const secondCandidate: CandidateStory = { id: "story-2", ...secondCandidateInput };

export const firstDeepStoryInput: DeepResearchedStoryInput = {
  candidateId: "story-1",
  title: "מודל חדש הושק",
  whatHappened: "החברה השיקה מודל חדש למפתחים.",
  whatChangedFromBefore: null,
  technicalDetails: null,
  capabilities: null,
  pricing: null,
  availability: "זמין כעת",
  rollout: null,
  supportedUsersOrPlatforms: null,
  limitations: null,
  whoIsAffected: null,
  whyItMatters: "המודל מוסיף יכולות חדשות למפתחים.",
  whatToDoWithItNow: null,
  category: "ai",
  importance: 4,
  occurredOn: "2026-08-27",
  eventDateEvidence: firstCandidateInput.eventDateEvidence,
  companies: ["OpenAI"],
  topics: ["AI models"],
  sources: firstCandidateInput.sources,
};

export const secondDeepStoryInput: DeepResearchedStoryInput = {
  candidateId: "story-2",
  title: "כלי פיתוח קיבל עדכון",
  whatHappened: "נוספה יכולת חדשה לכלי הפיתוח.",
  whatChangedFromBefore: null,
  technicalDetails: null,
  capabilities: null,
  pricing: null,
  availability: "זמין בגרסה החדשה",
  rollout: null,
  supportedUsersOrPlatforms: null,
  limitations: null,
  whoIsAffected: null,
  whyItMatters: "העדכון מקצר תהליך עבודה נפוץ.",
  whatToDoWithItNow: null,
  category: "developer_tools",
  importance: 3,
  occurredOn: "2026-08-27",
  eventDateEvidence: secondCandidateInput.eventDateEvidence,
  companies: ["Google"],
  topics: ["Developer tools"],
  sources: secondCandidateInput.sources,
};

export const firstDeepStory: DeepResearchedStory = { id: "story-1", ...firstDeepStoryInput };
export const secondDeepStory: DeepResearchedStory = { id: "story-2", ...secondDeepStoryInput };

const firstDevelopment = {
  storyIds: ["story-1"],
  title: "מודל חדש הושק",
  whatChanged: "החברה השיקה מודל חדש למפתחים.",
  whyItMatters: "המודל מוסיף יכולות חדשות למפתחים.",
  whatToDoWithIt: null,
  availability: "זמין כעת",
  sources: [{ url: "https://example.com/model", label: "OpenAI" }],
};

const secondDevelopment = {
  storyIds: ["story-2"],
  title: "כלי פיתוח קיבל עדכון",
  whatChanged: "נוספה יכולת חדשה לכלי הפיתוח.",
  whyItMatters: "העדכון מקצר תהליך עבודה נפוץ.",
  whatToDoWithIt: null,
  availability: "זמין בגרסה החדשה",
  sources: [{ url: "https://example.com/tool", label: "Google" }],
};

export const oneItemDraft: BriefDraft = {
  dayOverview: "יום שקט יחסית שמביא איתו התפתחות אחת משמעותית מצד OpenAI סביב מודל חדש למפתחים.",
  developments: [firstDevelopment],
  worthWatching: [],
  bottomLine: "יום שקט יחסית עם התפתחות אחת משמעותית מ-OpenAI.",
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
  dayOverview: "יום פעיל בתחום מודלי ה-AI וכלי הפיתוח, עם השקה של מודל חדש ועדכון משמעותי לכלי פיתוח קיים.",
  developments: [firstDevelopment, secondDevelopment],
  worthWatching: [],
  bottomLine: "יום פעיל בתחום מודלי ה-AI וכלי הפיתוח.",
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

export const validArtifact: BriefArtifact = {
  filePath: "tech_briefs/daily/2026/august/2026-08-27/2026-08-27-tech_briefs.md",
  content: renderBriefMarkdown("2026-08-27", oneItemDraft),
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
