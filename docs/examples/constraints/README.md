# Refinements — 精化契约

精化 **只来自声明**，不从 if 猜测。  
约束不是挡板：Pred 进入 Abs，参与代数（`x>0` ⇒ `x+1>1`）。

**唯一形态**：

```js
@nudo:refine <param> <constraint>     // 参数精化
@nudo:refine return <constraint>      // 返回精化
```

- `<constraint>` 必须是 `.nudo.js` 导出的模板  
- **不在** refine 里写 `x > 0`（绑死参数名）  
- 模板参数无关：`number().gt(0)`、`shape({ id: number().gt(0) })`  
- **不需要 interface / type**  
- **不用 JSDoc `@param`/`@return`**（类型注解）  
- **不叫 requires**（只像校验挡板）

| 文件 | 场景 |
|------|------|
| [`delay.nudo.js`](./delay.nudo.js) | 标量模板 `number().gt(0)` |
| [`shapes.nudo.js`](./shapes.nudo.js) | object 形状 `shape({ id, name })` |
| [`set-delay.js`](./set-delay.js) | 标量：`@nudo:refine ms delay` |
| [`register.js`](./register.js) | 形状：`@nudo:refine u user` |
| [`return-contract.js`](./return-contract.js) | 返回：`@nudo:refine return positive` |
| [`add-pred.js`](./add-pred.js) | Pred 流入代数 |
| [`declared-vs-if.js`](./declared-vs-if.js) | if ≠ 精化 |

## 标量

```js
// delay.nudo.js
export const delay = number().gt(0);

// set-delay.js
/// @nudo:import { delay } from "./delay.nudo.js"

/**
 * @nudo:refine ms delay
 */
function setDelay(ms) { ... }

setDelay(0);   // error: 0 ⊭ delay
setDelay(100); // ok
```

## Object 形状（无需 interface）

```js
// shapes.nudo.js
export const user = shape({
  id: number().gt(0),
  name: string(),
});

/**
 * @nudo:refine u user
 */
function register(u) {
  return `${u.id}:${u.name}`;
}

register({ id: 1, name: "ada" });  // ok
register({ id: -1, name: "ada" }); // error: u.id ⊭ > 0
register({ id: 1 });               // error: missing name
register({ id: 1, name: 2 });      // error: name ⊭ string
```

可选字段：`string().optional()`

## 返回精化

```js
/**
 * @nudo:refine x positive
 * @nudo:refine return positive
 */
function inc(x) {
  return x + 1;  // (x+1)>1 满足后置
}

/**
 * @nudo:refine return positive
 */
function bad() {
  return 0;      // error: 返回值 ⊭ positive
}
```

## 与 @nudo:case

| | refine | case |
|---|---|---|
| 角色 | 精化（定义域 D，参与运算） | 见证（⊆ D） |
| 违例 | 调用/返回 ⊭ refine | case ⊄ D → `nudo:case-inconsistency` |

```bash
pnpm run check docs/examples/constraints/set-delay.js      # L1 门禁
pnpm run test:cli docs/examples/constraints/add-pred.js    # case 报告（Pred 流入代数）
pnpm run verify:examples   # 验证本目录全部命令与期望退出码（见 [../README.md](../README.md) 命令矩阵）
```

入口无约束参数在 check/test 上显示为 **`any`**；`unknown` 表示推导失败。
入口 may-throw 属 L2（`nudo:entry-may-throw`），与本目录 L1 refine 互补。
