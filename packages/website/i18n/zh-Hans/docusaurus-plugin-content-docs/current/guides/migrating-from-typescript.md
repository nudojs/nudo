---
slug: /guides/migrating-from-typescript
description: 用 nudo migrate 退役 tsc —— status → strip → verify → retire。共存只是迁移战术，不是终态。
---

# 从 TypeScript 迁移

**读完你会知道：** 离开 `tsc` 的单向门（`nudo migrate`）、包何时可以退役，以及 TypeScript 应留下的诚实例外。

**JS 优先包的终局：没有 `tsc`。** Nudo 的目标是**替代** JavaScript 上的 TypeScript 门禁 —— 不是永久并排。共存是**迁移期战术**，出口叫 `migrate retire`。

相关：[心智模型](../getting-started/mental-model.md) · [为什么选 Nudo](../why-nudo.md) · [Nudo 与 TypeScript](./vs-typescript.md) · [错误对照](./error-faces.md) · [迁移现有 JS](./migrating-js.md)

## 先做判断

| 情况 | 建议 |
|------|------|
| 新建或存量 **`.js` 包** | **采用 Nudo**，直接跳过 `tsc` |
| 运行时是 JS 的 `.ts` / 混合包 | 用 [`nudo migrate`](#path-r--retire-tsc-nudo-migrate) **退役 tsc** |
| 混合 monorepo | **按包**迁移；仅在仍有 TS 包时短暂共存 |
| 标注优先 `.ts` monorepo，**类型语言就是产品** | 继续用 TypeScript（Nudo 不是 `tsc` 克隆） |
| npm 消费方要 `.d.ts` | `nudo export --format dts` 作有损投影 —— 不是第二真相源 |

Nudo 按 **JS 语义**分析。指向 `.ts` 会剥注解 —— 用 `migrate strip`，然后退役。

## 变了什么（什么没变）

| TS 习惯 | Nudo 对应 |
|---------|-----------|
| 在源码里标注参数/返回 | 观察层：`nudo check` 打印签名（无证据/契约前为 `any`） |
| CI 里 `tsc --noEmit` | CI 里 `nudo check`（成功也打印 signatures） |
| `interface` / mapped 当义务 | 侧车 `*.nudo.js` 构造器 + 可选 `@nudo:contract` |
| Hover 显示声明类型 | Hover / inlay 显示 Abs 事实（term / pred / conf） |
| `.d.ts` 是模型 | `.d.ts` 是**有损导出**；Abs 是模型 |
| 重构改注解 | 重构改**证据**（调用点）和/或**契约** |

**工作模式**（同一 checker）：

1. **逻辑优先** — 保留/实现 JS → `contract --draft` → 审阅 → `*.nudo.js`
2. **契约优先** — 先写侧车 / `@nudo:contract` → 在该面下实现

`nudo check` 只校验。schema/dts/guards 来自 `nudo export`。

## Path R —— 退役 tsc（`nudo migrate`） {#path-r--retire-tsc-nudo-migrate}

产品迁移路径。单向门：审计 → 剥离 → 门禁 → 摘掉 TypeScript。

```bash
npx nudojs migrate status ./my-pkg
npx nudojs migrate strip ./my-pkg/src --write
npx nudojs migrate verify ./my-pkg/src
npx nudojs migrate retire ./my-pkg          # 先加 --dry-run
```

| 步骤 | 做什么 | 何时结束 |
|------|--------|----------|
| `status` | 统计 `.ts`/`.tsx`、找 `tsc` scripts 与 `typescript` 依赖、列 **blockers**（含 workflow 里的 tsc 行） | 知道面有多大 |
| `strip` | `.ts` → `.js`（注解出、运行时留）。`--write` 写盘 + 尽力生成侧车草稿（`--no-draft` 跳过） | 源码是纯 JS |
| `verify` | 在剥离后的 JS 上跑 `nudo check` | 门禁绿 |
| `retire` | 摘掉 `typescript` 依赖、把 `tsc` scripts 改成 `nudo check`、**改写 `.github/workflows` 里的 tsc 行**、写 `.nudo/migrate-retired.json` | **tsc 没了** |

monorepo 批量：`npx nudojs migrate retire ./repo --all` 会走遍每个仍带 `tsc` / `typescript` 的 workspace 包。`--no-workflows` 让 CI YAML 保持原样。

`status` 样例：

```text
migrate status

  my-pkg
    ts files: 2  tsx: 0  tsconfig: yes  typescript dep: yes
    tsc scripts: typecheck
    blockers: tsc still in scripts; no nudo check/test script yet; typescript still in dependencies

next: nudo migrate strip <path>  →  verify  →  retire <pkg>
```

在信任注解之前，先变成可审阅契约：

```bash
npx nudojs contract --from-dts ./my-pkg/src/index.ts
# → @nudo:draft（复制进 *.nudo.js 前不执法）
```

手写 `*.nudo.js` 永远压过草稿。

### 真实包故事

| 样例 | 展示什么 |
|------|----------|
| [`docs/examples/migrate/`](https://github.com/nudojs/nudo/tree/main/docs/examples/migrate) | 公开 **checkout-demo**：TS+tsc → JS+nudo（before/after 门） |
| [`docs/examples/retire-real/`](https://github.com/nudojs/nudo/tree/main/docs/examples/retire-real) | 真实 npm **`ms`** 消费方退役 tsc；依赖不动 |

同一个故事，一张表：

| | before | after `migrate retire` |
|---|---|---|
| 语言 | `.ts` + 注解 | 普通 `.js` |
| CI 门禁 | `tsc --noEmit` | `nudo check` |
| `typescript` 依赖 | 有 | **无** |
| 标记 | — | `.nudo/migrate-retired.json` |

## Path A —— 先在 TS 应用旁起步，再退役该包

典型 monorepo：`apps/*` 仍是 TS，`packages/*` 是你想摘掉 `tsc` 的工具层。

1. **范围** — 一个包（CLI、worker、脚本层）。
2. **观察** — `npx nudojs check packages/tool/src`。读签名；无约束入口显示为 **`any`**。
3. **契约** — 逻辑优先（`contract --draft --from tests/`）或契约优先（侧车 / `@nudo:contract`）。
4. **门禁** — 在工作流中对该包路径跑 `nudo check`。
5. **退役该包** — 对它跑 `migrate status` / `strip` / `verify` / `retire`。不要把 `tsc` 留成永久第二门禁。
6. **生态** — 仍要给消费方类型时：

   ```bash
   npx nudojs export packages/tool/src/index.js --format dts --out packages/tool/dist/types
   ```
7. **IDE** — VS Code / Zed 扩展。

双门禁只应**存在于迁移过程中**——它不是产品终态。

## Path B —— 「TS 形态」但拒绝永久标注的逻辑

1. 用 `nudo check` 作为门禁后，关掉 `// @ts-check` 压力。
2. 用**侧车契约**替换 JSDoc 类型表演，只在需要义务处。
3. 从测试挖调用点（`--from test/`）；接受草稿前 **widen**。
4. `export` dts **给消费方**，不是你维护的模型。

## 保留手写 .d.ts（逃逸舱） {#keeping-handwritten-dts}

当包的公开表面就是**类型层工作**——React `props` 体操、以条件/映射类型为 API——Nudo 不要求你翻译它（见[能力边界](./vs-typescript.md#capability-bounds-engine-non-goals)）。受支持的共存面很窄，且逐条实测过：

**手写 `.d.ts` 服务 TS 生态消费方；`nudo check` 只门禁 JS。**

| 问题 | 实测答案 | 验证命令 |
|------|----------|----------|
| `check` 会碰我的声明文件吗？ | 不会——目录遍历只分析 `.js/.mjs/.ts`；`types/*.d.ts` 不产生任何诊断（fixture 实跑只列出 `src/fixture.js`，`OK`） | `npx nudojs check ./pkg` |
| 直接传一个进去呢？ | 拒绝，exit 1：`Not an analysis target (need .js/.mjs/.ts, not sidecar/decl/JSX)` | `npx nudojs check types/foo.d.ts` |
| `export --out` 会覆盖吗？ | 不会——无 `// nudo-export-module:` 标记的同名文件会被拒绝（exit 1 + `fix:` 提示）；nudo 自己生成的文件可原地再生 | `npx nudojs export src/index.js --format dts --out types/` |
| 声明能起草契约吗？ | 能，且只是草稿：产物为 `@nudo:draft`，**永不参与 check 加载**；把接受的导出复制进 `*.nudo.js` 义务才生效 | `npx nudojs contract --from-dts types/foo.d.ts`（`--write` 在旁边存 `foo.nudo.draft.ts`） |
| `migrate` 把它们算 TS 债吗？ | 不会——`migrate status` 只统计 `.ts`/`.tsx` 源码，不数 `.d.ts`；`retire` 摘掉的是 tsc，不是你的声明 | `npx nudojs migrate status ./pkg` |

放置规则：手写声明放独立目录（`types/`），`package.json` 的 `"types"` / `exports.types` 指向它；`nudo export --out` 指向**另一个**只放生成物的目录（`dist/types`）——覆盖守卫就永远不必触发。

Nudo 校验的模型仍是 **Abs + 契约**；手写 `.d.ts` 与生成的 `.d.ts` 同级，是生态出口——永远不是真相源。

## 契约审阅清单

1. **参数** — 调用点形状是证据；公开义务更宽时要 widen。
2. **返回** — 执法你要的契约，不是每条历史结果。
3. **Pred** — `number().gt(0)` 参与代数；不是品牌类型。
4. **any vs unknown** — 无约束入口是 **`any`**；**`unknown` = 推导失败**（引擎债）。
5. **手写优先** — draft/emit 永不覆盖已接受的 `*.nudo.js`。

## 迁移期共存（短命）

| 规则 | 为什么 |
|------|--------|
| 迁移期间每工具一条 CI job | 红绿清晰 |
| 同一 API 不要同时维护 `interface` 和侧车 | 漂移 |
| dts export 是生成物 | Abs + 契约才是模型 |
| 优先 `migrate retire`，不要「永远双跑」 | 双跑是战术，retire 是出口 |

战术生效期间见：[共存](./coexistence.md)。

## 下一步

- [心智模型](../getting-started/mental-model.md)
- [错误对照](./error-faces.md)
- [Nudo vs TypeScript](./vs-typescript.md)
- [快速开始](../getting-started/quick-start.md)
- [nudo check](./check.md) · [契约](./contract.md)
