# nudo-vscode — Release Checklist

Private Marketplace extension (`nudo-vscode`). Not an npm publish unit —
follow this checklist + extension release notes, not npm semver for consumers.
See also [`docs/versioning.md`](../../docs/versioning.md) and
[`packages/lsp/PUBLIC_API.md`](../lsp/PUBLIC_API.md).

Current package: see `packages/vscode/package.json` (private). Version bumps come from
`scripts/bump-vscode-version.mjs` during `changeset version` on `main`.

## 1. Bundled server version align

- [ ] `packages/lsp/package.json` version is the server you intend to ship
      (today **1.0.0**; do not invent a bump just to package the extension).
- [ ] Monorepo build produced a fresh LSP dist:
      `pnpm run build` (or `pnpm --filter @nudojs/lsp run build`).
- [ ] Bundle step ran: `packages/vscode/scripts/bundle-server.mjs` copies
      `packages/lsp/dist/server.js` → `packages/vscode/server/server.js`.
- [ ] Extension launches **bundled** `server/server.js` over IPC
      (`src/extension.ts` — not tsx / not a monorepo sibling path at runtime).
- [ ] Record the bundled lsp version in extension `CHANGELOG.md`
      (example: “bundled `@nudojs/lsp@1.0.0`”).
- [ ] VS Code `activationEvents` still cover the languages you document
      (`onLanguage:javascript`, `onLanguage:typescript`).
- [ ] `documentSelector` matches Nudo target paths (js/ts/mjs are analyzed by
      the server via `shouldAnalyzeFile`; JSX/tsx are not Nudo targets).

## 2. analysis.mode default + escape hatch

Ship notes **must** state the product default and the escape hatch:

- [ ] Default: `nudo.analysis.mode = "exports"` (`DEFAULT_ANALYSIS_MODE` in
      `@nudojs/service`). Export-bearing / sidecar / directive files are analyzed
      in the IDE; plain non-export JS stays quiet.
- [ ] Escape hatch (user/project `package.json`):

```json
{
  "nudo": {
    "analysis": {
      "mode": "directives"
    }
  }
}
```

- [ ] `"directives"` restores the conservative gate (diagnostics tier becomes
      `errors`). `"all"` analyzes every target path.
- [ ] Named-path CLI commands (`nudo check src/lib.js`) still analyze that file
      regardless of mode — say so if users report “CLI sees it, IDE does not”.
- [ ] `diagnostics` default follows mode (`exports`/`all` → `default`,
      `directives` → `errors`); do not document a silent third default.

## 3. tsserver coexistence note

Copy into Marketplace / Open VSX release notes (adapt wording):

> Nudo runs **next to** the built-in TypeScript server, not instead of it.
> Keep `tsserver` / `vtsls` for `.ts`; point Nudo at JS packages via
> `package.json#nudo.analysis.include` / `exclude`. Recommended mixed-repo
> recipe: [Coexistence with TypeScript](https://nudojs.github.io/nudo/docs/guides/coexistence)
> (or repo `packages/website/docs/guides/coexistence.md`).
> If you see a “double error storm”, scope include to `src/**/*.js` and exclude
> `**/*.ts`, `**/node_modules/**`, `**/dist/**` before widening mode.

- [ ] Notes link coexistence guide + client matrix when relevant.
- [ ] Notes say default mode can **add** diagnostics on export-bearing JS that
      previously looked quiet under `directives`.

## 4. Packaging dry-run

```bash
# from monorepo root
pnpm install
pnpm run build
pnpm --filter nudo-vscode run build   # tsup extension + bundle-server.mjs
pnpm --filter nudo-vscode run package # vsce package --no-dependencies
```

- [ ] Dry-run package succeeds; `.vsix` is produced.
- [ ] `.vsix` contains `server/server.js` (self-contained; no monorepo path).
- [ ] `.vsix` does **not** contain `src/`, `scripts/`, or monorepo junk
      (see `packages/vscode/.vscodeignore`).
- [ ] Install the `.vsix` locally (`code --install-extension …`) and smoke:
      open an export-bearing `.js` → diagnostics/hover without editing.
- [ ] Command palette lists `nudo.selectCase` / `nudo.contract` /
      `nudo.contract.draft` / `nudo.contract.emit`.
- [ ] IDE daily path also covered by vitest (no live VS Code required):
      `pnpm vitest run packages/lsp/src/__tests__/ide-daily-smoke.test.ts`

## 5. Marketplace / Open VS X notes template

```markdown
## nudo-vscode <extension-version>

Bundled language server: `@nudojs/lsp@<lsp-version>`

### Highlights
- …

### Analysis default
- Default `nudo.analysis.mode` is **`exports`** (export / sidecar / directives).
- Escape hatch: `package.json#nudo.analysis.mode` = `"directives"` (conservative)
  or `"all"` (every `.js`/`.mjs`/`.ts` target path).

### Coexistence with tsserver
- Nudo runs beside the TypeScript server; it does not replace tsc.
- Mixed JS/TS monorepos: scope `nudo.analysis.include` / `exclude` — see
  guides/coexistence.md. Avoid pointing both tools at the same `.ts` sources
  with conflicting severities.

### Protocol surface
- executeCommand `nudo.*` and custom requests `nudo/…` unchanged this release
  (see packages/lsp/PUBLIC_API.md). Slash form is the protocol contract.

### Known issues / follow-ups
- …
```

- [ ] Template filled with real versions (no placeholders left).
- [ ] Changesets/changelog on `main` already applied; extension version matches
      release CI output.
- [ ] CI release workflow will package Marketplace **and** Open VS X
      (`.github/workflows/release.yml`) — both targets updated or explicitly skipped.

## 6. Post-release

- [ ] Tag / release notes published.
- [ ] Website guides still match shipped defaults (`guides/vscode.md`,
      `guides/lsp-clients.md`, `guides/coexistence.md`, en + zh mirrors).
- [ ] If lsp public surface changed, `packages/lsp/PUBLIC_API.md` +
      `public-api-surface.test.ts` updated in the same PR as the code change.
