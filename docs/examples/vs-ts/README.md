# vs TypeScript — 同逻辑对照

| 场景 | Nudo | tsc --strict |
|------|------|----------------|
| **约束** `setDelay(0)` | **报** `constraint-violated`（`@nudo:requires ms delay`） | 不报（`number` 合法） |
| **结构缺属性** `greet({id})` | **报** `arg-structure`（body 访问推出，无需 interface） | 报（需 `interface User`） |
| **excess property** | ok（宽度子类型） | **报**（对象字面量） |
| **赋值缺字段** | **报** `assign-mismatch` | 报（inferred 形状） |
| 零注解 JS | 默认 | 需 checkJs 或迁 TS |
| 报告 | Abs：`actual ⊭ expected` | TS 诊断文案 |

## 怎么跑

```bash
# 约束
npx tsx packages/cli/src/index.ts check docs/examples/vs-ts/constraints/nudo.js
npx tsc --noEmit --strict docs/examples/vs-ts/constraints/tsc.ts

# 结构
npx tsx packages/cli/src/index.ts check docs/examples/vs-ts/structure/nudo.js
npx tsc --noEmit --strict docs/examples/vs-ts/structure/tsc.ts
```

## 分工

- **Nudo**：约束（类型即计算）+ 推断结构，零注解  
- **tsc**：完备结构 + 生态；大 TS 仓继续用  
- **dts**：兼容投影，不是主类型模型  
