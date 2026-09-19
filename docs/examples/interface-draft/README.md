# interface-draft — 代码优先契约草稿

从**已有逻辑**生成可审阅的 `*.nudo.draft.js`（不 ambient 绑定）。审阅后复制进 `*.nudo.js` 才成为契约。

```bash
pnpm run contract --draft docs/examples/interface-draft/greet.js
pnpm run contract --draft --write docs/examples/interface-draft/greet.js  # → greet.nudo.draft.js
```

本目录钉住：

| 证据 | 函数 | 草稿行为 |
|------|------|----------|
| callsite | `double` | `fn({ x: … }, …)` 投影 |
| body-read | `greet.user` | 注释 / suggested shape，**export DSL 不发明义务** |

手写契约永不被 draft 覆盖。IDE：CodeLens `⚡ draft interface`；agent/LSP 命令名 `nudo.contract.draft`；CLI 正门是 `nudo contract --draft`。

可选诊断：`nudo.analysis.evalMissingSlot: "warning"`（默认 off）见 `docs/design-limitations.md` §1.0b / `docs/design-cli-semantics.md` §7。

端到端演示（临时目录：盘点 → draft → 接受 → check）：

```bash
pnpm run migrate-demo          # bash scripts/migrate-demo.sh
pnpm run migrate-demo -- --keep
```

指南：[`guides/migrating-js.md`](../../../packages/website/docs/guides/migrating-js.md)。
