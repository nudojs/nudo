import { defineConfig } from "tsup";

/**
 * `nudo-lsp` is spawned as `node dist/server.js` from any cwd.
 * Bundle vscode-languageserver* so the ESM-hostile `vscode-languageserver/node`
 * subpath never hits Node's resolver. Bundle @nudojs/* as well: inlining keeps
 * the server single-file and independent of workspace-link resolution in
 * node_modules (tsconfig.build.json maps every @nudojs/* specifier to sibling
 * SRC — resolving to their dist instead would inline stale, pre-bundled output).
 * The @nudojs/* sources are
 * pure ESM; the inlined CJS deps (@babel/*, typescript via harvester) rely on
 * the createRequire banner below so dynamic requires (debug → "tty") reach
 * Node's CJS loader instead of esbuild's `__require` shim.
 * Shebang is preserved from src/server.ts.
 */
export default defineConfig({
  entry: ["src/server.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  tsconfig: "tsconfig.build.json",
  splitting: false,
  noExternal: [/^@nudojs\//, /^vscode-languageserver/, /^vscode-languageserver-textdocument$/],
  // dts uses the same src paths so types match the bundled sources; the
  // emitted d.ts keeps @nudojs/* imports external (declared deps).
  dts: true,
  banner: {
    js: [
      'import { createRequire as __nudoCreateRequire } from "module";',
      'import { fileURLToPath as __nudoFileURLToPath } from "url";',
      "const require = __nudoCreateRequire(import.meta.url);",
      "const __filename = __nudoFileURLToPath(import.meta.url);",
      'const __dirname = __nudoFileURLToPath(new URL(".", import.meta.url));',
    ].join("\n"),
  },
});
