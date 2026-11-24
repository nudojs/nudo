# 根因根除计划（2026-11-24）

> **状态**：现行。**来源**：`tmp/bug-report.md` 94 条（2026-11-24 复核）。
> **纪律**：不按 bug 编号施工；bug ID 只作为覆盖断言与验收清单。每个阶段只收敛
> 一个语义决策，禁止用「补分支 + 回归钉」代替结构修复。
> **交付后**：按 `docs/README.md` 删除正文，证据留在测试 / changeset / git。
>
> **进度（2026-11-24）**：Phase 0 / 1 / 2 完成（2.5 的 degraded 上屏由既有
> `export` 阻断诊断覆盖）；Phase 4.1 / 4.2 完成（矩阵进 CI + 孪生实现
> hygiene 门）；Phase 3 待做。Phase 3 前置：
> `SemanticIndex` 阶段 0 只带导出槽名，尚不含 dts 需要的值 / 类型 / 类成员节点。

## 0. 目标与非目标

**目标**：把「语法 → Abs → 产品面」的三条边界从 N×M 手工同步收敛为单点实现，
使新增 TS 构造只在一个地方落地；未支持的构造以 `degraded` 显式上屏，不再静默
变成 `any` / `unknown`。

**非目标**：

- 不改 Abs 形状 / `leqAbs` / `formatShape` / 单轨 IR（ADR 0001 §3）。
- 不重写求值器 / transpile。
- 不为单条 bug 加特判、白名单或第二套渲染器。
- 不在本计划内修复 H/I/K/M/Q 类求值模型与命令面残余；它们按各自台账排期。

## 1. 阶段与退出条件

### Phase 0 · 构造 × 面矩阵（先测量，不动产品）

| # | 任务 | 落点 | 退出条件 |
|---|---|---|---|
| 0.1 | 定义构造语料：注解成员 / 声明返回 / 类成员 / 模块面 / 值通道 / LSP | `scripts/face-matrix.ts` | 语料按 **构造** 命名，不按 bug 命名 |
| 0.2 | 四个面：`check` 签名、`dts` 文本、`dts` 自编译、消费方编译 | 同上 | 每格输出 `pass/fail` + 观测文本 |
| 0.3 | tsc oracle：`tsc --declaration` 与 `tsc --noEmit` | 同上 | nudo dts 与 tsc dts 的差异可定位到构造 |
| 0.4 | 基线棘轮：`docs/reports/face-matrix-baseline.json` | 同上 | 已知失败集合与基线一致；**新增失败即红**；基线缩小需显式更新 |
| 0.5 | 入口与文档：`package.json#face:matrix`、`scripts/README.md` | 同上 | 有常驻触发方；不阻塞现有 PR 门禁 |

**注意**：Phase 0 只报告，不修行为。基线是迁移棘轮，不是永久白名单；Phase 2/3
每收敛一个决策就删对应基线行。

### Phase 1 · 注解 AST（语法 → Abs 单点）

| # | 任务 | 落点 | 退出条件 |
|---|---|---|---|
| 1.1 | 保留注解节点旁路 `nudoTypeNode` / `nudoReturnTypeNode`（不可枚举） | `packages/core/src/strip-types.ts` | AST 结构等价断言不变；节点可直读 |
| 1.2 | `FormalParam.tsTypeNode` / `FunctionAnalysis.declaredReturnTypeNode` 透传 | `format/param-surface.ts`、`analyzer-ast.ts` | 不改变现有 `tsType` 文本消费方 |
| 1.3 | `TSType` 节点 → Abs 的 **total fold**：成员循环 / interface extends / import type / typeof / utility·mapped / template / 索引访问 / 构造签名 | `contract/ts-type-shape.ts` | 每个 `TSType` 种类有唯一分支；未支持 ⇒ `degraded` |
| 1.4 | 具名类型节点表（`namedTypeNodes`）替代文本摊平 | `contract/ts-type-shape.ts` | `interface extends` 不再依赖文本拼接 |
| 1.5 | 切换调用方；删除文本切分路径 | core / service | `splitTopLevel` 不再解析类型注解 |
| 1.6 | 穷尽性门 + 矩阵回归 | core tests + `face-matrix` | 新 `TSType` 种类未接线 = 编译红 / 矩阵红 |

### Phase 2 · 公共类型决议（declared vs observed vs degraded）

| # | 任务 | 落点 | 退出条件 |
|---|---|---|---|
| 2.1 | `resolvePublicType(Evidence[])` 优先级格 | `core/diagnostics/evidence.ts` | 没有「静默 → any」构造子 |
| 2.2 | dts 签名 / 类成员 / 值通道只读该决议 | `service/emit/dts-*` | `declarationMorePrecise` 白名单删除 |
| 2.3 | guard / standard / zod / hover / whatIf 读同一决议 | `service/emit/*`、`lsp/*` | 同一 fixture 归一化类型相等 |
| 2.4 | 字面量闸门收敛到单通道 | `dts-value-emit.ts` 等 | 默认导出 / namespace / 值通道同一实现 |
| 2.5 | `degraded` 必须上屏 | diagnostics | 无诊断消失 |

### Phase 3 · 单一模块/成员面（SemanticIndex）

| # | 任务 | 落点 | 退出条件 |
|---|---|---|---|
| 3.1 | dts 模块 / 类 / namespace / 导出槽只读 `SemanticIndex` | `dts-surface-*` | 删除 `dtsModuleSurface` 的独立 AST 扫描 |
| 3.2 | LSP 导航 / 签名 / 符号只读同一索引 | `lsp/src/*` | 删除 `collectImportBindings` 独立扫描 |
| 3.3 | export 面只读同一索引 | `nudojs/commands/export` | 导出槽单源 |
| 3.4 | 删孪生：`collectTopLevelFunctions` / `dtsModuleSurface` / `resolveRelativeModule` | service / lsp | `rg` 只剩单实现 |
| 3.5 | 成员判别联合：field / method / accessor / ctor / static / private / symbol / computed | `dts-ir.ts` | 每个 emitter 只渲染，不判断成员种类 |

### Phase 4 · 门禁（防复发）

| # | 任务 | 落点 | 退出条件 |
|---|---|---|---|
| 4.1 | CI 三不变量：产物自编译、消费方编译、`degraded` 必须上屏 | `face-matrix` + CI | 先 warning 一轮，再升 error |
| 4.2 | `lint:hygiene` 禁止第二份类型解析 / 说明符解析 / 键在场谓词 / 类型渲染 | `scripts/check-hygiene.mjs` | 新实现即红 |
| 4.3 | 删除迁移期 fallback / 开关 / 旧路径 | core / service / lsp | 无「双读」残留 |

## 2. 94 条覆盖映射（按根因类别）

> 只列每条**预计被哪个阶段顺带覆盖**；实际关闭以 `face-matrix` 与报告复跑为准。
> 不在此表之外的条目（H/I/K/M/Q）按各自台账独立修，不在本计划内。

| 类别 | 条数 | 条目 | 阶段 |
|---|---:|---|---|
| A 注解→Abs 映射 | 16 | 408 409 410 423 436 441 442 452 456 469 470 471 480 495 497 500 | P1（1.3/1.4） |
| B 声明返回精度闸门 | 9 | 418 422 426 427 455 478 498 459 492 | P2（2.1/2.2） |
| C 类模型/成员面 | 10 | 414 417 434 435 460 463 476 477 484 491 | P3（3.5）+ P2 |
| D 模块/导出面装配 | 7 | 416 453 457 461 462 473 489 | P3（3.1/3.3） |
| E 注解采用闸门 | 3 | 437 444 472 | P1（1.3/1.5） |
| F 值通道类型证据 | 7 | 429 438 475 482 493 496 501 | P2（2.2/2.4） |
| G 字面量闸门 | 2 | 415 443 | P2（2.4） |
| H 集合/内建对象模型 | 8 | 406 407 411 464 468 483 490 494 | 独立（求值模型） |
| I 运行时窄化/求值 | 8 | 413 419 425 433 466 481 485 499 | 独立（求值模型） |
| J 入口/普查/见证 | 6 | 424 430 431 439 440 467 | P3（3.1）+ 独立 |
| K 侧车路径 | 1 | 412 | 独立（路径解析单源） |
| L LSP/跨面契约 | 7 | 486 487 504 505 506 507 508 | P3（3.2）+ P4 |
| M 命令面 | 2 | 488 503 | 独立 |
| N1 core 渲染器 | 2 | 428 432 | P1（1.3） |
| N2 dts 渲染器 | 2 | 454 474 | P1（1.3）/ P2 |
| O 形参可选性/默认值 | 2 | 420 421 | P1（1.2/1.3）+ P2 |
| P 泛型签名/类型变量 | 2 | 458 502 | P2（2.2） |
| Q 共享键在场谓词 | 1 | 490 | 独立（谓词单源） |

## 3. 顺便修掉的 bug 台账

> 只登记**已用复现命令验证**的条目；在 `tmp/bug-report.md` 索引表中同步删除线。
> 未验证不登记。

| 条目 | 覆盖方式 | 验证 |
|---|---|---|
| ~~BUG-408~~ | `namedTypeTextsForSource` 接口摊平增补 `extends`（两遍递归，支持后声明 / 环保护） | `tmp/eradicate/b408.ts`：`adminName(a: {name,greet,role}) => string`，0 error；矩阵 `interface-extends` 由 fail → pass |
| ~~BUG-409~~ | `ObjectMember` 单点成员模型：调用签名 `(x): T` 独立于方法签名 | `tmp/eradicate/b409.ts`：`useCall(f: (number) => string) => string`，0 error；矩阵 `call-signature` 由 fail → pass |
| ~~BUG-471~~ | 同一个 `ObjectMember` 模型：`get` / `set` 访问器分支；getter 优先、仅 setter 用参数域 | `tmp/eradicate/b471.ts`：`g1(x: { a: number }) => number`、`g3` 同；矩阵 `accessor` pass |
| ~~BUG-410~~ | `builtinGenericAbs` 增 `Partial` / `Required` / `Readonly` / `Pick` / `Omit` 结构映射（对象槽变换；键集不可静态判 ⇒ 不猜） | `tmp/eradicate/b410.ts`：6 个函数 0 error；矩阵 `utility-type` pass |
| ~~BUG-500~~ | `valueTypeTextsForSource` 增对象字面量 dotted 值表（`cfg.port` / `cfg.nested.on`） | `tmp/eradicate/b500.ts`：`tPort(x: number) => number`，0 error；矩阵 `typeof-dotted` pass |
| ~~BUG-462~~ | `namespaceMembersOf` 对 ambient namespace 收隐式导出成员；`namespaceMemberLines` 增 `TSDeclareFunction` 分支 | `tmp/eradicate/policy/b462.ts`：`Settings.retries` / `describe(): string` 都在；自编译 / 消费方 exit 0 |
| ~~BUG-420~~ | `.d.ts` 声明签名允许解构默认值形参带 `?`：`patternOptional` 去掉 `!boundCovered`，观测签名同步 | `tmp/eradicate/policy/b420.ts`：`opt({ a }?: { a: number })` / `req({ a }: …)` |
| ~~BUG-453~~ | 非导出 enum 也发射模块局部 `declare enum`；enum 类型名一律登记为可解析 | `tmp/eradicate/policy/b453.ts`：`f(): E` + `declare enum E { A = 0 }`；自编译 / 消费方 exit 0 |
| ~~BUG-457~~ | 同名 namespace 成员合并（不再后写覆盖） | `tmp/eradicate/policy/b457.ts`：`namespace N { f(); b: 2 }` 两块成员都在 |
| BUG-438（部分） | `$fnVal` opts 增 `paramTypes` / `returnType`；函数表达式从旁路注解序列化签名 | `tmp/eradicate/policy/b438.ts`：`makeAdderArrowAnn` / `retParam` / `makeObj` / `adderConst` / `retAnonFnExpr` 的 dts 签名正确；**残余**：`makeAdder`（无返回注解）返回仍 `unknown`，`retNamed`（具名函数引用）仍 `(arg0) => unknown` |
| BUG-482（部分） | `objectFnMemberAnnotations` 的计算键解析补 `[k]`（const 字面量）/ `["dyn"]` / `[1]`；带注解的计算键成员保留签名 | `tmp/eradicate/policy/b482.ts`：`o10: { dyn: (x: number) => string }` ✅；**残余**：`o` / `o9`（无返回注解）仍 `() => unknown`，依赖 438 的返回证据 |
| ~~BUG-429~~ | `valueTypeTextOfInit` 的 `typeof` 只对导出名生效；模块局部标识符用初始化式放宽类型文本 | `tmp/eradicate/policy/b429.ts`：`obj: { name: string; port: number }` / `aliasExported: { fn: typeof TARGET }`；自编译 exit 0 |
| ~~BUG-475~~ | `objectFnMemberAnnotations` 递归嵌套对象（点路径）；`overlayObjectFnAnnotations` 按路径递归补洞；成员返回注解优先 | `tmp/eradicate/policy/b475b.ts`：`nested.inner.fn(x: number): string` / `deep.a.b.fn` 均保留 |
| ~~BUG-416~~ | `overloadExportGlue` 的 `named` 分支补 `form.extras`（重载 + alias / default 导出名不消失） | `tmp/eradicate/policy/b416.ts`：`p` 两条重载 + `export { p as alias }` / `{ p as default }`；消费方 exit 0 |
| ~~BUG-473~~ | ambient `declare function` + `export =` 补胶水行（无值/类声明可转换时） | `tmp/eradicate/policy/b473.ts`：`declare function api` + `export = api;`；自编译 exit 0 |
| ~~BUG-434~~ | `addField` 在已有构造器写入条目时，用带注解的真实字段声明覆盖（声明证据优先） | `tmp/eradicate/policy/b434.ts`：`v: number`（不再 `unknown`） |
| ~~BUG-435~~ | `ctorParamAbsArgs` / `classEntryPolyFn` 增构造器默认值域（`constructor(public z = 1)` ⇒ `z: number`） | `tmp/eradicate/policy/b435.ts`：`WithDefault(z: number)` / `inc() => number`，0 error |
| ~~BUG-463~~ | 私有字段类型进 getter 观测表（不发射成员） | `tmp/eradicate/policy/b463.ts`：`#private; get value(): number` |
| ~~BUG-414~~ | 类字段发射读 `nudoTypeText` → `$declDomain(declaredAbs, init)`；`scopePrivateNames` 深拷贝显式搬运不可枚举旁路 | `tmp/eradicate/policy/b414.ts`：`Nums.doubled() => number[]` / `first() => number`（此前 `[]` / `undefined`） |
| ~~BUG-417~~ | 类成员扫描在方法白名单前识别 `ClassPrivateMethod`，只置 `hasPrivateIdentifier`（不发射结构成员） | `tmp/eradicate/policy/b417.ts`：`export declare class C { #private; m(): number; }` |
| ~~BUG-484~~ | `DtsClassAccessorSurface` 增 `isAbstract`；扫描写 `mem.abstract`，发射拼 `abstract` | `tmp/eradicate/policy/b484.ts`：`abstract get area(): number;` / `abstract set area(v: number);` |
| ~~BUG-489~~ | `projectModuleDtsInner` 在无 `export =` / 无模块标记时补 `export {};`，非导出顶层声明不再被隐式导出 | `tmp/eradicate/b489`：dts 末尾 `export {};`；消费方 `import { Hidden }` 由假绿转 TS2305/TS2724 |
| ~~BUG-418~~ | `tsDeclaredReturn` 对 `raw === "this"` 无条件保留（Abs 无多态 this） | `tmp/eradicate/policy/b426.ts`：`chain(): this` 逐字 |
| ~~BUG-422~~ | 分析期 `declaredReturnAbs`（带 namedTypes / namedTypeNodes / importTypes）+ `tsDeclaredReturn` 直接消费 | `tmp/eradicate/policy/b422.ts`：`keyRet(): keyof User` / `idxRet(): User["name"]` / `aliasRet(): K` |
| ~~BUG-426~~ | `declaredCoversObserved`（声明 ⊇ 观测 ⇒ 保留声明） | `tmp/eradicate/policy/b426.ts`：`f(x: boolean): string \| number` |
| ~~BUG-427~~ | 同上；实例成员与 static 同口径 | `tmp/eradicate/policy/b459.ts`：`inst(...): string \| number` / `static stat(...): string \| number` |
| ~~BUG-455~~ | 同上（对象超类型：可选 / 索引 / readonly 保留） | `tmp/eradicate/policy/b455.ts`：`g(): { a?: number; b: string }` / `f(): { [k: string]: number }` / `r(): { readonly a: number }` |
| ~~BUG-456~~ | 删除 `raw !== "void"` 的硬丢弃；`Promise<void>` 由声明保留 | `tmp/eradicate/policy/b426.ts`：`v(): Promise<void>` |
| ~~BUG-459~~ | 声明 `Promise<string[]>` 覆盖观测 `Promise<[]>` | `tmp/eradicate/policy/b459.ts`：`empty(): Promise<string[]>` |
| ~~BUG-478~~ | 声明 `Array<(x: number) => string>` 覆盖观测 widen | `tmp/eradicate/policy/b459.ts`：`fns(): Array<(x: number) => string>` |
| ~~BUG-498~~ | 声明元组覆盖 widen 后的观测 | `tmp/eradicate/policy/b426.ts`：`tup(): [number]` |
| ~~BUG-442~~ | `AnnotationEnv.importTypes` + `inlineImportTypeTextsForFile`（service）与 CLI `annotationEnvForFile` 同表；`mapTsType` 增 `import("spec").T` 分支 | `tmp/eradicate/b442/lib.ts` + `sub/types.ts`：`take(u: { name: string, age: number }) => string`，0 error |
| ~~BUG-415~~ | default 导出登记挂 `literalTypeTextOfInit`（与具名 const 同一字面量闸门） | `tmp/eradicate/b415.ts`：`declare const _default: 42;`；矩阵 `default-export-literal` pass |
| ~~BUG-443~~ | namespace `const` 成员挂同一字面量闸门 | `tmp/eradicate/b443.ts`：`export const v: 1;` / `s: "x"` / `b: true` |
| ~~BUG-474~~ | `dts-type.ts` 的 bigint lit term 渲染为 `10n`（不再退 `bigint`） | `tmp/eradicate/b474.ts`：`export declare const b: 10n;`；矩阵 `bigint-literal` pass |
| BUG-497（部分） | 节点面 `Iterable` / `Iterator` / `AsyncIterable` 映射（文本面不动，避免 dts 值通道丢实参） | `tmp/eradicate/b497.ts`：3 个函数 0 error（假 `entry-may-throw` 消失）；**残余**：`for...of` 元素域仍 `number \| string`，返回位未精确 |
| BUG-423（部分） | `functionTypeAbs` 保留 `new` 前缀 → `absFunction({ctor:true})`；`$copy` 全 shape 搬运 facets | `tmp/eradicate/b423.ts`：`viaNew` / `viaAlias` 由 `=> never throws` → `=> number`；**残余**：`C(1)`（构造 only 的裸调用）仍零诊断（`$new` 与 `$call` 共用路径，见 §5） |
| BUG-480（部分） | 构造签名成员模型；`make` 通过 | `tmp/eradicate/b480.ts`：`make(c: Ctor) => string`；**残余**：`Both` 的 call + construct 双签名（Abs fn 只有一个签名槽）仍 `=> never`，需表示层扩展（另立 A 类） |

## 3.1 实施记录

### 2026-11-24 · Phase 3.1 前置实测

`SemanticIndex.exportSlots` 与 `dtsModuleSurface.exportBindings` 的直接对拍（5 个
代表源）暴露三类不可直接替换的差异：

- 索引含类型导出槽 `I` / `T`，dts 面把它们放在 `typeOnlyExportBindings` / `typeDeclarations`；
- 索引把 namespace 成员 `q` 也登记为导出槽，dts 面只在 namespace 内部发射；
- CJS 索引槽名是 `exports.foo` / `module.exports`，dts 面归一成 `foo` / 对象成员键。

⇒ 3.1 不能只换名字来源；索引需先补 `exportSlot.kind`（value / type / reexport /
cjs-member）、归一槽名、以及按 `SymbolId` 取声明节点的表。完成后再迁移
`dtsModuleSurface`，最后删独立扫描。

### 2026-11-24 · Phase 4.2 完成

- 删除 LSP 死代码 `parseTypeExpr`（第二份类型解析；无生产调用方）及其测试。
- `scripts/check-hygiene.mjs` 新增孪生实现门：`parseTypeExpr`（类型解析）、非 `symbols.ts` 的 `collectImportBindings`（说明符扫描）、非 `standard-schema.ts` 的 `hasProperty`（键在场谓词）、非 `dts-type.ts` 的 `renderDtsType`（类型渲染）均红。

### 2026-11-24 · Phase 4.1 完成

- `scripts/face-matrix.ts` 增加 `checkIssues` 面：`degraded-entry` 用例要求 `nudo check --json` 的 `issues[].code` 含 `nudo:entry-may-throw` ⇒ 降级不再静默。
- 矩阵从 23 例增至 **24 例**，基线同步；`pnpm run face:matrix` 进入 CI（`ts_changed` 时运行），产物自编译 + 消费方编译 + 降级上屏三条不变量同一条命令。

### 2026-11-24 · Phase 2.4 完成

- 删除三份 `widenTopLevel*` 复本：`dts-type.ts` 的 `widenTopLevelDts`、`dts-widen.ts` 的 `widenTopLevelAbs` / `widenLiteralToPrimAbs`、`projection-policy.ts` 的 `widenTopLevelObserved`；唯一实现落在 `abs-widen.ts`，`dts-type` / `dts-widen` / `dts-signature` / `projection-policy` 共用。
- 字面量闸门审计：`literalConst`（Abs 顶层的 `as const` / primitive literal）与 `literalTypeTextOfInit`（default / namespace 成员的源码初始化器文本）输入源不同、不是同一决议，未合并。
- `declarationMorePrecise` 与 `declaredNarrower` / `declaredCoversObserved` 已无代码引用。

### 2026-11-24 · Phase 2.3 / 2.4 首片

- `resolveDtsPublicType` 收编 `declarationMorePrecise` 的全部白名单规则（enum / 泛型实参 / lib 全局 / 内建占位 / readonly / 函数 / 字面量 / `| undefined`）；`tsDeclaredReturn` 不再保留本地 `declarationMorePrecise`。
- `observedReturnFace`（guard / standard / zod 的统一返回面）改用 `declaredWins`：声明覆盖观测 / 声明更窄 ⇒ 校验器与 dts 签发同一域。
- hover / whatIf 经由 `$fnVal.returnType` 读取注解旁路的声明返回，不另起声明 vs 观测决议。
- 仍待：各 emitter 局部 widen（`widenReturnAbs` / `widenModuleValueAbs`）与字面量闸门（`literalConst` / `literalTypeTextOfInit`）去重。

### 2026-11-24 · Phase 2.2 首片

- 新增 `service/src/emit/dts-public-type.ts` 的 `declaredWins(declared, observed)`：声明 ⊇ 观测（含等价）或声明更窄 ⇒ 保留声明。
- `tsDeclaredReturn` 的 `declaredNarrower` / `declaredCoversObserved` 合并为一次 `declaredWins` 调用；类成员 `refineObservedReturn` 改用同一 Abs 判据（具名类型 Abs 不可解析时回退文本成员判据）。
- 值通道保持既有的 declared-first（`declaredText ?? render()`）；字面量闸门去重仍归 2.4。

### 2026-11-24 · Phase 1 完成

- **节点 total fold**：`TSTYPE_NODE_SUPPORT` 以 `satisfies Record<TSType["type"], "node" | "unsupported">` 冻结 Babel 全部 TSType 种类；`mapTsTypeNode` 增字面量 / 模板 / `typeof` / inline import / `keyof` / 索引访问 / mapped type / 标签·可选·rest 元组 / 谓词 / `this` 分支；默认分支不再回落文本。
- **调用方切换**：入口域 / 构造参数 / 类入口 / 类字段 / dts 声明返回均走节点优先（`FormalParam.tsTypeNode`、`FunctionAnalysis.declaredReturnTypeNode`、`declaredReturnAbs`、`nudoTypeNode`）；文本解析仅保留给**文本型 API**（外部契约文本 / dts 注解原文 / 导入类型表），不再服务于源码 AST 注解。
- **穷尽性门**：新增 `TSTYPE_NODE_SUPPORT` 编译期 `satisfies` + `algebra-eval-core` 的 total-fold / explicit-unsupported 测试；构造矩阵保持 23/0。


### 2026-11-24 · Phase 0 + Phase 1 首片

- **Phase 0 完成**：`scripts/face-matrix.ts`（20 个构造 × 4 面：check / dts / dts 自编译 / 消费方编译）+ `docs/reports/face-matrix-baseline.json` 棘轮 + `face:matrix` 入口。基线 0 个已知失败 / 23 个通过（2026-11-24 晚：declared-supertype 决议 + 类面 / namespace / enum / 解构默认值收口后矩阵全绿）；新增失败即红。
- **Phase 1.1 完成**：`strip-types.ts` 为非枚举旁路增补 `nudoTypeNode` / `nudoReturnTypeNode` / `nudoTypeArgumentNodes`；`strip-types.test.ts` 钉住节点存在且 `Object.keys` / `JSON.stringify` 不可见。
- **Phase 1.3a 完成（文本生产者）**：`ts-type-shape.ts` 新增 `ObjectMember` 判别联合与 `objectMemberOfText` / `objectAbsOfMembers`，索引 / 调用 / 构造 / 访问器 / 方法 / 属性 / 计算 symbol / `readonly` 索引全部单点分类；删除 `methodMemberAbs`。
- **Phase 1.2 完成**：`FormalParam.tsTypeNode` / `FunctionAnalysis.declaredReturnTypeNode` 透传；`strip-types.test.ts` 钉住 `FormalParam.tsTypeNode`。
- **Phase 1.3b 完成（节点生产者，迁移期）**：`absTypeForTsTypeNode` 覆盖 `TSTypeLiteral` / `TSInterfaceDeclaration` / union·intersection / array / 固定 tuple / function / constructor / keyword；可选·标签·rest 元组回落文本（避免第二份逐臂展开口径）。`annotationAbsForText` 节点优先、文本 fallback；`generalize.ts` 的入口 / 构造参数 / 类入口三处已接线。
- **残余**：`tsDeclaredReturn` / `tsParamAnnotation` 仍用文本 + 局部 `namedTypes`；节点路要在分析期带 `namedTypes` / `source` 证据后才能切（归入 P2 的 `Evidence`）。
- **facet 搬运修复**：`$copy` 的 tuple / arr / fn / brand / eff / sum 分支补 `cloneAbsFacets`（此前只有 obj 分支搬运，`facets.callable` 在调用边界快照丢失）。
- **P1.3 扩展（提前）**：`builtinGenericAbs` 增 `Partial` / `Required` / `Readonly` / `Pick` / `Omit`；`valueTypeTextsForSource` 增对象字面量 dotted 值表（`typeof cfg.port`）；`namedTypeNodesForSource` 提供 interface / type alias 结构节点，`TSTypeReference` 直接消费；节点面补 `Iterable` / `Iterator` / `AsyncIterable` 映射（文本面仍由 `builtinGenericAbs` 负责，避免 dts 回归）。
- **P2.4 首片（提前）**：字面量闸门收敛为 `literalTypeTextOfInit`（default / namespace const 与具名 const 同一闸门）；`dts-type.ts` 的 bigint lit term 渲染为 `10n`。
- **未完成 / 下一步**：1.3b 的 namedTypeNodes / import type / AsyncIterable / void / template 分支；1.4 具名类型节点表；1.5 删除文本切分；1.6 穷尽性门。P2 的 `resolvePublicType` 接线、P3/P4 未动。

## 4. 验证配方

```bash
pnpm run build
pnpm run lint
pnpm run lint:tests
pnpm run lint:hygiene
pnpm run face:matrix            # Phase 0；基线棘轮
pnpm exec vitest run --changed  # 按用户约束，必须带 --changed
```

全量验证（确需时显式限制并发）：

```bash
pnpm exec vitest run --maxWorkers=4
```

## 5. 风险与回滚

- **P1 风险**：注解节点是 Babel AST 引用，不能跨 parse 生命周期保存；只随当前
  文件 AST 使用，不进入缓存键 / 不序列化。
- **P2 风险**：`declared > observed` 翻转会改变部分产物；先以 `face-matrix`
  记录差异，逐面切换，保留回滚开关一个版本。
- **P3 风险**：索引迁移期双读会短暂增加内存与分支；每面一个 PR，旧路径为准。
- **回滚**：每阶段独立可 revert；P1 的节点旁路是纯加法，P2/P3 保留一个版本的
  fallback 开关，Phase 4 删除。
