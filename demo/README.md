# Demo site

**Looking for the live demo? It's at [arghbox.com/demo](https://arghbox.com/demo/).** There you can vote and add an argh as a visitor, then run the AI triage as the owner, all in your browser.

This folder is "Pocket Maps", a made-up website that `npm run dev` serves so you can try ArghBox on your own machine. GitHub only shows its source, because ArghBox needs PHP to run.

## Run it

You need PHP 8.1+ with SQLite and Node.js 22+. From the repository root:

```
npm run dev
```

Then open:

- `http://localhost:8787/`: the demo site with the **Feedback** tab on its right edge
- `http://localhost:8787/arghbox/admin/`: the admin page (the owner token is printed in the terminal)

The box comes seeded with sample entries, and a fake Turnstile lets every check pass. Everything is stored in `.dev/`, which git ignores. Run `node tools/dev.mjs --help` for the options.

## Try the triage

With the dev server running, the terminal prints a `Triage:` command. Run the [triage skill](../docs/triage.md) against the local box the same way you would against a real site.
