---
"vite-plugin-nudo": minor
---

Ship TypeScript-aware defaults and Abs check diagnostics in the Vite plugin.

- Default include covers `.js` / `.mjs` / `.ts` / `.mts`; exclude also skips `*.d.ts`.
- Glob matching is a real anchored RegExp (not `endsWith` heuristics).
- Runs `analyzeFileAsync` plus `checkSource` so Abs constraint issues surface as Vite warnings/errors.
- Exposes `clearAnalysisSessionCaches` for long-lived Vite processes.
