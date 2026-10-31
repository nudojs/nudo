---
"nudojs": patch
---

Fix bug-report category 11 (`nudo contract` command layer).

- BUG-042: `contract --draft --fn <name>` for a non-existent export is no longer a
  silent no-op (exit 0 with an empty draft); it now mirrors `--emit` and exits 1 with a
  usage error listing the available exports.
- BUG-100: `contract --from-dts` no longer silently swallows `--emit` / `--fn` / `--all` /
  `--dry-run` / `--exit-on-diff`; the flags are honoured, so the drift gate is no longer
  permanently green.
- BUG-122: `contract --emit`'s derived branch and main branch no longer write the same
  sidecar with divergent formats, so `--dry-run` diffs match what is actually written and
  `--exit-on-diff` no longer exits 1 forever.

Regression tests: `cli-bug-042-*`, `cli-bug-100-*`, `cli-bug-122-*`.

### BUG-196：`nudo contract --emit` 的根侧车改为**单写者 + 同源判定**

**根因**：`emitDerivedFromRoot(...)`（派生分支，段文本 4 行含 `// derived-from:`）与
`emitInterface(...)`（直写分支，段文本 3 行）在同一次运行里写**同一个侧车的同一段**；后写的直写
分支把溯源行整段抹掉 ⇒ 净变化为零却报 `Updated`；而 dry-run 比对按「未抹掉的版本」算 ⇒ 预览
要求加那行、真实写盘从不产生 ⇒ `--exit-on-diff` 恒 exit 1（漂移门禁永不收敛）。

**修法**（先让「最终文本」成为结构上的事实，再让判定 / 预览 / 落盘都用它）：
- `interface-emitter.ts`：`EmitInterfaceResult` 增 `finalContent`（含 BOM，与真实落盘逐字节相同）
  —— 调用方不再需要从 `diff` 反解自身产物（CLI 里原先的 `applyUnifiedDiff` 已删除，约 110 行）。
- 直写分支一律 `dryRun: true`（只算，不写）；派生分支以直写分支的 `finalContent` 为
  `baseContent`，对**直写分支负责的段**（`directSections`）只并 `// derived-from:` 标签行、
  不整段覆盖；根侧车由 CLI **一次原子写入**（派生分支 `skipWrite`）。
- `changed` / `Updated` / dry-run 预览 / 落盘全部用同一份最终文本（逐字比较）⇒ 幂等。

**口径变化（重钉）**：`cli-bug-122-emit-net-effect.test.ts` 原先钉的是缺陷行为（首跑侧车不含
`// derived-from:`、干净夹具 dry-run exit 0），现按 section 改为：首跑落盘含溯源行、内容真变才报
`Updated`、干净夹具首跑 dry-run 正确报漂移（exit 1）而真写一次后 exit 0。

**残留**：LSP agent 面（`packages/lsp/src/agent-tools.ts`）的旧「派生 → 直写」双路顺序已收口
（见下文「BUG-196 残留收口」）。`packages/service/dist` 需 `pnpm run build` 后才有新语义
（`writeSrcTsconfig` 的测试钉源码）。

### BUG-196 残留收口：LSP agent 面改单写者（同源组合，CLI 口径一致）

上一节记录的残留（LSP agent 面仍是「派生 → 直写」双路顺序）已收口，改动全部在 `packages/lsp/src/**`。

**根因**：`packages/lsp/src/agent-tools.ts` 的 `serializedEmit()` 沿用旧顺序 ——
先 `emitDerivedFromRoot`（**写盘**，派生段 4 行含 `// derived-from:`），后 `emitInterface`
（**重写同一段**，3 行、无溯源行）⇒ 溯源行被抹掉、净变化为零却报 `Updated`；预览与真实写盘相反。

**修法**（与 CLI `runContractEmit` 同构）：直写分支**恒 `dryRun: true`**，其 `finalContent` 作合并基底；
派生分支以它为 `baseContent`、`skipWrite: [根侧车]`、`directSections: 直写分支负责的段`
⇒ 只把 `// derived-from:` 标签行并进直写段（正文以直写为准），下游侧车仍由派生分支拥有；
根侧车文本 M = 派生结果 ?? 直写结果（BOM 守卫）⇒ **一次原子写**（tmp + rename）；
`changed` / `written` / `diff` 全部由 M 与写前字节比较得出（直写 `written` ∪ 根侧车派生的 `writtenNames`），
根侧车的派生条目不再重复报「Updated」。

**重钉**：无。新增回归 `lsp-bug-196-single-writer-sidecar.test.ts`（4 例）：update 模式保留直写正文 +
保留 `// derived-from: lib.js:tag` + 收敛后内容逐字节一致 + **只写一次**（统计 `renameSync` 次数）；
第二跑无写盘、无「Updated」；dry-run 预览与真实写盘逐字相同；add 模式保留直写正文且只写一次。

**残留（已收口）**：LSP **add** 模式下，service 的「既有段不可动」规则使 `// derived-from:` 标签并不进
本轮刚追加的段 —— 基底（= 直写分支产物）里已经有该段，派生分支把它当成「既有段」跳过。
现由 `emitDerivedFromRoot` 的 `directCreatedSections` 判据区分「本轮直写分支新建」与「此前既有」
（详见 cat-14 changeset「BUG-196（add 面）」）：add 面只对本轮新建且直写负责的段**就地**并入溯源行，
既有段仍原样不动（不强制 update ⇒ 不会顺带刷新下游侧车的既有派生段）；收敛后 add 与 update 写出的
根侧车逐字节相同。
