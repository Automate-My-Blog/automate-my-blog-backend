# Prompts

OpenAI (and other LLM) prompts live here so we have one place to read and edit them. Same prompt can be used from the API, cron, or a script, and we can unit-test the builders (e.g. snapshots or length checks) without hitting the API.

**Layout**

- `index.js` – re-exports all prompt modules.
- `website-analysis.js` – website analysis (system + user). Used by `services/openai.js` in `analyzeWebsite()`.

**Conventions**

- One file per prompt (or small group). Export a system message and a user-message builder.
- System: `getXxxSystemMessage()` or `getXxxSystemMessage(context)` if it needs context.
- User: `buildXxxUserMessage(params)` with explicit params, not one big context blob.
- Id-style names: `website-analysis`, `seo-analysis`, etc.

**Wiring a new prompt**

1. Add a module under `prompts/` (e.g. `seo-analysis.js`).
2. Export `getXxxSystemMessage` and `buildXxxUserMessage` (or whatever fits).
3. Re-export from `prompts/index.js`.
4. In the service/route, replace the inline `content: \`...\`` with the imported functions.

Example for website analysis in `services/openai.js`:

```js
import { getWebsiteAnalysisSystemMessage, buildWebsiteAnalysisUserMessage } from '../prompts/index.js';

// In analyzeWebsite():
messages: [
  { role: 'system', content: getWebsiteAnalysisSystemMessage() },
  { role: 'user', content: buildWebsiteAnalysisUserMessage({ url, websiteContent, webSearchData, keywordData }) }
],
```

**What’s next**

See `docs/PROMPTS-INVENTORY.md` for the full list. Good next steps: add `seo-analysis.js` and switch the route over; then break up the enhanced blog prompt into sections and a composer; then migrate the rest of the prompts in `openai.js` the same way.
