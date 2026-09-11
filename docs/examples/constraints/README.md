# Refinements — 精化契约与 Pred

精化 **只来自声明**，不从 if 猜测。约束不是挡板，是 Abs 的一部分，会流入代数。

**唯一契约形态**：

```js
@nudo:refine <param> <constraint>     // 参数精化（挂入口 Abs，参与运算）
@nudo:refine return <constraint>      // 返回精化（推断返回值 ⊭ 时红）
```

- `<constraint>` 必须是 `.nudo.js` 导出的模板（如 `delay`、`user`）  
- **不在** refine 里写 `x > 0`（那是绑死参数名的旧写法）  
- 模板本身参数无关：`number().gt(0)`、`shape({ id: number().gt(0) })`  
- **不需要 interface / type 语法**——契约用可执行的 JS 表达式声明  
- **不用 JSDoc 的 `@param`/`@return`**：那是类型注解；这里是精化契约  
- **不叫 requires**：那只是「校验挡板」；refine 表示 Pred 进入 Abs，参与代数运算（前置/后置）

| 文件 | 场景 |
|------|------|
| [`delay.nudo.js`](./delay.nudo.js) | 标量模板 `number().gt(0)` |
| [`shapes.nudo.js`](./shapes.nudo.js) | **object 形状**：`shape({ id, name })` |
| [`set-delay.js`](./set-delay.js) | 标量主形态：`@nudo:refine ms delay` |
| [`register.js`](./register.js) | **形状主形态**：`@nudo:refine u user` |
| [`return-contract.js`](./return-contract.js) | **后置**：`@nudo:refine return positive` |
| [`add-pred.js`](./add-pred.js) | Pred 流入代数：`add(x,1)` → `(x+1)>1` |
| [`declared-vs-if.js`](./declared-vs-if.js) | if 分支 ≠ 契约（clamp vs setDelay） |

## 标量契约

```js
// delay.nudo.js
export const delay = number().gt(0);

// set-delay.js
/// @nudo:import { delay } from "./delay.nudo.js"

/**
 * @nudo:refine ms delay
 */
function setDelay(ms) { ... }
```

## Object 形状契约（无需 interface）

```js
// shapes.nudo.js
export const user = shape({
  id: number().gt(0),
  name: string(),
});

// register.js
/// @nudo:import { user } from "./shapes.nudo.js"

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

可选字段：

```js
export const config = shape({
  retries: number().ge(0).le(5),
  label: string().optional(),
});
```

## 返回值契约

```js
/**
 * @nudo:refine x positive
 * @nudo:refine return positive
 */
function inc(x) {
  return x + 1;
}

/**
 * @nudo:refine return positive
 */
function bad() {
  return 0;  // error: 返回值 ⊭ @nudo:refine return positive
}
```

- 约束模板 **参数无关**（占位 `self`）  
- `u user` = 把 `user` 实例化到参数 `u`  
- 同一 `user` 可被任意文件、任意参数复用  
- 形状检查是声明式门禁，不是类型系统完备检查

## 与 @nudo:case

| | refine | case |
|---|---|---|
| 角色 | 精化（定义域 D，参与运算） | 见证（⊆ D） |
| 违例 | 调用/返回 ⊭ refine | case ⊄ D → inconsistency |

```bash
npx tsx packages/cli/src/index.ts check docs/examples/constraints/set-delay.js
npx tsx packages/cli/src/index.ts check docs/examples/constraints/register.js
npx tsx packages/cli/src/index.ts infer docs/examples/constraints/add-pred.js
```
