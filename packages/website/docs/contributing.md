---
sidebar_position: 100
---

# Contributing

Thank you for your interest in contributing to Nudo. This guide covers setup, project structure, development workflow, and how to extend the system.

---

## Prerequisites

- **Node.js** 18 or later
- **pnpm** 8 or later

```bash
npm install -g pnpm
```

---

## Clone and Setup

```bash
git clone https://github.com/nudojs/nudo.git
cd nudo
pnpm install
pnpm run build
```

---

## Project Structure

The monorepo uses pnpm workspaces. Key packages:

| Package | Description |
|---------|-------------|
| `@nudojs/core` | Type values, Ops, Environment |
| `@nudojs/parser` | Babel parse, directive extraction, `parseTypeValueExpr` |
| `@nudojs/cli` | Evaluator, `nudo infer` / `nudo watch` |
| `@nudojs/service` | High-level API: `analyzeFile`, `getTypeAtPosition`, `getCompletionsAtPosition` |
| `@nudojs/lsp` | Language Server Protocol implementation |
| `vite-plugin-nudo` | Vite plugin for type inference during dev |
| `nudo-vscode` | VS Code / Cursor extension |
| `website` | Docusaurus documentation site |

---

## Development Workflow

### Run tests

```bash
pnpm run test
pnpm run test:watch   # watch mode
```

### Build all packages

```bash
pnpm run build
```

### Run CLI locally

```bash
pnpm exec tsx packages/cli/src/index.ts infer path/to/file.js
# or
pnpm exec nudo infer path/to/file.js
```

---

## How to Add New Operator Semantics (Ops)

1. **Add the op in `packages/core/src/ops.ts`:**

   ```typescript
   export const Ops = {
     // ...
     myOp(left: TypeValue, right: TypeValue): TypeValue {
       // Handle literal × literal, literal × abstract, abstract × abstract
       return T.unknown; // fallback
     },
   } as const;

   const binaryOpMap = {
     // ...
     "myOpSymbol": Ops.myOp,
   };
   ```

2. **Wire it in the evaluator** (`packages/cli/src/evaluator.ts`):
   - For binary ops: map the AST operator string to your op in `BinaryExpression` handling.
   - The evaluator uses `applyBinaryOp(op, left, right)` for standard binary ops; extend `binaryOpMap` if needed.
   - For unary ops: add handling in the `UnaryExpression` case and call `Ops.myUnary(operand)`.

3. **Add tests** in `packages/core/src/__tests__/ops.test.ts` or `packages/cli/src/__tests__/evaluator*.test.ts`.

---

## How to Add New Directives

1. **Define the directive type** in `packages/parser/src/directives.ts`:

   ```typescript
   export type MyDirective = { kind: "my"; param: string };
   export type Directive = CaseDirective | ... | MyDirective;
   ```

2. **Add a regex** and parsing logic in `parseDirectivesFromComments`:

   ```typescript
   const MY_REGEX = /@nudo:my\s+(\w+)/g;
   // In the loop: match, extract, push { kind: "my", param: ... }
   ```

3. **Use the directive** in the evaluator or service:
   - `packages/cli/src/index.ts` or `packages/service/src/analyzer.ts` for analysis behavior.
   - Filter `fn.directives` by `d.kind === "my"` and apply your logic.

4. **Update `parseTypeValueExpr`** if the directive takes type-value arguments.

5. **Add tests** in `packages/parser/src/__tests__/directives*.test.ts`.

---

## PR Guidelines

- Keep PRs focused; prefer several small PRs over one large one.
- Add or update tests for new behavior.
- Run `pnpm run build` and `pnpm run test` before submitting.
- Update docs (e.g. `docs/concepts/directives.md`, API reference) when adding directives or public APIs.

---

## Code Style

- **TypeScript**: strict mode, ES modules.
- **Types**: Prefer `type` over `interface` and `enum`.
- **Structure**: Avoid class/OOP; use plain functions and objects.
- **Mutability**: Minimize `let`; prefer `const` and pure functions.
- **Control flow**: Minimize conditional branches; use early returns and small functions.
