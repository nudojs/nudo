/**
 * Browser stub for the `typescript` package.
 *
 * Only `@nudojs/harvester` (.d.ts parsing) needs the real compiler at runtime;
 * the docs/playground bundle must not ship it. Module load must not throw —
 * harvest paths are Node-only and are stubbed out via `harvester-browser.ts`.
 */
const tsStub = {
  createSourceFile() {
    throw new Error("typescript is not available in the browser bundle");
  },
  createProgram() {
    throw new Error("typescript is not available in the browser bundle");
  },
  createCompilerHost() {
    throw new Error("typescript is not available in the browser bundle");
  },
  sys: undefined,
  SyntaxKind: {},
  ScriptTarget: {},
  ModuleKind: {},
  NodeFlags: {},
  TypeFormatFlags: {},
  SymbolFlags: {},
  ModifierFlags: {},
  factory: {},
};

export default tsStub;
export const {
  createSourceFile,
  createProgram,
  createCompilerHost,
  sys,
  SyntaxKind,
  ScriptTarget,
  ModuleKind,
  NodeFlags,
  TypeFormatFlags,
  SymbolFlags,
  ModifierFlags,
  factory,
} = tsStub;
