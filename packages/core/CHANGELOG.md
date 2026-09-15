# @nudojs/core

## 0.4.1

### Patch Changes

- 78f6752: Fix hover, case switching, and NaN folding in Zed-style clients.

  - `const n = double(21)` reports the init Abs (`42`) instead of the statement's `unknown` (record the declarator id in `evalVarDecl`).
  - `const s = double("a")` is `NaN` (JS `"a" * 2`), not `unknown` — concrete string/boolean lits coerce under ToNumber; `formatAbs` prints `NaN`/`Infinity` instead of `null`.
  - Relational compare folds mixed concrete lits (`"a" > 3` → false), so `if (x > 3)` does not join both branches for NaN inputs.
  - `joinValues` uses `Object.is` so `join(NaN, NaN)` stays `NaN` (`NaN === NaN` is false).
  - `workspace/executeCommand` accepts positional `nudo.selectCase` args from CodeLens (`[uri, fn, index, name]`).
  - Hover inside `@nudo:case` functions goes through TypeValue + `activeCases` instead of call-site B-path nodes.
  - Param inlay no longer invents `where x > 3` from `if (x > 3) return x` — only explicit `@nudo:refine` contracts show as preconditions.
  - Return inlay is a path summary with source param names: `x + 1`, `x | x * 2` (not the refined `number where x>3 | string | …` dump).
  - Number range narrowing uses exclusive bounds (`> 3`, not integer-style `>= 4`).
  - Concrete `if` tests no longer narrow the tested value into a range (`44 > 3` keeps `x` as `44`).
  - True branch of `x > k` on unknown refines to `number>… | string` (JS ToNumber space).
  - `flattenSum` keys prim members by term/pred so `number=A1>3` and `number=A1*2` stay distinct paths.

## 0.4.0

### Minor Changes

- 1d6bb01: 修复抽象执行器的多处精度与门禁缺陷（dogfooding 回归全绿）：

  - 结构门禁：`@nudo:refine` 在 `export function`/`export const`/`export default`/`async` 声明上被静默丢弃（refine.ts 的声明正则只匹配裸 `function`）——现在导出函数上的参数 refine 真实生效，`string()` 原语约束能拦截 `first(42)` 这类调用（退出码 1）
  - 转译执行（exec/transpile.ts 等）：解构形参绑定、`+=` 等复合赋值、`Math.*`/`Number.isNaN` 命名空间调用、正则字面量 `.exec` 捕获组、可选链真值判断、`i++`、成员/索引写回、三元表达式、`new Array().fill`、字符串下标/长度——此前均丢失精确值（case 求值为 unknown），现在 `@nudo:case ... => expected` 在这些体上可精确断言（含 OSA 编辑距离 DP 矩阵、semver 比较链）
  - 早返回折叠：`if (c) return X;` 语句级 `$fork` 的返回值被静默丢弃导致整函数回退到最后一条 return——改为位置感知提升（后续语句整体进 else 分支），`join` 语义与 JS 控制流一致
  - bridge：`null` 字面量可投影为 `T.literal(null)`，`=> null` 期望成立

### Patch Changes

- 1d233a7: Fix hover and CodeLens case switching in Zed-style clients, and fold JS ToNumber for `- * / %`.

  - `const n = double(21)` now reports the init Abs (`42`) instead of the statement's `unknown` (record the declarator id in `evalVarDecl`).
  - `const s = double("a")` is `NaN` (JS `"a" * 2`), not `unknown` — concrete string/boolean lits coerce under ToNumber; `formatAbs` prints `NaN`/`Infinity` instead of `null`.
  - `workspace/executeCommand` accepts positional `nudo.selectCase` args from CodeLens (`[uri, fn, index, name]`), not only the agent object form.
  - Hover inside `@nudo:case` functions goes through TypeValue + `activeCases` instead of call-site B-path nodes, so selecting a case actually changes the shown types.

## 0.3.1

### Patch Changes

- 21427eb: Fix directive-case args lost in early-return branches: fold `if (c) return X; …tail` into `return $fork` in B-path transpile, and join partial-return fall-through in AST `evalBlock`. `@nudo:case "A" (92)` on a graded if now yields `"A"`; `nudo test` expected cases pass; doctor-emitted `call@` solidifies correctly.
- df1726c: Make `@nudo:env` actually affect inference: declaration-only fnSigs (readFileSync) now become relationFns instead of unknown-on-call, B-path `$invoke` implements string methods and filters union members, and `collectAbsCallRecords` merges env modules so call@ cases no longer overwrite correct B-path results.
- bee69d4: Publish built dist instead of TypeScript source: packages now ship compiled ESM + .d.ts, CLI bin gets a shebang, `nudo --version` reads the real package version, and `nudo check` accepts multiple paths.
- 8d85d99: Fix refine template gate for array()/string() and stop body method calls from inventing object shapes: typeof preds are checked at call sites, refine contracts take priority over structural inference, method names (`p.some`/`p.replace`) are no longer required data fields, array() constraints produce arr entry Abs, and `{...base}` call-site args resolve file-level bindings.

## 0.3.0

### Minor Changes

- 5786fa5: Promote the B-path (transpile + in-process Abs runtime) to the primary evaluation path for capable sources.

  - Module graph now supports relative imports, bare-package harvest, default/namespace imports, re-exports, `export *`, require, cycle/depth/missing guards, and env modules (`path` / `node:path` etc.).
  - Diagnostics, `@nudo:env` / mock injection, `call@` / `entry@` provenance, method-missing, unknown-recv, generators, classes, async/await, optional chaining, and destructuring run through B.
  - When B hosts a file, `evaluateProgram` is skipped so TypeValue no longer double-reports.
  - CLI `check` / `types` / `test` accept directories; check uses an Abs-only gate.
  - LSP hover / `getTypeAtPosition` on capable files read the Abs node table; `*.nudo.js` edits evict L0 and recheck open parents.
  - Public core surface now re-exports the algebra API (`Abs`, check, generalize, exec, bridge, `parseSource`, `stripTypes`).

- 5786fa5: Speed up repeated analysis with layered memos and tighter cache contracts.

  - Shared parse/AST LRU, `generalizeFromAst` L0–L3 (instantiate, α-equivalence, dep fingerprint + LRU), Abs module cache, and session-wide memos with an incremental after-edit path.
  - Host cache-eviction contract, AST/function-fingerprint memory caps, conservative call-scan depth cap, and fail-open truncated dependency fingerprints.
  - Fix session-memo staleness and identity holes so after-edit results stay correct.

## 0.2.0

### Minor Changes

- 6c38283: docs and ci
- 9f7f819: fix pkg info
- c175f71: version

## 0.1.0

### Minor Changes

- Conceptual design and basic implementation.
