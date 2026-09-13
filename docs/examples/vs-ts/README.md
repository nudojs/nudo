# vs TypeScript — 同逻辑对照

Nudo 不是「另一个类型系统」，是 **少写一门类型系统**：零注解 + 边界精化 + 值级报错。

| 场景 | Nudo | tsc --strict |
|------|------|----------------|
| **精化** `setDelay(0)` | **报** `constraint-violated`（`@nudo:refine ms delay`） | 不报（`number` 合法） |
| **结构缺属性** `greet({id})` | **报** `arg-structure`（body 访问推出，无需 interface） | 报（需 `interface User`） |
| **excess property** | ok（宽度子类型） | **报**（对象字面量） |
| **赋值缺字段** | **报** `assign-mismatch` | 报（inferred 形状） |
| 零注解 JS | 默认 | 需 checkJs 或迁 TS |
| 无契约 `x+1` | `number \| string`（真实 JS） | 常被钉成 `number` |
| 报告 | Abs：`actual ⊭ expected` | TS 诊断文案 |
| 形状契约 | `shape({...})` 模板 | `interface` / `type` |

## 怎么跑

```bash
# 精化 —— nudo 报（exit 1 预期），tsc 不报（exit 0）
pnpm run check docs/examples/vs-ts/constraints/nudo.js
npx tsc --noEmit --strict docs/examples/vs-ts/constraints/tsc.ts

# 结构 —— nudo 报（exit 1 预期），tsc 报 3 处（exit 2）
pnpm run check docs/examples/vs-ts/structure/nudo.js
npx tsc --noEmit --strict docs/examples/vs-ts/structure/tsc.ts
```

> 两侧的退出码非 0 都是预期：这些文件故意放错误调用，
> 报错行（nudo 诊断 vs tsc 诊断）就是对照表的内容。

## 分工

- **Nudo**：精化（类型即计算）+ 推断结构，零注解  
- **tsc**：完备结构 + 生态；大 TS 仓继续用  
- **dts**：兼容投影，不是主类型模型  

## 行数对照（真实小服务）

同一业务逻辑：Nudo 侧 0 行 interface/type/mock 样板；TS 侧需类型定义与 DI 接口。  
价值不在「少打字」，而在 **不用维护第二份真相**。
