import { defineConfig } from "tsup";

/**
 * `nudo-lsp` is spawned as `node dist/server.js` from any cwd.
 * Bundle vscode-languageserver* so the ESM-hostile `vscode-languageserver/node`
 * subpath never hits Node's resolver. Keep @nudojs/* external — they resolve
 * from package dependencies (and their dist createRequire banners must not be
 * inlined into this single file).
 * Shebang is preserved from src/server.ts.
 */
export default defineConfig({
  entry: ["src/server.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  external: [/^@nudojs\//],
  noExternal: [/^vscode-languageserver/, /^vscode-languageserver-textdocument$/],
  banner: {
    js: [
      'import { createRequire as __nudoCreateRequire } from "module";',
      "const require = __nudoCreateRequire(import.meta.url);",
    ].join("\n"),
  },
});
