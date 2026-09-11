# @nudo:requires × Pred × add — 约束如何与代数融合

## 1. 契约来源：声明，不是 if 猜测

```js
/**
 * @nudo:requires x > 0
 */
function scale(x) {
  return add(x, 1);
}
```

`if (x > 0) return x` **只是分支**，不当调用前置。  
前置只来自 **`@nudo:requires`**（后续可接 zod/valibot schema）。

## 2. requires 编译成 Pred

```
@nudo:requires x > 0
        │ compileRequiresExpr
        ▼
Pred { op: "gt", a: var(x), b: lit(0) }
```

支持片段：`x > 0` / `x >= 0` / `x < 10` / `x <= 10`，以及 `&&` 连接。

## 3. Pred 在 check 与 infer 中的两条路

| 路径 | 用法 |
|------|------|
| **check** | 调用点字面量 Abs ⊢ requires Pred？否则 `constraint-violated` |
| **infer / 代数** | 参数 Abs 附着该 Pred 后，`add`/`+` 单调传播 |

## 4. add 示例：Pred 如何流进代数

```js
const add = (a, b) => a + b;

/**
 * @nudo:requires x > 0
 */
function scale(x) {
  return add(x, 1);
}

/**
 * @nudo:requires x > 0
 */
function twice(x) {
  const c = add(x, 1);
  return add(c, 1);
}
```

### 求值轨迹（类型即计算）

```
Φ ⊢ x > 0                    # requires 进入路径前提 / 参数 Pred

add(1, 3)
  → lit(4)  #exact

scale(x)                     # x 带 pred x>0
  add(x, 1)
    term = x+1
    pred: (x+1) > 1          # 单调性：x>0 ∧ 1=1 ⇒ x+1>1
  → number = (x+1)  where (x+1)>1  #path

twice(x)
  c = add(x, 1)              # c ↦ x+1, c>1
  add(c, 1)                  # (x+1)+1, >2
  → number = ((x+1)+1)  where ((x+1)+1)>2  #path
```

### 调用点 check

```
scale(-1)    →  -1 ⊭ x>0   → constraint-violated
scale(100)   →  ok
add(1, 3)    →  ok（add 无 requires）
```

## 5. 与 @nudo:case 的关系

```
@nudo:requires x > 0          # 契约（定义域 D）
@nudo:case "ok" (100)         # 见证 ⊆ D
// @nudo:case "bad" (0)       # ⊄ D → 应报 inconsistency，不是另一种 case
```

- **check** 只吃 requires  
- **infer** 在 D 上采样 case  
- case 不能削弱 requires  

## 6. 和 zod / valibot（设计对齐）

```js
// interface.nudo.js（设计）
export const delay = /* z.number().positive() → */ { pred: "ms > 0" };

// demo.js
/// @nudo:import * as V from "./interface.nudo.js"

/**
 * @nudo:requires V.delay     # 后续：解析绑定到 Pred
 */
function setDelay(ms) { return ms; }
```

当前最小实现：`@nudo:requires` 内联 Pred 片段。  
下一跳：schema 绑定 + `@nudo:import`。

## 7. 跑示例

```bash
npx tsx packages/cli/src/index.ts check docs/examples/requires-pred/add.js
npx tsx packages/cli/src/index.ts infer docs/examples/requires-pred/add.js
```
