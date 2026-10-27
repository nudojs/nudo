---
"nudojs": patch
"@nudojs/core": patch
---

Fix bug-report category 09 (`nudo check` gate) — 10 of 15 defects.

- BUG-046: a variadic flag no longer silently consumes the following path; a value the
  flag cannot accept that exists on disk is reported as a usage error, so `check
  clean.js --only <code> broken.js` no longer exits 0 with `broken.js` unchecked.
- BUG-047: `check --fix` advances its plan text outside the `--write` branch, so a second
  hunk is `@@ -1,2 +1,3 @@` instead of a conflicting `@@ -0,0 +1,2 @@`, and dry-run output
  matches `--write`.
- BUG-048: `--only` values are validated against the diagnostic registry (unknown codes
  are a usage error; valid-but-unmatched codes are reported) instead of silently
  producing `0 edits`.
- BUG-049: a sidecar write failure is reported (`check --fix cannot write <path>`) instead
  of aborting the whole run with a bare `EACCES`.
- BUG-066: `--quiet` is evaluated before `--abs`, so `--abs --quiet` prints one line
  instead of the full signature block.
- BUG-067: `--fix` refuses to write a sidecar that would conflict with a sibling file
  (`.js` / `.mjs`, `.ts` / `.mts`) and names the sibling.
- BUG-115: the `--json` envelope gains an unambiguous `summary.pathErrors`, so path
  failures are readable from the summary (the green shape is unchanged).
- BUG-264: `sidecarPathOf` strips `.d` **after** `.nudo`, so a `.d.ts` source yields
  `api.nudo.ts` (and a `.nudo.draft.ts`-style draft) instead of a `.d.` name that
  TypeScript treats as a declaration file.
- BUG-284: hard errors (input read failures / syntax errors) feed both CI channels, so
  `--gitlab` always emits exactly one parseable array and `--gha` emits `::error`.
- BUG-285: GHA annotations move to stderr when GitLab owns stdout, so `--gha --gitlab`
  emits its `::error` lines instead of dropping them.

Regression tests: `cli-bug-046-*`, `cli-bug-047-*`, `cli-bug-048-*`, `cli-bug-049-*`,
`cli-bug-066-*`, `cli-bug-067-*`, `cli-bug-115-*`, `cli-bug-284-*`, `cli-bug-285-*`,
`core-bug-264-sidecar-dts-name`.

Known follow-ups NOT covered here: BUG-014 (needs `commands/test.ts`), BUG-015 / BUG-114
(need `migrate.ts`, handed to the migrate category), BUG-262 (needs
`packages/lsp/src/validation.ts`), BUG-056 (needs per-round module isolation; `check`
still prints `bump() => 2`).

### BUG-056 诊断追加（未修复，定位已收窄）

同文件在同一进程被求值两轮时，闸门读到被上一轮写脏的结果（`bump() => 2`，原生 `1`；
连带 `main() => 11`、`once() => 1`、`nudo:interface-drift` 把干净侧车判成陈旧）。

已排除（逐一实测，均无效）：

- service `evictAbsModuleCacheFiles` / `evictEvalCacheForFiles`：驱逐前后
  `getAbsModuleCacheSize()` 都是 `0`、`getEvalCacheSize()` 由 `1` 归 `0`，闸门仍是 `2`；
- core `evictGeneralizeMemoForPaths`：仍是 `2`；
- core `resetNudoModuleExecCache`（侧车模块执行表）：仍是 `2`。

已定位的方向：**`checkSource` 的整文件 memo**（`packages/core/src/algebra/check-memo.ts`）。
探针（同一进程内先跑分析器再跑闸门）在每次 `checkSource` 前 `resetCheckSourceMemo()`
后结果稳定为 `1`（不重置则 `2`，且第二次调用仍 `2`）⇒ 陈旧 `CheckReport` 被跨轮复用，
不是模块实例泄漏。收口方向 = 在 CLI 轮边界按路径驱逐
`evictCheckSourceMemoForPaths([filePath])`（该 API 已从 `@nudojs/core` 导出，无需动
public-api 快照）；未落地的原因是上述探针全部跑在**修复前的 `dist/`** 上（`@nudojs/*`
经 package `exports` 解析到 `dist`），需要在源码构建上复核后再改 —— 否则无法区分
「memo 陈旧」与「模块实例脏」两种成因。

### 追加：BUG-056 已修（根因与落法）

根因（实测确认，不是推测）：`packages/core/src/algebra/generalize.ts` 与
`check-may-throw.ts` 各有一张 `evalRunMemo`，缓存的是**活的 run 表**——模块级 `let` 状态
**和对象身份**都住在里面；键**只有 source（+ mock scope + inject 指纹）**，没有路径、
没有轮次。后果：

- 分析器一轮 generalize 与闸门一轮共用同一实例 ⇒ `bump() => 2` / `main() => 11` /
  `once() => 1`（同一文件在同一进程里被读作 1 / 2 / 3，字节相同的两个不同文件也共用）；
- `contract --emit` 写分析器的干净值、`check` 打印被污染的值 ⇒ `nudo:interface-drift`
  永不收敛（health 永久假红，重跑 `--emit` 无法自愈）。

落法：引入单调**求值轮次**（`collector-scope.ts`），最外层 `runWithCollectorScope` 创建
作用域时涨轮；两张 run 表的键都带轮次前缀 ⇒ 跨轮不复用活状态；**不做整表作废**（整表
作废会让轮内的对象身份变化，递归泛化的 term 指纹随之坍缩成 `unknown`）；`resetGeneralizeMemo`
同时清 run 表。已排除的无效方案（逐条实测）：service `evictAbsModuleCacheFiles` /
`evictEvalCacheForFiles`、core `evictGeneralizeMemoForPaths`、`resetNudoModuleExecCache`、
按路径驱逐 `checkSource` 报告 memo —— 全部无法触及这两张表。

回归：`core-bug-056-eval-round-identity.test.ts`（3 例：分析器轮之后闸门仍读 1、字节相同的
第二个文件各自读 1、同一文件重复分析每次读 1）；CLI 侧 `cli-bug-056-check-single-eval.test.ts`
钉住 `bump() => 1`、`once() => never throws Error`、无 `nudo:interface-drift`。

### 追加：BUG-085 已修（`--abs` 观测面吃 `@nudo:assume` 前提）

根因不在 core 的假定折叠，而在 **CLI 观测面没喂前提**：`nudojs/src/commands/shared.ts::
runAbsView` 直接 `tryEvalCall(...)`，`@nudo:assume d <= max` 从未进入求值。

落法（关键点：喂**前提槽**，不是 `phi`）：每个待观测函数先从
`extractAssumeSegs(source, fnName)` 取 `ok` 段，折成 `ale(v(lhs), v(rhs))` 后
`withAssumePremises(phi, () => tryEvalCall(...))`。`div` 的关系折叠只读
`assumePremiseList(assume)`（`core/algebra/arithmetic/muldiv.ts:141`），而前提槽在调用边界
会被清空；折进 `phi` 会既拿不到谓词、又把前提泄漏给被调方（不健全）。

回归：`nudojs/src/__tests__/cli-bug-085-abs-assume-premises.test.ts`（3 例）——
`check --abs` 打印 `pred: /(d, max) ≤ 1`（此前缺失而 `--json` 已给出 `where`，两面不一致）、
无 assume 行的对照两面都无谓词、`nudo test --abs` 同源同结论。

### 追加：CLI fail-closed 判据改为「可见性」，诊断按标签分两条通道

`packages/nudojs/src/commands/check.ts`：per-file collector 由「只收 `internal`」改为
「`internal` **或** `gateFatal === true`」（plain check 与 `--fix` 两处采集点同口径），
并把诊断拆成两条：

- `internal`（引擎 / 宿主边界违约）⇒ `nudo:internal` + 「报引擎 bug」文案（既有）；
- 装载期逃逸的**用户代码**异常（标签 `module-throw` 且 `gateFatal === true`）⇒
  `nudo:module-throw` + 指向**用户代码**的文案（BUG-073：不得让用户去报引擎 bug）。

这补上 BUG-072 在 CLI 侧的最后一个缺口：**无句法证据**的装载失败（模块顶层
`JSON.parse(userInput)`、顶层调用会抛的导入函数）此前零诊断 + exit 0（**假绿**），现在按
`gateFatal` 判红。`unsupported:*`（能力边界）与建模内 `NudoThrow` 的
`gateFatal === false` ⇒ 仍不入闸门（假红防线不变，1145 的 unsupported 用例守反向）。

### 重钉：BUG-264 带来的落点改名（`.d.ts` 源的草稿名不再含 `.d.`）

BUG-264 修了「`.d.ts` 源的侧车 / 草稿名含 `.d.` ⇒ TypeScript 判成声明文件 ⇒ TS1254」，
把落点从 `api.d.nugo.draft.ts` / `api.d.nugo.ts` 改成 `api.nugo.draft.ts` / `api.nugo.ts`。
该修复落地时**只更新了 core 侧自己的钉**，漏了 3 个 nudojs 侧的旧断言 ⇒ 它们的期望仍写着旧拼写。

按 BUG-264 的权威规格重钉（**保留旧拼写等于把 BUG-264 重新引回来**）：
- `cli-bug-659-from-dts-usage-order.test.ts`：`types.d.nudo.draft.ts` → `types.nugo.draft.ts`
  （「CWD 里的同名草稿不存在」那条断言未动）。
- `cli-bug-944-from-dts-write-path.test.ts`（3 处）：落点、`next` 提示里的侧车名、拒绝覆盖提示里的路径
  全部改成 `types/index.nugo.draft.ts` / `types/index.nugo.ts`（CWD 无同名草稿、既有草稿逐字不变
  等行为断言未动）。
- `nudojs-bug-1147-contract-cli-text.test.ts`（3 处）：共享的 `draftPathOf` 辅助函数改成新落点
  （拒绝提示双口子 / 人工改过永不被覆盖 / `--force` 覆盖成功三条的语义断言未动）。

新增 `cli-bug-944-from-dts-draft-invariants.test.ts`（7 例）：钉**规则**而不是拼写 —— 落点贴着源
`.d.ts` 且 basename 不含 `.d.`、「next」侧车名不含 `.d.`（旧名不得出现）、目标已存在 ⇒ 拒绝覆盖
（exit 1 + `--force` 与 `NUDO_DRAFT_FORCE` 双口子 + 提示含 `hand-edited` + 既有草稿逐字不变 +
不谎报 `wrote `）、内容未变 ⇒ 不拒绝、`--force` 与 `NUDO_DRAFT_FORCE` 各自可覆盖机器原稿、
人工改过的草稿 `--force` 也不放行。

**零源码改动**：实现的落点、拒绝、双口子与「人工改过不覆盖」规则本就符合 944/1147 的规格
（逐条手测复核过），只有断言的**拼写**过时。

**残留**：① `--from-dts --write` 在没有 `package.json` 祖先目录时**无项目根守卫**，
而 `--draft --write` 在同场景要求 `NUDO_DRAFT_FORCE=1` —— 944/1147 夹具（无 `package.json`）钉住
前者成功 ⇒ 对齐会与被钉住的行为冲突，故未动；
② `--from-dts --write --dry-run` 在既有草稿不同时**拒绝**（exit 1）而非给 diff 预览，
与 `--draft --write --dry-run` 不一致（未动）。
