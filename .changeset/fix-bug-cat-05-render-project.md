---
"@nudojs/core": patch
"@nudojs/service": patch
---

Fix bug-report category 05 (rendering / projection / emit generators) — 11 of 17 defects.

- BUG-025: the standard-schema `promise` node tests `instanceof Promise` in both the
  library and the inlined copy, so a non-promise value is rejected instead of accepted.
- BUG-031: `litPredValue` became `litPredValues` and recognises
  `or(eq(...arm), ...)`, so a literal-union contract renders as `1 | 2 | 3` in the
  signature face, matching the dts face byte for byte.
- BUG-087: `showLits` renders the **type** (`3`, `"a"`) instead of leaking the contract
  DSL spelling (`lit(3)`) into signatures and slot displays.
- BUG-092: `predAsJs` / `termIsValue` emit `Number.isInteger(v)` for a `%1 === 0`
  predicate and compare field items by value, so nested numeric bounds agree across all
  four faces.
- BUG-095: the `arr` branch uses `Array.from(v).every(...)` (holes filled with
  `undefined`), matching the standard face — `[1, , 3]` is no longer accepted by the
  guard.
- BUG-097: a slot named like an `Object.prototype` own member is read with bracket
  access, so the guard compiles under `tsc --strict` (TS2367 gone).
- BUG-098: the `brand` branch drops observed literals deeply, so a brand built from an
  observed `/abc/i` or `new TypeError("boom")` accepts the real value.
- BUG-145: a same-name slot produces no inlay hint (it previously rendered another
  binding's derivation).
- BUG-147: inlay hints cover anonymous default exports (arrow, function expression, and
  a `FunctionDeclaration` without an id).
- BUG-158: an `Arguments` brand no longer emits an `Array.isArray` premise while keeping
  its length/index semantics, so the guard accepts `arguments` at runtime.
- BUG-250: the guard declares `const data: any` when the contract carries an identity
  clause, so `instanceof` narrowing no longer blocks index reads
  (`tsc --strict` TS7053 gone).

Also updates `core-bug-348-lit-literal-signature.test.ts`, which pinned the
`f(x: lit(1))` spelling that BUG-087 declares wrong, to the corrected `f(x: 1)`.

Regression tests: `core-bug-{031,087,092,095,097,098,145,147,158}-*`,
`service-bug-{025,250}-*`.

Known follow-ups NOT covered here (root cause outside this category's file set):
BUG-091 (needs `lsp/src/lsp-surface/completions.ts`), BUG-096 (needs
`schema-generator.ts`), BUG-108 / BUG-169 (need `dts-generator.ts` + `schema-generator.ts`),
BUG-156 (needs `schema-generator.ts`), BUG-191 (needs `dts-generator.ts:1986-1995`).

### 追加：BUG-096 / BUG-169 / BUG-191 已修 + BUG-258 的 facet 与投影面

- **BUG-096（键存在性三面不一致）**：zod 面原生用 `key in data`（含 `Object.prototype` 成员），
  guard / standard 面减污染键 ⇒ `Object.create({toString:"s"})` 在 zod 面被放行。反向改
  guard/standard 会改 `hasPropertyClause` 的子句文本，而该文本被 `eval-bug-191-accessor-projection`
  与 `eval-bug-240-guard-internal-slots` **逐字钉住** ⇒ 只能把 zod 面补齐：`schema-generator.ts`
  对「**必填**且键名是 `Object.prototype` 自有成员」的槽追加 `.superRefine`（沿用同文件 `__proto__`
  槽的既有模式），子句与 guard **逐字同口径**；非污染键不加码（`z.object` 原生判据已与另两面等价）。
  同时修正三处自述注释（`denote.ts` / `standard-schema.ts` / 产物 `__nudoHasProperty`）为「三面唯一
  规则」。guard / standard 的**代码未变**。回归 `service-bug-096-key-presence-parity.test.ts`。
- **BUG-169（TS 可选形参 `b?: T` 丢失）**：`?` 在 strip-types 阶段被删（param 节点 `optional`
  为 `undefined`），`formalParamsFromNodes` 的 `kind:"id"` 硬写 `optional:false`；dts 的
  `declaredParams` case `"id"` 硬写 `hasDefault:false`；standard 只认 `kind==="default"`。
  修：`param-surface.ts` 的 `formalParamsFromNodes(params, source?)` 末尾接
  `withOptionalParams(out, tsOptionalParams(params, source))`（**无 source 时集合为空 ⇒ 零行为变化**，
  `generalize.ts` / `exec/transpile` 等未传 source 的调用点不受影响）；`dts-generator.ts` 的
  `case "id"` 改 `hasDefault: f.optional === true`；`standard-schema.ts` 的 `declarationOptional`
  认 `kind === "default"` ∪ (`kind === "id"` && `optional`)。服务面 `extractFormals(node, source?)`
  与 3 处调用点只做 **source 透传**（无语义改动）。回归 `emit-bug-169-ts-optional-params.test.ts`
  （差分口径：三面可省性 ≡ 源码 JS 默认值 ∪ TS `?`）。
- **BUG-191（`export namespace` 缺失）**：`scan-named-exports.ts` 的 `ExportNamedDeclaration`
  声明分支只认 Function/Class/Variable ⇒ `TSModuleDeclaration` 落 `continue` 被静默丢弃；
  `dts-generator.ts` 同款缺口且从不发射 ⇒ 消费端 TS2305，而求值器确实物化了 `NS`。修：
  `scan-named-exports.ts` 新增 `TSModuleDeclaration` 分支（登记 `NS` + 运行时成员键
  `NS.x` / `NS.f` / 嵌套 `NS.Inner.y`；interface / type 是纯类型**不**登记，`addNamespaceMemberKeys`
  只认 `export` 过的成员）；`dts-generator.ts` 增加 `namespaces` 面并发射
  `export declare namespace NS { … }` + 别名导出（class 发空体；enum/interface/type 镜像原文；
  嵌套递归；`namespace A.B` 认尾段）。回归 `emit-bug-191-export-namespace.test.ts`。
- **BUG-258（数组视图 facet）**：数组视图信息原由 `builtins/regexp.ts` 的 `WeakSet` 侧表（按 Abs
  身份）承载，只有 `Array.isArray` / JSON 序列化 / 数组方法派发消费，类型面完全看不见 ⇒ 同一个值在
  引擎内两个结论。修：`abs.ts` 的 `{k:"obj"}` 形状增加 `view?: "array"` facet +
  `markArrayView` / `isArrayView`（**不**导出到公开面 ⇒ 快照零变化；`markArrayView` 是**替换** shape，
  不是就地改共享 shape）；`regexp.ts` 删除 WeakSet 侧表，`markMatchArrayView` / `isMatchArrayView`
  保留同名同签名降为 facet 薄包装；消费面（`array.ts` / `json.ts` / `member.ts` 派发）只读 facet。
  运行形状仍是 `k:"obj"`（**未**改 tuple）⇒ `eval-call-position.test.ts:344-350` 的
  `"0":"b"` / `index:1` / `input:"abc"` 仍成立。回归 `core-bug-258-array-view-facet.test.ts`。
  未完成（已定位）：四个产物面（dts / zod / standard / guard 的 obj 分支）尚未按
  `shape.view === "array"` 分支；多 case join 时 `joinObjects` 重建 shape 不带 `view`，需一侧传递。

### 追加：BUG-258 四产物面 + BUG-169 zod 面

- **BUG-258 产物面**（facet 本体见 cat-04）：**guard 面**（`denote.ts`）obj 分支改判
  `shape.view === "array"` ⇒ `Array.isArray(v)`（取代 `typeof/object` + `!Array.isArray`；槽判据一字
  未动 —— exec 结果的 `0/1/length/index/input/groups` 全是自有属性）；**dts 面**
  （`dts-generator.ts`）数组视图投影成**元组** + 其余自有槽的交集（`length` 由元组隐含），
  `widenParamAbs` 透传 `view` facet（否则形参位会退回对象字面量）；**zod 面**
  （`schema-generator.ts`）`SchemaNode.obj` 增 `arrayView?: boolean`，渲染 `z.tuple(...)`
  （`z.object` 会拒真实数组），非下标槽记台账 `non-index slots not validated by z.tuple`；
  **standard 面**（`standard-schema.ts`）库函数版与产物版都要求 `Array.isArray(value)`，
  `arrayView` 随节点序列化，产物类型别名 `NudoSchemaNode` 补 `arrayView?: boolean`
  —— 这是**修产物类型**，不是放宽 `emit-bug-519-989` 的 strict 编译门禁。
- **BUG-169 zod 面**：`nudojs/src/commands/export/contract-face.ts` 的 `unifiedParamFace` 常规形参
  分支改为 `formal.optional === true || formal.kind === "default" || formal.index >= minArity`
  —— `FormalParam.optional`（已接通 TS `?`）成为唯一事实源；无 `?` 的声明仍按观测最少实参元数放宽。
  回归用「一键实参」观测把 `minArity` 钉在 1，使下标 1 的可省性只可能来自 TS `?`。

回归：`core-bug-258-array-view-facet.test.ts`（6 例）、
`service-bug-258-array-view-products.test.ts`（5 例）、`emit-bug-169-ts-optional-params.test.ts`
（5 例）；`service/src/emit/__tests__` 114 文件 / 798 例、core algebra 973 文件 / 10 431 例、
service 242 文件 / 1 318 例全绿。残留：多 case join 的 `joinObjects` facet 传递（`objects.ts`）。
