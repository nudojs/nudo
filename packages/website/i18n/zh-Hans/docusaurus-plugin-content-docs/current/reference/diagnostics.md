---
slug: /reference/diagnostics
description: 稳定的 Nudo 诊断码 —— 含义、最小复现、Abs 视图与修复。
---

# 诊断术语表

`nudo check` / 分析打印的稳定诊断码。产品原生消息使用 **`actual ⊭ expected`**（Nudo Abs 蕴含），不是 TypeScript 诊断的伪装。

机器可读面：`nudo check --json`。Agent：见 [Agents](/docs/reference/agents) 与已发布的 [agents.md](https://nudojs.github.io/nudo/agents.md)。

## 契约门禁（L1）

### `nudo:constraint-violated` {#nudo-constraint-violated}

| | |
|--|--|
| **含义** | 调用/返回不满足显式契约 Pred |
| **层** | L1 error |
| **来源** | `*.nudo.js` / `@nudo:contract` |

```javascript
// needsPositive with @nudo:contract x positive
needsPositive(-1);
// actual:   -1  #exact
// expected: x > 0
```

**修复：** 收紧调用点，或在义务本身写错时修正契约。**故意越界输入**不是产品默认 —— 改契约，不要静默「忽略」L1。

### `nudo:assign-mismatch` {#nudo-assign-mismatch}

赋值 / 绑定 shape 不满足先前契约 shape（`leqAbs` 结构失败）。修值或修声明槽。

### `nudo:arg-structure` {#nudo-arg-structure}

HOF 实参不是可调用 `fn`，或元数与**显式** relation 契约不匹配。（body 提升建议是 warning，不是此错误。）

### 调用点验证精度

以下码来自调用点 / 契约验证（`checkCall` / `checkArg`）：调用被对照泛化参数面检查时，检查器不只报违例，也会报**验证降级**——诚实的「无法证明」，而不是静默放行。

### `nudo:constraint-unproven` {#nudo-constraint-unproven}

```text
cannot prove the argument satisfies x > 0
```

实参 pred 无法可证蕴含契约 pred，且不是引擎可判定的字面量。**Warning** —— 验证悬而未决，不是失败。修复：补调用点 / `@nudo:case`，或用 `--assume` 声明前置条件。

### `nudo:arg-opaque` {#nudo-arg-opaque}

```text
argument type is unknown; cannot verify constraint x > 0
```

实参 Abs 是 `unknown`（无 term）——约束根本无法检查。**Warning** —— 补调用点或 `@nudo:case`，或用 `--assume` 提供前置条件。若 `unknown` 是引擎债，先建模该值的来源（env / mock）。

### `nudo:arg-count` {#nudo-arg-count}

```text
scale expects 2 argument(s), got 1
```

调用元数与泛化参数面不匹配。**Error。**

### `nudo:fn-not-found` {#nudo-fn-not-found}

```text
function nope not found
```

调用引用了分析器在作用域内无法解析的函数。**Error** —— 检查函数名 / 导出，或用 env / `@nudo:mock-module` 补上缺失模块。

### `nudo:partial-result` {#nudo-partial-result}

```text
f(...) result confidence partial
```

结果 Abs 携带 `#partial` 置信。**Info** —— 仅观察。建议：补调用点或约束以提升精度。

### `nudo:case-inconsistency` {#nudo-case-inconsistency}

已声明的 `@nudo:case` 见证与显式 refine 冲突。调试见证与契约不一致 —— 修见证或修契约。

### `nudo:interface-param-mismatch` {#nudo-interface-param-mismatch}

手写契约参数名不在形式参数面上。（诊断 ID 保留历史 `interface` 词元；产品术语是 **contract**。）

### `nudo:interface-conflict` {#nudo-interface-conflict}

手写契约合取不可满足。简化侧车 / refine。

### `nudo:interface-load` {#nudo-interface-load}

侧车文件加载失败（解析 / import / 解析路径错误）。**Error。** 修侧车；若契约已废弃则删除绑定。

### `nudo:interface-name-clash` {#nudo-interface-name-clash}

侧车导出名与源码导出冲突，或 emit 会覆盖手写绑定。手写始终优先。

### `nudo:interface-cycle` {#nudo-interface-cycle}

侧车 `@nudo:import` 链成环。**Error。** 修复：打破侧车 import 环。

### `nudo:interface-domain-exceeds` {#nudo-interface-domain-exceeds}

经 `nudo check --from` 注入的跨文件调用点证据不在手写契约域内（`⊄`）。**Error。** 修复：放宽契约，或修正使用处。

### `nudo:interface-drift` {#nudo-interface-drift}

固化的 `@generated` 侧车段 ≠ 今日重算的调用点域或返回。**Warning** —— 不挡 exit。

### `nudo:interface-entry-only` {#nudo-interface-entry-only}

导出函数**无契约根**（无手写/生成侧车或 `@nudo:contract`）且**无调用点域**（仅合成 `entry@`、参数为 `any`）。**Info** —— 覆盖/契约缺口，不是门禁失败。修复：补契约（`*.nudo.js` / `@nudo:contract`），或从使用现场触达该导出（`nudo check --from`）。

### `nudo:dual-entry` {#nudo-dual-entry}

```text
dual-entry package "lib": browser (./browser.js) and node (./node.js) call-site
records do not cross files — analysis observes only the browser entry variant
```

该包发布 **browser/node 双入口**（package.json `exports` 条件或 `browser` 字段指向与 `main`/`node` 不同的文件），且本次分析跑在其中一个变体上。调用点记录按文件归因：另一入口上的证据**不会**注入到这里。**Info** —— 观察信号，不是门禁失败。单入口包、以及不是入口目标的共享 helper 上**绝不**触发。

**修复：** 分析你实际发布的入口，另一变体 mock 或跳过；不要期望 `--from` 记录跨两个面合并。这仍是天花板 —— 见[边界与非目标](/docs/concepts/limits)。

### `nudo:interface-emit-denied` {#nudo-interface-emit-denied}

```text
emit target 'path/lib.nudo.js' is outside package.json#nudo.contract.emit allowlist
```

`contract --emit` 拒绝写配置允许列表之外的侧车。**Warning** —— 该次写入被跳过。修复：移动目标路径，或扩展 `package.json#nudo.contract.emit`。

### `nudo:interface-multi-declarator` {#nudo-interface-multi-declarator}

```text
generated section 'a, b' is a hand-merged multi-declarator form; kept verbatim
```

`@generated` 段被手工合并成一个多声明导出。**Warning** —— 原样保留（手写优先）；拆成每节一个导出即可重新 emit。

### `nudo:interface-not-projectable` {#nudo-interface-not-projectable}

```text
assembled sidecar failed round-trip (path); refusing to write
```

组装的侧车源码无法重新解析回推导出的接口。**Error** —— 不写任何文件。作为引擎债上报（round-trip 必须成功），调整源码直到 `contract --emit --dry-run` 干净。

## 运行时边界（L2）

### `nudo:entry-may-throw` {#nudo-entry-may-throw}

| | |
|--|--|
| **含义** | 入口/导出函数有未消化 may-throw |
| **层** | L2 error（默认） |
| **展示** | 签名行上的 `throws TypeError` |

```javascript verify
export function getName(user) {
  return user.name; // 任意接收者 → 可能抛
}
```

**修复选项：** 把参数 refine 成 shape；对路径 `try/catch`；或（迁移期）`--ignore-throws TypeError` / `package.json#nudo.check.ignoreThrows` / `--entry-throws warning`。**L2 不门禁内部 helper。**

## 引擎债 / 观察

### `nudo:unknown-inference` {#nudo-unknown-inference}

签名上的真 `unknown` —— 推导失败。**不是**无约束入口 `any`。修复：建模 env、补 mock，或 refine。

### `nudo:unknown-recv` {#nudo-unknown-recv}

`unknown` 接收者上的成员访问。不能替代 L2 throws 建模。

### `nudo:builtin-unknown` {#nudo-builtin-unknown}

API 未被 env/推理覆盖（如未建模全局）。优先 `@nudo:env` / mock。

### `nudo:opaque-result` {#nudo-opaque-result}

求值返回 opaque / 无信息 Abs。

### `nudo:eval-error` {#nudo-eval-error}

分析期间 body 求值抛出。

### `nudo:recursion-truncated` {#nudo-recursion-truncated}

递归预算用尽；结果拓宽。

### `nudo:fork-truncated` {#nudo-fork-truncated}

分支展开预算（`$fork` 总次数）用尽；受影响结果拓宽。**warning**。可用 `NUDO_MAX_FORKS` 或 `package.json#nudo.analysis.maxForks` 调高（默认 5000）。

### `nudo:no-signature` {#nudo-no-signature}

函数无法泛化（CJS/匿名形态仍经入口 fallback 得到 L2）。

### `nudo:no-method` {#nudo-no-method}

无法解析的成员访问：``Method 'x' does not exist on type 'T'`` / ``Property 'x' does not exist on type 'T'``。原始类型接收者（`number` / `boolean` / `bigint` / `symbol`）为 **error**，其余为 warning。与 `nudo:unknown-recv`（`unknown` 接收者）不同。

### `nudo:mock-invalid` {#nudo-mock-invalid}

`@nudo:mock` 表达式无法解析为已知形态（stub/spy/mock 形式、箭头函数或类型表达式）。**Warning** —— 检查受支持形态。

### `nudo:env-harvest-conflict` {#nudo-env-harvest-conflict}

```text
handwritten @nudo:env wins over harvest on module "fs"; harvest only fills missing slots
```

手写 `@nudo:env` 模块与 `@types` harvest 同时提供了同一模块键或导出。**Warning** —— 手写 env 优先（`mergeHarvestUnderEnv`）；harvest 只补缺失槽。消除方式：从手写 env 删除重叠导出，或接受该优先级。

### `nudo:interface-underivable` {#nudo-interface-underivable}

**派生**契约行（root 驱动推导 / `nudo contract --draft`）无法从源码证据推导（opaque / 截断 / 无证据）。**Info** —— 该行被跳过；手写契约从不触发此码。

### `nudo-unreachable` {#nudo-unreachable}

`return`/`throw` 之后的代码 —— info 级。注意连字符：这是唯一不带冒号的诊断 id。

### `nudo:may-throw` {#nudo-may-throw}

Case 路径可能抛（test / 线索）。L2 升格的是**入口** throws。

## 模块图

Abs 模块求值（`evalAbsModuleGraph`）遇到装载问题时上报。`cycle` / `depth` 为 warning；`missing` 为 error。

### `nudo:module-cycle` {#nudo-module-cycle}

```text
Circular module load: a.js -> b.js -> a.js
(bindings inside the cycle resolve to their partially evaluated types)
```

**修复：** 打破环（抽取共享逻辑），或接受部分类型。

### `nudo:module-depth` {#nudo-module-depth}

```text
Module load chain too deep (depth N > M max): a.js -> b.js -> …
(loading truncated, deeper modules typed as unknown)
```

**修复：** 链超过装载深度预算——扁平化 re-export 跳数或调高预算。

### `nudo:module-missing` {#nudo-module-missing}

```text
Module file not found for 'spec' (from file); tried: path
```

**Error。** 被分析文件 import 了装载器无法解析的模块。**修复：** 修正 spec，或 mock 该模块（`@nudo:mock-module` / `@nudo:mock`）。

### `nudo:missing-slot` {#nudo-missing-slot}

```text
Field 'name' is missing on the evaluated object shape
```

**Warning，默认 off。** C0.5：求值实际命中了闭对象 shape 的缺字段（用 `package.json#nudo.analysis.evalMissingSlot: "warning"` 打开）。它是**观察，不是义务**——不会凭空产生 check 错误；手写契约仍经 `nudo:constraint-violated` 门禁。

## 测试断言（`nudo test`）

### `nudo:case-expected` {#nudo-case-expected}

```text
debug "bad": expected 5, got 4. The inferred return type does not match the
expected type declared in the @nudo:case witness
```

声明的 `@nudo:case "name" (…) => expected` 见证的期望类型与推断结果不符。**在 test 运行中为 error** —— 声明断言失败会让 `nudo test` 以 `1` 退出；合成 `call@` / `entry@` case 永不导致运行失败。

报告中的失败面：

```text
=== double ===
  debug "bad"  (2) => 4

assertions
  ✗ 0 passed · 1 failed · 0 unchecked
  [FAIL] double  case "bad"
         expected: 5
         actual:   4
```

**修复：** 改正见证期望或函数体。

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
