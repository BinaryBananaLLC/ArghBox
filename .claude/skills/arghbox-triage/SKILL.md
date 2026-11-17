---
name: arghbox-triage
description: Empty the ArghBox feedback box of arghbox.com (or the local dev server). Triage pending feedback entries and entries visitors reported: publish real ones, reject spam, merge duplicates, flag what needs the owner, keep or reject reported entries. Use when the user asks to "empty the ArghBox", "triage feedback", "review the feedback box", "triage the ArghBox" or "AI-review feedback".
---

Follow `skill/arghbox-triage/PROMPT.md` step by step; the judging rules are in
`skill/arghbox-triage/RULES.md` (read them completely first). The script
`skill/arghbox-triage/triage.mjs` makes no paid calls, and the owner has authorized running
its commands `fetch`, `check`, `apply`, `status` and `undo`.

- arghbox.com's own board: the default `--dir .arghbox` (needs `.arghbox/site.json` and
  `.arghbox/token`, both git-ignored).
- The local dev server (`node tools/dev.mjs`): add `--dir .dev/arghbox` to every command; the
  dev server writes `site.json` and `token` there.

If the `arghbox` MCP server is connected, use its tools for ad-hoc questions and single
changes; for emptying the box, always use `triage.mjs`.
