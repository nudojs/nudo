// Package-local runs: cd packages/lsp && ../../node_modules/.bin/vitest run …
// Resolves @nudojs/* to workspace src exactly like the root config.
import { packageVitestConfig } from "../../scripts/package-vitest-config.mjs";

export default packageVitestConfig(import.meta.url);
