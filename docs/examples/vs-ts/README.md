# vs TypeScript — 同逻辑对照

Nudo 不是「另一个类型系统」，是 **少写一门类型语言**：契约旁路 + 边界精化 + 值级报错。

| 场景 | Nudo | tsc --strict |
|------|------|----------------|
| **精化** `setDelay(0)` | **报** `nudo:constraint-violated`（`@nudo:refine ms delay`） | 不报（`number` 合法） |
| **结构缺属性** `greet({id})` | **报**（shape 契约 `@nudo:refine u user`） | 报（需 `interface User`） |
| **excess property** | ok（宽度子类型） | **报**（对象字面量） |
| **赋值缺字段** | **报** `nudo:assign-mismatch` | 报（inferred 形状） |
| 零契约 JS | 不发明义务（调用点事实 / `any`） | 需 checkJs 或迁 TS |
| 无契约 `x+1` | `number \| string`（真实 JS） | 常被钉成 `number` |
| 报告 | Abs：`actual ⊭ expected` | TS 诊断文案 |
| 形状契约 | `shape({...})` 模板 / 侧车 | `interface` / `type` |

## 怎么跑

```bash
pnpm run verify:examples   # 验证两侧命令与期望退出码（见 ../README.md 命令矩阵）
```

> 两侧的退出码非 0 都是预期：这些文件故意放错误调用，
> 报错行（nudo 诊断 vs tsc 诊断）就是对照表的内容。

## 分工

- **Nudo**：精化（类型即计算）+ **显式 shape 契约**（旁路 `*.nudo.js`，不必写 interface 语法）
- **tsc**：完备结构 + 生态；大 TS 仓继续用
- **dts**：兼容投影，不是主类型模型

## 样板对照（本目录真实文件）

同一逻辑在两侧文件里的样板差异，逐文件可查：

- `structure/tsc.ts` 需要 `interface User`（类型定义）+ 参数/返回注解才能报
  「缺 name」；`structure/nudo.js` 用旁路 `user.nudo.js` 的 `shape({id,name})` +
  `@nudo:refine u user`——**契约只写一次**，源码不写 interface 语法。
- `constraints/tsc.ts` 的 `setDelay(ms: number)` 拦不住 `setDelay(0)`——
  tsc 查不到 `ms > 0`；`constraints/nudo.js` 用 `@nudo:refine ms delay`
  （模板一行 `number().gt(0)`）在调用点报 `actual: 0 #exact ⊭ ms > 0`。

价值不在「少打字」，而在 **不用维护第二份真相**（契约只写一次，参与代数）。
无契约时 Nudo **不**从 body 静态发明必填字段（与「有 interface 才报」的 TS 同侧）。
