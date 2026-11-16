# Export and integrations

Your data is yours. You can export it any time from the admin page (the **Export** menu) or the API, and you can connect the box to the tools you already use.

## Export formats

| Format | What you get | Good for |
|---|---|---|
| **JSON** | Everything: all entries (with originals, context, AI notes, comments), tags, runs, version | Moving to another tool, backups |
| **CSV** | One row per entry: id, type, state, status, title, body, votes, tags, dates, merge and reject info, `external_url`, source, and the public comments. UTF-8 with a byte-order mark so Excel opens it correctly | Spreadsheets, reports |
| **Jira CSV** | Published entries that are open, planned or in progress, with Jira's import columns | Importing into Jira |

By default JSON and CSV include every state except rejected ones; add a `state` filter to choose. Downloads are named `arghbox-<site>-<yyyymmdd>.<ext>`. The Jira CSV currently gets the same name as the plain CSV, so rename one of them if you save both on the same day.

From a script, with the owner token or the read-only token:

```
curl -H "Authorization: Bearer $TOKEN" -o box.json "https://example.com/arghbox/api.php?action=admin.export&format=json"
```

## Jira CSV import

The Jira CSV has the columns `Summary`, `Description`, `Issue Type` and `Labels`. Bugs become Bug, ideas become Story and questions become Task. Each description ends with "From ArghBox #<id>, <votes> votes", so you can trace it back.

1. In ArghBox, choose **Export, Jira CSV** and save the file.
2. In Jira, go to **Settings, System, External System Import, CSV** (the exact menu depends on your Jira version).
3. Upload the file and pick the project.
4. Map the columns: Summary to Summary, Description to Description, Issue Type to Issue Type, Labels to Labels. Tick the option that maps the labels field to multiple values if Jira asks.
5. Run the import and check a few issues.

Afterwards, put the issue link on the entry so you do not import it twice: set **external_url** (below).

## Linking an entry to an issue: `external_url`

Every entry has an optional `external_url` (http or https, up to 500 characters) that only you see on the admin page: a link to the Jira, GitHub or Linear issue. Set it in the admin page's "Edit title, type, details and linked issue" section, through `admin.update`, or through your AI.

## The AI recipe

If Claude Code has the **ArghBox MCP server** and the **Atlassian** or **GitHub** MCP server connected, you can ask:

> For every planned entry in ArghBox that has no external link, create a GitHub issue with the title, the description and a link back to the entry, then store the issue URL in the entry's `external_url`.

Claude lists the planned entries (`arghbox_list_entries`), creates the issues with the other MCP server, and records each link with `arghbox_link_issue` (`{"id": 12, "url": "https://..."}`; it is logged and can be undone). Keep a human in the loop for what gets created in your issue tracker.

## The Atom feed

`https://example.com/arghbox/api.php?action=feed` is an Atom 1.0 feed of the 50 most recently updated published entries. Titles carry the status when it is not open ("[Done] Dark mode"), the body and the latest public comment are the content, and each item links to your site with `#arghbox-<id>`, which opens that entry's detail in the widget. The feed is cached for ten minutes. Set `site_url` in `config.php` so the links are right. Check it with any feed reader, or fetch it with `curl` and look for `<feed xmlns="http://www.w3.org/2005/Atom">`; an empty box gives a valid feed with no entries.

Use it as:

- **A changelog or backlog for readers**: subscribe in any feed reader.
- **Slack**: in a channel, `/feed subscribe <feed url>` (with Slack's RSS app).
- **Zapier, Make, n8n, IFTTT**: use the "new feed item" trigger and send it to email, a chat, a spreadsheet or an issue tracker.

## Other ideas

- A weekly Claude Code session: "summarise what was asked this week" using the read token.
- A scheduled export to a backup folder using the read token and `curl`.
- Webhooks are on the roadmap.
