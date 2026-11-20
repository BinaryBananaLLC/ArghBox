# Translations

The widget's text lives in small JSON files, so adding a language needs no code.

## How strings work

- `arghbox/i18n/en.json` is the source of truth. Every other language is a file next to it, named by language code: `pl.json`, `de.json`, `pt-BR.json`.
- A file is a flat object of `"key": "text"`. Placeholders in braces, such as `{n}` or `{site}`, are filled in by the widget and must stay exactly as they are.
- **Plurals** use key suffixes from the Unicode plural categories: `votes.one` and `votes.other`. Languages with more forms add `.few`, `.many`, `.two` or `.zero` (Polish needs `.one`, `.few`, `.many` and `.other`). The widget falls back to `.other`, then to English.
- **Tone**: many keys come as a pair, `something.funny` and `something.neutral`, picked by the `data-tone` attribute. Translate both, keeping the funny one playful and the neutral one plain.
- The `_meta` key holds `{"lang": "pl", "name": "Polski", "version": "0.1.2"}`.
- The widget picks the language from `data-lang`, otherwise the page's `<html lang>`: an exact match first, then the part before the dash (`pt-BR` falls back to `pt`), otherwise English. Missing keys fall back to English, so a partial translation is fine.
- The tab label comes from the `tab.label` key and is also listed in the loader (`arghbox.js`), because the loader loads no strings. That is the `LABELS` and `LANGS` block described below.

## Add a language with a pull request

1. Copy `arghbox/i18n/en.json` to `arghbox/i18n/<code>.json`.
2. Translate the values (never the keys). Keep every `{placeholder}`. Add the plural forms your language needs.
3. Set `_meta.lang` and `_meta.name` (the name in the language itself).
4. Add your language to the two marker blocks at the top of `arghbox/arghbox.js`, keeping the markers:

   ```js
   /* arghbox:labels:start */
   var LABELS = {"en":"Feedback","pl":"Opinie"};
   /* arghbox:labels:end */
   /* arghbox:langs:start */
   var LANGS = ["en","pl"];
   /* arghbox:langs:end */
   ```

   Non-ASCII letters can be written as `\uXXXX` escapes.
5. Run `npm test` and `npm run check:size` (the loader must stay under 4 KB gzipped).
6. Open a pull request. Mention whether you are a native speaker.

Machine-translated drafts are welcome as a starting point, but please read them through. Funny copy needs a human ear.

## The owner-only script

`tools/translate.mjs` translates with Azure OpenAI, so it costs money and needs credentials. It is for the project owner; contributors do not need it and should not run it.

```
node tools/translate.mjs <lang...> [--paid] [--all]
```

- It translates only the keys that are missing, or whose English text changed since the last run (it keeps a hash of each English string in `arghbox/i18n/.translate-state.json`). `--all` redoes everything.
- It keeps placeholders, checks them in the answer, asks for the plural forms the language needs and rewrites the `LABELS` and `LANGS` blocks.
- **Without `--paid` (or `--yes`) it is a dry run**: it prints what would be sent, with the estimated characters and requests, and costs nothing. Only `--paid` calls the API.
- Each language is saved (file, state, `LABELS`, `LANGS`) as soon as it is done, so a failure on the second language never makes the next run pay for the first again.
- Credentials come from `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY` and `AZURE_OPENAI_DEPLOYMENT`, or from the git-ignored file `.secrets/azure-openai.json`.

## Changing English text

When you change a string in `en.json`, the translations of that key are out of date. The owner's script retranslates them; for contributor-made languages, mention it in your pull request so someone can update them.
