# @nudojs/parser

## 0.4.1

### Patch Changes

- Updated dependencies [0fd253f]
- Updated dependencies [a2aac9e]
- Updated dependencies [0f0b7d5]
- Updated dependencies [de47d84]
- Updated dependencies [78f6752]
  - @nudojs/core@1.0.0

## 0.4.0

### Minor Changes

- 1d6bb01: `getFunctionName` 对 `export const f = …`（ExportNamedDeclaration + VariableDeclaration）返回 `<anonymous>`——现在递归进入声明节点，导出箭头函数获得真实函数名，case 求值可达。

### Patch Changes

- Updated dependencies [1d6bb01]
- Updated dependencies [1d233a7]
  - @nudojs/core@0.4.0

## 0.3.1

### Patch Changes

- bee69d4: Publish built dist instead of TypeScript source: packages now ship compiled ESM + .d.ts, CLI bin gets a shebang, `nudo --version` reads the real package version, and `nudo check` accepts multiple paths.
- Updated dependencies [21427eb]
- Updated dependencies [df1726c]
- Updated dependencies [bee69d4]
- Updated dependencies [8d85d99]
  - @nudojs/core@0.3.1

## 0.3.0

### Minor Changes

- 5786fa5: Improve `@nudo:mock` parsing for sinon-style stubs and share parse/strip with core.

  - Support `stub().onFirstCall()`, `stub().callsFake(fn)`, and `sinon.`-prefixed chains as the same MockHelper shape TypeValue/Abs already consume.
  - Drop the unused `ReturnsDirective` / `@nudo:returns` directive type (contracts use `@nudo:refine`).
  - `parse()` now strips types unconditionally via core `parseSource` (shared AST cache).

### Patch Changes

- Updated dependencies [5786fa5]
- Updated dependencies [5786fa5]
  - @nudojs/core@0.3.0

## 0.2.0

### Minor Changes

- 6c38283: docs and ci
- 9f7f819: fix pkg info
- c175f71: version

### Patch Changes

- Updated dependencies [6c38283]
- Updated dependencies [9f7f819]
- Updated dependencies [c175f71]
  - @nudojs/core@0.2.0

## 0.1.0

### Minor Changes

- Conceptual design and basic implementation.

### Patch Changes

- Updated dependencies
  - @nudojs/core@0.1.0
