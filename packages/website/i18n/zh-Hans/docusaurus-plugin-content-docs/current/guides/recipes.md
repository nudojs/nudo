---
slug: /guides/recipes
description: 任务配方 —— CI 门禁、渐进契约、monorepo、export、agent。
---

# Recipes

任务型 how-to。模式：**目标 → 步骤 → 验证 → 陷阱**。

## 1. 用 `nudo check` 门禁 CI

**目标：** 契约或入口 throws 破坏时让流水线失败。

```yaml
# .github/workflows/nudo.yml
jobs:
  nudo:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm i -g nudojs
      - run: nudojs check src/
```

**验证：** 干净树上 `npx nudojs check src/` 退出 `0`；L1/L2 错误时退出 `1`。

**陷阱：** `--ignore-throws` 只过滤 L2。优先修契约，而不是静音 L1。完整旗标：[check](./check.md) · [CLI 参考](../api/cli-reference.md)。

## 2. 在现有包上渐进加契约

**目标：** Day 0 观察 → 草稿 → 手写侧车 → CI。

```bash
npx nudojs check src/                 # 签名 + L2
npx nudojs contract --draft src/lib.js
npx nudojs contract --draft --write src/lib.js --fn importantFn
# 审阅 lib.nudo.draft.js → 拷入 lib.nudo.js
npx nudojs check src/lib.js
```

**陷阱：** 草稿不会 ambient 加载；手写优先于 `@generated`。指南：[contract](./contract.md) · [migrating-js](./migrating-js.md)。

## 3. Monorepo：与 tsserver 并排的分析范围

```json
{
  "nudo": {
    "analysis": {
      "mode": "exports",
      "include": ["packages/js-lib/src/**"],
      "exclude": ["**/*.test.ts", "packages/ts-lib/**"]
    }
  }
}
```

JS 包 → Nudo LSP + `nudo check`。TS 包 → `tsc`。详见：[共存](./coexistence.md)。

## 4. 为 TS 消费者导出类型

```bash
npx nudojs export src/api.js --format dts --out dist/types
npx nudojs export src/api.js --format schema --dialect zod --out dist/schema
```

投影是**有损的**；Abs + `nudo check` 仍是真源。指南：[运行时生成](./runtime-generation.md)。

## 5. Mock 边界 + env

```javascript
/// @nudo:env node
// @nudo:mock fetch = (url) => ({ ok: true, json: () => ({ id: 1 }) })
```

需要包形 API 时收割：`npx nudojs env harvest <pkg>`。Env 不是 mock 的替代品。见 [env-harvest](./env-harvest.md) · [边界](../concepts/limits.md)。

## 6. 教 AI agent 认识这个仓库

给编码 agent 的粘贴块：

```text
Read https://nudojs.github.io/nudo/docs/reference/agents
Then: npx nudojs check src/
Contracts are *.nudo.js / @nudo:refine. Do not invent body-AST obligations.
@nudo:case is debug-only.
```

更多：[Agents](../reference/agents.md) · [Agent integration](./agent-integration.md) · [API · agent](../api/agent.md)。

## 7. IDE inlay + CodeLens

安装 **nudo-vscode**（或 Zed 扩展）。默认分析模式 `"exports"`。见 [VS Code](./vscode.md) · [LSP 客户端](./lsp-clients.md)。

## 8. 快速读懂 check 输出

```text
signatures
  getName(user: any) => any  throws TypeError
issues
  [ERROR L1 getName] getName (export): may throw TypeError  (nudo:entry-may-throw)
```

`any` = 无约束入口。`throws` = L2 域。诊断码：[诊断](../reference/diagnostics.md)。

---

## 下一步

- [快速开始](../getting-started/quick-start.md)
- [nudo check](./check.md)
- [nudo contract](./contract.md)
- [术语表](../reference/glossary.md)
