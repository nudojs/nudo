# 根因根除计划（2026-11-24）

> **状态**：现行（未闭环项见 §2）。**来源**：`tmp/bug-report.md` 94 条（2026-11-24 复核）。
> **纪律**：不按 bug 编号施工；bug ID 只作为覆盖断言与验收清单。每个阶段只收敛
> 一个语义决策，禁止用「补分支 + 回归钉」代替结构修复。
> **生命周期**：已交付阶段不在此保留 evidence（证据在测试 / changeset / git），
> 只留未闭环项与门禁口径。

## 0. 目标与非目标

**目标**：把「语法 → Abs → 产品面」的三条边界从 N×M 手工同步收敛为单点实现，
使新增 TS 构造只在一个地方落地；未支持的构造以 `degraded` 显式上屏，不再静默
变成 `any` / `unknown`。

**非目标**：

- 不改 Abs 形状 / `leqAbs` / `formatShape` / 单轨 IR（ADR 0001 §3）。
- 不重写求值器 / transpile。
- 不为单条 bug 加特判、白名单或第二套渲染器。
- 不在本计划内修复 H/I/K/M/Q 类求值模型与命令面残余；它们按各自台账排期。

## 1. 阶段与状态

| 阶段 | 收口口径 | 状态 |
|---|---|---|
| Phase 0 · 构造 × 面矩阵 | `scripts/face-matrix.ts`（42 个构造 × 4 面：`check` 签名 / dts 文本 / 产物自编译 / 消费方编译；`expectDts` 取自 tsc `--declaration` oracle）+ `docs/reports/face-matrix-baseline.json` 迁移棘轮 + `pnpm run face:matrix` 进 CI（`ts_changed` 时）。新增失败即红；基线缩小需显式 `--update`。 | 已交付 |
| Phase 1 · 注解 AST（语法 → Abs 单点） | 节点折叠是源码 AST 注解的**唯一生产路径**（入口域 / 构造参数 / 类入口 / 类字段 / 声明返回 Abs）；`TSType` 种类穷尽（`never` 编译门，未支持种类返回 `undefined`，不回落文本语法）；跨文件类型带结构节点；一个同文件注解环境工厂 + 一个导入类型扫描器；文本 / 节点 parity 棘轮（`ts-type-mapping-parity.test.ts`）。 | 已交付主体；**残余 §2.1** |
| Phase 2 · 公共类型决议 | 返回位：有声明注解即发布声明（与 tsc `--declaration` 同答案）；不可解析的类型名落 `nudo:dropped-type-annotation` 台账并回落观测；声明与观测冲突只落信息性 `nudo:return-annotation-mismatch`，不改发布类型；dts 与 guard / standard / zod 共用同一判据；删除 `declarationMorePrecise` 白名单与 `declaredWins`。 | 已交付；**残余 §2.2** |
| Phase 3 · 单一模块/成员面 | `SemanticIndex` 带 `entries`（名字）与 `entryInfos`（节点 / 语句 / 形态）；`check` 入口表只读索引（旧普查并集与 `entry-face-shadow` 已删）；service 分析面的函数普查读同一索引（常驻 parity 门）；LSP 导入绑定 / 导出跳转；dts 导出槽 / 类成员 / namespace 成员均只读索引事实。 | 已交付；**残余 §2.3** |
| Phase 4 · 门禁（防复发） | `face:matrix` + `lint:hygiene` 孪生规则（第二份类型解析 / 说明符扫描 / 键在场谓词 / 类型渲染 / 注解环境拼装 / 导入类型扫描即红）+ fs-input 清单；迁移期开关、影子双读与缓存键的 `face=` 维度全部删除。 | 已交付 |

## 2. 未闭环

### 2.1 类型注解映射

- 文本解析器（`mapTsType`）仍在：它是**文本型输入**的入口（外部契约文本 / dts
  注解原文 / 导入类型表 / 值类型表）。源码 AST 注解已不走它。两套实现的差异由
  parity 棘轮按构造钉住，基线只允许「节点更精确 / 明确不支持」两类条目，新增
  「节点更宽」即测试红。
- 文本面已知缺陷（生产不再经过，未修）：单引号字面量联合（`'a' | 'b'`）产出垃圾
  字面量；mapped type 摊成 `{ }`；数字键 / 计算键成员丢失；JSDoc / 行注释分隔的
  成员丢失。
- 分类口径的已知局限：`leqAbs` 不按函数参数逆变、不看索引签名键域；`formatAbs`
  不显示 symbol 键槽（函数类型域的 parity 分类因此只能逐条看，不能只看 `leqAbs`）。
- `this` 类型节点面给 `any`（Abs 无多态 this 维度，dts 原文由注解文本保留）。
- 带实参的泛型别名（`Box<number>` 作 `this` / 别名引用）仍不映射。

### 2.2 声明返回

- 裸泛型引用（`make(): Box`，`Box` 有必填类型形参）静默回落观测：名字可解析但
  原文立不住（TS2314），不落 dropped 台账。
- 跨模块泛型的形参实参不可知时，裸引用仍原样发布。
- `isTypeRefResolvable` 不认命名空间根（`N.T`）。
- 注解自带类型形参（`<T>(x: T) => T`）与映射类型会被误落 dropped 台账。
- 类成员的两种台账命名不一致：dropped 用裸成员名，mismatch 用普查名（`C.m`）。
- `dts-brand-scope.ts` 的 `typeParamHasDefault` 与 `clauseHasRequiredTypeParam`
  判的是同一件事，可一行合并。

### 2.3 入口普查 / 索引

- core `listTopFunctions` / `listClassEntryNames` 仍是 `./internal` 公共面
  （service `contract-derivation-derive.ts` 与多个测试在用），与索引 `entries`
  的口径由 service 侧常驻 parity 门钉住。
- LSP 本地符号面（`buildSymbolTable` / `documentSymbols`）仍独立扫描，未迁索引。
- check 面 D1 分类读索引入口形态标签（`SUPPLEMENTARY_ENTRY_FORMS`）：新增入口
  形态必须同时补标签，否则该形态不会按导出槽执法。
- 索引 `entries` 与 service 普查的差异（若有）以 parity 门的失败信息为准；不允许
  以「补齐旧普查」的方式回退。

## 3. 验证配方

```bash
pnpm run build                      # 本地跑 watch / dist 面 e2e 前必须
pnpm run lint && pnpm run lint:tests
pnpm run lint:hygiene
pnpm run face:matrix               # 构造 × 面棘轮
pnpm run verify:examples           # 文档示例输出钉
pnpm exec vitest run --changed     # 按用户约束，必须带 --changed
```

全量验证（确需时显式限制并发）：

```bash
pnpm exec vitest run --maxWorkers=4
```

## 4. 风险与回滚

- **注解节点是 Babel AST 引用**：只随当前文件 AST 使用，不进入缓存键、不序列化；
  深拷贝（如私有名作用域化）必须显式搬运旁路键（单源常量 `NUDO_SIDECAR_KEYS`）。
- **注解环境 memo 的失效覆盖磁盘文件**（stat 签名：`mtimeMs:size`）；LSP 未保存
  缓冲区里的依赖改动不在范围（既有限制）。
- **「声明优先」只改发布类型**：与观测冲突落信息性台账，不改诊断集合；dts 与
  校验器（guard / standard / zod）同一判据。
- **回滚**：本批改动集中在 core `ts-type-shape` / `semantic-index` / check 与
  service emit 决议；同一 changeset 内可整体 revert。
