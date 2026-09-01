# @daily-tech/core

Framework-free TypeScript contracts and deterministic validation for Daily Tech.

## Public API

- Metadata types and allowed values: `DayMetadata`, `DayIntensity`, `BriefStatus`.
- Type guards: `isDayIntensity`, `isBriefStatus`.
- Boundary validation: `validateDayMetadata`.
- Full artifact validation: `validateBriefArtifact`.
- Operator-tunable pipeline settings: `PipelineSettings`, `DEFAULT_PIPELINE_SETTINGS`,
  `PIPELINE_SETTINGS_LIMITS`, `validatePipelineSettings`.
- Date/path and Markdown inspection helpers used by storage and pipeline packages.

`validateBriefArtifact` accepts raw bytes so callers reading from the filesystem can
verify UTF-8 before content is accepted. It returns every issue found in one pass,
using stable machine-readable issue codes and human-readable messages.

Markdown item counts recognize two shapes:

- A significant development is its own numbered level-two heading, e.g. `## 1. Title`.
- A worth-watching item is a level-three heading under `## שווה לעקוב` (the English
  alias `## Worth watching` is also accepted). Lower-level Markdown inspection can
  receive a custom heading when required.
