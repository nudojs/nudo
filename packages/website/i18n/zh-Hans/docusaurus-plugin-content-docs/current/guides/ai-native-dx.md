---
slug: /guides/ai-native-dx
description: AI-native DX —— 为什么 agent 在 Nudo 上更少噪音地红→绿。结构化 actions、诚实 unknown、可度量评测。
---

# AI-native DX

**读完你会知道：** Nudo 如何为 **agent 修环** 设计（不只服务人类 IDE），以及如何**客观度量**（token · 轮数 · bug）。

给 agent 的一句话：**不要相信声明。跑 `nudo check --json`。`actual` 是值，`actions[]` 是下一步。**

## Agent 在 TypeScript 上的痛

| TS 上的 agent 痛点 | 后果 |
|--------------------|------|
| **假绿** | `ms: number` + `setDelay(0)` 能过检，bug 出货 |
| **散文报错** | “Not assignable to type …” —— 无值、无命令 |
| **双 IR** | 注解与运行时漂移；agent「修错边」 |
| **闭环贵** | 全量 `tsc` / LS 多轮，费时费 token |

## Nudo 给 agent 的面

| 需要 | 表面 |
|------|------|
| 真值 | 分析**执行** JS（Abs）；调用点是证据 |
| 机读门禁 | `npx nudojs check <file> --json` → **CheckJson v1**（稳定 code） |
| 下一步 | `issues[].actions[]` —— `draft` / `relax` / `callsite` / … + 可执行 `command` |
| 诚实 | `any` ≠ `unknown`；结果宽化时 **`budget.truncated`** |
| 快环 | 编辑路径远快于 `tsc.LS` |
| 出口 | `migrate retire` —— 一门禁，不双跑 |

```json
{
  "code": "nudo:constraint-violated",
  "actual": "0  #exact",
  "expected": "ms > 0",
  "actions": [
    { "kind": "callsite", "label": "use a value satisfying the constraint", "hint": "ms > 0" },
    { "kind": "relax", "label": "relax the precondition (edit *.nudo.js / @nudo:refine)" },
    { "kind": "draft", "command": "nudo contract --draft", "label": "emit a sidecar draft you can edit" }
  ]
}
```

少样本「错→对」在 [Agents](../reference/agents)（及 `packages/lsp/agent-skill/SKILL.md`）。粘贴块：

```text
Read https://nudojs.github.io/nudo/agents.md and set up Nudo in this project.
Primary gate: npx nudojs check <path>.
Prefer issues[].actions[] over parsing suggestion prose.
Do not invent body-AST obligations. @nudo:case is debug-only.
Entry params print as any; unknown = inference failed.
Leaving tsc: npx nudojs migrate status|strip|verify|retire (exit is retire).
```

## 量什么（别争「感觉更 agent-friendly」）

| 指标 | 定义 | 为何重要 |
|------|------|----------|
| **detectRate** | bug 在门禁上是红的比例 | agent 看得见吗？ |
| **silentGreen** | 门禁绿但 bug 仍在 | TypeScript 失效模式 |
| **wrongFixGreen** | 常见错误修法后门禁仍绿 | 可作弊的门禁 |
| **diagTokens** | 首个红载荷近似 token（**仅报红时**） | 看见之后的读成本 |
| **rounds** | **文档路径**上的门禁次数 | 迭代税 |

成对夹具（同一 bug：JS+Nudo vs TS+tsc）——`pnpm run agent-dx`：

```text
detectRate    nudo=5/5   ts=2/5
silentGreen   nudo=0/5   ts=3/5
wrongFixGreen nudo=3/5   ts=5/5
avgDiagTokens (detected) nudo≈103  ts≈51
```

**TS 的「便宜 token」往往是沉默（SG）**——agent 根本看不见 bug。Nudo 付的是**检出**的 token。

```bash
pnpm run agent-dx
node benchmark/agent-dx/run.mjs --json
pnpm run agent-eval
pnpm run dx-metrics
```

源码：[`benchmark/agent-dx/`](https://github.com/nudojs/nudo/tree/main/benchmark/agent-dx)。

### 更重的成对评测（仓库内）

`agent-dx` 是**静态**门禁载荷探针。要在**多文件模块图 + 真实历史 bug** 上量 LLM 修复环（detect · silentGreen · token/轮次），用 `benchmark/lsp-rounds/`（夹具由本地 `node-semver` checkout 生成）；结论档：`benchmark/lsp-rounds/out/OSS-SEMVER.md`。

**OSS 历史 bug 切片**（node-semver，6 个最近 fix，约 2.4k LOC 多文件）——两侧都 **6/6**：

| | Nudo | TypeScript |
|--|--|--|
| detectRate | **6/6** | **6/6** |
| silentGreen | false | false（跑完时） |
| tokenTotal | **569k** | 993k（**+75%**） |
| rounds / repairLoops | **45 / 16** | 63 / 21 |
| gate 峰值 RSS | **226MB** | 289MB |

结论：在**大模块真缺陷**上，两侧都能摸到满分检出——差距在**成本与稳定性**，不是天花板。预算偏紧时 TS 侧 2/3 次出现 **silentGreen**（门禁绿、坑还在）；Nudo 跑完那轮没有。约束类小题（`agent-dx`）上 **detect / silentGreen** 的类型面分裂仍然更尖锐。

```bash
node benchmark/lsp-rounds/oss-semver/build.mjs /path/to/node-semver
node benchmark/lsp-rounds/harness/run.mjs --seed 1 --task oss
```

## 推荐 agent 闭环

```text
写/改 JS
  → nudo check --json
  → 选 actions[]（或 few-shot 对）
  → 改实参 / 放宽契约 / draft→accept
  → 再 check
  → 绿，或诚实 unknown（禁止假 @returns）
```

可脚本探针：

```bash
npx nudojs check src/app.js --what-if raw=string --target size
npx nudojs contract --draft src/app.js --json    # draftSource + unified diff
```

## 非目标（让 agent 保持诚实）

- **不要**把 JS 改写成 TS「为了类型」。
- **不要**发明 body-AST 义务。
- **不要**用编造的 `@returns` 消 `unknown`。
- **不要**把双跑写成终态 —— 出口是 **`migrate retire`**。

## 下一步

- [Agents](../reference/agents) — 规则 + 少样本修复对
- [错误对照](./error-faces) — 人读的 `actual ⊭ expected`
- [十分钟心智模型](../getting-started/mental-model)
- [从 TypeScript 迁移](./migrating-from-typescript) — 退役 tsc
