---
slug: /reference/agents
description: 面向 AI coding agent 的 Nudo — 产品规则、Day0 命令、机器可读诊断、MCP/LSP 入口。
---

# Agents（智能体）

Nudo 面向 **agent 可执行**：稳定动词、稳定诊断码，并提供机器入口。

- 机器入口：[agents.md](https://nudojs.github.io/nudo/agents.md)
- 策展索引：[llms.txt](https://nudojs.github.io/nudo/llms.txt)
- 源码 Markdown：monorepo `packages/website/docs/**`（llms.txt 中列出 raw 链接）

## 可粘贴进 agent 的指令块

```text
Read https://nudojs.github.io/nudo/agents.md and set up Nudo in this project.
Primary gate: npx nudojs check <path>.
Contracts are *.nudo.js / @nudo:refine (alias @nudo:interface).
Do not invent body-AST obligations. @nudo:case is debug-only.
Entry params print as any; unknown = inference failed.
Leaving tsc: npx nudojs migrate status|strip|verify|retire (exit is retire).
```

## 产品规则（不得违反）

| 规则 | 说明 |
|------|------|
| 动词 | 仅 `check` \| `test` \| `contract` \| `export` \| `health` \| `migrate` |
| 无 `infer` 动词 | 观察 = check 签名 + IDE |
| 契约 | sidecar / `@nudo:refine`；`@nudo:interface` 只是别名 |
| `@nudo:case` | 仅调试 / `nudo test` / LSP |
| any vs unknown | 入口 `any`；`unknown` = 推导失败 |
| check vs export | check 校验；export 有损投影 |
| L1 / L2 | L1 显式契约；L2 入口 may-throw；ignoreThrows ≠ L1 |
| 不发明 body-AST 槽位 | 义务只来自契约或调用点事实 |
| HOF promote ≠ check error | body 用法提升只是警告建议 |
| migrate 是单向门 | `status` → `strip` → `verify` → `retire` tsc；共存不是终态 |

## Day 0 / Day 1 命令

```bash
npx nudojs check <path>
npx nudojs check <path> --what-if raw=string --target size   # AI3：假设 → 观察
npx nudojs contract <path>
npx nudojs contract --draft <path> [--write] [--json]        # AI4：draftSource + unified diff
npx nudojs export <path> --format dts --out dist/types
npx nudojs health <path>
npx nudojs migrate status <pkg>
npx nudojs migrate retire <pkg> --dry-run
```

`nudo test` 是可选的调试 case 报告，**不是**主叙事。


## 配置（package.json）

```json
{
  "nudo": {
    "analysis": { "mode": "exports" },
    "check": { "ignoreThrows": ["TypeError"], "entryThrows": "error" },
    "contract": { "autoBind": true }
  }
}
```

默认分析模式 `"exports"`（export / 侧车 / 指令）；命名路径的 CLI `check` 仍会分析该文件。完整配置面：[CLI 参考](/docs/api/cli-reference)。

## 机器可读诊断

```bash
npx nudojs check file.js --json
```

人类可读面使用 Abs 上的 `actual ⊭ expected`。稳定诊断码见 [诊断码词典](/docs/reference/diagnostics)。

## 少样本修复对（该这么改，别那么改）

最小 diff。优先消费 issue 上的 `actions[]`，再套用下表。

### `nudo:constraint-violated` — 改调用点

```js
// 错 — actual: 0  #exact  ⊭  expected: ms > 0
setDelay(0);

// 对 — 同一契约，值满足 Pred
setDelay(250);
```

仅当 `0` 合法时才**放宽**契约（编辑 `*.nudo.js`）：

```js
// 错
export const setDelay = fn({ ms: number().gt(0) }, number());
// 对
export const setDelay = fn({ ms: number().ge(0) }, number());
```

### `nudo:entry-may-throw` — refine / 守卫 / 迁移开关

```js
// 错 — L2: property 'name' on any
export function getName(user) {
  return user.name;
}

// 对 — 声明入口形状
export const getName = fn({ user: shape({ name: string() }) }, string());
```

迁移期逃生舱（不是类型修复）：`npx nudojs check --ignore-throws TypeError`。

### `nudo:unknown-inference` / `nudo:opaque-result` — 让返回面可计算，禁止编造

```js
// 错 — 调进未建模 native，返回面是 true unknown
export function fmt(v) {
  return __nudoMissingNative(v);
}

// 对 — 可计算函数体（或补调用点证据）
export function fmt(v) {
  return String(v);
}
```

**不要**为了消掉 `unknown` 去写 `@returns string`。那正是 Nudo 拒绝的 TS 谎言。  
`@nudo:mock` 面向**导入模块**面（对自由全局仍不稳——优先可计算函数体或真实证据）。

### `nudo:assign-mismatch` — 保住形状

```js
// 错 — 丢 port
config = { host: "y" };
// 对
config = { host: "y", port: 8080 };
```

### draft→accept（新义务）

```bash
npx nudojs contract --draft src/app.js   # 仅审阅
# 把选中的 export 抄进 app.nudo.js  ← accept 时 L1 才生效
npx nudojs check src/app.js
```

不发明 body-AST 槽；不把 JS 改写成 TS「为了类型」。

## 工具面

| 表面 | 文档 |
|------|------|
| LSP 包 | [`@nudojs/lsp`](/docs/api/lsp) |
| Agent executeCommand | [API · agent](/docs/api/agent) |
| Agent 集成 | [Agent 集成指南](/docs/guides/agent-integration) |

不要把服务端注入字段（`loadModule`、生效中的 `autoBind`）当作 JSON-RPC 参数发送。

## Agent 非目标

- 不要把 `@nudo:case` 当成契约生成器
- 不要把 JS 改写成 TS「为了类型」
- 不要从 body AST 发明必填 slot
- 不要把无约束入口参数叙述成 `unknown`
- 不要把双跑 `tsc` + `nudo check` 写成永久终态 —— 出口是 `migrate retire`

参见 [Limits](/docs/concepts/limits) · [术语表](/docs/reference/glossary) · [Recipes](/docs/guides/recipes) · [从 TypeScript 迁移](/docs/guides/migrating-from-typescript)。

