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
```

## 产品规则（不得违反）

| 规则 | 说明 |
|------|------|
| 动词 | 仅 `check` \| `test` \| `contract` \| `export` \| `health` \| `env harvest` |
| 无 `infer` 动词 | 观察 = check 签名 + IDE |
| 契约 | sidecar / `@nudo:refine`；`@nudo:interface` 只是别名 |
| `@nudo:case` | 仅调试 / `nudo test` / LSP |
| any vs unknown | 入口 `any`；`unknown` = 推导失败 |
| check vs export | check 校验；export 有损投影 |
| L1 / L2 | L1 显式契约；L2 入口 may-throw；ignoreThrows ≠ L1 |
| 不发明 body-AST 槽位 | 义务只来自契约或调用点事实 |
| HOF promote ≠ check error | body 用法提升只是警告建议 |

## Day 0 / Day 1 命令

```bash
npx nudojs check <path>
npx nudojs contract <path>
npx nudojs contract --draft <path> [--write]
npx nudojs export <path> --format dts --out dist/types
npx nudojs health <path>
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

参见 [Limits](/docs/concepts/limits) · [术语表](/docs/reference/glossary) · [Recipes](/docs/guides/recipes)。
