# Nudo 类型系统架构（单轨）

> **唯一真理源**：`Abs = shape × term × pred × conf`（类型即计算）。
> 位置：`@nudojs/core/src/algebra`。
>
> 产品命令面 / any·unknown / check 门禁语义见
> [`cli-semantics.md`](./cli-semantics.md)。
>
> **无第二套 IR**：生产求值 Abs 原生、单引擎 **B-path**（transpile+exec）；
> B-incapable / 求值失败 **fail-closed**（unknown/空导出），无解释兜底。
> dts / schema / guard / LSP hover / 序列化都是 **Abs 的单向外延投影**
> （`formatShape` / `absToTSType` / `absToSchemaSource` / 守卫生成器）。
> 约束构建器（`number()` / `shape({...})` 等，`*.nudo.js` 模板）进入 Abs 作为 Pred。
>
> 无 `NUDO_KERNEL` 开关、无 `packages/kernel`、无双矩阵。

> **Executive summary (EN).** This document is the single source of truth for the Abs architecture: `Abs = shape × term × pred × conf` (types as computation). There is one IR and one evaluation engine (B-path: transpile + `new Function`); failures fail closed (unknown / empty exports) — no interpreter fallback. dts / schema / guard / LSP hover / serialization are **one-way lossy projections** of Abs and are never read back. Constraint builders (`number()`, `shape({…})`, …) enter Abs as Preds and participate in algebra. Trust boundary: analysis **executes** target code in-process — treat `nudo check` / `nudo test` like running the code; sidecar `*.nudo.js` and mocks are ordinary JS inside that boundary. Cross-product invariants are listed near the end of this document; product CLI face lives in `cli-semantics.md`.

---

## 分层

```
parser ──▶ core
            ├── algebra/     ← 类型本体（Abs / Term / Pred / Φ / check / surface）
            ├── format       ← 外延投影（formatShape / formatAbs / absToTSType）
            └── refinements  ← *.nudo.js 约束构建器 → Pred
                 │
                 ▼
            service/evaluator    ← Abs 原生：B-path（transpile+exec）单引擎
                 │
                 ▼
            service / lsp / vscode / dts / schema
```

## 运算路径

| 运算 | 路径 |
|---|---|
| `+ - * / %` 数值/字符串 | 代数 `add/sub/mul/div/mod` |
| `< <= > >=` 数值/字符串字面量 | 代数 `cmp` |
| `=== !==`（含 nullish） | 代数 `strictEqAbs` / `cmp` |
| `typeof` / `!` / 一元 `-` | 代数 `surface.ts`（`tryAbsUnary`） |
| 对象 spread / join | 代数 `spread` / `joinAbs` |
| range narrow | Pred 编码进 Abs |
| union | 逐成员代数 |
| refined 方法/属性 | `dispatchMethod/Property`（宿主扩展） |
| 混合 `+` / 无法判定的比较 | 粗化回 shape 基类型（Abs 内部，不传播约束） |

路由：`algebra/surface.ts` + `service/evaluator/abs-route.ts`。

## 约束如何传播

1. 调用点参数 `tagParamArg` 挂 `var(name)` 项身份（WeakMap 旁路）。
2. `if (x > 5)` → `phiFromTest` 提取 Pred，`pushPhi` 进路径前提 Φ。
3. 分支内 `x+1` / `x>=3` 读 Φ 与自身 pred，单调性推出新约束。
4. narrow 产生的 range refined 保留 term，`toAbsWithTerms` 编码成 `ge/le` Pred。
5. `nudo check`：`checkSource` 做蕴含门禁（调用前置 vs clamp 不算违例）。

## 置信度

| conf | 含义 |
|---|---|
| exact | 字面量 / 可精确求值 |
| path | 依赖路径约束 |
| widened | 丢失结构后的保守外延 |
| mock | 来自 harvest/mock 声明而非观测求值 |
| partial / opaque | 未知或不可投影 |

外延投影丢 term/pred 时不得假装 exact。

## 模块边界

- **algebra 无 fs/path**：模块解析、harvest、scan 在 service/cli/scripts。
- **scripts 不进 `packages/*/src`**。
- **core 不依赖 parser 包**（`parseSource` 用 `@babel/parser` + `stripTypes`）。

## 执行模型与信任边界

> **本节是信任边界的唯一事实源。** 用户侧警告见 README「Security」与 website
> `concepts/semantics.md`「Trust boundary」；B-path 机械细节见
> [`evaluator-paths.md`](./evaluator-paths.md)。

生产分析是 **分析即执行**：B-path 把目标源码转译成 `$add` / `$fork` 等代数调用后，
用 **`new Function` 编译并运行**（`runTranspiled` / `callTranspiledExportFull`）。
被分析代码以抽象值（Abs）在分析器进程内**真实求值**——顶层副作用、
`import` / `require`、以及侧车 `*.nudo.js` 与 `@nudo:mock` / `@nudo:mock-module`
提供的普通 JS 都在分析期执行。

**信任边界**：`nudo check` / `nudo test`（以及 LSP / vite 插件的分析路径）
等价于「在本机执行目标代码」。

- **不要**对 untrusted 代码运行 nudo（陌生 npm 包、用户提交、未经审查的 PR）。
- CI 上只分析**可信仓库**。
- 侧车契约与 mock 也是普通 JS，同属信任边界之内——它们不是声明式数据。

这不是沙箱声明：Nudo **没有**隔离求值进程。预算（`MAX_CALL_DEPTH` /
`MAX_TOTAL_CALLS` / forks 截断）只防失控分析，**不构成安全边界**。

## 不变量（跨产品）

- 检查的是 Abs 上的 **Pred 蕴含**，不是 TS 式类型匹配。
- 投影单向：分析从不读回 dts/schema/guard。
- 入口无约束参数产品展示为 **`any`**；**`unknown` = 推导失败**（见 cli-semantics §2）。
- L2 入口 may-throw 是运行时效果门禁，不是 body AST 必填 slot（C0）。

## 历史

历史上的 kernel 独立包、`NUDO_KERNEL` 开关、TypeValue 求值 IR 均已删除。
迁移见 git：`feat/typevalue-algebra` → `feat/mimo`。
