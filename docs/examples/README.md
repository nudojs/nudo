# Nudo Examples

单一入口。按场景分组，与实现目录无关。

| 目录 | 场景 |
|------|------|
| [`constraints/`](./constraints/) | `@nudo:refine` × Pred：契约、`*.nudo.js` 模块、与代数融合 |
| [`structure/`](./structure/) | Abs `leq`：赋值 / 传参结构 |
| [`vs-ts/`](./vs-ts/) | 与 TypeScript 同逻辑对照 |
| [`mini-repo/`](./mini-repo/) | 多文件集成（ESM + class + async） |
| [`algebra/`](./algebra/) | 类型即计算（高级：spread / HOF / reduce / mixin） |

## 约束模型（设计）

```
*.nudo.js          通用约束模板（不绑参数名）
  export const delay = number().gt(0);
  export const user  = shape({ id: number().gt(0), name: string() });

demo.js            绑定发生在 requires
  /// @nudo:import { delay, user } from "./delay.nudo.js"
  /**
   * @nudo:refine ms delay
   * @nudo:refine u user
   */
  function setDelay(ms) { ... }
  function register(u) { ... }
```

- `if` 分支 **不是** 契约  
- 契约只来自 **声明**（`.nudo.js` 导出的模板）  
- requires 形态唯一：`@nudo:refine <param> <constraint>`  
- **object 形状用 `shape({...})`，无需 interface / type**  
- 同一 Pred 喂 check 与代数  

## 怎么跑

```bash
# 约束门禁（标量）
npx tsx packages/cli/src/index.ts check docs/examples/constraints/set-delay.js

# 约束门禁（object 形状）
npx tsx packages/cli/src/index.ts check docs/examples/constraints/register.js

# 推断（无损 Abs）
npx tsx packages/cli/src/index.ts infer docs/examples/constraints/add-pred.js

# 与 tsc 对照
npx tsx packages/cli/src/index.ts check docs/examples/vs-ts/constraints/nudo.js
npx tsc --noEmit --strict docs/examples/vs-ts/constraints/tsc.ts
```
