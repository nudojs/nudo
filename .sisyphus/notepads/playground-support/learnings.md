# Playground Support - Learnings

## Wave 1 Completed Tasks

### Task 1: Browser Compatibility Verification
- Verified @nudojs/core, @nudojs/parser, @nudojs/cli have NO Node.js imports
- Packages are browser-compatible

### Task 2: Playground Page Scaffold
- Created: packages/website/src/pages/playground.tsx
- Created basic layout with left-right split
- Used @docusaurus/Layout and Translate components
- Added placeholder for Monaco Editor and Output panels

### Task 3: Navigation Entry
- Added Playground link to navbar in docusaurus.config.ts
- Positioned after Docs, before GitHub

## Wave 2 Completed Tasks

### Task 4: Monaco Editor Integration
- Installed @monaco-editor/react package
- Used React.lazy() + Suspense for SSR handling
- Configured JavaScript syntax highlighting
- Added default @nudo:case example code

### Task 5: Browser Evaluator Integration
- Added workspace dependencies: @nudojs/core, @nudojs/parser, @nudojs/cli
- Imported evaluateProgram, parse
- Added Run button to trigger evaluation
- Added state management for code and output
- Basic error handling for parse/eval errors

### Task 6: Output Panel + Tab Switching
- Added Text / .d.ts tab buttons
- Added CSS styling for tabs and run button
- Output displays JSON formatted results

### Task 7: URL State Sync
- Added base64 URL encoding for code sharing
- Added Share button to copy URL to clipboard
- URL updates on share without page reload
- Uses browser native APIs (window.history.replaceState)

## Build Status
- All builds pass successfully
- Playground page generated at /playground/index.html

## Wave 3: Case Switching Feature

### Task 8: Add Case Switching to Playground
- Added state management: `activeCaseIndex` (default 0)
- Created `activeCaseIndexRef` to sync state with Monaco providers
- Added `extractCases` helper function to flatten all cases from code
- Added case selector dropdown UI between presets and editor
- Case dropdown shows: `{functionName}: "{caseName}" ({args})`
- Updated inlay hints provider to only show hint for selected case
- Updated hover provider to only show hover for selected case
- Updated `runInference` to only output selected case result
- Added `setActiveCaseIndex(0)` reset on preset change and URL load
- Added CSS styling for `.cases-bar` and `.case-select`
- Dropdown only appears when cases are detected in code

### Implementation Details
- Case selection uses zero-based index matching across all functions
- Monaco providers access active case via ref (providers registered once on mount)
- `extractCases` function safely handles parse errors (returns empty array)
- Current cases derived from editor value: `extractCases(editorRef.current?.getValue() || "")`
- Case selector responsive width: min 300px, max 600px

### Verification
- Build passes successfully for all packages
- No TypeScript errors in playground.tsx
- LSP diagnostics clean

### Task 9: Add Real Parameter Type Inference to Monaco Hover
- Replaced hardcoded "test hover" with real type inference
- Hover provider now extracts parameter types from active case
- Implementation steps:
  1. Get word at hover position using `model.getWordAtPosition(position)`
  2. Parse code and extract directives: `parse(code)`, `extractDirectives(ast)`
  3. Find all cases by filtering directives where `kind === "case"`
  4. Get active case using `activeCaseIndexRef.current`
  5. Check if hovered word matches any function parameter name
  6. Get parameter type from active case's `directive.args[paramIndex]`
  7. Format hover as `` `${word.word}: ${typeStr}` ``
- Graceful error handling: returns `null` for non-parameters, missing cases, parse errors
- Hover range uses word boundaries: `word.startColumn` to `word.endColumn`
- Uses `typeValueToString()` to convert TypeValue to display string
- Works with all case types: literals (`Literal<5>`), primitives (`T.number`), complex types
- LSP diagnostics clean, build passes

## Fix Hover Provider ActiveCaseIndexRef Access

### Issue
- playground.tsx was corrupted with duplicate code
- Hover provider needed to access activeCaseIndexRef but couldn't
- MonacoEditor and EditorLoader components needed to receive activeCaseIndexRef as a prop

### Solution
- Created clean playground.tsx with proper prop passing
- Added activeCaseIndexRef prop to MonacoEditor component
- Removed unused EditorLoader component
- Hover provider now accesses activeCaseIndexRef via props
- Hover shows real parameter types from active case

### Implementation Details
- MonacoEditorWrapper component receives activeCaseIndexRef as prop
- Playground component creates activeCaseIndexRef and passes it down
- Hover provider checks if hovered word is a function parameter
- Gets parameter type from active case's directive.args[paramIndex]
- Formats hover as   
- Graceful error handling for non-parameters and parse errors

### Verification
- LSP diagnostics clean (only hint about React types)
- Build passes: 
> nudo-monorepo@0.2.0 build /Users/lot/.local/share/opencode/worktree/f25aeefe5fb53845e957550ee148891ef06bbdd3/tidy-nebula
> pnpm -r run build

Scope: 8 of 9 workspace projects
packages/core build$ tsup src/index.ts --format esm --dts
packages/vscode build$ tsup src/extension.ts --format cjs --outDir out --external vscode
packages/vscode build: CLI Building entry: src/extension.ts
packages/vscode build: CLI Using tsconfig: ../../tsconfig.json
packages/vscode build: CLI tsup v8.5.0
packages/core build: CLI Building entry: src/index.ts
packages/core build: CLI Using tsconfig: tsconfig.json
packages/core build: CLI tsup v8.5.0
packages/vscode build: CLI Target: es2022
packages/vscode build: CJS Build start
packages/core build: CLI Target: es2022
packages/core build: ESM Build start
packages/core build: DTS Build start
packages/vscode build: CJS out/extension.js 5.75 KB
packages/vscode build: CJS ⚡️ Build success in 190ms
packages/core build: ESM dist/index.js 23.27 KB
packages/core build: ESM ⚡️ Build success in 191ms
packages/vscode build: Done
packages/core build: DTS ⚡️ Build success in 456ms
packages/core build: DTS dist/index.d.ts 5.89 KB
packages/core build: Done
packages/parser build$ tsup src/index.ts --format esm --dts
packages/parser build: CLI Building entry: src/index.ts
packages/parser build: CLI Using tsconfig: tsconfig.json
packages/parser build: CLI tsup v8.5.0
packages/parser build: CLI Target: es2022
packages/parser build: ESM Build start
packages/parser build: ESM dist/index.js 566.28 KB
packages/parser build: ESM ⚡️ Build success in 27ms
packages/parser build: DTS Build start
packages/parser build: DTS ⚡️ Build success in 399ms
packages/parser build: DTS dist/index.d.ts 1.18 KB
packages/parser build: Done
packages/cli build$ tsup src/index.ts src/evaluator-api.ts --format esm --dts
packages/cli build: CLI Building entry: src/evaluator-api.ts, src/index.ts
packages/cli build: CLI Using tsconfig: tsconfig.json
packages/cli build: CLI tsup v8.5.0
packages/cli build: CLI Target: es2022
packages/cli build: ESM Build start
packages/cli build: ESM dist/evaluator-api.js  557.00 B
packages/cli build: ESM dist/chunk-LGWVGEMB.js 67.43 KB
packages/cli build: ESM dist/index.js          127.20 KB
packages/cli build: ESM ⚡️ Build success in 19ms
packages/cli build: DTS Build start
packages/cli build: DTS ⚡️ Build success in 904ms
packages/cli build: DTS dist/index.d.ts         13.00 B
packages/cli build: DTS dist/evaluator-api.d.ts 2.24 KB
packages/cli build: Done
packages/service build$ tsup src/index.ts --format esm --dts
packages/service build: CLI Building entry: src/index.ts
packages/service build: CLI Using tsconfig: tsconfig.json
packages/service build: CLI tsup v8.5.0
packages/service build: CLI Target: es2022
packages/service build: ESM Build start
packages/service build: ESM dist/index.js 18.72 KB
packages/service build: ESM ⚡️ Build success in 12ms
packages/service build: DTS Build start
packages/service build: DTS ⚡️ Build success in 552ms
packages/service build: DTS dist/index.d.ts 2.29 KB
packages/service build: Done
packages/lsp build$ tsup src/server.ts --format esm --dts
packages/vite-plugin build$ tsup src/index.ts --format esm --dts
packages/website build$ docusaurus build
packages/vite-plugin build: CLI Building entry: src/index.ts
packages/vite-plugin build: CLI Using tsconfig: tsconfig.json
packages/vite-plugin build: CLI tsup v8.5.0
packages/vite-plugin build: CLI Target: es2022
packages/vite-plugin build: ESM Build start
packages/lsp build: CLI Building entry: src/server.ts
packages/lsp build: CLI Using tsconfig: tsconfig.json
packages/lsp build: CLI tsup v8.5.0
packages/lsp build: CLI Target: es2022
packages/lsp build: ESM Build start
packages/vite-plugin build: ESM dist/index.js 2.33 KB
packages/vite-plugin build: ESM ⚡️ Build success in 12ms
packages/lsp build: ESM dist/server.js 7.78 KB
packages/lsp build: ESM ⚡️ Build success in 12ms
packages/vite-plugin build: DTS Build start
packages/lsp build: DTS Build start
packages/website build: [INFO] Website will be built for all these locales: 
packages/website build: - en
packages/website build: - zh-Hans
packages/website build: [INFO] [en] Creating an optimized production build...
packages/vite-plugin build: DTS ⚡️ Build success in 597ms
packages/vite-plugin build: DTS dist/index.d.ts 227.00 B
packages/vite-plugin build: Done
packages/lsp build: DTS ⚡️ Build success in 663ms
packages/lsp build: DTS dist/server.d.ts 13.00 B
packages/lsp build: Done
packages/website build: [webpackbar] ℹ Compiling Client
packages/website build: [webpackbar] ℹ Compiling Server
packages/website build: [webpackbar] ✔ Server: Compiled successfully in 415.64ms
packages/website build: [webpackbar] ✔ Client: Compiled successfully in 437.53ms
packages/website build: [SUCCESS] Generated static files in "build".
packages/website build: [INFO] [zh-Hans] Creating an optimized production build...
packages/website build: [webpackbar] ℹ Compiling Client
packages/website build: [webpackbar] ℹ Compiling Server
packages/website build: [webpackbar] ✔ Server: Compiled successfully in 337.61ms
packages/website build: [webpackbar] ✔ Client: Compiled successfully in 346.76ms
packages/website build: [SUCCESS] Generated static files in "build/zh-Hans".
packages/website build: [INFO] Use `npm run serve` command to test your build locally.
packages/website build: Done in packages/website
- Inlay hints functionality preserved
- Playground page generated successfully

## Fix Hover Provider ActiveCaseIndexRef Access

### Issue
- playground.tsx was corrupted with duplicate code
- Hover provider needed to access activeCaseIndexRef but couldn't
- MonacoEditor and EditorLoader components needed to receive activeCaseIndexRef as a prop

### Solution
- Created clean playground.tsx with proper prop passing
- Added activeCaseIndexRef prop to MonacoEditor component
- Removed unused EditorLoader component
- Hover provider now accesses activeCaseIndexRef via props
- Hover shows real parameter types from active case

### Implementation Details
- MonacoEditorWrapper component receives activeCaseIndexRef as prop
- Playground component creates activeCaseIndexRef and passes it down
- Hover provider checks if hovered word is a function parameter
- Gets parameter type from active case's directive.args[paramIndex]
- Formats hover as `` `${word.word}: ${typeStr}` ``
- Graceful error handling for non-parameters and parse errors

### Verification
- LSP diagnostics clean (only hint about React types)
- Build passes: `pnpm run build` in packages/website
- Inlay hints functionality preserved
- Playground page generated successfully
