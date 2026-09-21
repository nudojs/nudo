---
slug: /guides/migrating-from-typescript
description: 何时以及如何把偏 TypeScript 的工作流转到「在 JavaScript 上使用 Nudo」——诚实路径，不假装 Nudo 是 tsc。
---

# 从 TypeScript 迁移

**读完你会知道：** 什么样的 TS 团队适合在 JS 上采用 Nudo、什么时候应继续以 TypeScript 为主，以及一条不把 Nudo 伪装成 `tsc` 的迁移路径。

这里**不是**「把所有 `.ts` 都改成 Nudo」，而是：**当产品事实写在 JavaScript（或 JS 形态的逻辑）里时，在该包上加 Nudo 门禁**；TS 语言本身就是产品的地方，继续用 TypeScript。

相关：[为什么选 Nudo](../why-nudo.md) · [Nudo 与 TypeScript](./vs-typescript.md) · [共存](./coexistence.md) · [迁移现有 JS](./migrating-js.md)

## 先做判断

| 情况 | 建议 |
|------|------|
| 新建或存量 **`.js` 包**；要观察 + 契约，又不想迁 TS | 在该包上**采用 Nudo**（逻辑优先或契约优先） |
| 混合仓：JS 工具 + TS 应用 | **共存**：`.ts` 交给 `tsc`，要门禁的 JS 包用 `nudo check` |
| 标注优先的 **`.ts` monorepo**，产品就是类型语言 | **继续以 TypeScript 为主**；Nudo 不是 `tsc` 替代品 |
| JS 包需要给 npm 消费方 `.d.ts` | 用 Nudo 管 Abs + 契约；**`nudo export --format dts`** 作单向桥 |

Nudo 按 **JS 语义**分析。可以指向 `.ts` 文件，但会剥离标注——它不是 TypeScript 编译器克隆。

## 变了什么（什么没变）

| TS 习惯 | Nudo 对应 |
|---------|-----------|
| 在源码里标注参数/返回 | Day 0：`nudo check` 打印签名（无证据/契约前为 `any`） |
| CI 里 `tsc --noEmit` | CI 里 `nudo check`（成功也打印 signatures） |
| 用 `interface` / 映射类型当义务 | 侧车 `*.nudo.js` 构建器（`fn`、`shape`、`number().gt(0)`）+ 可选 `@nudo:refine` |
| hover 显示声明类型 | hover / inlay 显示 Abs 事实（term / pred / conf） |
| `.d.ts` 是模型 | `.d.ts` 是**有损导出**；Abs 才是模型 |
| 重构 = 改标注 | 重构 = 改**证据**（调用点）和/或**契约** |

**工作模式**（校验器同一套）：

1. **逻辑优先** — 保留/实现 JS → `contract --draft` → 审阅 → `*.nudo.js`
2. **契约优先** — 先写侧车/refine → 在该契约面下实现

`nudo check` 只校验。schema / dts / guards 来自 `nudo export`。

## 路径 A — TS 应用旁的 JS 包

常见：monorepo 里 `apps/*` 是 TS，`packages/*` 工具是 JS。

1. **圈定范围** — 先选一个 JS 包（CLI、worker、脚本层），不要一上来整仓。
2. **安装** — 见[安装](../getting-started/installation.md)。用 `npx nudojs` / `nudo`。
3. **观察（Day 0）**

   ```bash
   npx nudojs check packages/tool/src
   ```

   读 signatures。无约束入口是 **`any`**。导出在 `any`/空值上可能抛错的，处理 L2 entry may-throw。

4. **契约（按工作模式）**
   - 逻辑优先：`npx nudojs contract --draft <file> --from <tests…>` → 审阅 → 复制进 `*.nudo.js`
   - 契约优先：为必须执法的 API 面手写 `*.nudo.js` / `@nudo:refine`
5. **CI** — 仅对该包路径增加或替换为 `nudo check`。仍有 `.ts` 的地方保留 `tsc`。
6. **生态** — 若 TS 应用要消费该包：

   ```bash
   npx nudojs export packages/tool/src/index.js --format dts --out packages/tool/dist/types
   npx nudojs export packages/tool/src/index.js --format schema --dialect zod
   ```

   JSON Schema / Zod 投影服务 mock 与运行时检查；它们**不能**替代 `nudo check`。

7. **IDE** — 安装 VS Code / Zed 扩展，获得 JS 上的 hover、inlay、CodeLens 草稿/落盘。

编辑器若对同一缓冲区同时调度两套工具，把 Nudo 分析范围从 `.ts` 排除——见[共存](./coexistence.md)。

## 路径 B — 「长得像 TS」却不想永远补标注的逻辑

有些包加了 `// @ts-check` 或零散 JSDoc，运行时仍是 JS。

1. 该包 CI 进入 `nudo check` 后，放下对增量 `@ts-check` 的压力。
2. 只在需要义务处，用**侧车契约**取代表演式类型注释。
3. 从测试挖调用点（`--from test/`）作草稿证据；接受前**放宽**（不要把 `lit(21)` 冻成公共义务，除非调用方只要正数）。
4. `export` dts 是给**消费方**的，不是你要手工维护的源。

## 路径 C — 继续以 TypeScript 为主

若 `.ts` 类型语言就是产品：

- `tsc` / 工程引用 / DefinitelyTyped 风格 API 留在 TS 侧。
- 不要把 `nudo check` 指向 TS monorepo 并期望与 TS 可赋值性逐位一致。
- 仍可在 TS **旁边**对 JS 脚本、生成的 JS 或运行时校验投影使用 Nudo——不要为同一套已标注源码再引入第二 IR。

## 契约审阅清单（从 TS 心智切换时）

接受草稿或写侧车时：

1. **参数** — 调用点形状是证据，不一定是公共义务。需要时放宽（`number()` vs 字面量）。
2. **返回** — 执法你要的契约，而不是历史结果的并集。
3. **Pred** — `number().gt(0)` 参与 Abs 代数，不是 TS branded type。
4. **any vs unknown** — 无约束入口是 **`any`**；**`unknown` 表示推导失败**（引擎债），不是「开发者忘了写类型」。
5. **手写优先** — draft/emit 永不覆盖你已接受的 `*.nudo.js`。

## 共存经验法则

| 法则 | 原因 |
|------|------|
| 每个工具路径一条 CI | TS 用 `tsc`；要门禁的 JS 包用 `nudo check` |
| 同一 API 不要同时手维护 `interface` 和侧车 | 双真源会漂移 |
| dts 导出是生成物 | 维护 Abs + 契约；`.d.ts` 是投影 |
| 编辑器 analysis mode / include 只圈 JS | 避免同一缓冲区双重诊断 |

细节：[共存](./coexistence.md)。

## 下一步

- [为什么选 Nudo](../why-nudo.md)
- [Nudo 与 TypeScript](./vs-typescript.md)
- [快速开始](../getting-started/quick-start.md)
- [nudo check](./check.md)
- [指令 — refine / 侧车](../concepts/directives.md)
- [运行时类型生成](./runtime-generation.md)
