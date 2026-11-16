`action_id` or `run_id` | `type`, `title`, optional `body`, `status`, `tags`, `public` | `id`, `reject_reason`, optional `note` | `id`, `into`, optional `reason` | `id`, `url` | `id`, `tags` | `id`, `body`, `public` (true or false) | `id`, `status`, optional `comment`, `public` | `decisions`, `digest`, `reviewer` | `view`, `run_id`, `entry_id`, `limit`, `offset` | none | `id` | `q` (required), `state`, `limit` | `state`, `status`, `type`, `source`, `tag`, `q`, `sort`, `limit`, `offset` | `limit`, `offset` | none | # MCP server

`/arghbox/mcp.php` is a [Model Context Protocol](https://modelcontextprotocol.io) endpoint. It lets Claude Code, Cursor, VS Code, Windsurf and other MCP clients work with your box in conversation: "what are people asking about exports?", "mark #12 done and thank the visitor", "undo the last run".

It uses the same code as the admin API, so the action log, undo, fingerprints and the confidence gate behave exactly the same.

Use it for questions and single changes. To empty the box in bulk, use the [triage skill](triage.md) (checked, in one transaction).

## Tokens

- The **triage token** gives every tool.
- The **read token** (`read_token_sha256` in `config.php`) gives only the read tools. Use it for reporting or "what are users asking?" sessions. Make one with `npx arghbox secrets --read` (it prints the token and the `read_token_sha256` line for `config.php`), or hash any long random string with sha256 yourself.
- The **owner token is not accepted** on purpose.

Wrong or missing tokens answer 401, and failed attempts are throttled. Set `'mcp_enabled' => false` to switch the endpoint off.

## Claude Code

```
claude mcp add --transport http arghbox https://example.com/arghbox/mcp.php --header "Authorization: Bearer <YOUR_TRIAGE_TOKEN>"
```

That puts the token in Claude Code's local settings. To keep it out of every config file, use a `.mcp.json` in your repository with a `headersHelper`: a tiny script that reads the token from `.arghbox/token` when it is needed.

```json
{
  "mcpServers": {
    "arghbox": {
      "type": "http",
      "url": "https://example.com/arghbox/mcp.php",
      "headersHelper": "node .claude/skills/arghbox-triage/mcp-headers.mjs"
    }
  }
}
```

`node .claude/skills/arghbox-triage/triage.mjs mcp-config` prints both forms for your site, with a placeholder instead of the real token.

## Cursor and VS Code

Both read the same kind of config. In Cursor, put the `.mcp.json` block above in `.cursor/mcp.json`; in VS Code, use `.vscode/mcp.json` (the top-level key there is `servers`). Check your editor's MCP documentation for the current file name and shape, since they change. If the editor cannot run a header helper, pass a header with the token from an environment variable instead of pasting it into a file you commit.

Claude Desktop can connect through the `mcp-remote` bridge. claude.ai itself cannot connect yet: it needs OAuth, which is on the roadmap.

## Tools

All tool names start with `arghbox_`.

| Tool | Access | Arguments | What it does |
|---|---|---|---|
| `arghbox_stats` | read | none | Counts, votes, entries in the last 7 days, the last run |
| `arghbox_list_pending` | read | `limit`, `offset` | Pending and flagged entries (bodies cut short; `limit`, `offset`) |
| `arghbox_list_entries` | read | `state`, `status`, `type`, `source`, `tag`, `q`, `sort`, `limit`, `offset` | Filter by state, status, type, source, tag or text; sort; up to 50 rows |
| `arghbox_search` | read | `q` (required), `state`, `limit` | Full-text search with a snippet per hit |
| `arghbox_get_entry` | read | `id` | One entry with comments, AI note and recent actions |
| `arghbox_list_tags` | read | none | The tag vocabulary with counts |
| `arghbox_get_log` | read | `view`, `run_id`, `entry_id`, `limit`, `offset` | The action log and the triage runs |
| `arghbox_apply_decisions` | write | `decisions`, `digest`, `reviewer` | Apply triage decisions (at most 50 per call) |
| `arghbox_set_status` | write | `id`, `status`, optional `comment`, `public` | Set an entry's status (open, planned, in progress, done, declined) |
| `arghbox_comment` | write | `id`, `body`, `public` (true or false) | Add a comment. You must say `public` or private. |
| `arghbox_tag` | write | `id`, `tags` | Set the tags of one entry |
| `arghbox_link_issue` | write | `id`, `url` | Store the link of a Jira, GitHub or Linear issue on an entry (empty clears it) |
| `arghbox_merge` | write, destructive hint | `id`, `into`, optional `reason` | Merge an entry into another, with a reason |
| `arghbox_reject` | write, destructive hint | `id`, `reject_reason`, optional `note` | Reject an entry with a reason |
| `arghbox_create_task` | write | `type`, `title`, optional `body`, `status`, `tags`, `public` | Create one of your own tasks (private by default) |
| `arghbox_undo` | write, destructive hint | `action_id` or `run_id` | Undo one action or a whole run |

Every tool takes a JSON object of arguments; the server's `tools/list` answer carries the exact schema for each one, so your AI client always knows them.

## Trying it without an AI

MCP here is plain JSON-RPC over HTTP POST, so you can check the endpoint with `curl` (the token is the **triage** token or the read token):

```
curl -s https://example.com/arghbox/mcp.php \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"arghbox_search","arguments":{"q":"export"}}}'
```

The other methods are `initialize` and `tools/list`. A wrong token answers 401, the owner token answers 401 on purpose, and a write tool with the read token answers a tool error ("This token is read-only").

## Safety

- **Visitor text is untrusted.** Every result containing visitor text is marked as untrusted, and the server instructions tell the AI to treat it as data. A visitor cannot instruct your assistant by writing an entry.
- **No delete tool**, and no tool that fetches URLs or files.
- **Public writes are off by default.** Unless you set `triage_public_writes` (old name `mcp_allow_public_comments`), the AI over MCP (and the triage token on the REST API too) the AI can only write private notes and private tasks, so a poisoned entry cannot make it publish text on your site. Public comments and public tasks answer an error.
- **Everything is logged and undoable**, under an actor name like `triage:mcp:<client>`.
- **Rate limits** per token: 120 calls and 30 writes per minute by default.
- The endpoint takes only POST, refuses browser requests (anything with an `Origin` header) and accepts bodies up to 64 KB.
- Use the **read token** when you only want answers.

## Hosting note

The `Authorization` header must reach PHP. The shipped `.htaccess` handles Apache and LiteSpeed. If you get 401 with the right token, see the troubleshooting section of [install.md](install.md).
