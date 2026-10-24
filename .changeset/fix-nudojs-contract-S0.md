---
"nudojs": patch
---

refactor(nudojs): `nudo contract` 的三个分支函数拆到同包内部模块（**行为零变化**）

族 20 · S0（串行前置重构）。`packages/nudojs/src/commands/contract.ts` 里
按分支天然分块的三个函数，搬到**同包内部模块**：

- `runContractDraft` → `packages/nudojs/src/commands/contract-draft.ts`
- `runContractEmit` → `packages/nudojs/src/commands/contract-emit.ts`
- `runContractFromDts` → `packages/nudojs/src/commands/contract-from-dts.ts`

`contract.ts` 只保留 `registerContractCommand`（**唯一导出**）+ `runContractPrint`
+ action（含 per-root 循环）。

- **函数签名逐字不变**（参数、返回类型、行为全部不变）；函数体逐字搬移。
- **零新增公开导出**：`packages/nudojs/src/index.ts` 一行未动；`nudojs` 的
  `exports` 仍只有 `"."` ⇒ 三个新模块**不在公开面上**。
- **行为零变化**：同一批夹具（`nudo contract` 的 print / `--json` / `--draft` /
  `--draft --json` / `--emit` / `--emit --dry-run` / `--from-dts` 七个形态）
  改前 / 改后各跑一遍，**stdout / stderr / exit code 逐字零差异**。
