# Nudo 类型系统架构（单轨）

> **唯一真理源**：`Abs = shape × term × pred × conf`（类型即计算）。
> 位置：`@nudojs/core/src/algebra`。
>
> **TypeValue** 是评估 IR / 外延投影——环境绑定、dts/LSP/序列化消费的格式，
> **不是**平行类型系统。Abs ⇄ TypeValue 经 `bridge.ts` 有损投影。
>
> 无 `NUDO_KERNEL` 开关、无 `packages/kernel`、无双矩阵。

---

## 分层

```
parser ──▶ core
            ├── algebra/     ← 类型本体（Abs / Term / Pred / Φ / check）
            ├── type-value   ← 评估 IR
            ├── ops          ← 代数未覆盖的语言表面（/ % === typeof …）
            └── bridge       ← Abs ⇄ TypeValue
                 │
                 ▼
            service/evaluator    ← AST 抽象解释；算术/比较/spread 先走代数
                 │
                 ▼
            service / lsp / vscode / dts
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
| 混合 `+` / 无法判定的比较 | 残差 `Ops`（IR 兜底，不传播约束） |

路由：`abs-route.ts` + `eval-binary.ts`。

## 约束如何传播

1. 调用点参数 `tagParamArg` 挂 `var(name)` 项身份（WeakMap 旁路，不污染 TypeValue）。
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
| partial / opaque | 未知或不可投影 |

`absToTypeValue` 丢 term/pred 时禁止假装 exact。

## 模块边界

- **algebra 无 fs/path**：模块解析、harvest、scan 在 service/cli/scripts。
- **scripts 不进 `packages/*/src`**。
- **core 不依赖 parser 包**（`parseSource` 用 `@babel/parser` + `stripTypes`）。

## 回滚与历史

历史上的 kernel 独立包与 `NUDO_KERNEL` 域开关已删除。
迁移记录见 git：`feat/typevalue-algebra` → `feat/mimo`。
