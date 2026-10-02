---
description: "@nudojs/core API —— Abs 类型体系（shape × term × pred × conf）、构造器、可赋值性与格式化、运算符语义、模板字符串、mock 帮助函数与 Environment。"
---

# @nudojs/core

core 包提供 Abs 类型体系、运算符语义以及环境抽象，是 Nudo 抽象解释引擎的核心支撑。类型体系**只有一个——Abs**：分析、展示与投影（`.d.ts` / zod / guard）全部直接消费 Abs，不存在平行 IR。

## Abs

`Abs` 就是类型系统——一个可计算的值 `{ shape, term?, pred?, conf }`：

- **shape**——外延载体：值长什么样（`prim`、`obj`、`arr`…）。
- **term**——抽象值身份：`lit`（具体值）、`var`（符号 α，如 `A1`）或 `app`（应用表达式，如 `(x + 2)`）。约束因此能参与代数：`x > 0` ⇒ `x + 1 > 1`。
- **pred**——相对 term 的约束（如 `(x + 2) > 3`），恒真时为 `undefined`。
- **conf**——`Confidence`：`"exact" | "path" | "widened" | "partial" | "opaque"`。

### Shape 种类

| `shape.k` | 描述 |
|-----------|-------------|
| `prim` | 基本类型域（`number`、`string`、`boolean`、`bigint`、`symbol`）；带 `lit` term 即具体值 |
| `obj` | 已知槽位的对象——每个键为 `{ value: Abs; optional?: boolean }` |
| `arr` | 单一元素 Abs 的数组 |
| `tuple` | 定长、逐元素 Abs |
| `fn` | 函数值——参数名，或仅签名的 `paramTypes`/`returnType` |
| `eff` | 效应包装（`promise` / `generator`）包裹内层 Abs——渲染为 `promise<inner>` |
| `brand` | 名义类实例（如 `MemoryStore`、`Error`） |
| `sum` | 成员 Abs 的联合 |
| `never` | 空集（不可达） |
| `any` | 无约束 JS 值并集 —— 未标注入口参数的默认；开发者负责细化 |
| `unknown` | 推导失败 / 引擎无信息 —— **不是** `any` 的同义词；Nudo 负责修 |

详见 [Abs — any vs unknown](../concepts/abs.md#any-vs-unknown)。

---

## Abs 构造器

```typescript
// 基本类型（域，无 term）
num(): Abs
str(): Abs
bool(): Abs

// 字面量值（prim shape + lit term）
numLit(value: number): Abs
strLit(value: string): Abs
boolLit(value: boolean): Abs

// 对象：按属性名给槽位
obj(slots: Record<string, { value: Abs; optional?: boolean }>): Abs

// 符号变量（内涵签名的形参）
anyVar(id: string, conf?): Abs
numVar(id: string, pred?, conf?): Abs

// 常量
never: Abs            // { shape: { k: "never" }, conf: "exact" }
// any / unknown 是不同产品概念：
//   any     —— 无约束（未标注入口的默认）
//   unknown —— 推导失败（引擎债），conf 通常为 partial/opaque
unknown: Abs          // { shape: { k: "unknown" }, conf: "partial" }

// 通用构造器（pred=true 会被丢弃）
abs(shape: Shape, term: Term | undefined, pred: Pred | undefined, conf: Confidence): Abs

// 函数值（impl：body AST、闭包 env 或直接派发的 apply）
absFunction(params: string[], impl: { body?: Node; async?: boolean; env?: AstEnv; apply?: (args: Abs[]) => Abs }): Abs
```

term 与 pred 也是一等公民：`lit(value)` / `v(id)` 构造 term，`eq/ne/lt/le/gt/ge`、`ptypeof`、`and/or/not` 构造 pred（`pred.ts`、`term.ts`）。

---

## 核心函数

| 函数 | 描述 |
|----------|-------------|
| `leqAbs(src, tgt, opts?)` | 可赋值性：`src` 能否流入 `tgt`？返回 `{ ok, reason? }`——`reason` 是 Nudo 式 `actual ⊭ expected` 证据，不是 TS 文案。 |
| `formatAbs(a, opts?)` | 人类可读单行：shape、`= term`、`where pred`、`#conf`。 |
| `formatShape(a)` | 仅 shape 渲染（`{ host: "localhost", port: 8080 }`、`[2, 4, 6]`、`promise<{…}>`）。 |
| `formatAbsMultiline(a, label?)` | 多行展示（CLI inlay）。 |
| `absToString(a)` / `shapeToString(s)` | 调试渲染，含 `term=`。 |
| `litValue(a)` | 若 Abs 是精确字面量，取出具体值。 |
| `confJoin(a, b)` | 连接两个置信度（取更差的）。 |
| `checkSource(source, opts?)` | CI 门禁：Abs 上的契约/Pred 蕴含——见 [Check](../guides/check.md)。 |
| `runTranspiled` / `callTranspiledExportFull` / `analyzeFn(…)` | Abs 原生求值入口（evaluator）。 |
| `generalizeFromAst(…)` | 内涵签名提取——`intension:` 行与 `A1` 形参的来源。 |

---

## 运算符语义（Abs 原生）

运算符在 Abs 上代数化。算术、比较、一元与 spread 位于：

| 位置 | 内容 |
|-------|------|
| `core/src/algebra/surface.ts` | `typeofAbs`、`negAbs`、`notAbs`、`strictEqAbs`（一元运算 + 严格相等） |
| `core/src/algebra/arithmetic.ts` | 二元算术（`+` `-` `*` `/` `%`）与比较 |
| `service/src/evaluator/abs-route.ts` | 二元/一元运算与对象 spread 的 union 逐成员路由 |

唯一求值引擎是 evaluator（`core/algebra/exec`：转译 → 以 Abs 值执行 `new Function`）。B 不可托管源 fail-closed（`unknown` / 空导出）。

---

## 模板字符串

字面量与抽象字符串拼接（至少一侧是字面量）会产生**模板** Abs——已知前后缀作为 pred 元数据保留，使 `startsWith` / `endsWith` / `includes` 精确。

```typescript
createTemplateAbs(parts: Abs[]): Abs   // 如 [strLit("0x"), str()]——单段或
                                       // 全字面量输入会坍缩为普通 Abs
isTemplateLike(a: Abs): boolean
```

数值区间在代数里不是类型包装——窄化出的边界是 term 上的 **pred**（`x >= 0` 存 `ge(x, lit(0))`），`checkSource` 的蕴含门禁正是在它上面推理。

---

## Mock 帮助函数

`@nudo:mock` 表达式与 env 文件共享的类型安全 mock 构造器——`MockHelper` 是一个普通记录，其值字段为 **Abs**（唯一类型系统；分析从不读回投影）。`@nudojs/parser` 经 `parseNudoMockExpr` 从 `@nudo:mock` 表达式构建它；`@nudojs/service` 的 `mockDirectivesToAbsSeeds` 将其转为 Abs mock 种子：

```typescript
type MockHelper = {
  kind: "mock-helper";
  returnValue?: Abs;        // stub().returns(v)
  resolvedValue?: Abs;      // stub().resolves(v) —— 调用返回 Promise<v>
  rejectedValue?: Abs;      // stub().rejects(v) —— 调用抛出/拒绝 v
  onFirstCallValue?: Abs;   // stub().onFirstCall(v)
  onSecondCallValue?: Abs;  // stub().onSecondCall(v)
  withArgsCases?: { args: Abs[]; returnValue: Abs }[];  // stub().withArgs(...)
  callsFakeImpl?: { params: string[]; body: Node; async?: boolean };  // stub().callsFake(fn) —— 调用时执行 fn
};

function stub(): MockHelper;
function spy(): MockHelper;
function mock(): MockHelper;
```

`stub`、`spy`、`mock` 返回相同的基础 helper，只是语义意图不同；行为来自**挂在 `stub`/`spy` 上的静态构造器**——每个都返回完整的 `MockHelper`（没有实例级链式调用）：

```typescript
stub.returns(v: Abs): MockHelper
stub.resolves(v: Abs): MockHelper       // 调用返回 Promise<v>
stub.rejects(v: Abs): MockHelper        // 调用以 v 拒绝
stub.onFirstCall(v: Abs): MockHelper
stub.onSecondCall(v: Abs): MockHelper
stub.withArgs(...args: Abs[]): MockHelper
stub.callsFake(fn: { params: string[]; body: Node; async?: boolean }): MockHelper
spy.returns(v: Abs): MockHelper
```

在 `@nudo:mock` 表达式中写的是 sinon 风格链 `stub().…`——解析器对整条链做模式匹配，构造等价的 `MockHelper`（`stub()` 调用本身不会执行）：

```javascript
/**
 * @nudo:mock fetch = stub().resolves({ ok: true })
 * @nudo:mock parse = stub().withArgs(string()).returns(number())
 */
```

`withArgs` 按位置逐位匹配实参（sinon 深比较的保守近似），在更长链中优先级高于全局 `returnValue`；`callsFake(fn)` 直接解析为 fake 函数值本身，调用时会以真实实参执行它——与行内箭头函数 mock 走同一机制。

---

## Environment

Environment 管理变量绑定（名称 → Abs），支持词法作用域。

```typescript
createEnvironment(parent?, bindings?)
```

- `parent` — 可选的父 Environment，用于作用域链。
- `bindings` — 可选的 `Map<string, Abs>`，作为初始绑定（默认：`new Map()`）。

### Environment 方法

| 方法 | 描述 |
|--------|-------------|
| `lookup(name)` | 获取绑定到 `name` 的 Abs；沿父链查找；未找到时返回 `unknown` Abs。 |
| `bind(name, value)` | 在当前 env 中设置绑定；返回 env 以支持链式调用。 |
| `update(name, value)` | 更新当前 env 或父 env 中已有的绑定；返回 `boolean` 表示是否成功。 |
| `extend(bindings)` | 创建带有新绑定的子 env（普通 `Record<string, Abs>`）。 |
| `fork()` | 创建共享当前作用域链的空子 env——分支分叉时使用。 |
| `has(name)` | 检查名称是否已绑定（当前 env 或父 env）。 |
| `snapshot()` | env 的深拷贝（用于分支分叉）。 |
| `getOwnBindings()` | 获取仅当前 env 绑定的 `Record<string, Abs>`。 |

## Export inventory

<!-- NUDO-API-SKELETON:BEGIN -->
> 由 `pnpm run docs:gen:api` 从包导出面（`PUBLIC_API.md` / `src/index.ts`）生成 —— 请勿手改本块。重新生成：`node scripts/gen-api-docs.mjs`。每行名字带稳定锚点 `#slug`（符号名小写）。

产品面清单来自 `packages/core/PUBLIC_API.md` §2，按子节分组：类型系统核心（§2.1）与 Exec 运行时（§2.2，`$op` 族）。`src/index.ts` 中其余非 `$op` 再导出名折叠进下方清单。宿主机件在 `@nudojs/core/internal`，刻意不在本表。

### 类型系统核心（§2.1）

| 名称 | 种类 | 说明 | 签名 |
|------|------|------|------|
| <a id="abs"></a>`abs` | fn | Abs constructors / faces | `abs( shape: Shape, term: Term \| undefined, pred: Pred \| undefined, conf: Confidence, ): Abs` |
| <a id="abs"></a>`Abs` | type | Abs = shape × term × pred × conf; `LiteralValue` 含 bigint | `Abs = { shape: Shape; term?: Term; pred?: Pred; conf: Confidence; pathNote?: string; }` |
| <a id="absapplynothrow"></a>`AbsApplyNoThrow` | type | no-throw apply face: narrow signature for impls that return bare `Abs`; `absOnly` peels the abs facet off `AbsApplyReturn` (test/host convenience, drops throws) | `AbsApplyNoThrow = Abs` |
| <a id="absapplynothrowfn"></a>`AbsApplyNoThrowFn` | type | no-throw apply face: narrow signature for impls that return bare `Abs`; `absOnly` peels the abs facet off `AbsApplyReturn` (test/host convenience, drops throws) | `AbsApplyNoThrowFn = (args: Abs[], thisVal?: Abs) => AbsApplyNoThrow` |
| <a id="absapplyresult"></a>`AbsApplyResult` | type | evaluator execution (analyze mode); `callTranspiledExportApply` is the only apply-wrap of `callTranspiledExportFull` (throws channel, H1); construct AbsApplyResult only via `makeAbsApplyResult` (brand) | `AbsApplyResult = { abs: Abs; throws: Abs; readonly applyResult: true; }` |
| <a id="absonly"></a>`absOnly` | fn | no-throw apply face: narrow signature for impls that return bare `Abs`; `absOnly` peels the abs facet off `AbsApplyReturn` (test/host convenience, drops throws) | `absOnly(r: AbsApplyReturn): AbsApplyNoThrow` |
| <a id="abstoschemasource"></a>`absToSchemaSource` | const | one-way projections | — |
| <a id="abstotstype"></a>`absToTSType` | const | one-way projections | — |
| <a id="and"></a>`and` | fn | `@nudo:contract` builder grammar | `and(...preds: Pred[]): Pred` |
| <a id="andc"></a>`andC` | fn | `@nudo:contract` builder grammar | `andC( ...cs: (NudoConstraint \| ConstraintBuilder)[] ): ConstraintBuilder` |
| <a id="any"></a>`any` | fn | Abs constructors / faces | `any(): ConstraintBuilder` |
| <a id="anyabs"></a>`anyAbs` | const | Abs constructors / faces | `const anyAbs` |
| <a id="anyvar"></a>`anyVar` | fn | Abs constructors / faces | `anyVar(id: string, conf: Confidence = "path"): Abs` |
| <a id="app"></a>`app` | const | term / shape builders | `const app` |
| <a id="array"></a>`array` | fn | term / shape builders | `array( item: NudoConstraint \| ConstraintBuilder \| number \| string \| boolean \| null \| undefined, ): ConstraintBuilder` |
| <a id="bigintlit"></a>`bigintLit` | fn | literal Abs; `litValue` → `LitValueResult` tagged (`&#123;ok:true,value&#125;\ | `bigintLit(value: bigint): Abs` |
| <a id="bool"></a>`bool` | fn | Abs constructors / faces | `bool(): Abs` |
| <a id="boolean"></a>`boolean` | fn | `@nudo:contract` builder grammar | `boolean(): ConstraintBuilder` |
| <a id="boollit"></a>`boolLit` | fn | literal Abs; `litValue` → `LitValueResult` tagged (`&#123;ok:true,value&#125;\ | `boolLit(value: boolean): Abs` |
| <a id="calltranspiledexport"></a>`callTranspiledExport` | fn | evaluator execution (analyze mode); `callTranspiledExportApply` is the only apply-wrap of `callTranspiledExportFull` (throws channel, H1); construct AbsApplyResult only via `makeAbsApplyResult` (brand) | `callTranspiledExport( exports: Record<string, unknown>, name: string, args: Abs[], ): Abs` |
| <a id="calltranspiledexportapply"></a>`callTranspiledExportApply` | fn | evaluator execution (analyze mode); `callTranspiledExportApply` is the only apply-wrap of `callTranspiledExportFull` (throws channel, H1); construct AbsApplyResult only via `makeAbsApplyResult` (brand) | `callTranspiledExportApply( exports: Record<string, unknown> \| (() => Record<string, unknown>), name: string, )` |
| <a id="calltranspiledexportfull"></a>`callTranspiledExportFull` | fn | evaluator execution (analyze mode); `callTranspiledExportApply` is the only apply-wrap of `callTranspiledExportFull` (throws channel, H1); construct AbsApplyResult only via `makeAbsApplyResult` (brand) | `callTranspiledExportFull( exports: Record<string, unknown>, name: string, args: Abs[], opts?: { phi?: Phi }, ): TranspiledCallResult` |
| <a id="casetag"></a>`CaseTag` | type | single-source `@nudo:` directive grammar (see `docs/design/directive-scope.md`) | `CaseTag = { name: string; argsText: string; expectedText?: string; tagOffset: number; }` |
| <a id="checkarg"></a>`checkArg` | fn | contract checking | `checkArg( arg: Abs, expect: Pred \| undefined, phi: Phi = pTrue, ): Diagnostic \| undefined` |
| <a id="checkcall"></a>`checkCall` | fn | contract checking | `checkCall( source: string, fnName: string, args: Abs[], phi: Phi = pTrue, ): Diagnostic[]` |
| <a id="checkjson"></a>`CheckJson` | type | `nudo check` gate | `CheckJson = { version: 1; file: string; ok: boolean; summary: CheckReport["summary"]; signatures: Array<{ name: string; params: string[];...` |
| <a id="checkreport"></a>`CheckReport` | type | `nudo check` gate | `CheckReport = { file: string; issues: CheckIssue[]; ok: boolean; signatures: NudoSig[]; summary: { errors: number; warnings: number; info...` |
| <a id="checksource"></a>`checkSource` | fn | `nudo check` gate | `checkSource( filePath: string, source: string, phi: Phi = pTrue, opts: CheckOptions = {}, ): CheckReport` |
| <a id="confidence"></a>`Confidence` | type | Abs = shape × term × pred × conf; `LiteralValue` 含 bigint | `Confidence = "exact" \| "path" \| "widened" \| "mock" \| "partial" \| "opaque"` |
| <a id="confjoin"></a>`confJoin` | fn | assignability / join | `confJoin(a: Confidence, b: Confidence): Confidence` |
| <a id="constraintbuilder"></a>`ConstraintBuilder` | type | `@nudo:contract` builder grammar | `ConstraintBuilder = NudoConstraint & { gt(n: number): ConstraintBuilder; ge(n: number): ConstraintBuilder; lt(n: number): ConstraintBuild...` |
| <a id="createenvironment"></a>`createEnvironment` | fn | env host surface | `createEnvironment( parent?: Environment, bindings: Map<string, Abs> = new Map(), ): Environment` |
| <a id="effectiveinterface"></a>`effectiveInterface` | fn | interface tiers | `effectiveInterface( source: string, fnName: string, opts: EffectiveInterfaceOpts = {}, ): EffectiveInterface \| undefined` |
| <a id="effectiveinterface"></a>`EffectiveInterface` | type | interface tiers | `EffectiveInterface = { fnName: string; params: Array<{ param: string; constraint: NudoConstraint }>; returns?: { constraint: NudoConstrai...` |
| <a id="environment"></a>`Environment` | type | env host surface | `Environment = { lookup(name: string): Abs; bind(name: string, value: Abs): Environment; update(name: string, value: Abs): boolean; extend...` |
| <a id="evalexprabs"></a>`evalExprAbs` | fn | Abs-native expression eval | `evalExprAbs( expr: import("@babel/types").Expression, bindings: Record<string, Abs> = {}, ): Abs` |
| <a id="extractfileenvnames"></a>`extractFileEnvNames` | const | single-source `@nudo:` directive grammar (see `docs/design/directive-scope.md`) | — |
| <a id="extractmockmodulerecords"></a>`extractMockModuleRecords` | fn | single-source `@nudo:` directive grammar (see `docs/design/directive-scope.md`) | `extractMockModuleRecords(source: string): MockModuleRecord[]` |
| <a id="extractnudoimportrecords"></a>`extractNudoImportRecords` | fn | single-source `@nudo:` directive grammar (see `docs/design/directive-scope.md`) | `extractNudoImportRecords(source: string): NudoImportRecord[]` |
| <a id="extractrefinesfromsource"></a>`extractRefinesFromSource` | fn | refinement gate | `extractRefinesFromSource( source: string, fnName: string, opts: RefineResolveOpts = {}, ): RefineEntry[]` |
| <a id="findfndirectivescope"></a>`findFnDirectiveScope` | fn | G2 directive scope binding (nearest AST Function, incl. nested / class method) | `findFnDirectiveScope( file: File, fnName: string, ): FnDirectiveScope \| undefined` |
| <a id="fn"></a>`fn` | fn | term / shape builders | `fn( params: Record<string, NudoConstraint \| ConstraintBuilder \| number \| string \| boolean \| null \| undefined>, returns?: NudoConstraint \| ConstraintBuilder \| number \| string \| boolean \| null \| undefined, opts?: { throws?: NudoConstraint \| ConstraintBuilder \| number \| string \| boolean \| null \| undefined }, ): ConstraintBuilder` |
| <a id="fndirectivecommentlines"></a>`fnDirectiveCommentLines` | fn | G2 directive scope binding (nearest AST Function, incl. nested / class method) | `fnDirectiveCommentLines(source: string, fnName: string): string[]` |
| <a id="fndirectivescope"></a>`FnDirectiveScope` | type | G2 directive scope binding (nearest AST Function, incl. nested / class method) | `FnDirectiveScope = { name: string; node: Node; commentTexts: string[]; commentLines: string[]; commentStartLines: number[]; startLine: nu...` |
| <a id="fnof"></a>`fnOf` | fn | term / shape builders | `fnOf(params: string[], name?: string): Abs` |
| <a id="formatabs"></a>`formatAbs` | fn | extensional rendering (one-way) | `formatAbs(a: Abs, opts: FormatOptions = {}): string` |
| <a id="formatcheckreport"></a>`formatCheckReport` | fn | extensional rendering (one-way) | `formatCheckReport(r: CheckReport, opts: { verbose?: boolean } = {}): string` |
| <a id="formatconstraint"></a>`formatConstraint` | fn | extensional rendering (one-way) | `formatConstraint(c: NudoConstraint): string` |
| <a id="formatshape"></a>`formatShape` | fn | extensional rendering (one-way) | `formatShape(a: Abs): string` |
| <a id="generalizeall"></a>`generalizeAll` | fn | symbolic α generalization | `generalizeAll( source: string, opts: { budget?: LeakBudget } = {}, ): PolyFn[]` |
| <a id="generalizefromast"></a>`generalizeFromAst` | fn | symbolic α generalization | `generalizeFromAst( fnName: string, source: string, opts: { budget?: LeakBudget; label?: string; refine?: EffectiveInterfaceOpts; file?: ReturnType<typeof babelParse>; depsFp?: LoadDepsFingerprint; sidecarFp?: string; modules?: Record<string, AbsModuleExports \| Record<string, unknown>>; inject?: RunTranspiledOptions; } = {}, ): PolyFn \| undefined` |
| <a id="getparsesourcecachesize"></a>`getParseSourceCacheSize` | fn | Babel parse + memo | `getParseSourceCacheSize(): number` |
| <a id="instantiateconstraint"></a>`instantiateConstraint` | fn | contract checking | `instantiateConstraint( c: NudoConstraint, paramName: string, ): Pred` |
| <a id="interfacetierinfo"></a>`InterfaceTierInfo` | type | interface tiers | `InterfaceTierInfo = { source: InterfaceSource; display?: string; }` |
| <a id="interfacetierof"></a>`interfaceTierOf` | fn | interface tiers | `interfaceTierOf( source: string, fnName: string, fromFile: string, opts: InterfaceTierOpts = {}, ): InterfaceTierInfo \| undefined` |
| <a id="isabsapplyresult"></a>`isAbsApplyResult` | fn | evaluator execution (analyze mode); `callTranspiledExportApply` is the only apply-wrap of `callTranspiledExportFull` (throws channel, H1); construct AbsApplyResult only via `makeAbsApplyResult` (brand) | `isAbsApplyResult(v: AbsApplyReturn): v` |
| <a id="isexactlit"></a>`isExactLit` | fn | literal Abs; `litValue` → `LitValueResult` tagged (`&#123;ok:true,value&#125;\ | `isExactLit(a: Abs): boolean` |
| <a id="joinabs"></a>`joinAbs` | fn | assignability / join | `joinAbs(a: Abs, b: Abs): Abs` |
| <a id="joinvalues"></a>`joinValues` | fn | assignability / join | `joinValues(a: Abs, b: Abs): Abs` |
| <a id="leqabs"></a>`leqAbs` | fn | assignability / join | `leqAbs( src: Abs, tgt: Abs, opts: { phi?: Phi; env?: AstEnv } = {}, ): LeqResult` |
| <a id="listfndirectivescopes"></a>`listFnDirectiveScopes` | fn | G2 directive scope binding (nearest AST Function, incl. nested / class method) | `listFnDirectiveScopes(file: File): FnDirectiveScope[]` |
| <a id="lit"></a>`lit` | const | term / shape builders | `const lit` |
| <a id="litc"></a>`litC` | fn | `@nudo:contract` builder grammar | `litC(v: import("./term.ts").LiteralValue): ConstraintBuilder` |
| <a id="literalvalue"></a>`LiteralValue` | type | Abs = shape × term × pred × conf; `LiteralValue` 含 bigint | `LiteralValue = string \| number \| boolean \| bigint \| null \| undefined` |
| <a id="litvalue"></a>`litValue` | fn | literal Abs; `litValue` → `LitValueResult` tagged (`&#123;ok:true,value&#125;\ | `litValue(a: Abs): LitValueResult` |
| <a id="litvalueresult"></a>`LitValueResult` | type | Abs = shape × term × pred × conf; `LiteralValue` 含 bigint | `LitValueResult = \| { ok: true; value: LiteralValue } \| { ok: false }` |
| <a id="makeabsapplyresult"></a>`makeAbsApplyResult` | fn | evaluator execution (analyze mode); `callTranspiledExportApply` is the only apply-wrap of `callTranspiledExportFull` (throws channel, H1); construct AbsApplyResult only via `makeAbsApplyResult` (brand) | `makeAbsApplyResult(abs: Abs, throws: Abs): AbsApplyResult` |
| <a id="makesum"></a>`makeSum` | fn | term / shape builders | `makeSum(a: Abs, b: Abs): Abs` |
| <a id="mock"></a>`mock` | fn | test mock helpers | `mock(): MockHelper` |
| <a id="mockhelper"></a>`MockHelper` | type | test mock helpers | `MockHelper = { kind: "mock-helper"; returnValue?: Abs; resolvedValue?: Abs; rejectedValue?: Abs; onFirstCallValue?: Abs; onSecondCallValu...` |
| <a id="mockmodulerecord"></a>`MockModuleRecord` | type | single-source `@nudo:` directive grammar (see `docs/design/directive-scope.md`) | `MockModuleRecord = { source: string; names?: string[]; fromPath: string; }` |
| <a id="never"></a>`never` | const | Abs constructors / faces | `const never` |
| <a id="nudoconstraint"></a>`NudoConstraint` | type | contract checking | `NudoConstraint = { readonly __nudoConstraint: true; readonly prim?: PrimName; readonly preds: Pred[]; readonly fields?: Record<string, Nu...` |
| <a id="nudoimportrecord"></a>`NudoImportRecord` | type | single-source `@nudo:` directive grammar (see `docs/design/directive-scope.md`) | `NudoImportRecord = { names: string[]; importedOfLocal: Record<string, string>; spec: string; }` |
| <a id="num"></a>`num` | fn | Abs constructors / faces | `num(): Abs` |
| <a id="number"></a>`number` | fn | `@nudo:contract` builder grammar | `number(): ConstraintBuilder` |
| <a id="numlit"></a>`numLit` | fn | literal Abs; `litValue` → `LitValueResult` tagged (`&#123;ok:true,value&#125;\ | `numLit(value: number): Abs` |
| <a id="obj"></a>`obj` | fn | term / shape builders | `obj( slots: Record<string, { value: Abs; optional?: boolean }>, ): Abs` |
| <a id="objshape"></a>`ObjShape` | type | Abs = shape × term × pred × conf; `LiteralValue` 含 bigint | `ObjShape = { k: "obj"; slots: Record<string, Slot>; index?: { key: Abs; value: Abs }; open?: boolean; }` |
| <a id="parseenvpayload"></a>`parseEnvPayload` | fn | single-source `@nudo:` directive grammar (see `docs/design/directive-scope.md`) | `parseEnvPayload(payload: string): string[]` |
| <a id="parsemockmodulepayload"></a>`parseMockModulePayload` | fn | single-source `@nudo:` directive grammar (see `docs/design/directive-scope.md`) | `parseMockModulePayload(payload: string): MockModuleRecord \| undefined` |
| <a id="parsenudoimportpayload"></a>`parseNudoImportPayload` | fn | single-source `@nudo:` directive grammar (see `docs/design/directive-scope.md`) | `parseNudoImportPayload( payload: string, ): NudoImportRecord` |
| <a id="parsesource"></a>`parseSource` | fn | Babel parse + memo | `parseSource( source: string, opts?: { errorRecovery?: boolean; keepTs?: boolean }, ): File` |
| <a id="phi"></a>`Phi` | type | Abs = shape × term × pred × conf; `LiteralValue` 含 bigint | `Phi = Pred` |
| <a id="pred"></a>`Pred` | type | Abs = shape × term × pred × conf; `LiteralValue` 含 bigint | `Pred = \| { op: "true" } \| { op: "false" } \| { op: "eq"; a: Term; b: Term } \| { op: "ne"; a: Term; b: Term } \| { op: "lt"; a: Term; b: Ter...` |
| <a id="projectabstoschema"></a>`projectAbsToSchema` | const | one-way projections | — |
| <a id="refineabsforreltrue"></a>`refineAbsForRelTrue` | fn | refinement gate | `refineAbsForRelTrue( a: Abs, op: "gt" \| "ge" \| "lt" \| "le", k: number, ): Abs` |
| <a id="resetparsesourcecache"></a>`resetParseSourceCache` | fn | Babel parse + memo | `resetParseSourceCache(): void` |
| <a id="runtranspiled"></a>`runTranspiled` | fn | evaluator execution (analyze mode); `callTranspiledExportApply` is the only apply-wrap of `callTranspiledExportFull` (throws channel, H1); construct AbsApplyResult only via `makeAbsApplyResult` (brand) | `runTranspiled( source: string, opts: RunTranspiledOptions = {}, ): Record<string, unknown>` |
| <a id="scanbudgetdecl"></a>`scanBudgetDecl` | fn | single-source `@nudo:` directive grammar (see `docs/design/directive-scope.md`) | `scanBudgetDecl( lines: string[], )` |
| <a id="scancasetags"></a>`scanCaseTags` | fn | single-source `@nudo:` directive grammar (see `docs/design/directive-scope.md`) | `scanCaseTags(text: string): CaseTag[]` |
| <a id="scancontractsegments"></a>`scanContractSegments` | fn | single-source `@nudo:` directive grammar (see `docs/design/directive-scope.md`) | `scanContractSegments(lines: string[]): string[]` |
| <a id="scanthrowsdecl"></a>`scanThrowsDecl` | fn | single-source `@nudo:` directive grammar (see `docs/design/directive-scope.md`) | `scanThrowsDecl(lines: string[]): string \| undefined` |
| <a id="serializecheckjson"></a>`serializeCheckJson` | fn | `nudo check` gate | `serializeCheckJson(r: CheckReport): CheckJson` |
| <a id="serializecheckjsonmulti"></a>`serializeCheckJsonMulti` | fn | `nudo check` gate | `serializeCheckJsonMulti(reports: CheckJson[]): CheckJsonMulti` |
| <a id="shape"></a>`shape` | fn | term / shape builders | `shape( fields: Record< string, NudoConstraint \| ConstraintBuilder \| number \| string \| boolean \| null \| undefined >, ): ConstraintBuilder` |
| <a id="shape"></a>`Shape` | type | Abs = shape × term × pred × conf; `LiteralValue` 含 bigint | `Shape = \| { k: "never" } \| { k: "any" } \| { k: "unknown" } \| { k: "prim"; type: PrimName } \| { k: "obj"; slots: Record<string, { value: A...` |
| <a id="slot"></a>`Slot` | type | Abs = shape × term × pred × conf; `LiteralValue` 含 bigint | `Slot = { value: Abs; optional?: boolean; readonly?: boolean }` |
| <a id="spy"></a>`spy` | fn | test mock helpers | `spy(): MockHelper` |
| <a id="str"></a>`str` | fn | Abs constructors / faces | `str(): Abs` |
| <a id="string"></a>`string` | fn | `@nudo:contract` builder grammar | `string(): ConstraintBuilder` |
| <a id="striptypes"></a>`stripTypes` | fn | AST TS-stripping helper | `stripTypes<T extends Node>(ast: T): T` |
| <a id="strlit"></a>`strLit` | fn | literal Abs; `litValue` → `LitValueResult` tagged (`&#123;ok:true,value&#125;\ | `strLit(value: string): Abs` |
| <a id="stub"></a>`stub` | fn | test mock helpers | `stub(): MockHelper` |
| <a id="term"></a>`Term` | type | Abs = shape × term × pred × conf; `LiteralValue` 含 bigint | `Term = \| { op: "lit"; value: LiteralValue } \| { op: "var"; id: string } \| { op: "app"; fn: string; args: Term[] }` |
| <a id="transpiledcallresult"></a>`TranspiledCallResult` | type | evaluator execution (analyze mode); `callTranspiledExportApply` is the only apply-wrap of `callTranspiledExportFull` (throws channel, H1); construct AbsApplyResult only via `makeAbsApplyResult` (brand) | `TranspiledCallResult = { result: Abs; throws: Abs; }` |
| <a id="union"></a>`union` | fn | term / shape builders | `union( ...cs: (NudoConstraint \| ConstraintBuilder \| number \| string \| boolean \| null \| undefined)[] ): ConstraintBuilder` |
| <a id="unknown"></a>`unknown` | const | Abs constructors / faces | `const unknown` |
| <a id="v"></a>`v` | const | term / shape builders | `const v` |

### Exec 运行时（$op，§2.2）

| 名称 | 种类 | 说明 | 签名 |
|------|------|------|------|
| <a id="$add"></a>`$add` | fn | operator runtime | `$add(a: Abs, b: Abs): Abs` |
| <a id="$arguments"></a>`$arguments` | fn | array runtime | `$arguments(items: ArrayLike<unknown>): Abs` |
| <a id="$arr"></a>`$arr` | fn | array runtime | `$arr(items: Abs[]): Abs` |
| <a id="$arrmutcontainer"></a>`$arrMutContainer` | fn | array runtime | `$arrMutContainer(arr: Abs, method: string, args: Abs[]): Abs` |
| <a id="$arrrest"></a>`$arrRest` | fn | object / member runtime | `$arrRest(a: Abs, start: number): Abs` |
| <a id="$arrwithholes"></a>`$arrWithHoles` | fn | array runtime | `$arrWithHoles(items: Abs[], holes: number[]): Abs` |
| <a id="$assignrecord"></a>`$assignRecord` | fn | call-site recording for analyze | `$assignRecord( name: string, prev: Abs \| undefined, next: Abs, line: number, column: number, conditional: boolean, ): void` |
| <a id="$async"></a>`$async` | fn | async / generator | `$async(thunk: () => Abs): Abs` |
| <a id="$asyncreturn"></a>`$asyncReturn` | fn | async / generator | `$asyncReturn(v: Abs): Abs` |
| <a id="$await"></a>`$await` | fn | async / generator | `$await(v: Abs): Abs` |
| <a id="$callnamed"></a>`$callNamed` | fn | call-site recording for analyze | `$callNamed( name: string, fn: unknown, args: Abs[], loc?: [number, number], argLocs?: Array<[number, number] \| null \| undefined>, ): Abs` |
| <a id="$catchval"></a>`$catchVal` | fn | control-signal / throw | `$catchVal(e: unknown): Abs` |
| <a id="$classexpr"></a>`$classExpr` | fn | value / class runtime | `$classExpr(): Abs` |
| <a id="$concat"></a>`$concat` | fn | object / member runtime | `$concat(a: Abs, b: Abs): Abs` |
| <a id="$copy"></a>`$copy` | fn | array runtime | `$copy(a: Abs): Abs` |
| <a id="$del"></a>`$del` | fn | object / member runtime | `$del(o: Abs, key: Abs): Abs` |
| <a id="$elems"></a>`$elems` | fn | object / member runtime | `$elems(a: Abs): Abs[]` |
| <a id="$eq"></a>`$eq` | fn | operator runtime | `$eq(a: Abs, b: Abs): Abs` |
| <a id="$fnval"></a>`$fnVal` | fn | value / class runtime | `$fnVal( params: string[], impl: (...args: Abs[]) => Abs, opts?: { bindThis?: boolean }, ): Abs` |
| <a id="$for"></a>`$for` | fn | control-flow lowering | `$for( init: Abs, test: (s: Abs) => Abs, step: (s: Abs) => Abs, body: (s: Abs) => Abs, maxIters: number = DEFAULT_MAX_LOOP_ITERS, opts?: { pack?: () => Abs; unpack?: (s: Abs) => void; label?: string; }, ): Abs` |
| <a id="$foriter"></a>`$forIter` | const | control-flow lowering | — |
| <a id="$fork"></a>`$fork` | fn | control-flow lowering | `$fork(test: Abs, consequent: () => Abs, alternate?: () => Abs): Abs` |
| <a id="$ge"></a>`$ge` | fn | operator runtime | `$ge(a: Abs, b: Abs): Abs` |
| <a id="$gen"></a>`$gen` | fn | async / generator | `$gen(body: () => void): Abs` |
| <a id="$get"></a>`$get` | fn | object / member runtime | `$get( o: Abs, key: string, opts?: { silent?: boolean }, ): Abs` |
| <a id="$idx"></a>`$idx` | fn | array runtime | `$idx(a: Abs, i: Abs): Abs` |
| <a id="$idxset"></a>`$idxSet` | fn | array runtime | `$idxSet(a: Abs, i: Abs, value: Abs): Abs` |
| <a id="$in"></a>`$in` | fn | value / class runtime | `$in(key: Abs, o: Abs): Abs` |
| <a id="$instanceof"></a>`$instanceof` | fn | value / class runtime | `$instanceof(left: Abs, rightName: string, rightVal?: Abs): Abs` |
| <a id="$join"></a>`$join` | fn | operator runtime | `$join(a: Abs, b: Abs): Abs` |
| <a id="$len"></a>`$len` | fn | array runtime | `$len(a: Abs): Abs` |
| <a id="$lit"></a>`$lit` | fn | value / class runtime | `$lit(v: unknown): Abs` |
| <a id="$loopbreak"></a>`$loopBreak` | fn | control-signal / throw | `$loopBreak(label?: string): never` |
| <a id="$loopcontinue"></a>`$loopContinue` | fn | control-signal / throw | `$loopContinue(label?: string): never` |
| <a id="$loopreturn"></a>`$loopReturn` | fn | control-signal / throw | `$loopReturn(v: Abs): never` |
| <a id="$neg"></a>`$neg` | fn | operator runtime | `$neg(a: Abs): Abs` |
| <a id="$not"></a>`$not` | fn | operator runtime | `$not(a: Abs): Abs` |
| <a id="$nullishtest"></a>`$nullishTest` | fn | control-flow lowering | `$nullishTest(v: Abs): Abs` |
| <a id="$obj"></a>`$obj` | fn | object / member runtime | `$obj(slots: Record<string, Abs>): Abs` |
| <a id="$objrest"></a>`$objRest` | fn | object / member runtime | `$objRest(o: Abs, keys: string[]): Abs` |
| <a id="$pow"></a>`$pow` | fn | operator runtime | `$pow(a: Abs, b: Abs): Abs` |
| <a id="$rawthis"></a>`$rawThis` | fn | value / class runtime | `$rawThis(v: unknown): Abs` |
| <a id="$recordbinding"></a>`$recordBinding` | fn | call-site recording for analyze | `$recordBinding(name: string, value: unknown): void` |
| <a id="$set"></a>`$set` | fn | object / member runtime | `$set(o: Abs, key: string, value: Abs): Abs` |
| <a id="$spread"></a>`$spread` | fn | object / member runtime | `$spread(a: Abs, b: Abs): Abs` |
| <a id="$switch"></a>`$switch` | fn | control-flow lowering | `$switch( disc: Abs, cases: Array<{ test: Abs; run: () => Abs }>, dflt?: () => Abs, ): Abs` |
| <a id="$throw"></a>`$throw` | fn | control-signal / throw | `$throw(v: Abs): never` |
| <a id="$typeof"></a>`$typeof` | fn | operator runtime | `$typeof(a: Abs): Abs` |
| <a id="$while"></a>`$while` | fn | control-flow lowering | `$while( init: Abs, test: (s: Abs) => Abs, step: (s: Abs) => Abs, maxIters: number = DEFAULT_MAX_LOOP_ITERS, ): Abs` |
| <a id="$whileseq"></a>`$whileSeq` | fn | control-flow lowering | `$whileSeq( test: () => Abs, body: () => void, maxIters: number = DEFAULT_MAX_LOOP_ITERS, opts?: { pack?: () => Abs; unpack?: (s: Abs) => void; label?: string; }, ): void` |
| <a id="$yield"></a>`$yield` | fn | async / generator | `$yield(v: Abs): Abs` |
| <a id="asabsval"></a>`asAbsVal` | fn | value / class runtime | `asAbsVal(v: unknown): Abs` |
| <a id="evalcallrecord"></a>`EvalCallRecord` | type | call-site recording for analyze | `EvalCallRecord = { fnName: string; args: Abs[]; result: Abs; callLoc?: { line: number; column: number }; threw?: boolean; }` |
| <a id="filltuple"></a>`fillTuple` | fn | array runtime | `fillTuple( shape: { k: "tuple"; elements: Abs[]; holes?: number[] } \| { k: "arr"; element: Abs }, vals: Abs[], arr: Abs, ): Abs` |
| <a id="foldrequirespecarg"></a>`foldRequireSpecArg` | fn | static folding helpers | `foldRequireSpecArg(arg: unknown): string \| undefined` |
| <a id="foldstaticstringexpr"></a>`foldStaticStringExpr` | fn | static folding helpers | `foldStaticStringExpr(node: unknown): string \| undefined` |
| <a id="isarrmutator"></a>`isArrMutator` | fn | array runtime | `isArrMutator(name: string): boolean` |
| <a id="nudoloopsignal"></a>`NudoLoopSignal` | type | control-signal / throw | `NudoLoopSignal extends Error { readonly kind: "break" \| "continue"; readonly label: string \| undefined; constructor(kind: "break" \| "cont...` |
| <a id="nudoreturn"></a>`NudoReturn` | type | control-signal / throw | `NudoReturn extends Error { readonly absValue: Abs; constructor(absValue: Abs) { super("nudo:return"); this.name = "NudoReturn"; this.absV...` |
| <a id="nudothrow"></a>`NudoThrow` | type | control-signal / throw | — |
| <a id="runtimeimportof"></a>`runtimeImportOf` | fn | JS AST → `$op` program | `runtimeImportOf(runtime: string): string` |
| <a id="setevalcallcollector"></a>`setEvalCallCollector` | fn | call-site recording for analyze | `setEvalCallCollector( collector: ((r: EvalCallRecord) => void) \| null, )` |
| <a id="transpile"></a>`transpile` | fn | JS AST → `$op` program | `transpile(source: string, opts?: TranspileOptions): string` |
| <a id="transpilebodynode"></a>`transpileBodyNode` | fn | JS AST → `$op` program | `transpileBodyNode(node: Node, opts: TranspileOptions): string` |
| <a id="transpileexpression"></a>`transpileExpression` | fn | JS AST → `$op` program | `transpileExpression(expr: Expression, opts: TranspileOptions = {}): string` |
| <a id="transpilefile"></a>`transpileFile` | fn | JS AST → `$op` program | `transpileFile(file: File, opts: TranspileOptions = {}): string` |
| <a id="transpileoptions"></a>`TranspileOptions` | type | JS AST → `$op` program | — |
| <a id="transpilesource"></a>`transpileSource` | fn | JS AST → `$op` program | `transpileSource(source: string, opts: TranspileOptions = {}): string` |

<details>
<summary>src/index.ts 其余导出（340）</summary>

| 名称 | 种类 | 说明 | 签名 |
|------|------|------|------|
| <a id="absapplyreturn"></a>`AbsApplyReturn` | type | apply 可返回裸 Abs（无 throws）或带 throws 通道的 AbsApplyResult | `AbsApplyReturn = Abs \| AbsApplyResult` |
| <a id="absassignrecord"></a>`AbsAssignRecord` | type | Abs 域赋值记录（eval 通道 $assignRecord 的同形投影） | `AbsAssignRecord = { name: string; prev?: Abs; next: Abs; line?: number; column?: number; conditional?: boolean; }` |
| <a id="abscallrecord"></a>`AbsCallRecord` | type | Abs 域调用记录（eval 通道 EvalCallRecord 的同形投影） | `AbsCallRecord = { fnName: string; args: Abs[]; result: Abs; callLoc?: { line: number; column: number }; threw?: boolean; }` |
| <a id="absfnimpl"></a>`AbsFnImpl` | type | — | `AbsFnImpl = { params: string[]; body?: Node; async?: boolean; env?: AstEnv; kind?: string; apply?: (args: Abs[], thisVal?: Abs) => AbsApp...` |
| <a id="absfunction"></a>`absFunction` | fn | 造一个带实现的 Abs 函数值 | `absFunction( params: string[], impl: Omit<AbsFnImpl, "params">, opts?: { name?: string; paramTypes?: Abs[]; returnType?: Abs; slots?: Record<string, { value: Abs; optional?: boolean; readonly?: boolean }>; conf?: Confidence; }, ): Abs` |
| <a id="absmoduleexports"></a>`AbsModuleExports` | type | — | `AbsModuleExports = { named: Record<string, Abs>; default?: Abs; evaluated?: boolean; }` |
| <a id="absshapekey"></a>`absShapeKey` | fn | — | `absShapeKey(a: Abs, seen: Set<object> = new Set()): string` |
| <a id="abssigimpl"></a>`AbsSigImpl` | type | Abs 原生 env/builtin 实现（evaluator 优先） | `AbsSigImpl = (args: Abs[], thisVal?: Abs) => Abs \| undefined` |
| <a id="abstoconstraint"></a>`absToConstraint` | fn | Abs → 契约；不可表达 → undefined。 | `absToConstraint( a: Abs, budget: ProjectionBudget = new ProjectionBudget(), ): NudoConstraint \| undefined` |
| <a id="abstostring"></a>`absToString` | fn | — | `absToString(a: Abs): string` |
| <a id="actionsforissue"></a>`actionsForIssue` | fn | 诊断码 → 结构化动作（AI1）；未知码给 info 提示 | `actionsForIssue(i: { code: string; expected?: string; suggestion?: string; fn?: string; }): CheckAction[]` |
| <a id="add"></a>`add` | fn | 抽象加法：eval(a + b) —— 跟真实 JS，不无根据地假定 number。 | `add(a: Abs, b: Abs, phi: Phi = pTrue): Abs` |
| <a id="alphaof"></a>`alphaOf` | fn | 仅当 term 是 var 且 id ∈ alphaIds（本次 typeParams）时复用；否则 fresh α。 | `alphaOf( absOrTerm: Abs \| Term \| undefined, ctx: HofCollectCtx, ): Term` |
| <a id="applycallbackabs"></a>`applyCallbackAbs` | fn | — | `applyCallbackAbs( cb: Abs \| { type: string }, args: Abs[], env: unknown, phi: unknown, budget: unknown, ): Abs` |
| <a id="applycallbackvalue"></a>`applyCallbackValue` | fn | 通用回调实参调用（exec/class invokeArrMethod 与 builtins Array.from 共用）： 原始 JS 函数直调（展开实参）；Abs fn 走 applyCallbackAbs（sum 分发/宿主）。 | `applyCallbackValue( fn: unknown, args: Abs[], env: unknown, phi: unknown, budget: unknown, ): Abs` |
| <a id="asabs"></a>`asAbs` | fn | 从 map/filter/reduce 回调实参里取出 Abs（Identifier 已绑定或直接 Abs） | `asAbs(v: unknown): Abs \| undefined` |
| <a id="assignsourceslots"></a>`assignSourceSlots` | fn | — | `assignSourceSlots(src: Abs): Record<string, { value: Abs }> \| undefined` |
| <a id="assumefinite"></a>`assumeFinite` | const | 显式有限证据：t 为有限数（非 NaN/±Inf），开启线性环化简 | `const assumeFinite` |
| <a id="astenv"></a>`AstEnv` | type | — | — |
| <a id="attachfnimpl"></a>`attachFnImpl` | fn | — | `attachFnImpl(a: Abs, impl: AbsFnImpl): void` |
| <a id="begincollectionfork"></a>`beginCollectionFork` | fn | — | `beginCollectionFork(): void` |
| <a id="betaof"></a>`betaOf` | fn | 共享输出变量 B:$&#123;param&#125;（§5.1 P2 钉死） | `betaOf(param: string): Term` |
| <a id="bindimports"></a>`bindImports` | fn | 把 import 说明符绑定进 env（宿主已求值依赖） | `bindImports( node: ImportDeclaration, env: AstEnv, modules: Record<string, AbsModuleExports>, ): void` |
| <a id="bindingsof"></a>`bindingsOf` | fn | — | `bindingsOf(run: Record<string, unknown>): Map<string, unknown> \| undefined` |
| <a id="bitandabs"></a>`bitandAbs` | fn | &amp; —— ToInt32 两侧后按位与 | `bitandAbs(a: Abs, b: Abs): Abs` |
| <a id="bitnotabs"></a>`bitnotAbs` | fn | ~ —— ToInt32 后按位取反（bigint 无符号截断） | `bitnotAbs(a: Abs): Abs` |
| <a id="bitorabs"></a>`bitorAbs` | fn | \| —— ToInt32 两侧后按位或 | `bitorAbs(a: Abs, b: Abs): Abs` |
| <a id="bitxorabs"></a>`bitxorAbs` | fn | ^ —— ToInt32 两侧后按位异或 | `bitxorAbs(a: Abs, b: Abs): Abs` |
| <a id="buildargsfromassume"></a>`buildArgsFromAssume` | fn | 按 assume 集合构造实参：被 assume 的参数给带约束的符号，其余 any （design-cli-semantics §2：入口无约束 = any，不是 unknown）。 | `buildArgsFromAssume( source: string, fnName: string, assumeIds: Set<string>, ): Abs[]` |
| <a id="builtinctorabs"></a>`builtinCtorAbs` | fn | — | `builtinCtorAbs(name: string): Abs` |
| <a id="builtinctornameof"></a>`builtinCtorNameOf` | fn | Abs 侧内建构造器身份（与宿主构造器名对齐） | `builtinCtorNameOf(v: unknown): string \| undefined` |
| <a id="callabsmethod"></a>`callAbsMethod` | fn | 调用 Abs 方法。返回 undefined = 未接管（调用方走其它路径）。 | `callAbsMethod( recv: Abs, name: string, args: Abs[], ): Abs \| undefined` |
| <a id="callatfunctionboundary"></a>`callAtFunctionBoundary` | fn | 函数调用边界：callee 的 loop/early-return 不得冒泡成 caller 结果。 | `callAtFunctionBoundary<T>(body: () => T): T` |
| <a id="canonicalarrayindex"></a>`canonicalArrayIndex` | fn | ES 规范数组下标（无前导零、&lt; 2^32-1）；非规范键返回 undefined | `canonicalArrayIndex(v: unknown): number \| undefined` |
| <a id="checkaction"></a>`CheckAction` | type | 结构化修复动作（AI1；稳定枚举，只增不改语义） | `CheckAction = { kind: "draft" \| "relax" \| "callsite" \| "assume" \| "mock" \| "emit" \| "ignore-throws" \| "info"; command?: string; label: st...` |
| <a id="checkissue"></a>`CheckIssue` | type | — | `CheckIssue = Diagnostic & { fn?: string; line?: number; column?: number; actual?: string; expected?: string; actions?: CheckAction[]; }` |
| <a id="checkjsonmulti"></a>`CheckJsonMulti` | type | 多文件 `check --json` 信封（CI / monorepo）。单文件仍输出裸 CheckJson。 | `CheckJsonMulti = { version: 1; kind: "multi"; ok: boolean; summary: CheckReport["summary"] & { files: number; budgetTruncated?: boolean }...` |
| <a id="checkoptions"></a>`CheckOptions` | type | — | — |
| <a id="clearbclasses"></a>`clearBClasses` | fn | — | `clearBClasses(): void` |
| <a id="clearcollectiontables"></a>`clearCollectionTables` | fn | — | `clearCollectionTables(): void` |
| <a id="clearstaletermpred"></a>`clearStaleTermPred` | fn | 调用方已直接改 shape 时的 term/pred 清理 | `clearStaleTermPred(v: Abs): void` |
| <a id="cmp"></a>`cmp` | fn | 比较：返回 boolean Abs；若双字面量则 exact | `cmp( op: "lt" \| "le" \| "gt" \| "ge" \| "eq" \| "ne", a: Abs, b: Abs, phi: Phi = pTrue, ): Abs` |
| <a id="collectabsexports"></a>`collectAbsExports` | fn | 从已求值 env + AST 收集 ESM 导出。 | `collectAbsExports( file: File, env: AstEnv, modules?: Record<string, AbsModuleExports>, ): AbsModuleExports` |
| <a id="collectabsfreevars"></a>`collectAbsFreeVars` | fn | 公开：收集 Abs 自由 term 变元（dts 泛型投影 / α 作用域判定复用 L2 基建）。 | `collectAbsFreeVars(a: Abs): Set<string>` |
| <a id="collectionelementjoin"></a>`collectionElementJoin` | fn | 元素联合（for-of / Array.from）；无表 → unknown。 | `collectionElementJoin(c: Abs): Abs` |
| <a id="collectionexactlen"></a>`collectionExactLen` | fn | 确切条目数：Set 无 maybeAbsent / Map 无 shadow+maybeAbsent 时返回长度； 否则 undefined（for-of 不得假装有界）。 | `collectionExactLen(c: Abs): number \| undefined` |
| <a id="constraint_builder_names"></a>`CONSTRAINT_BUILDER_NAMES` | const | 构建器表面名（供文法正则 / 测试枚举；顺序即表定义顺序） | `const CONSTRAINT_BUILDER_NAMES` |
| <a id="constraint_builders"></a>`CONSTRAINT_BUILDERS` | const | 约束构建器表面名表（单一真源）：case 实参文法、mock 类型表达式识别与 侧车注入共用的名字 → 实现映射。键名是 *.nudo.js / 指令里的用户写法 （`lit`/`and` 而非内部的 litC/andC）。 | `const CONSTRAINT_BUILDERS` |
| <a id="constraint_expr_re"></a>`CONSTRAINT_EXPR_RE` | const | 约束表达式头：`name(` 形态。由 CONSTRAINT_BUILDER_NAMES 生成—— 名单只在 CONSTRAINT_BUILDERS 一处维护。 | `const CONSTRAINT_EXPR_RE` |
| <a id="constraintadmitsnullish"></a>`constraintAdmitsNullish` | fn | 契约域是否包含 nullish（null / undefined）。 | `constraintAdmitsNullish(c: NudoConstraint): boolean` |
| <a id="constrainttoentryabs"></a>`constraintToEntryAbs` | fn | 契约 → 函数入口 param Abs（infer/hover 用）。 | `constraintToEntryAbs( c: NudoConstraint, paramName: string, ): Abs` |
| <a id="contractparamnameset"></a>`contractParamNameSet` | fn | 侧车契约可绑定的参数名全集 | `contractParamNameSet(formals: FormalParam[]): Set<string>` |
| <a id="createhofcollectctx"></a>`createHofCollectCtx` | fn | — | `createHofCollectCtx( paramNames: ReadonlySet<string>, alphaIds: Iterable<string>, ): HofCollectCtx` |
| <a id="ctorargdefinitelyinvalid"></a>`ctorArgDefinitelyInvalid` | fn | 构造器实参**确定**非法（原生 TypeError 域）： - 非可迭代字面量（number/boolean/symbol/bigint、闭对象字面量）→ Set/Map 都抛 - Map 条目必须是对象：外层 iterable 出现 lit prim 条目（含字符串实参的 每个字符、tuple/Set 元素）→ TypeError（空串例外：零条目合法） 抽象形态不确定 → false（保守）。 | `ctorArgDefinitelyInvalid( name: "Map" \| "Set", iterable: Abs \| undefined, ): boolean` |
| <a id="ctornameofrecv"></a>`ctorNameOfRecv` | fn | 接收者 → 原型链 constructor 名（`.constructor` 折叠）。 | `ctorNameOfRecv(recv: Abs): string \| undefined` |
| <a id="currentexecphi"></a>`currentExecPhi` | fn | — | `currentExecPhi(): Phi` |
| <a id="currentphi"></a>`currentPhi` | fn | — | `currentPhi(): Phi` |
| <a id="default_max_loop_iters"></a>`DEFAULT_MAX_LOOP_ITERS` | const | 循环展开上限（leaf）—— 从 control.ts 拆出，打断 control ↔ containers 环。 | `const DEFAULT_MAX_LOOP_ITERS` |
| <a id="definitelynotnullishshape"></a>`definitelyNotNullishShape` | fn | 该 shape 在 JS 上一定不是 null/undefined | `definitelyNotNullishShape(s: Shape): boolean` |
| <a id="describephi"></a>`describePhi` | fn | — | `describePhi(): string` |
| <a id="diagnostic"></a>`Diagnostic` | type | — | `Diagnostic = { severity: "error" \| "warning" \| "info"; code: string; message: string; suggestion?: string; fn?: string; argIndex?: number; }` |
| <a id="div"></a>`div` | fn | 除法：字面量折叠；除以正/负常数时按单调性推界。 | `div(a: Abs, b: Abs, phi: Phi = pTrue): Abs` |
| <a id="drainpromisemicros"></a>`drainPromiseMicros` | fn | — | `drainPromiseMicros(): void` |
| <a id="effectiveinterfaceopts"></a>`EffectiveInterfaceOpts` | type | — | `EffectiveInterfaceOpts = RefineResolveOpts & { autoBind?: boolean \| ((sidecarPath: string) => boolean); projectDir?: string; }` |
| <a id="emptyenv"></a>`emptyEnv` | fn | 空求值环境（分析宿主用：不带任何绑定） | `emptyEnv(): AstEnv` |
| <a id="emptyphi"></a>`emptyPhi` | const | — | `const emptyPhi` |
| <a id="endcollectionfork"></a>`endCollectionFork` | fn | — | `endCollectionFork(arms: Array<ArmOverlay \| undefined \| null>): void` |
| <a id="enterpromiseexecutorscope"></a>`enterPromiseExecutorScope` | fn | — | `enterPromiseExecutorScope(): void` |
| <a id="eq"></a>`eq` | const | — | `const eq` |
| <a id="errorbrandabs"></a>`errorBrandAbs` | fn | Error brand：shape 带 name/message（字面量 message 保精确）。 | `errorBrandAbs(name: string, args: Abs[]): Abs` |
| <a id="evalabsassignrecord"></a>`EvalAbsAssignRecord` | type | B 赋值记录（与 ast-records.ts AbsAssignRecord 同形；structuralAssignIssues 消费） | `EvalAbsAssignRecord = { name: string; prev: Abs \| undefined; next: Abs; line?: number; column?: number; conditional?: boolean; }` |
| <a id="evalarraystatic"></a>`evalArrayStatic` | fn | Array.isArray / Array.from / Array.of | `evalArrayStatic(name: string, args: Abs[]): Abs \| undefined` |
| <a id="evalbuiltininstancemethod"></a>`evalBuiltinInstanceMethod` | fn | brand 实例方法（Date/RegExp/Map/Set） | `evalBuiltinInstanceMethod( brandName: string, method: string, recv: Abs, args: Abs[], ): Abs \| undefined` |
| <a id="evalbuiltinnew"></a>`evalBuiltinNew` | fn | new X(...) | `evalBuiltinNew(className: string, args: Abs[]): Abs \| undefined` |
| <a id="evalclassspec"></a>`EvalClassSpec` | type | — | — |
| <a id="evaldatector"></a>`evalDateCtor` | fn | — | `evalDateCtor(args: Abs[]): Abs` |
| <a id="evaldatemethod"></a>`evalDateMethod` | fn | — | `evalDateMethod(name: string, _recv: Abs, _args: Abs[]): Abs \| undefined` |
| <a id="evaldatestatic"></a>`evalDateStatic` | fn | — | `evalDateStatic(name: string, _args: Abs[]): Abs \| undefined` |
| <a id="evalfallback"></a>`EvalFallback` | type | evaluator 回落事件（观测单一埋点；reason: unsupported:* = 能力边界，internal = 引擎自身缺陷） | `EvalFallback = { reason: string; message: string; loc?: { line: number; column: number }; }` |
| <a id="evalglobalfn"></a>`evalGlobalFn` | fn | — | `evalGlobalFn(name: string, args: Abs[]): Abs \| undefined` |
| <a id="evaljsonmethod"></a>`evalJsonMethod` | fn | JSON.parse / stringify：字面量实参真执行折叠；失败硬抛（catch 可吸收） | `evalJsonMethod(name: string, args: Abs[]): Abs \| undefined` |
| <a id="evalmathmethod"></a>`evalMathMethod` | fn | — | `evalMathMethod(name: string, args: Abs[]): Abs \| undefined` |
| <a id="evalnamespacecall"></a>`evalNamespaceCall` | fn | — | `evalNamespaceCall( ns: string, method: string, args: Abs[], ): Abs \| undefined` |
| <a id="evalnumberstatic"></a>`evalNumberStatic` | fn | Number.isInteger / isNaN / parseFloat 等 | `evalNumberStatic(name: string, args: Abs[]): Abs \| undefined` |
| <a id="evalobjectmethod"></a>`evalObjectMethod` | fn | Object.keys/values/entries/assign + 不变性方法 | `evalObjectMethod(name: string, args: Abs[]): Abs \| undefined` |
| <a id="evalobjectprotomethod"></a>`evalObjectProtoMethod` | fn | Object.prototype 方法语义（evaluator $invoke 与 Object.prototype.X.call 共用）。 | `evalObjectProtoMethod( name: string, thisVal: Abs, args: Abs[], ): Abs \| undefined` |
| <a id="evalpromisector"></a>`evalPromiseCtor` | fn | new Promise(executor)：调用 executor(resolve, reject)，收集 resolve 实参作为 promise inner。原生只认第一次 settle——顺序双 resolve 取第一次；执行器内 $fork 分叉时各臂 settle 值 join（路径敏感，不得 first-wins 假精确）。 | `evalPromiseCtor(args: Abs[]): Abs` |
| <a id="evalpromisemethod"></a>`evalPromiseMethod` | fn | then/catch/finally：可映射回调 → 新 inner；做不到诚实 promise&lt;unknown&gt; | `evalPromiseMethod( name: string, recv: Abs, args: Abs[], ): Abs \| undefined` |
| <a id="evalpromisestatic"></a>`evalPromiseStatic` | fn | — | `evalPromiseStatic(name: string, args: Abs[]): Abs \| undefined` |
| <a id="evalregexpctor"></a>`evalRegExpCtor` | fn | — | `evalRegExpCtor(args: Abs[]): Abs` |
| <a id="evalregexpmethod"></a>`evalRegExpMethod` | fn | — | `evalRegExpMethod(name: string, recv: Abs, args: Abs[]): Abs \| undefined` |
| <a id="evalstringstatic"></a>`evalStringStatic` | fn | String.fromCharCode(...)： - 全部字面量 → 按 ToUint16 折成精确字符串（含越界/非整数/数字字符串） - symbol 字面量 → TypeError（ToNumber 抛） - 任一抽象实参 → 抽象 string（不假精确） | `evalStringStatic(name: string, args: Abs[]): Abs \| undefined` |
| <a id="evalsymbolctor"></a>`evalSymbolCtor` | fn | 全局 Symbol([desc])（$callNamed 身份校验后派发） | `evalSymbolCtor(args: Abs[]): Abs` |
| <a id="evictchecksourcememoforpaths"></a>`evictCheckSourceMemoForPaths` | fn | `*.nudo.js` 变更后定向逐出依赖它的整文件 check 缓存。查找与索引同走 stablePathKey | `evictCheckSourceMemoForPaths(paths: string[]): number` |
| <a id="evictgeneralizememoforpaths"></a>`evictGeneralizeMemoForPaths` | fn | LSP/宿主：`*.nudo.js` 变更后按路径定向逐出依赖它的 L0 条目。 | `evictGeneralizeMemoForPaths(paths: string[]): number` |
| <a id="execnudomodule"></a>`execNudoModule` | fn | 执行 *.nudo.js（真实 JS + 我们的构建器）。import/export 由 Babel 语句级 改写：多行 named import、注释/字符串里的同形文本不误伤；相对 .nudo 递归 求值；环 → throw NudoSidecarError。结果进 exec 缓存（依赖闭包内容指纹键）。 | `execNudoModule(src: string, opts?: RefineResolveOpts): Record<string, unknown>` |
| <a id="extractbalancedparens"></a>`extractBalancedParens` | fn | 平衡括号摘取（字符串感知；`\` 不是转义——与 case 实参原样 slice 一致）。 | `extractBalancedParens(text: string, startIdx: number): string \| null` |
| <a id="extractdeclaredthrows"></a>`extractDeclaredThrows` | fn | 申报式抛错（declare throws — L2 豁免）： 与 refine 同扫函数前注释块（D6=G2 同一 scope 绑定）。 | `extractDeclaredThrows( source: string, fnName: string, ): string[]` |
| <a id="extractfn"></a>`extractFn` | fn | — | `extractFn( source: string, fnName: string, fileAst?: ReturnType<typeof babelParse>, )` |
| <a id="extractfnbudget"></a>`extractFnBudget` | fn | 函数级预算旋钮（#64 P4）： 与 @nudo:throws 同路径扫函数前注释块（D6=G2 同一 scope 绑定）。 | `extractFnBudget( source: string, fnName: string, )` |
| <a id="extractnudoimports"></a>`extractNudoImports` | fn | `@nudo:import` 命名/namespace 导入（D5=F1：文法在 directive-scan 单源）。 | `extractNudoImports(source: string): NamedImport[]` |
| <a id="extractrefinereturnfromsource"></a>`extractRefineReturnFromSource` | fn | 解析 `@nudo:contract return positive` → 返回契约。 | `extractRefineReturnFromSource( source: string, fnName: string, opts: RefineResolveOpts = {}, )` |
| <a id="extstate"></a>`ExtState` | type | — | `ExtState = "nonext" \| "sealed" \| "frozen"` |
| <a id="extstateof"></a>`extStateOf` | fn | — | `extStateOf(o: Abs): ExtState \| undefined` |
| <a id="falseconstraint"></a>`falseConstraint` | fn | — | `falseConstraint(c: Abs): Pred \| undefined` |
| <a id="fnabs"></a>`FnAbs` | type | — | `FnAbs = Abs & { shape: { k: "fn"; params: string[]; name?: string; paramTypes?: Abs[]; returnType?: Abs; }; }` |
| <a id="fnconstrainttoentryreqs"></a>`fnConstraintToEntryReqs` | fn | fn 约束 → 逐参约束表（interface 推导 / 入口签名消费）。 | `fnConstraintToEntryReqs( c: NudoConstraint, ): Array<{ param: string; constraint: NudoConstraint }>` |
| <a id="formalparam"></a>`FormalParam` | type | C4.1：函数形参表面（contract surface）—— 侧车 `fn({…})` / `@nudo:contract` 参数名与求值形参的对齐基线。 | `FormalParam = \| { kind: "id"; name: string; index: number } \| { kind: "default"; name: string; index: number } \| { kind: "rest"; name: st...` |
| <a id="formalparamdisplaynames"></a>`formalParamDisplayNames` | fn | 求值/签名用形参名（与 analyzer extractParamNames / dts 对齐） | `formalParamDisplayNames(formals: FormalParam[]): string[]` |
| <a id="formalparamsfromnodes"></a>`formalParamsFromNodes` | fn | — | `formalParamsFromNodes(params: AstParam[] \| undefined \| null): FormalParam[]` |
| <a id="formalparamsignaturenames"></a>`formalParamSignatureNames` | fn | 签名展示名（C4.1 #64）：解构形参渲染为 `{ grade, findings }`， 不落回求值占位 `_p0`——否则读签名的人以为没有契约。 | `formalParamSignatureNames(formals: FormalParam[]): string[]` |
| <a id="formatabsmultiline"></a>`formatAbsMultiline` | fn | 多行展示，CLI 用 | `formatAbsMultiline(a: Abs, label?: string): string` |
| <a id="formatdiagnostics"></a>`formatDiagnostics` | fn | — | `formatDiagnostics(diags: Diagnostic[]): string` |
| <a id="formateffectiveinterfacedisplay"></a>`formatEffectiveInterfaceDisplay` | fn | EffectiveInterface → 契约展示串（与 CLI interface 打印同口径，不含函数名） | `formatEffectiveInterfaceDisplay(eff: EffectiveInterface): string` |
| <a id="formatgithubannotations"></a>`formatGithubAnnotations` | fn | GitHub Actions 行内注解（PR Files changed 红/黄标）。 | `formatGithubAnnotations( r: CheckReport, opts: { workspaceRoot?: string } = {}, ): string` |
| <a id="formatgitlabcodequality"></a>`formatGitlabCodeQuality` | fn | GitLab Code Quality 报告数组（`--gitlab`；可写 gl-code-quality-report.json） | `formatGitlabCodeQuality( r: CheckReport, opts: { workspaceRoot?: string } = {}, ): GitlabCodeQualityIssue[]` |
| <a id="formatinterfacetierline"></a>`formatInterfaceTierLine` | fn | CodeLens / hover 首行标题（design-refine-derivation §8）：`● interface / <source>` | `formatInterfaceTierLine(source: InterfaceSource): string` |
| <a id="formatoptions"></a>`FormatOptions` | type | — | `FormatOptions = { showTerm?: boolean; showPred?: boolean; indent?: string; }` |
| <a id="formatshapeslot"></a>`formatShapeSlot` | fn | fn/arr 槽位：shape + 非 lit term（禁止在 format 里内联复制 term 逻辑） | `formatShapeSlot(a: Abs): string` |
| <a id="ge"></a>`ge` | const | — | `const ge` |
| <a id="generatedexportnames"></a>`generatedExportNames` | fn | 侧车源码的生成段导出名：export 之前（跳过紧邻的 import/const 链）的注释 行含 `@generated` → 该名为 generated。组合式下行段（§5.3）形态为 `import` + `@generated 头` + prelude + export；callsite 段则是头紧贴 export。隔了其他代码行 / 无标记 / re-export 列表均不算。 | `generatedExportNames(sidecarSrc: string): Set<string>` |
| <a id="genum"></a>`geNum` | fn | — | `geNum(term: Term, n: number): Pred` |
| <a id="getabsproperty"></a>`getAbsProperty` | fn | 属性读取：template/string.length 等 | `getAbsProperty(recv: Abs, name: string): Abs \| undefined` |
| <a id="getevalcallcollector"></a>`getEvalCallCollector` | fn | — | `getEvalCallCollector()` |
| <a id="getevalclass"></a>`getEvalClass` | fn | — | `getEvalClass(name: string): EvalClassSpec \| undefined` |
| <a id="getfnimpl"></a>`getFnImpl` | fn | — | `getFnImpl(a: Abs): AbsFnImpl \| undefined` |
| <a id="getgeneralizememosize"></a>`getGeneralizeMemoSize` | fn | — | `getGeneralizeMemoSize(): number` |
| <a id="getimplicationoracle"></a>`getImplicationOracle` | fn | — | `getImplicationOracle(): ImplicationOracle \| undefined` |
| <a id="getpropflags"></a>`getPropFlags` | fn | — | `getPropFlags(o: Abs): Map<string, PropFlags> \| undefined` |
| <a id="getslot"></a>`getSlot` | fn | 自有槽位读取。slots 是普通对象，直接 `slots[key]` 会让 `__proto__` / `toString` / `valueOf` 等键命中 Object.prototype 原型链，得到既非 slot 又 truthy 的原生值（历史 bug 模式，已两次复发）。所有跨来源 key 的槽位 读取必须走这里。 | `getSlot<S extends { value: Abs }>( slots: Record<string, S>, key: string, ): S \| undefined` |
| <a id="getterm"></a>`getTerm` | fn | 字段访问项：u.id | `getTerm(obj: Term, key: string): Term` |
| <a id="gitlabcodequalityissue"></a>`GitlabCodeQualityIssue` | type | — | `GitlabCodeQualityIssue = { description: string; check_name: string; fingerprint: string; severity: "major" \| "minor" \| "info" \| "blocker"...` |
| <a id="gt"></a>`gt` | const | — | `const gt` |
| <a id="gtnum"></a>`gtNum` | fn | 便捷：数字下界 | `gtNum(term: Term, n: number): Pred` |
| <a id="hofcollectctx"></a>`HofCollectCtx` | type | — | — |
| <a id="hofsite"></a>`HofSite` | type | — | — |
| <a id="hostbuiltinctorname"></a>`hostBuiltinCtorName` | fn | 宿主全局构造器身份（Number === (42).constructor 折叠用） | `hostBuiltinCtorName(v: unknown): string \| undefined` |
| <a id="implicationoracle"></a>`ImplicationOracle` | type | 外部蕴含 oracle（可选 SMT 等）。内建判定证不出时调用。 | `ImplicationOracle = (phi: Phi, pred: Pred) => boolean \| undefined` |
| <a id="implies"></a>`implies` | fn | 简单蕴含：在区间/线性/字面量/typeof 可判定范围内判断 Φ ⊢ pred | `implies(phi: Phi, pred: Pred): boolean` |
| <a id="instantiatereturn"></a>`instantiateReturn` | fn | relation-only / isRelFn 的应用：按 paramTypes 做 α 替换得到 returnType。 | `instantiateReturn(fn: Abs, args: Abs[]): Abs` |
| <a id="interfacediag"></a>`InterfaceDiag` | type | interface 推导诊断（severity 由消费方按 code 定档，形状对齐 Issue 子集） | `InterfaceDiag = { code: string; message: string; file?: string }` |
| <a id="interfacediagcount"></a>`interfaceDiagCount` | fn | 当前诊断累计序号（since 锚：工具面只排干自身探测产生的增量） | `interfaceDiagCount(): number` |
| <a id="interfacesource"></a>`InterfaceSource` | type | 有效契约来源：手写（源码 refine ∪ 侧车手写绑定）&gt; 生成段 &gt; 隐式 | `InterfaceSource = "handwritten" \| "generated" \| "implicit"` |
| <a id="interfacesourceof"></a>`interfaceSourceOf` | fn | interfaceTierOf 的来源投影；非导出 → undefined | `interfaceSourceOf( source: string, fnName: string, fromFile: string, opts: InterfaceTierOpts = {}, ): InterfaceSource \| undefined` |
| <a id="interfacetieropts"></a>`InterfaceTierOpts` | type | — | `InterfaceTierOpts = EffectiveInterfaceOpts` |
| <a id="isbigprim"></a>`isBigPrim` | fn | — | `isBigPrim(a: Abs): boolean` |
| <a id="isdefinitelyfalse"></a>`isDefinitelyFalse` | fn | — | `isDefinitelyFalse(a: Abs): boolean` |
| <a id="isdefinitelytrue"></a>`isDefinitelyTrue` | fn | — | `isDefinitelyTrue(a: Abs): boolean` |
| <a id="iserrorctorname"></a>`isErrorCtorName` | fn | — | `isErrorCtorName(name: string \| undefined): boolean` |
| <a id="isintflag"></a>`isIntFlag` | fn | builder 与纯数据形态统一的 int 标志读取：纯数据看 `int === true`， builder（int 是链式方法）查 WeakSet。toPlainConstraint 归一化后只剩前者。 | `isIntFlag(c: NudoConstraint): boolean` |
| <a id="ismapabs"></a>`isMapAbs` | fn | — | `isMapAbs(a: Abs \| undefined): boolean` |
| <a id="isnodemodulespath"></a>`isNodeModulesPath` | const | — | — |
| <a id="isnudobreak"></a>`isNudoBreak` | fn | — | `isNudoBreak(e: unknown, label?: string): boolean` |
| <a id="isnudoconstraint"></a>`isNudoConstraint` | fn | — | `isNudoConstraint(x: unknown): x` |
| <a id="isnudocontinue"></a>`isNudoContinue` | fn | — | `isNudoContinue(e: unknown, label?: string): boolean` |
| <a id="isnudoreturn"></a>`isNudoReturn` | fn | — | `isNudoReturn(e: unknown): e` |
| <a id="isnudothrow"></a>`isNudoThrow` | const | — | — |
| <a id="isnullishlitabs"></a>`isNullishLitAbs` | fn | 仅当 term 确为 lit null/undefined 时为 true；非 lit 的 litValue===undefined 不得当 nullish | `isNullishLitAbs(a: Abs): boolean` |
| <a id="isnullprotoobj"></a>`isNullProtoObj` | fn | — | `isNullProtoObj(o: Abs): boolean` |
| <a id="isnumprim"></a>`isNumPrim` | fn | — | `isNumPrim(a: Abs): boolean` |
| <a id="isobj"></a>`isObj` | fn | — | `isObj(a: Abs): a` |
| <a id="isobjectprotobrand"></a>`isObjectProtoBrand` | fn | — | `isObjectProtoBrand(a: Abs \| undefined): boolean` |
| <a id="isrelfn"></a>`isRelFn` | fn | 「有可用外延签名」判定：唯一权威定义。 | `isRelFn(a: Abs \| undefined \| null): boolean` |
| <a id="issetabs"></a>`isSetAbs` | fn | — | `isSetAbs(a: Abs \| undefined): boolean` |
| <a id="isstrprim"></a>`isStrPrim` | fn | — | `isStrPrim(a: Abs): boolean` |
| <a id="issymbolabs"></a>`isSymbolAbs` | const | — | `const isSymbolAbs` |
| <a id="joinfunctions"></a>`joinFunctions` | fn | 函数 join：签名并（重载），禁止 (A\|C)→(B\|D)。 | `joinFunctions(a: Abs, b: Abs): Abs` |
| <a id="joinobjects"></a>`joinObjects` | fn | 对象 join：默认积之和（sum），不自动折 optional。 | `joinObjects(a: Abs, b: Abs): Abs` |
| <a id="jointhenproject"></a>`joinThenProject` | fn | 工件聚合投影（设计 §4.2：先 Abs join 折叠再投影）。 | `joinThenProject(absList: Abs[]): NudoConstraint \| undefined` |
| <a id="le"></a>`le` | const | — | `const le` |
| <a id="leavepromiseexecutorscope"></a>`leavePromiseExecutorScope` | fn | — | `leavePromiseExecutorScope(): number` |
| <a id="lenterm"></a>`lenTerm` | fn | 长度项：length(u) | `lenTerm(t: Term): Term` |
| <a id="lenum"></a>`leNum` | fn | — | `leNum(term: Term, n: number): Pred` |
| <a id="leqresult"></a>`LeqResult` | type | — | `LeqResult = { ok: boolean; reason?: string; }` |
| <a id="listfunctionnames"></a>`listFunctionNames` | fn | 列出源码中的顶层函数名。 | `listFunctionNames(source: string): string[]` |
| <a id="literalmeetsconstraint"></a>`literalMeetsConstraint` | fn | 字面量 lv 是否落在约束 c 表达的域内（保守：判不了 → false）。 | `literalMeetsConstraint( lv: number \| string \| boolean \| null \| undefined, c: NudoConstraint, ): boolean` |
| <a id="littruth"></a>`litTruth` | fn | JS 真值：字面量按 Boolean(v)；对象形恒真；不可判 → undefined | `litTruth(a: Abs): boolean \| undefined` |
| <a id="localnamedexports"></a>`localNamedExports` | fn | 源文件本地导出名表（侧车自动绑定边界）： - ESM：`export function/const/let/var/class` 与本地 `export { x }` / `export { local as exported }`（按**导出名**绑定）； - `export default function add` / `const add = …; export default add`： 按**本地名** `add` 绑定（侧车可 `export const add = fn(…)`）； 同时登记 `"default"`，供侧车 `export default fn(…)` 对齐； - CJS（C4.3）：`module.exports = { a, b }`、`module.exports.a = …`、 `exports.a = …`、`module.exports = localFn`（登记 localFn 名）。 | `localNamedExports(source: string): Set<string>` |
| <a id="locatecontractparam"></a>`locateContractParam` | fn | 契约参数名 → 形参定位。 | `locateContractParam( formals: FormalParam[], contractName: string, )` |
| <a id="lookupobjaccessor"></a>`lookupObjAccessor` | fn | 对象字面量访问器查询（供 $get/$set/$spread/Object.assign 共用） | `lookupObjAccessor( o: Abs, key: string, )` |
| <a id="looseeqabs"></a>`looseEqAbs` | fn | 宽松相等 `==`（C2.3）：双 lit 走 Abstract Equality；否则回落严格相等判定。 | `looseEqAbs(a: Abs, b: Abs): boolean \| undefined` |
| <a id="lt"></a>`lt` | const | — | `const lt` |
| <a id="ltnum"></a>`ltNum` | fn | — | `ltNum(term: Term, n: number): Pred` |
| <a id="makearrayctorabs"></a>`makeArrayCtorAbs` | fn | — | `makeArrayCtorAbs(args: Abs[]): Abs` |
| <a id="makemapabs"></a>`makeMapAbs` | fn | — | `makeMapAbs(iterable?: Abs): Abs` |
| <a id="makesetabs"></a>`makeSetAbs` | fn | — | `makeSetAbs(iterable?: Abs): Abs` |
| <a id="makesymbolabs"></a>`makeSymbolAbs` | fn | Symbol([description])：非具体 unique symbol（prim type=symbol，无 term）。 | `makeSymbolAbs(descArg?: Abs): Abs` |
| <a id="mapclearentries"></a>`mapClearEntries` | fn | Map#clear：清空条目；fork 下仍走 overlay | `mapClearEntries(mapAbs: Abs): Abs` |
| <a id="mapdeleteentry"></a>`mapDeleteEntry` | fn | Map#delete：fork overlay 内移除字面量键；未知 key 仅标 shadow 不确定 | `mapDeleteEntry(mapAbs: Abs, key: Abs \| undefined): Abs` |
| <a id="mapelementfallback"></a>`mapElementFallback` | fn | map 元素投影：body 在符号实参上跑出 unknown 时， 用 shape.returnType 槽，conf 由调用方按 path/partial 处理。 | `mapElementFallback( cbAbs: Abs \| undefined, elem: Abs, out: Abs, ): Abs` |
| <a id="mapentriesabs"></a>`mapEntriesAbs` | fn | Map 迭代条目：JS `for (const [k,v] of map)` / `Array.from(map)` 产出 `[key, value]` 元组 Abs。字面量 key 精确；shadow 写入 key 为 unknown。 | `mapEntriesAbs(mapAbs: Abs): Abs[]` |
| <a id="mapgetentry"></a>`mapGetEntry` | fn | Map#get：命中字面量 key → 精确；miss / 未知 key / maybeAbsent / shadow 并 undefined | `mapGetEntry(mapAbs: Abs, key: Abs \| undefined): Abs` |
| <a id="maphasentry"></a>`mapHasEntry` | fn | Map#has：字面量 miss 折 exact false 时，get 必须是 undefined（不可再并 value） | `mapHasEntry(mapAbs: Abs, key: Abs \| undefined): Abs` |
| <a id="mapsetentry"></a>`mapSetEntry` | fn | Map#set：fork 内写 overlay；否则原地。返回同一 Abs（JS 可变语义） | `mapSetEntry(mapAbs: Abs, key: Abs \| undefined, value: Abs): Abs` |
| <a id="mapsizeabs"></a>`mapSizeAbs` | fn | — | `mapSizeAbs(mapAbs: Abs): Abs` |
| <a id="mapvaluesabs"></a>`mapValuesAbs` | fn | — | `mapValuesAbs(mapAbs: Abs): Abs[]` |
| <a id="markextstate"></a>`markExtState` | fn | — | `markExtState(o: Abs, s: ExtState): Abs` |
| <a id="marknullprotoobj"></a>`markNullProtoObj` | fn | — | `markNullProtoObj(o: Abs): Abs` |
| <a id="markpurefn"></a>`markPureFn` | fn | 标记纯函数（@nudo:pure）：调用结果可按实参记忆化 | `markPureFn(target: object, name: string): void` |
| <a id="matchrelidentlit"></a>`matchRelIdentLit` | fn | 从 Identifier 在比较中的位置解析「对哪个变量、用哪个关系」。 | `matchRelIdentLit( test: unknown, )` |
| <a id="max_eval_call_depth"></a>`MAX_EVAL_CALL_DEPTH` | const | — | `const MAX_EVAL_CALL_DEPTH` |
| <a id="max_eval_total_calls"></a>`MAX_EVAL_TOTAL_CALLS` | const | 总调用上限：与 call-budget.MAX_TOTAL_CALLS 同阀（递归×循环×分支展开的 规模阀）。200k 在病态展开（lodash _baseFlatten）下 ~30s，20k 收口到 ~3s——截断 → opaque（更保守，zero-FP 安全）。 | `const MAX_EVAL_TOTAL_CALLS` |
| <a id="mergecollectionarms"></a>`mergeCollectionArms` | fn | 合并 fork 各臂 overlay → 全局表（由 endCollectionFork 实现）。 | `mergeCollectionArms(arms: Array<ArmOverlay \| undefined \| null>): void` |
| <a id="migrateinvariants"></a>`migrateInvariants` | fn | 写路径产生新副本时迁移不变性侧表（同 migrateAccessors 模式）。 | `migrateInvariants(from: Abs, to: Abs): void` |
| <a id="migratenullproto"></a>`migrateNullProto` | fn | 同一对象的不可变更新（$set/$del）迁移 nullProto 标记 | `migrateNullProto(from: Abs, to: Abs): Abs` |
| <a id="mod"></a>`mod` | fn | 取模：字面量折叠；`x % k`（k 为有限非零字面量）仅当被除数有限时 结果界在 (−\|k\|, \|k\|)。整数模可收紧到 [0, k)，此处先做保守实数界。 | `mod(a: Abs, b: Abs, phi: Phi = pTrue): Abs` |
| <a id="mul"></a>`mul` | fn | 乘法：字面量直接求值；×正数同向缩放；×负数翻转不等式；×0 归零 | `mul(a: Abs, b: Abs, phi: Phi = pTrue): Abs` |
| <a id="namedimport"></a>`NamedImport` | type | `/// @nudo:import { delay, percent } from "./delay.nudo.js"` | `NamedImport = { names: string[]; spec: string }` |
| <a id="namespaceabsof"></a>`namespaceAbsOf` | fn | 命名空间 Abs（`import * as ns` / `export * as ns` / CJS require 绑定）： open + path——导出收集可能不全（CJS 收集失败等），缺失成员是分析 视图不完整，不得按「运行时缺失」判定（不可调用判定会假抛 TypeError）。 | `namespaceAbsOf(mod: AbsModuleExports): Abs` |
| <a id="namespacenameof"></a>`namespaceNameOf` | fn | 命名空间身份表：transpile 后 `Math.max(0, x)` 的接收者是宿主 JS 全局对象 （非 Abs）。按对象身份识别命名空间，路由到 Abs builtin 表。 | `namespaceNameOf(v: unknown): string \| undefined` |
| <a id="ne"></a>`ne` | const | — | `const ne` |
| <a id="negabs"></a>`negAbs` | fn | 一元负号：字面量折叠（含 ToNumber 强制）；符号数翻转不等式 | `negAbs(a: Abs, _phi: Phi = pTrue): Abs` |
| <a id="negatepred"></a>`negatePred` | fn | 逻辑否定（De Morgan）：¬(A∧B)=¬A∨¬B；¬(A∨B)=¬A∧¬B；双重否定消去。 | `negatePred(p: Pred): Pred` |
| <a id="not"></a>`not` | fn | — | `not(p: Pred): Pred` |
| <a id="notabs"></a>`notAbs` | fn | 逻辑非 | `notAbs(a: Abs): Abs` |
| <a id="notecollectionwrite"></a>`noteCollectionWrite` | fn | — | `noteCollectionWrite(id: object): void` |
| <a id="noteevalcallrecord"></a>`noteEvalCallRecord` | fn | 成员/方法调用点打点（$invoke 等；无收集器时 no-op）。不进 $callNamed 预算。 | `noteEvalCallRecord(r: EvalCallRecord): void` |
| <a id="noteevalfallback"></a>`noteEvalFallback` | fn | 记录一次 B 回落（body-fn / tryRunTranspiled / call 边界兜底共用） | `noteEvalFallback(e: unknown): void` |
| <a id="notepromiseexecutorfork"></a>`notePromiseExecutorFork` | fn | $fork 在 executor 内发生时打点（多臂 resolve 需 join，不得 first-wins 假精确） | `notePromiseExecutorFork(): void` |
| <a id="nudofield"></a>`NudoField` | type | — | `NudoField = { constraint: NudoConstraint; optional?: boolean; }` |
| <a id="nudofnconstraint"></a>`NudoFnConstraint` | type | fn(params, returns?, &#123; throws? | `NudoFnConstraint = { params: Record<string, NudoConstraint>; returns?: NudoConstraint; throws?: NudoConstraint; }` |
| <a id="nudosidecarerror"></a>`NudoSidecarError` | fn | 侧车模块错误：code ∈ nudo:interface-cycle \| nudo:interface-load | `NudoSidecarError extends Error { readonly code: string; constructor(code: string, message: string) { super(message); this.name = "NudoSid...` |
| <a id="nudosig"></a>`NudoSig` | type | 无损函数签名（类型即计算） | `NudoSig = { name: string; params: string[]; paramTypes?: string[]; abs: Abs; display: string; detail: string; conf: Confidence; throws?: ...` |
| <a id="nudounsupportederror"></a>`NudoUnsupportedError` | fn | 转译器无法正确 lowering 的构造：抛此错误（替代静默降级注释）。 | `NudoUnsupportedError extends Error { readonly reason: string; readonly loc?: { line: number; column: number }; constructor(reason: string...` |
| <a id="nullable"></a>`nullable` | fn | nullable(c)：允许 null / undefined 的约束（nullish 显式化）。 | `nullable( c: NudoConstraint \| ConstraintBuilder \| number \| string \| boolean, ): ConstraintBuilder` |
| <a id="numvar"></a>`numVar` | fn | 带项的符号数，例如参数 x | `numVar(id: string, pred?: Pred, conf: Confidence = "path"): Abs` |
| <a id="object_proto_method_names"></a>`OBJECT_PROTO_METHOD_NAMES` | const | — | `const OBJECT_PROTO_METHOD_NAMES` |
| <a id="objectprotobrand"></a>`objectProtoBrand` | fn | Object.prototype 单例（$get(Object, "prototype") 与 host Object.prototype 共用）。 | `objectProtoBrand(): Abs` |
| <a id="objectprotomethodabs"></a>`objectProtoMethodAbs` | fn | Object.prototype.X 一等函数（bindThis：call/apply 把 receiver 注入首参） | `objectProtoMethodAbs(name: string): Abs` |
| <a id="objof"></a>`objOf` | fn | — | `objOf( slots: Record<string, Slot>, opts?: { index?: { key: Abs; value: Abs }; open?: boolean }, ): Abs` |
| <a id="omit"></a>`omit` | fn | omit(c, keys)：shape 去字段；非 shape throw | `omit( c: NudoConstraint \| ConstraintBuilder, keys: string[], ): ConstraintBuilder` |
| <a id="or"></a>`or` | fn | — | `or(...preds: Pred[]): Pred` |
| <a id="partial"></a>`partial` | fn | partial(c)：shape 全字段变可选；非 shape throw | `partial(c: NudoConstraint \| ConstraintBuilder): ConstraintBuilder` |
| <a id="pfalse"></a>`pFalse` | const | — | `const pFalse` |
| <a id="phiand"></a>`phiAnd` | const | — | `const phiAnd` |
| <a id="pick"></a>`pick` | fn | pick(c, keys)：shape 子形状（不存在的 key 忽略）；非 shape throw | `pick( c: NudoConstraint \| ConstraintBuilder, keys: string[], ): ConstraintBuilder` |
| <a id="polyfn"></a>`PolyFn` | type | — | `PolyFn = { name: string; params: string[]; typeParams: TypeParam[]; instantiate: (args: Abs[], phi?: Phi) => Abs; symbolic: Abs; display:...` |
| <a id="popcollectionarm"></a>`popCollectionArm` | fn | — | `popCollectionArm(): ArmOverlay \| undefined` |
| <a id="popphi"></a>`popPhi` | fn | — | `popPhi(): void` |
| <a id="powabs"></a>`powAbs` | fn | —— 幂（右结合由 AST 保证）；负指数 bigint 原生 RangeError → 不可折叠 | `powAbs(a: Abs, b: Abs): Abs` |
| <a id="predequals"></a>`predEquals` | fn | — | `predEquals(a: Pred, b: Pred): boolean` |
| <a id="predtostring"></a>`predToString` | fn | — | `predToString(p: Pred): string` |
| <a id="predvars"></a>`predVars` | fn | 收集 pred 中出现的自由变量 | `predVars(p: Pred): Set<string>` |
| <a id="primname"></a>`PrimName` | type | — | `PrimName = "number" \| "string" \| "boolean" \| "bigint" \| "symbol"` |
| <a id="primtotypeof"></a>`primToTypeof` | fn | abs prim 标签 → typeof 标签（恒等嵌入）。abs prim 仍是 PrimName 子集。 | `primToTypeof(p: PrimName): TypeofName` |
| <a id="projectflatmapresult"></a>`projectFlatMapResult` | fn | flatMap 统一结果：展开后的元素 join 成 arr(γ)。 | `projectFlatMapResult( arrConf: Confidence, mapped: Abs[], ): Abs` |
| <a id="promoteparamshape"></a>`promoteParamShape` | fn | 提升写入载体：替换 env.vars map 项，禁止 mutate 共享 Abs。 | `promoteParamShape( env: AstEnv, param: string, promotedShape: Shape, opts?: { loc?: { line: number; column: number }; recordSite?: boolean }, ): boolean` |
| <a id="propertykeyof"></a>`propertyKeyOf` | fn | ES ToPropertyKey 的字面量折叠：null→"null"、undefined→"undefined"、 true/false→"true"/"false"、number/bigint/string → String(v)（ToString）。 | `propertyKeyOf(a: Abs \| undefined): string \| undefined` |
| <a id="propflags"></a>`PropFlags` | type | — | `PropFlags = { writable?: boolean; enumerable?: boolean; configurable?: boolean; }` |
| <a id="protobrandabs"></a>`protoBrandAbs` | fn | `X.prototype` 形态（getPrototypeOf 结果；带 constructor 槽） | `protoBrandAbs(ctorName: string): Abs` |
| <a id="protoofrecv"></a>`protoOfRecv` | fn | Object.getPrototypeOf 的具体原型投影（constructor 链可解）。 | `protoOfRecv(a: Abs): Abs` |
| <a id="ptrue"></a>`pTrue` | const | — | `const pTrue` |
| <a id="ptypeof"></a>`ptypeof` | const | — | `const ptypeof` |
| <a id="purefnnameof"></a>`pureFnNameOf` | fn | 读纯函数标记（Abs impl 或对象属性 `_memoize`） | `pureFnNameOf(fn: unknown): string \| undefined` |
| <a id="pushcollectionarm"></a>`pushCollectionArm` | fn | — | `pushCollectionArm(): void` |
| <a id="pushloopexit"></a>`pushLoopExit` | fn | — | `pushLoopExit(v: Abs): void` |
| <a id="pushphi"></a>`pushPhi` | fn | — | `pushPhi(p: Phi): void` |
| <a id="pushthrowexit"></a>`pushThrowExit` | fn | — | `pushThrowExit(v: Abs): void` |
| <a id="queuepromisemicro"></a>`queuePromiseMicro` | fn | — | `queuePromiseMicro(task: () => void): void` |
| <a id="refinediag"></a>`RefineDiag` | type | refine 侧车加载诊断（severity 由消费方按 code 定档，形状对齐 Issue 子集） | `RefineDiag = { code: string; message: string; file?: string }` |
| <a id="refinediagcount"></a>`refineDiagCount` | fn | 当前诊断累计序号（since 锚） | `refineDiagCount(): number` |
| <a id="refineentry"></a>`RefineEntry` | type | 解析 `ms delay` / `n percent` → [param, Pred] 多条用 &amp;&amp; 或换行连接。 | `RefineEntry = { param: string; pred: Pred; constraint: NudoConstraint; }` |
| <a id="refineresolveopts"></a>`RefineResolveOpts` | type | — | `RefineResolveOpts = { loadModule?: (spec: string, fromFile: string) => string \| undefined; fromFile?: string; }` |
| <a id="refinetoindexedfull"></a>`refineToIndexedFull` | fn | refine 参数 → 带约束模板的下标表（shape 检查用） | `refineToIndexedFull( source: string, fnName: string, paramNames: string[], opts: RefineResolveOpts = {}, ): Array<[number, RefineEntry]>` |
| <a id="regexbrandabsfrom"></a>`regexBrandAbsFrom` | fn | RegExp brand：source/flags/lastIndex 进 slots（evaluator evalRegExpCtor / $regex 共用） | `regexBrandAbsFrom(pattern: string, flags: string): Abs` |
| <a id="registerevalclass"></a>`registerEvalClass` | fn | — | `registerEvalClass(spec: EvalClassSpec): void` |
| <a id="relationfingerprint"></a>`relationFingerprint` | fn | relationFn 稳定 fingerprint（同签名共享，见 §3.3 已知限制） | `relationFingerprint( paramTypes: Abs[], returnType: Abs, ): string` |
| <a id="relationfn"></a>`relationFn` | fn | 无 body、纯关系的 fn Abs。params 仅记 arity。 | `relationFn( paramTypes: Abs[], returnType: Abs, opts?: { params?: string[]; conf?: Confidence; fingerprint?: string; inferFrom?: { fromVar: string; via: "arr" \| "promise"; inferVar: string }; condFallback?: Abs; }, ): Abs` |
| <a id="relsource"></a>`RelSource` | type | — | — |
| <a id="requiredfnarity"></a>`requiredFnArity` | fn | Required arity from fn param labels — skips rest (`...`) and optional (`?`). | `requiredFnArity(params: readonly string[] \| undefined): number` |
| <a id="resetchecksourcememo"></a>`resetCheckSourceMemo` | fn | — | `resetCheckSourceMemo(): void` |
| <a id="resetevalcallbudget"></a>`resetEvalCallBudget` | fn | 宿主入口前强制清零（测试 / 显式 API）。执行入口请用 enterEvalCallBudgetSession。 | `resetEvalCallBudget(): void` |
| <a id="resetgeneralizememo"></a>`resetGeneralizeMemo` | fn | — | `resetGeneralizeMemo(): void` |
| <a id="resetnudomoduleexeccache"></a>`resetNudoModuleExecCache` | fn | — | `resetNudoModuleExecCache(): void` |
| <a id="resetphi"></a>`resetPhi` | fn | — | `resetPhi(): void` |
| <a id="resetsidecarloadfailurecache"></a>`resetSidecarLoadFailureCache` | fn | 与 resetNudoModuleExecCache 同口径：分析会话/测试间清空失败去重表 | `resetSidecarLoadFailureCache(): void` |
| <a id="runtime_import_re"></a>`RUNTIME_IMPORT_RE` | const | — | `const RUNTIME_IMPORT_RE` |
| <a id="runtranspiledoptions"></a>`RunTranspiledOptions` | type | — | `RunTranspiledOptions = { modules?: Record<string, AbsModuleExports \| Record<string, unknown>>; maxLoopIters?: number; mode?: "exec" \| "an...` |
| <a id="runtranspiledoptionsmemokey"></a>`runTranspiledOptionsMemoKey` | fn | inject/modules **内容**指纹（memo 键）。对象身份对「每次新建同内容」 的 CLI 注入不稳——同一语义的 inject 跨 checkSource 调用会 miss 缓存。 | `runTranspiledOptionsMemoKey( opts: RunTranspiledOptions \| undefined, ): string` |
| <a id="runwithloopexits"></a>`runWithLoopExits` | fn | 函数求值作用域：收集抽象分支上的 early-return / throw 值；try 标记栈同边界 | `runWithLoopExits<T>(body: () => T): T` |
| <a id="scancaseargspans"></a>`scanCaseArgSpans` | fn | case 实参区间（供其它标签做遮罩） | `scanCaseArgSpans(text: string)` |
| <a id="self"></a>`SELF` | const | 模板占位项；instantiate 时换成真实参数名 | `const SELF` |
| <a id="setaddentry"></a>`setAddEntry` | fn | Set#add：fork 内写 overlay；返回同一 Abs | `setAddEntry(setAbs: Abs, value: Abs): Abs` |
| <a id="setapplycallbackhost"></a>`setApplyCallbackHost` | fn | evaluator 宿主 `exec/call.ts` 加载时注册（副作用）。 | `setApplyCallbackHost(fn: ApplyCallbackHost): void` |
| <a id="setclearentries"></a>`setClearEntries` | fn | Set#clear | `setClearEntries(setAbs: Abs): Abs` |
| <a id="setdeleteentry"></a>`setDeleteEntry` | fn | Set#delete：按字面量元素移除；fork overlay 内生效。 | `setDeleteEntry(setAbs: Abs, value: Abs): Abs` |
| <a id="setelementsabs"></a>`setElementsAbs` | fn | — | `setElementsAbs(setAbs: Abs): Abs[]` |
| <a id="setevalassigncollector"></a>`setEvalAssignCollector` | fn | 返回先前 collector，便于嵌套调用 save/restore（禁止 finally 置 null 砸外层） | `setEvalAssignCollector( collector: ((r: EvalAbsAssignRecord) => void) \| null, )` |
| <a id="setevalbindingsink"></a>`setEvalBindingSink` | fn | — | `setEvalBindingSink(sink: Map<string, unknown> \| null): void` |
| <a id="setevalfallbackcollector"></a>`setEvalFallbackCollector` | fn | — | `setEvalFallbackCollector( collector: ((f: EvalFallback) => void) \| null, ): void` |
| <a id="sethasentry"></a>`setHasEntry` | fn | — | `setHasEntry(setAbs: Abs, value: Abs): Abs` |
| <a id="setimplicationoracle"></a>`setImplicationOracle` | fn | — | `setImplicationOracle(fn: ImplicationOracle \| undefined): void` |
| <a id="setinterfacediagcollector"></a>`setInterfaceDiagCollector` | fn | 设置诊断观察者（null 清除）；缓冲照常累积，takeInterfaceDiags 取走 | `setInterfaceDiagCollector( fn: ((d: InterfaceDiag) => void) \| null, ): void` |
| <a id="setpropflags"></a>`setPropFlags` | fn | — | `setPropFlags(o: Abs, key: string, f: PropFlags): void` |
| <a id="setrefinediagcollector"></a>`setRefineDiagCollector` | fn | 设置诊断观察者（null 清除）；缓冲照常累积，takeRefineDiags 取走 | `setRefineDiagCollector(fn: ((d: RefineDiag) => void) \| null): void` |
| <a id="setsizeabs"></a>`setSizeAbs` | fn | — | `setSizeAbs(setAbs: Abs): Abs` |
| <a id="shapeofterm"></a>`shapeOfTerm` | fn | 从 term 反推 prim shape | `shapeOfTerm(t: Term): Shape` |
| <a id="shapeonlyfn"></a>`shapeOnlyFn` | fn | 仅写 shape 槽（E 路径 / §5.2 提升产物）；禁止 attachFnImpl | `shapeOnlyFn( paramTypes: Abs[], returnType: Abs, opts?: { params?: string[]; conf?: Confidence }, ): Abs` |
| <a id="shapetostring"></a>`shapeToString` | fn | — | `shapeToString(s: Shape): string` |
| <a id="shlabs"></a>`shlAbs` | fn | &lt;&lt; —— 左移（rhs ToUint32 &amp; 31；bigint 不限位宽） | `shlAbs(a: Abs, b: Abs): Abs` |
| <a id="shrabs"></a>`shrAbs` | fn | &gt;&gt; —— 算术右移（rhs ToUint32 &amp; 31；bigint 不限位宽） | `shrAbs(a: Abs, b: Abs): Abs` |
| <a id="sidecarclosurefingerprint"></a>`sidecarClosureFingerprint` | fn | 侧车及递归 .nudo 依赖闭包的内容指纹：`${hashSource(侧车)}\|路径=hash,…`。 | `sidecarClosureFingerprint( fromFile: string, opts: EffectiveInterfaceOpts, ): string \| undefined` |
| <a id="sidecarpathof"></a>`sidecarPathOf` | const | — | — |
| <a id="simplifyterm"></a>`simplifyTerm` | fn | 常量折叠 + 简单代数化简 | `simplifyTerm(t: Term): Term` |
| <a id="snapshotabs"></a>`snapshotAbs` | fn | deep-ish copy for snapshot（新对象，不是 env.vars 同一引用） | `snapshotAbs(a: Abs): Abs` |
| <a id="spread"></a>`spread` | fn | spread：base ⊕ over（右侧覆盖，不是 join） 未出现在 over 的 key 保留 base；over 的 key 覆盖。 | `spread(base: Abs, over: Abs): Abs` |
| <a id="stricteqabs"></a>`strictEqAbs` | fn | 严格相等（Abs）：双字面量折叠；nullish 与 definitely-not-nullish → false。 | `strictEqAbs(a: Abs, b: Abs): boolean \| undefined` |
| <a id="stringofsymbol"></a>`stringOfSymbol` | fn | String(sym) → SymbolDescriptiveString（原生不抛；隐式 ToString 才抛） | `stringOfSymbol(a: Abs): Abs` |
| <a id="sub"></a>`sub` | fn | 减法：a - b = a + (-b)，数值上做单调性 | `sub(a: Abs, b: Abs, phi: Phi = pTrue): Abs` |
| <a id="substabs"></a>`substAbs` | fn | α 替换：map 的 key 是 term var id，value 是替换 Abs。 | `substAbs(a: Abs, map: ReadonlyMap<string, Abs>): Abs` |
| <a id="substpred"></a>`substPred` | fn | 把 pred 里的 Term 用 subst 替换（用于 bound 变量重命名等） | `substPred(p: Pred, subst: (t: Term) => Term): Pred` |
| <a id="substpredabs"></a>`substPredAbs` | fn | pred 三条规则： 1. | `substPredAbs( p: Pred, map: ReadonlyMap<string, Abs>, )` |
| <a id="symboldescriptionabs"></a>`symbolDescriptionAbs` | const | — | — |
| <a id="symbolidof"></a>`symbolIdOf` | const | — | — |
| <a id="takeinterfacediags"></a>`takeInterfaceDiags` | fn | 取走已收集的诊断（收集即清空） | `takeInterfaceDiags(): InterfaceDiag[]` |
| <a id="takeinterfacediagssince"></a>`takeInterfaceDiagsSince` | fn | 只取走 seq &gt; since 的诊断（清空仅限增量）——LSP 长驻进程里 lens/打印/ emit 工具用它排干**自身探测**产生的诊断，不窃取在途 validateText 待消费 的接口诊断（全量 take 曾在 await 窗口偷走 checkSource 的待收诊断）。 | `takeInterfaceDiagsSince(since: number): InterfaceDiag[]` |
| <a id="takeloopexits"></a>`takeLoopExits` | fn | — | `takeLoopExits(): Abs[]` |
| <a id="takerefinediags"></a>`takeRefineDiags` | fn | 取走已收集的诊断（收集即清空） | `takeRefineDiags(): RefineDiag[]` |
| <a id="takerefinediagssince"></a>`takeRefineDiagsSince` | fn | 只取走 seq &gt; since 的增量（工具面防窃取在途诊断；全量 take 的 since 版） | `takeRefineDiagsSince(since: number): RefineDiag[]` |
| <a id="takethrowexits"></a>`takeThrowExits` | fn | — | `takeThrowExits(): Abs[]` |
| <a id="termequals"></a>`termEquals` | fn | — | `termEquals(a: Term, b: Term): boolean` |
| <a id="termtostring"></a>`termToString` | fn | — | `termToString(t: Term): string` |
| <a id="throwconstrainttokinds"></a>`throwConstraintToKinds` | fn | fn(..., &#123; throws &#125;) / throws 约束 → 申报的 throws 类型名。 | `throwConstraintToKinds( c: NudoConstraint \| undefined, ): string[]` |
| <a id="tonumberabs"></a>`toNumberAbs` | fn | 一元 + —— ToNumber 折叠；bigint（含抽象 prim）原生恒抛 TypeError → 硬抛 | `toNumberAbs(a: Abs): Abs` |
| <a id="trueconstraint"></a>`trueConstraint` | fn | 从比较结果 Abs 提取「若为真」的额外约束（供 if 使用） | `trueConstraint(c: Abs): Pred \| undefined` |
| <a id="trymakeregexabs"></a>`tryMakeRegexAbs` | fn | new RegExp(pattern, flags) 字面量真构造验证（$new 与 evalRegExpCtor 共用）： - 无参 → /(?:)/（原生 source 归一） - pattern 非字面量（抽象/RegExp 实例）→ undefined（调用方保守） - symbol pattern / flags → TypeError（ToString 抛） - 非法 pattern / 非法 flags（含 number/null/boolean flags 的 ToString） → SyntaxError；合法 → 精确 brand（source/flags 取真构造结果） | `tryMakeRegexAbs(args: Abs[]): Abs \| undefined` |
| <a id="trypromotedirectcall"></a>`tryPromoteDirectCall` | fn | 挂载点②：CallExpression callee = 形参 Identifier 直接调用 p(x) / p(a,b)。 | `tryPromoteDirectCall( env: AstEnv, calleeName: string, args: Abs[], loc?: { line: number; column: number }, ): Abs \| undefined` |
| <a id="trypromoteforofiteratee"></a>`tryPromoteForOfIteratee` | fn | for-of 迭代对象提升（applyEach 型）：`for (const x of items)`， items 为形参且仍是 any/unknown → arr(自身 var)。不依赖方法名。 | `tryPromoteForOfIteratee( env: AstEnv, iterateeName: string, loc?: { line: number; column: number }, ): Abs \| undefined` |
| <a id="trypromotehofcallback"></a>`tryPromoteHofCallback` | fn | 挂载点③：HOF 回调实参。回调是 Identifier ∈ paramNames 且尚未有 fn 形状。 | `tryPromoteHofCallback( env: AstEnv, cevalName: string, method: string, argAbses: Abs[], loc?: { line: number; column: number }, ): Abs \| undefined` |
| <a id="trypromotereceiverasarr"></a>`tryPromoteReceiverAsArr` | fn | 挂载点①：方法派发 miss。receiver 是形参 Identifier 且 shape 为 any/未知， 方法名为 filter/map/reduce/flatMap → 提升为 arr(自身 var)。 | `tryPromoteReceiverAsArr( env: AstEnv, receiverName: string, method: string, loc?: { line: number; column: number }, ): Abs \| undefined` |
| <a id="tryruntranspiled"></a>`tryRunTranspiled` | fn | B 单一入口：runTranspiled + 类型化回落观测。 | `tryRunTranspiled( source: string, opts: RunTranspiledOptions = {}, ): Record<string, unknown> \| undefined` |
| <a id="typeof_names"></a>`TYPEOF_NAMES` | const | typeof 标签全集（否定展开用；顺序稳定） | `const TYPEOF_NAMES` |
| <a id="typeofabs"></a>`typeofAbs` | fn | JS typeof：结果域永远是 string | `typeofAbs(a: Abs): Abs` |
| <a id="typeofname"></a>`TypeofName` | type | JS `typeof` 完整结果域（8 标签）。Pred 的 typeof 节点用此域。 | `TypeofName = \| "undefined" \| "object" \| "boolean" \| "number" \| "bigint" \| "string" \| "symbol" \| "function"` |
| <a id="typeparam"></a>`TypeParam` | type | — | `TypeParam = { id: string; value: Abs; }` |
| <a id="undefabs"></a>`undefAbs` | fn | undefined 值的统一 Abs 表示（forEach/find 等） | `undefAbs(): Abs` |
| <a id="ushrabs"></a>`ushrAbs` | fn | &gt;&gt;&gt; —— 逻辑右移（rhs ToUint32 &amp; 31；bigint 无此运算符 → 不可折叠） | `ushrAbs(a: Abs, b: Abs): Abs` |
| <a id="withexecphi"></a>`withExecPhi` | fn | — | `withExecPhi<T>(p: Phi, body: () => T): T` |
| <a id="withphiconstraint"></a>`withPhiConstraint` | fn | 在当前 Φ 上合取额外约束，body 结束后恢复 | `withPhiConstraint(extra: Phi, body: () => void): void` |
| <a id="withvar"></a>`withVar` | fn | — | `withVar(env: AstEnv, name: string, value: Abs): AstEnv` |

</details>
<!-- NUDO-API-SKELETON:END -->
