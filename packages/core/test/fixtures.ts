import type { DayMetadata } from "../src/index.js";

export const validMetadata: DayMetadata = {
  date: "2026-08-27",
  summary: "יום פעיל עם מספר עדכוני מוצר משמעותיים.",
  significant_items: 2,
  worth_watching_items: 1,
  day_intensity: "high",
  companies: ["OpenAI", "Google"],
  topics: ["AI models", "Developer tools"],
  developments: ["השקת מודל חדש", "עדכון לכלי פיתוח"],
  status: "ready",
  source_count: 8,
  created_at: "2026-08-28T01:42:10.000Z",
  published_at: null,
  updated_at: null,
};

export const validMarkdown = `# עדכון טכנולוגי יומי — 27 באוגוסט 2026

## תמצית היום

יום פעיל עם מספר עדכוני מוצר משמעותיים.

## 1. מודל חדש הושק

### מה השתנה

המודל זמין כעת למפתחים.

### מקורות

- [OpenAI](https://openai.com/)

## 2. כלי הפיתוח קיבל עדכון

### מה השתנה

העדכון מוסיף יכולת חדשה.

### מקורות

- [Google](https://developers.google.com/)

## שווה לעקוב

### פרויקט חדש נכנס לבטא

הפרויקט עדיין אינו זמין לכולם.

## שורה תחתונה

יום פעיל בתחום ה-AI וכלי הפיתוח.
`;
