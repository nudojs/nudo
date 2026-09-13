# Nudo Examples

单一入口。按场景分组，与实现目录无关。

| 目录 | 场景 |
|------|------|
| [`constraints/`](./constraints/) | `@nudo:refine` × Pred：标量 / shape / 返回精化 |
| [`structure/`](./structure/) | Abs `leq`：赋值 / 传参结构 |
| [`vs-ts/`](./vs-ts/) | 与 TypeScript 同逻辑对照 |
| [`mini-repo/`](./mini-repo/) | 多文件集成（ESM + class + async） |
| [`algebra/`](./algebra/) | 类型即计算（spread / HOF / reduce / mixin） |

## 精化模型

契约不是类型注解，是 **进入 Abs 的 Pred**，会参与代数运算。

```
*.nudo.js                 参数无关的精化模板
  export const delay = number().gt(0);
  export const user  = shape({ id: number().gt(0), name: string() });

demo.js                   绑定发生在 refine
  /// @nudo:import { delay, user } from "./delay.nudo.js"
  /**
   * @nudo:refine ms delay
   * @nudo:refine u user
   * @nudo:refine return delay
   */
  function setDelay(ms) { ... }
```

- `if` 分支 **不是** 精化  
- 精化只来自 **声明**（`.nudo.js` 导出的模板）  
- 唯一形态：`@nudo:refine <param|return> <constraint>`  
- **object 形状用 `shape({...})`，无需 interface / type**  
- 同一 Pred 喂 check 与代数（`x>0` ⇒ `x+1>1`）

## 无契约时跟真实 JS

```js
function score(x) { return x + 1; }
// score: (x) => number | string = (x + 1)
// score("x") 合法，返回 "x1"；不报错
```

`any` = 任意 JS 值；`unknown` = 分析无信息。二者不是一回事。

## 怎么跑

```bash
# 精化门禁（标量）
pnpm run check docs/examples/constraints/set-delay.js

# 精化门禁（object 形状）
pnpm run check docs/examples/constraints/register.js

# 返回精化
pnpm run check docs/examples/constraints/return-contract.js

# 推断（无损 Abs）
pnpm run infer docs/examples/constraints/add-pred.js

# 与 tsc 对照
pnpm run check docs/examples/vs-ts/constraints/nudo.js
npx tsc --noEmit --strict docs/examples/vs-ts/constraints/tsc.ts
```
