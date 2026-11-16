---
name: arghbox-triage
description: Empty the ArghBox feedback box. Triage the pending feedback entries (ideas, bugs, questions) of this site's ArghBox: publish the real ones, reject spam, merge duplicates, flag what needs the owner, and tag the board. Use when the user asks to "empty the ArghBox", "triage feedback", "review the feedback box", "triage the ArghBox" or "AI-review feedback".
---

Follow `PROMPT.md` in this folder step by step; the judging rules are in `RULES.md` in the
same folder (read it completely before judging). The script `triage.mjs` in this folder
makes no paid calls and uses no AI service: it only talks to the site's own admin API. The
site owner has authorized running its commands `fetch`, `check`, `apply`, `status` and
`undo`. Run them from the repository root, and never print or open the token file.

If the `arghbox` MCP server is connected, use its tools for ad-hoc questions and single changes (what are users asking about X, mark #12 done and comment). For emptying the box, always use `triage.mjs` (bulk, checked, one transaction). `triage.mjs mcp-config` prints how to connect it, without printing the token.
