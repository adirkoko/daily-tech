# @daily-tech/core

Framework-free TypeScript contracts and deterministic validation for Daily Tech.

## Public API

- Metadata types and allowed values: `DayMetadata`, `DayIntensity`, `BriefStatus`.
- Type guards: `isDayIntensity`, `isBriefStatus`.
- Boundary validation: `validateDayMetadata`.
- Full artifact validation: `validateBriefArtifact`.
- Date/path and Markdown inspection helpers used by storage and pipeline packages.

`validateBriefArtifact` accepts raw bytes so callers reading from the filesystem can
verify UTF-8 before content is accepted. It returns every issue found in one pass,
using stable machine-readable issue codes and human-readable messages.

Markdown item counts use level-three headings under these level-two sections:

- `## ההתפתחויות המשמעותיות`
- `## שווה לעקוב`

English aliases are accepted, and lower-level Markdown inspection can receive custom
headings when required.
