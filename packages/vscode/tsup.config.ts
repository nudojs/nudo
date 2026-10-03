import { defineConfig } from "tsup";

/**
 * out/extension.js must be self-contained: the vsix is packaged with
 * `vsce package --no-dependencies` and `.vscodeignore` drops node_modules/,
 * so nothing may stay external except the `vscode` host API.
 *
 * tsup auto-externalizes package.json `dependencies` — including
 * vscode-languageclient and @nudojs/parser — which would ship unresolvable
 * `require(...)` calls. `noExternal` here bundles both back in.
 */
export default defineConfig({
  entry: ["src/extension.ts"],
  format: ["cjs"],
  outDir: "out",
  clean: true,
  external: ["vscode"],
  // tsup auto-externalizes package.json deps; bundle ours back in
  // (same regex style as packages/lsp/tsup.config.ts).
  noExternal: [/^@nudojs\//, /^vscode-languageclient/],
});
