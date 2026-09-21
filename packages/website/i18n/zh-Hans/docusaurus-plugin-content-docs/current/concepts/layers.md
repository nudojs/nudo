---
slug: /concepts/layers
description: Day-0 零概念、Day-1 侧车契约、进阶 Abs——按需选层即可。
---

# 概念分层

**读完你能带走：** 你今天需要哪一层——Day 0（执行即类型）、Day 1（侧车契约 + `nudo check`），还是进阶 Abs。

Nudo 的设计是：你只学当下需要的那一层。

## Day 0 — 零概念

写普通 JavaScript，跑 Day-0 两条命令：

```bash
npx nudojs check ./src/app.js   # 签名 + L2 入口 throws
npx nudojs test ./src/app.js    # 全部推断用例
```

`check` 成功时也打印 signatures。无约束入口参数显示为 `any`。`test` 打印合成 `call@` / `entry@` 用例 —— 这就是调用点观察面。无注解、无配置。

用装了 Nudo 扩展的 VS Code 打开同一文件，可获得 hover 与 inlay。

**Day 0 要点：** 从 `check` 签名与 `test` 用例读类型。

> 项目级可把 `package.json#nudo.analysis.mode` 设为 `all` 或 `directives`；**出厂默认是 `exports`**（含 export / 侧车 / 指令的文件进 IDE 分析）。

## Day 1 — 侧车契约

需要**更强义务**（CI 显式契约）时，在源文件旁加侧车：

```javascript
// math.js
export function add2(x) {
  return x + 2;
}
```

```javascript
// math.nudo.js — 函数绑定必须是 fn({ 参数 }, 返回?)
import { number, fn } from "@nudojs/core";

export const add2 = fn({ x: number().gt(0) }, number());
```

```bash
npx nudojs contract --draft ./src/math.js   # 可选：代码优先草稿
npx nudojs check ./src/math.js
```

侧车**函数**绑定必须是一等 `fn({ … }, …)` 契约。裸的 `number().gt(0)` 是**值级模板**（例如共享 `*.nudo.js` 里的 `export const positive = number().gt(0)`）——经 `@nudo:refine` 引用，或作为 `fn` 的参数槽；不能直接当函数契约导出。非 `fn` 形态的函数侧车绑定会被拒绝（`nudo:interface-load`）。

显式契约只来自：
- 侧车（`*.nudo.js`）/ `@nudo:refine`（别名 `@nudo:interface`）
- 分析器观察到的调用点事实（域证据）

无显式契约时，契约退化为 JS 运行时边界：入口参数为 `any`，导出函数不得携带未消化 may-throw（L2）。Nudo **不会**从 body AST 扫描发明必填 slot。

## 进阶 — Abs

内部类型是 **Abs**（`shape × term × pred × conf`）：类型是可计算的值。`nudo check --abs` 展示逐函数的代数面（shape + conf）；`--generalize` 附加符号 term/pred α。日常开发很少需要直接接触。

## 下一步

- [快速开始](../getting-started/quick-start.md)
- [check 指南](../guides/check.md)
- [VS Code](../guides/vscode.md)
- [与 TypeScript 共存](../guides/coexistence.md#何时用-modedirectives-vs-modeexports)
