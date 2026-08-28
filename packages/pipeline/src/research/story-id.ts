import { randomUUID } from "node:crypto";

import type { StoryIdFactory } from "./contracts.js";

export const randomStoryIdFactory: StoryIdFactory = {
  create: () => `story-${randomUUID()}`,
};
