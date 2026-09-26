---
slug: /concepts/layers
description: Nudo 如何分层实现「源码中可见接近运行时的变量」— 观察层（Day 0）、契约层（Day 1）、进阶 Abs。
---

# 概念分层

Nudo 的目标是**在源码中看到变量接近运行时的样子**。该结果可分层获得，只需学习当前用到的概念。

术语约定：**观察层**即 Day 0，**契约层**即 Day 1（保留 Day-N 别名，便于熟悉运维生命周期说法的读者对照）。

## 你需要哪一层？

| 你想要 | 层 | 从这开始 |
|---|---|---|
| 在签名 / inlay 中看到接近运行时的值 | **观察层**（Day 0） | `npx nudojs check` / IDE hover |
| 义务——能报告违例的契约 | **契约层**（Day 1） | `*.nudo.js` 侧车 + `nudo check` |
| 表示本身——term、pred、`--abs` | **进阶** | Abs（`shape × term × pred × conf`） |

经验法则：只需*读*接近运行时的变量，停在观察层。需要*强制*条件，再加契约层。只有在调试推断或基于内核做工具时，才打开进阶层。

## 观察层（Day 0）— 零概念

写普通 JavaScript，跑两条观察命令：

```bash
npx nudojs check ./src/app.js   # 签名 + L2 入口 throws
npx nudojs test ./src/app.js    # 全部推断用例
```

`check` 成功时也打印 signatures。无约束入口参数显示为 `any`。`test` 打印合成 `call@` / `entry@` 用例——这就是调用点观察面。无注解、无配置。

用装了 Nudo 扩展的 VS Code 打开同一文件，可获得 hover 与 inlay。

> **默认分析模式：** `nudo.analysis.mode` 出厂默认 `"exports"`（含 export / 侧车 / 指令的文件进 IDE 分析）。完整门禁语义与各模式何时用：[与 TypeScript 共存](../guides/coexistence.md#何时用-modedirectives-vs-modeexports)。CLI 对指定路径的 `check`/`test` 仍会分析目标文件。

**观察层要点：** 从 `check` 签名与 `test` 用例读接近运行时的值。无约束入口参数上的 `any` 是诚实的——它的反面 `unknown` 意味着推导失败（见 [Abs —— any vs unknown](./abs.md#any-vs-unknown)）。

## 契约层（Day 1）— 侧车义务

需要*更强的义务*（可在任意流程中检查的显式契约）时，在源码旁添加侧车：

```javascript verify
// math.js
export function add2(x) {
  return x + 2;
}
```

```javascript verify-sidecar
// math.nudo.js — 函数绑定必须是 fn({ params }, returns?)
import { number, fn } from "@nudojs/core";

export const add2 = fn({ x: number().gt(0) }, number());
```

```bash
npx nudojs contract --draft ./src/math.js   # 可选的代码优先草稿
npx nudojs check ./src/math.js
```

侧车**函数**绑定必须是一等 `fn({ … }, …)` 契约。裸的 `number().gt(0)` 是**值级模板**（如共享 `*.nudo.js` 中的 `export const positive = number().gt(0)`）——经 `@nudo:contract` 或作为 `fn` 的参数槽使用，不可作为函数导出契约。非 `fn` 的函数侧车绑定会被拒绝（`nudo:interface-load`）。

显式契约来自：
- 侧车（`*.nudo.js`）/ `@nudo:contract`
- 分析器观察到的调用点事实（定义域证据）

无显式契约时，契约退化为 JS 运行时边界：入口参数为 `any`，导出函数不得携带未消化的 may-throw（L2）。Nudo **不会**从 body AST 扫描发明必填槽。

**契约层要点：** 侧车即契约产品。`nudo check` 强制 L1（显式契约）与 L2（入口 may-throw）。`@nudo:case` 仅调试 / `nudo test` 用——不是接口。

## 进阶 — Abs {#advanced-abs}

内部类型是 **Abs**（`shape × term × pred × conf`）：类型即可计算值。`nudo check --abs` 显示每函数的代数面（shape + conf）；`--generalize` 追加符号 term/pred α。日常很少需要。

需要进阶层时：
- 签名看起来不对，要 intensional 面而非展示字符串
- 在代数里推理约束（`x>0` ⇒ `x+1>1`）
- 基于 `@nudojs/core` 做工具

深入：[Abs —— 类型系统](./abs.md) · [抽象解释](./abstract-interpretation.md)。

## 下一步

- [快速开始](../getting-started/quick-start.md)
- [check 指南](../guides/check.md)
- [contract 指南](../guides/contract.md)
- [Abs —— 类型系统](./abs.md)
- [VS Code](../guides/vscode.md)
- [与 TypeScript 共存](../guides/coexistence.md)
