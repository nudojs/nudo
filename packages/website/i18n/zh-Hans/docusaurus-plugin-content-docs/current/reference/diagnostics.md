---
slug: /reference/diagnostics
description: 稳定的 Nudo 诊断码 —— 含义、最小复现、Abs 视图与修复。
---

# 诊断术语表

`nudo check` / 分析打印的稳定诊断码。产品原生消息使用 **`actual ⊭ expected`**（Nudo Abs 蕴含），不是 TypeScript 诊断的伪装。

机器可读面：`nudo check --json`。Agent：见 [Agents](/docs/reference/agents) 与已发布的 [agents.md](https://nudojs.github.io/nudo/agents.md)。

## 契约门禁（L1）

### `nudo:constraint-violated`

| | |
|--|--|
| **含义** | 调用/返回不满足显式契约 Pred |
| **层** | L1 error |
| **来源** | `*.nudo.js` / `@nudo:refine` |

```javascript
// needsPositive with @nudo:refine x positive
needsPositive(-1);
// actual:   -1  #exact
// expected: x > 0
```

**修复：** 收紧调用点，或在义务本身写错时修正契约。**故意越界输入**不是产品默认 —— 改契约，不要静默「忽略」L1。

### `nudo:assign-mismatch`

赋值 / 绑定 shape 不满足先前契约 shape（`leqAbs` 结构失败）。修值或修声明槽。

### `nudo:arg-structure`

HOF 实参不是可调用 `fn`，或元数与**显式** relation 契约不匹配。（body 提升建议是 warning，不是此错误。）

### `nudo:case-inconsistency`

已声明的 `@nudo:case` 见证与显式 refine 冲突。调试见证与契约不一致 —— 修见证或修契约。

### `nudo:interface-param-mismatch`

手写契约参数名不在形式参数面上。（诊断 ID 保留历史 `interface` 词元；产品术语是 **contract**。）

### `nudo:interface-conflict`

手写契约合取不可满足。简化侧车 / refine。

### `nudo:interface-load` / `nudo:interface-name-clash`

侧车加载失败，或 emit 会覆盖手写绑定。手写始终优先。

### `nudo:interface-cycle`

侧车 `@nudo:import` 链成环。**Error。** 修复：打破侧车 import 环。

### `nudo:interface-domain-exceeds`

经 `nudo check --from` 注入的跨文件调用点证据不在手写契约域内（`⊄`）。**Error。** 修复：放宽契约，或修正使用处。

### `nudo:interface-drift`

固化的 `@generated` 侧车段 ≠ 今日重算的调用点域或返回。**Warning** —— 不挡 exit。

## 运行时边界（L2）

### `nudo:entry-may-throw`

| | |
|--|--|
| **含义** | 入口/导出函数有未消化 may-throw |
| **层** | L2 error（默认） |
| **展示** | 签名行上的 `throws TypeError` |

```javascript
export function getName(user) {
  return user.name; // 任意接收者 → 可能抛
}
```

**修复选项：** 把参数 refine 成 shape；对路径 `try/catch`；或（迁移期）`--ignore-throws TypeError` / `package.json#nudo.check.ignoreThrows` / `--entry-throws warning`。**L2 不门禁内部 helper。**

## 引擎债 / 观察

### `nudo:unknown-inference`

签名上的真 `unknown` —— 推导失败。**不是**无约束入口 `any`。修复：建模 env、补 mock，或 refine。

### `nudo:unknown-recv`

`unknown` 接收者上的成员访问。不能替代 L2 throws 建模。

### `nudo:builtin-unknown`

API 未被 env/推理覆盖（如未建模全局）。优先 `@nudo:env` / mock。

### `nudo:opaque-result`

求值返回 opaque / 无信息 Abs。

### `nudo:eval-error`

分析期间 body 求值抛出。

### `nudo:recursion-truncated`

递归预算用尽；结果拓宽。

### `nudo:no-signature`

函数无法泛化（CJS/匿名形态仍经入口 fallback 得到 L2）。

### `nudo:no-method`

无法解析的成员访问：``Method 'x' does not exist on type 'T'`` / ``Property 'x' does not exist on type 'T'``。原始类型接收者（`number` / `boolean` / `bigint` / `symbol`）为 **error**，其余为 warning。与 `nudo:unknown-recv`（`unknown` 接收者）不同。

### `nudo:mock-invalid`

`@nudo:mock` 表达式无法解析为已知形态（stub/spy/mock 形式、箭头函数或类型表达式）。**Warning** —— 检查受支持形态。

### `nudo:interface-underivable`

**派生**契约行（root 驱动推导 / `nudo contract --draft`）无法从源码证据推导（opaque / 截断 / 无证据）。**Info** —— 该行被跳过；手写契约从不触发此码。

### `nudo-unreachable`

`return`/`throw` 之后的代码 —— info 级。注意连字符：这是唯一不带冒号的诊断 id。

### `nudo:may-throw`

Case 路径可能抛（test / 线索）。L2 升格的是**入口** throws。

## 模块图

Abs 模块求值（`evalAbsModuleGraph`）遇到装载问题时上报。`cycle` / `depth` 为 warning；`missing` 为 error。

### `nudo:module-cycle`

```text
Circular module load: a.js -> b.js -> a.js
(bindings inside the cycle resolve to their partially evaluated types)
```

**修复：** 打破环（抽取共享逻辑），或接受部分类型。

### `nudo:module-depth`

```text
Module load chain too deep (depth N > M max): a.js -> b.js -> …
(loading truncated, deeper modules typed as unknown)
```

**修复：** 链超过装载深度预算——扁平化 re-export 跳数或调高预算。

### `nudo:module-missing`

```text
Module file not found for 'spec' (from file); tried: path
```

**Error。** 被分析文件 import 了装载器无法解析的模块。**修复：** 修正 spec，或 mock 该模块（`@nudo:mock-module` / `@nudo:mock`）。

### `nudo:missing-slot`

```text
Field 'name' is missing on the evaluated object shape
```

**Warning，默认 off。** C0.5：求值实际命中了闭对象 shape 的缺字段（用 `package.json#nudo.analysis.evalMissingSlot: "warning"` 打开）。它是**观察，不是义务**——不会凭空产生 check 错误；手写契约仍经 `nudo:constraint-violated` 门禁。

## 读懂 `actual ⊭ expected`

```text
actual:   0  #exact     // 调用点观测到的 Abs
expected: price > 0     // 来自契约的 Pred
```

Abs 上的 conf 标记：`#exact` / `#path` / `#widened` / `#mock` / `#partial` / `#opaque` —— 见 [Abs](/docs/concepts/type-values)。

## 影响诊断的配置

```json
{
  "nudo": {
    "analysis": { "mode": "exports", "evalMissingSlot": "off" },
    "check": {
      "ignoreThrows": ["TypeError"],
      "entryThrows": "error"
    },
    "contract": { "autoBind": true }
  }
}
```

`ignoreThrows` / `entryThrows` 只影响 **L2** —— 它们绝不吞掉 L1 契约违例。

## 下一步

- [nudo check](/docs/guides/check)
- [契约](/docs/guides/contract)
- [边界](/docs/concepts/limits)
- [CLI 参考](/docs/api/cli-reference)
