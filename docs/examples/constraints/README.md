# Constraints — 契约与 Pred

前置约束 **只来自声明**，不从 if 猜测。

**唯一 requires 形态**：

```js
@nudo:requires <param> <constraint>
```

- `<constraint>` 必须是 `.nudo.js` 导出的模板（如 `delay`）  
- **不在** requires 里写 `x > 0`（那是绑死参数名的旧写法）  
- 模板本身参数无关：`number().gt(0)`  

| 文件 | 场景 |
|------|------|
| [`delay.nudo.js`](./delay.nudo.js) | 通用约束模板 `number().gt(0)` |
| [`set-delay.js`](./set-delay.js) | **主形态**：`@nudo:requires ms delay` |
| [`add-pred.js`](./add-pred.js) | Pred 流入代数：`add(x,1)` → `(x+1)>1` |
| [`declared-vs-if.js`](./declared-vs-if.js) | if 分支 ≠ 契约（clamp vs setDelay） |

## 主形态

```js
// delay.nudo.js
export const delay = number().gt(0);

// set-delay.js
/// @nudo:import { delay } from "./delay.nudo.js"

/**
 * @nudo:requires ms delay
 */
function setDelay(ms) { ... }
```

- 约束模板 **参数无关**（占位 `self`）  
- `ms delay` = 把 `delay` 实例化到参数 `ms`  
- 同一 `delay` 可被任意文件、任意参数复用  

## 与 @nudo:case

| | requires | case |
|---|---|---|
| 角色 | 契约（定义域 D） | 见证（⊆ D） |
| 违例 | 调用点 ⊭ requires | case ⊄ D → inconsistency |

```bash
npx tsx packages/cli/src/index.ts check docs/examples/constraints/set-delay.js
npx tsx packages/cli/src/index.ts infer docs/examples/constraints/add-pred.js
```
