---
"@nudojs/service": patch
---

**Bug 修复（翻译口径订正，非 breaking）**：产品裁定「nudo 的 `any` 含义更接近 TS 的 `unknown`」——nudo `any` 是「任意 JS 值、无约束」，对应 TS 的 `unknown`（top，消费方须先收窄），**不是** TS 的 `any`（关闭类型检查的逃生舱）。此前 `.d.ts` 是唯一把 nudo any 直译成 TS `any` 的产物面，而 zod / standard / guard 三面运行时校验器早已把 any / unknown 同映为 `unknown`。现在 TS 投影面归一，四面同口径。

- `dts-generator.ts::absToTSTypeB` 的 `case "any"` 由 `return "any"` 改为 `return "unknown"`；另补齐三处绕过该函数的硬编码：`classParamDecl`（类构造器 / 静态方法形参）、无签名导出的 `(...args: unknown[]): any` fallback、泛型基类实参占位。源码注解原文解析的 `any` token 白名单、守卫体内部故意的 `Record<string, any>`、`case-json` / contract draft / `formatAbs` 等 **nudo 展示面**均不变。
- `abs.md`（en / zh）的「unconstrained entry parameters display as `any`」规则**作用域澄清**：它只管 Nudo 自己的展示 / CLI 输出，不管辖 TypeScript 声明产物；`nudo check` / `nudo contract` 签名面继续区分 any（无约束）与 unknown（推导失败）。`docs/design/cli-semantics.md` §2 与导出指南 en / zh 同步订正。
- 实测收益：生成器宿主调用退化档 `Generator<any>` → **`Generator<unknown>`**；BUG-076 记录的「导出指南承诺 `unknown` + 点名提示，实现却给 `any` 且无提示」矛盾**彻底关闭** —— 归一后按「渲染为 unknown」触发的 stderr 提示自动覆盖主路径。
- 兼容性：`.d.ts` 消费方对未收窄的无约束返回值会遇到 TS2571。按产品裁定性为**正确的类型安全提示**（引擎确实不知道返回值是什么），先做 `typeof` / 判别收窄即可；Bug 544 的 tsc 实证已从「假红」改判并保留正反映证。按 `docs/versioning.md` 的 soundness 判例走 **patch**，不写 BREAKING / Migration 标注；该 changeset 自身不抬级，与同批 minor changeset 合并发布时包版本取最高的 minor。
- Evidence：全仓独立改前基线 1659 入口 / 20 失败 = 基线 20；归一实验暴露 26 条新增失败，**全部**为 TS 产物精确串断言（无功能失败），已按新口径逐条重订；BUG-544 / BUG-076 两个语义级测试整份重写，BUG-003 / BUG-079 / BUG-044 / BUG-168 / BUG-514 / BUG-520 / dts-contract-face / export-dts-evidence 等同步。最终全仓 0 新增失败。

依据：`docs/versioning.md`「判例（2026-11-06）」、`docs/design/cli-semantics.md` §2、`packages/website/docs/concepts/abs.md`。
