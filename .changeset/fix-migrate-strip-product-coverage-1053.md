---
"nudojs": major
---

**BREAKING**: `nudo check` 的**同 stem 选源规则**变了 —— 同名 `.js` 产物现在
**胜出**于同名 `.ts` 源 ⇒ 源不再被门禁覆盖（此前门禁查的是源）。

谁会坏：仓库里**同时**提交了 `foo.ts` 与编译产物 `foo.js`（且该 `.js` **不是**
`nudo migrate strip` 产物）的工程 —— 门禁现在分析 `foo.js`，`foo.ts` **不再**被
分析 ⇒ 只写在 `.ts` 里的契约 / 指令**不再**被门禁看到（覆盖静默丢失）；分析对象
也换了 ⇒ 诊断集合可能变化。

怎么迁移：让 `foo.js` 与 `foo.ts` **同源**（用 `nudo migrate strip` 的产物，或
删掉其中一个）；本版本**尚未**落产物清单（marker）来区分「strip 产物」与「同名
的另一个模块」，因此同名 `.ts` / `.js` 并存的工程需要自己消歧。

fix(nudojs): `migrate strip --write` 的产物 `.js` 不再被 `nudo check` 跳过（发布物零覆盖 ⇒ 假绿）

**现象**：`nudo migrate strip --write` **默认保留源 `.ts`** ⇒ 迁移过渡期
（strip → retire 之间）目录里 `.ts` 与 `.js` **并存**是常态 ⇒ `nudo check`
（= `migrate retire` 装到 CI 上的门禁）**跳过同 stem 的产物 `.js`** ⇒
**真正发布出去的产物零覆盖**（假绿）；且与 `migrate verify` 对同一包给出
**相反结论**（verify 红 / check 绿）。

**根因**：目录扫描的「同 stem 只分析一份」规则把「取哪一份」**硬编码成
`.ts`**（迁移**前**的事实源：带类型标注 ⇒ 推断更准）⇒ 迁移过渡期恰好取
**错**的那一份。

**修法**（`packages/nudojs/src/commands/shared.ts` · `collectNudoFiles`）：
同 stem 冲突时**产物（发布物）胜出** —— 同目录存在同名产物 ⇒ 源被产物取代 ⇒
门禁查**要发布的东西**；源单独存在时照旧分析源。

- **不变式保持**：一个模块 ⇒ **一次**分析（源被压掉，不是两份都分析）⇒
  `summary.errors` / `functions` / `files` 不翻倍。
- **契约不丢**：strip 保留注释 ⇒ `@nudo:contract` / `/// @nudo:import` 在产物里
  仍然生效 ⇒ 产物侧的契约面与源侧同强度。

**行为变更（请注意）**：

1. 同 stem 的 `.js` 若**不是** strip 产物（例如手写的旧模块、或被提交进仓库的
   编译输出），现在被分析的是 `.js` 而不是 `.ts` ⇒ 源不再被门禁覆盖。要区分
   「产物」与「同名的另一个模块」需要 strip 落一份产物清单（marker），本次未做。
2. `.mts` / `.cts` 源（它们**本身不是**分析目标）的产物 `.mjs` / `.js` 现在
   **会被分析**；改前这类产物被「同名源存在 ⇒ 跳过」规则连坐 ⇒ 该模块被分析
   **0 次**（零覆盖）⇒ 现在补上。
