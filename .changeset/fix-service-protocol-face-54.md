---
"@nudojs/service": patch
---

族 54 · service 协议面收口（3 条中的 2 条；第 3 条在 nudojs 包，见下）。

**Bug 697（env 模板族扩展名表）** — `isEnvTemplatePath` 的 mock 两支
（`mock-<name>.<ext>` / `<name>.mock.<ext>`）只认 `js|mjs|ts`，而 `.env.<ext>`
分支认 `js|mjs|ts|cjs|cts|mts` ⇒ 族内两支各写各的扩展名表 ⇒ `mock-foo.cjs` /
`fs.mock.cts` / `x.mock.mts` 这类 env 模板**不进 watch 门禁** ⇒ 模板改动
不触发依赖源文件复分析。改为三支**同表**（`js / mjs / ts / cjs / cts / mts`）；
mock 前缀支同时锚到 **basename** 起点（相对路径形态 `mock-foo.js` 同样成立）。
非模板路径判定逐字不变。

**Bug（族 54 / item 2：hover 的 throws 段在两种状态下仍缺）** — hover 只读
case 台账的 throws 证据（`AnalysisResult.functions[].cases[].throwsAbs`），
而函数级 throws 域（check 签名行口径 = 入口求值的 hard throw ∪ soft
may-throw）的唯一载体是 `entry@` 见证 ⇒ 两种状态下证据随见证一起消失 ⇒
IDE 的 throws 段与 `nudo check` 的签名尾缀分叉：

- **有调用点见证**：`settleEntryOnlyCandidates` 把 `entry@` 见证连同 throws
  证据一起撤掉、改由 `call@` 见证承担调用点域 ⇒ 证据无处安放；
- **模块级调用点路径**：该路径**从不**产 `entry@` 见证（调用点域直接接管）
  ⇒ 同样无处安放；
- **选中 case**（LSP selectCase）：被选函数**不生成** `entry@` 见证（域由
  选中的那条 case 声明）⇒ 同样无处安放。

改为：入口域的 throws 证据并进该函数**已有**的见证（并集；见证数不变、
推断域不变 ⇒ 产物面 / 固化面 / 报告台账的形状都不动）。补证据时只跑**只取
证据**的入口求值（不产见证 / 不改域 / 不报诊断 / 不并入调用点台账），且只对
**导出**函数补（入口面口径 = 导出函数，与 hover / check 同源）。
`nudo test` 的 "all" 模式不在补证据范围内 ⇒ 报告面不变。

**未收口（第 3 条，跨包）** — 台账里的「`migrate verify` 库面整批 abort」
实测**已不成立**：`migrateVerify`（`packages/nudojs/src/migrate.ts`）早已逐
文件隔离（同目标内部分文件语法错 ⇒ 失败文件记 `analysis-error`、成功文件照常
返回）。仍整批 abort 的是同族的 `migrateStrip`（696 的库面半边：
`planStrip` → `makeStripPlan` 遇解析错即 throw ⇒ 同目标内其它文件的成功结果
全丢）—— 该文件在 **nudojs** 包（另一分片的范围），本片未改。
