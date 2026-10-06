---
description: 各包当前版本发布说明 —— 由 changesets CHANGELOG 自动生成；破坏性变更含迁移说明。
slug: /releases
---

# 发布记录

> 由 `pnpm run docs:gen` 从 `packages/*/CHANGELOG.md` 生成 —— 请勿手改。破坏性条目带 `**BREAKING**` 与一行迁移说明。

本页只保留各包**当前版本**说明。完整历史见 [完整发布历史](./releases-history.md)。

| 包 | 当前版本 |
|----|----------|
| `@nudojs/core` | 1.7.7 |
| `@nudojs/service` | 1.6.7 |
| `nudojs (CLI)` | 1.3.8 |
| `@nudojs/parser` | 1.4.4 |
| `@nudojs/lsp` | 1.4.5 |
| `@nudojs/env` | 0.4.22 |
| `@nudojs/harvester` | 0.3.8 |
| `vite-plugin-nudo` | 0.4.23 |
| `nudo-vscode` | 0.3.27 |

**按包跳转:** [`@nudojs/core`](#pkg-core) · [`@nudojs/service`](#pkg-service) · [`nudojs (CLI)`](#pkg-nudojs) · [`@nudojs/parser`](#pkg-parser) · [`@nudojs/lsp`](#pkg-lsp) · [`@nudojs/env`](#pkg-env) · [`@nudojs/harvester`](#pkg-harvester) · [`vite-plugin-nudo`](#pkg-vite-plugin) · [`nudo-vscode`](#pkg-vscode)

## @nudojs/core 1.7.7 {#pkg-core}

## 1.7.7

### Patch Changes

- d6fa067: fix(core): throws 域判定与值域计算粒度一致（Bug 2/3/23/25）—— L2 门（nudo:entry-may-throw）假阳性消除，守卫已证不抛的代码不再记 may-throw TypeError：
  
  - **Bug 2**：早退提升路径（transpileFnBodyStmts）补守卫剪影——`if (p === null) return -1;` 后接非终结尾句（中间绑定/副作用语句）时，尾句在 fork 假值臂内执行，`p` 以剪除 null 后的版本影子重绑，`p.major` 不再撞未剪 null 臂记假 may-throw（与 IfStatement 路径同源；issue #97 五变体不回归）。
  - **Bug 3**：nullish 守卫白名单扩展 + 剪除粒度——识别复合 `p === null || p === undefined`（否定臂剪 nullish）与 `typeof u === "undefined"`（假值臂只剪 undefined，`typeof null === "object"` 不误剪 null）；严格 `p === null`/`p === undefined` 按字面量粒度剪（`null === undefined` 为 false，严格等价只排除该字面量——同时修掉「假值臂连 undefined/null 一起剪」的既有假阴性）；`&&`/`||`/三元表达式面同享。
  - **Bug 23**：新增 typeof 类型守卫剪枝（typeGuardOf + $narrowTypeOf）——`typeof v === "string"` 真臂把 v 影子重绑为 union 中 typeof 匹配成员、假臂绑补集（不可判成员保守保留）；守卫臂内 `+`/关系/for-of/spread/解构/模板串拿到成员类型，七面（addStr/relStr/forOfStr/spreadStr/destrStr/tmplStr/addNum）零假 L2，`typeof v === "number"` 臂不再产不可能的 string 值臂。
  - **Bug 25**：isMaybeBigintOperand（arithmetic/surface 两处）对 sum 成员感知——纯 prim union（number|string）绝不可能是 Symbol/bigint，`v > "a"` 类关系运算不再记假 may-throw；obj/fn/brand/any 成员保持原子（对象经 @@toPrimitive 确可返 Symbol），unknown 豁免口径不变。
  
  回归红线：真实可抛路径不剪（严格守卫假值臂的 undefined/null 成员保留并照常报 L2；any 入口守卫后仍诚实 may-throw；unknown 令牌口径不变）；check-gold / check-recall-gold / check-real-packages 全绿。
- 92e6a5f: fix(core,env): L2 entry-may-throw 假阳性两处（issue #105 / #106）——1.3.5 的 builtin throws 语义对齐（2e5aeb35）引入的回归面：
  
  - **#105 typeof 守卫后的 any 不再记假 may-throw**：`$narrowTypeOf` 此前只剪 sum 成员，裸 `any`（无约束入口参数）在守卫事实臂原样保留 → `RegExp.exec/test(v)` 的 subject ToString 档位按 any 记 may-throw。修复：事实臂（keep=true）any 健全窄化为对应 prim（string/number/boolean/bigint/symbol，term/pred/conf 保留；补集臂与 object/function/undefined 不可表示、unknown fail-closed 令牌均保守保留）。npm-safe `parseVersion`（`typeof v !== 'string'` + `if (!m) return null` 双守卫 + 捕获组读）恢复干净。无守卫的 `exec(any)` 仍如实报（原生 `exec(Symbol())` 抛 TypeError，与 check-gold 的 scale(x) 口径一致）。
  - **#106 env 声明构造器不再报 constructibility 假抛**：env 的 Error 族声明为无名 envFn——`$new` 的按名派发（evalBuiltinNew → errorBrandAbs）拿不到名字，落到通用 fn 分支的 unknown-constructibility 门；`$class` 的 extends 门同样只见 ctor:undefined，`class ApiError extends Error` 定义期误报。修复：`envFn` 支持 `ctor` facet 并给 relationFn 路径补 `name` 盖章；Error 族 / Date / Promise / URL / AbortController / EventEmitter / stream 族声明 ctor:true（Symbol 声明 ctor:false——原生非构造器，`new Symbol()` / `extends Symbol` 仍定抛）；`$new` 的 ctor:true-无-impl 路径回落声明 returnType（保实例面精度，AbortController/EventEmitter 不丢方法槽）。`new Error('lit')` / `new TypeError('lit')` / `new ApiError(...)` / `class extends Error` 在 env 下恢复干净；`new Error(anyMsg)` 仍如实报 message ToString may-throw（node 实测 `new Error(Symbol())` 抛 TypeError，与无 env 宿主路径同口径）。

更早版本（30）→ [完整发布历史](./releases-history.md#pkg-core)

## @nudojs/service 1.6.7 {#pkg-service}

## 1.6.7

### Patch Changes

- Updated dependencies [d6fa067]
- Updated dependencies [92e6a5f]
  - @nudojs/core@1.7.7
  - @nudojs/env@0.4.22
  - @nudojs/harvester@0.3.8
  - @nudojs/parser@1.4.4

更早版本（32）→ [完整发布历史](./releases-history.md#pkg-service)

## nudojs (CLI) 1.3.8 {#pkg-nudojs}

## 1.3.8

### Patch Changes

- d6fa067: fix(core): 函数边界缺参归一——省略尾实参不再以宿主 undefined 流入（Bug 7 / Bug 12）
  
  - **Bug 7（部分传参，假阳性）**：`two(s)` 对 `two(a, b)` 把宿主 `undefined` 送进 `$add` 等算子（读 `.shape` 崩溃被收成假 may-throw），或经 return 通道泄漏裸值。修复：宿主绑定元数内省略槽位按「显式传 undefined」归一为 `lit(undefined)`——函数声明/类方法在转译 prologue 收形（`p = $absVal(p)`），函数表达式/对象方法在 `$fnVal` apply 钩子按 `impl.length` 补齐（读宿主 `arguments` 的 function 包装走 `padArgs: false` + 体内归一，`arguments.length` 不膨胀）。
  - **Bug 12（零参调用，假阴性）**：`f(a){return a.b}` 零参原折 `unknown` 无 throws（确定抛被折成保证不抛）。归一后 `$get`/解构守卫走 nullish 硬抛——`throws TypeError` 与原生一致；wave-1 的 unknown 接收者政策不变。
  - `+` 代数不设 `lit(undefined) ⊗ any` 专用零抛臂：`undefined + any` 落既有 anyLike 臂（值域 `number | string`，any 侧可为 Symbol → 原生 may TypeError，与 `any + 1` / `any ⊕ any` 同口径记 may-throw——省略归一只消除宿主裸值崩溃/泄漏，不放宽 any 的投射面）；`s + 1` 的 policy 不变。
  - 红线保持：默认参照常取默认、rest 收 `[]` 不补、`typeof` 折 `"undefined"`、显式 `undefined` 实参语义不变、数组解构零参迭代守卫硬抛、checkSource 入口 any 路径不变。
- Updated dependencies [d6fa067]
- Updated dependencies [92e6a5f]
  - @nudojs/core@1.7.7
  - @nudojs/env@0.4.22
  - @nudojs/harvester@0.3.8
  - @nudojs/parser@1.4.4
  - @nudojs/service@1.6.7

更早版本（29）→ [完整发布历史](./releases-history.md#pkg-nudojs)

## @nudojs/parser 1.4.4 {#pkg-parser}

## 1.4.4

### Patch Changes

- Updated dependencies [d6fa067]
- Updated dependencies [92e6a5f]
  - @nudojs/core@1.7.7

更早版本（29）→ [完整发布历史](./releases-history.md#pkg-parser)

## @nudojs/lsp 1.4.5 {#pkg-lsp}

## 1.4.5

### Patch Changes

- Updated dependencies [d6fa067]
- Updated dependencies [92e6a5f]
  - @nudojs/core@1.7.7
  - @nudojs/parser@1.4.4
  - @nudojs/service@1.6.7

更早版本（33）→ [完整发布历史](./releases-history.md#pkg-lsp)

## @nudojs/env 0.4.22 {#pkg-env}

## 0.4.22

### Patch Changes

- 92e6a5f: fix(core,env): L2 entry-may-throw 假阳性两处（issue #105 / #106）——1.3.5 的 builtin throws 语义对齐（2e5aeb35）引入的回归面：
  
  - **#105 typeof 守卫后的 any 不再记假 may-throw**：`$narrowTypeOf` 此前只剪 sum 成员，裸 `any`（无约束入口参数）在守卫事实臂原样保留 → `RegExp.exec/test(v)` 的 subject ToString 档位按 any 记 may-throw。修复：事实臂（keep=true）any 健全窄化为对应 prim（string/number/boolean/bigint/symbol，term/pred/conf 保留；补集臂与 object/function/undefined 不可表示、unknown fail-closed 令牌均保守保留）。npm-safe `parseVersion`（`typeof v !== 'string'` + `if (!m) return null` 双守卫 + 捕获组读）恢复干净。无守卫的 `exec(any)` 仍如实报（原生 `exec(Symbol())` 抛 TypeError，与 check-gold 的 scale(x) 口径一致）。
  - **#106 env 声明构造器不再报 constructibility 假抛**：env 的 Error 族声明为无名 envFn——`$new` 的按名派发（evalBuiltinNew → errorBrandAbs）拿不到名字，落到通用 fn 分支的 unknown-constructibility 门；`$class` 的 extends 门同样只见 ctor:undefined，`class ApiError extends Error` 定义期误报。修复：`envFn` 支持 `ctor` facet 并给 relationFn 路径补 `name` 盖章；Error 族 / Date / Promise / URL / AbortController / EventEmitter / stream 族声明 ctor:true（Symbol 声明 ctor:false——原生非构造器，`new Symbol()` / `extends Symbol` 仍定抛）；`$new` 的 ctor:true-无-impl 路径回落声明 returnType（保实例面精度，AbortController/EventEmitter 不丢方法槽）。`new Error('lit')` / `new TypeError('lit')` / `new ApiError(...)` / `class extends Error` 在 env 下恢复干净；`new Error(anyMsg)` 仍如实报 message ToString may-throw（node 实测 `new Error(Symbol())` 抛 TypeError，与无 env 宿主路径同口径）。
- Updated dependencies [d6fa067]
- Updated dependencies [92e6a5f]
  - @nudojs/core@1.7.7

更早版本（29）→ [完整发布历史](./releases-history.md#pkg-env)

## @nudojs/harvester 0.3.8 {#pkg-harvester}

## 0.3.8

### Patch Changes

- Updated dependencies [d6fa067]
- Updated dependencies [92e6a5f]
  - @nudojs/core@1.7.7
  - @nudojs/env@0.4.22
  - @nudojs/parser@1.4.4

更早版本（29）→ [完整发布历史](./releases-history.md#pkg-harvester)

## vite-plugin-nudo 0.4.23 {#pkg-vite-plugin}

## 0.4.23

### Patch Changes

- Updated dependencies [d6fa067]
- Updated dependencies [92e6a5f]
  - @nudojs/core@1.7.7
  - @nudojs/service@1.6.7

更早版本（32）→ [完整发布历史](./releases-history.md#pkg-vite-plugin)

## nudo-vscode 0.3.7 {#pkg-vscode}

## Unreleased

- Settings wiring is real now: `nudo.analysis.mode` is forwarded to the language server as `initializationOptions` and re-pushed on `workspace/didChangeConfiguration` (only for `nudo.*` changes). Priority: an explicit project `package.json#nudo.analysis.mode` always wins; the VS Code setting only provides the default when the project does not set it (also stated in the setting description). `nudo.coexistence.suggestMuteTsValidation` is consumed extension-side: when false, `Nudo: Apply coexistence settings` no longer offers the tsserver mute suggestion — only the guide link.
- Case highlight decorations now parse via `@nudojs/parser` (`parse` + `extractDirectivesQuiet`, the same `@nudo:case` grammar as the server) instead of a parallel regex implementation in the extension; pure span computation lives in `src/case-decorations.ts` (unit-tested), the extension only maps spans to `vscode.Range`.
- Bundle fix: `tsup` auto-externalized `dependencies`, so `out/extension.js` shipped unresolvable `require("vscode-languageclient/node")` (and would have for the new `@nudojs/parser`) while the vsix excludes `node_modules/`. `tsup.config.ts` now bundles both into the self-contained `out/extension.js`.

更早版本（3）→ [完整发布历史](./releases-history.md#pkg-vscode)
