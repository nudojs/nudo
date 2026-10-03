---
"@nudojs/service": patch
---

fix(service): `findProjectConfig` 增加目录链 memo——条目记录向上查找访问过的每个 package.json 的 mtimeMs+size（无文件记 absent），命中只做链上 stat 比对，不再每次 existsSync + readFileSync + JSON.parse（LSP 每次 getCachedOrAnalyze / validateText 都会调它）。链上任何 package.json 新建/改写/删除（含 absent↔存在翻转）自动 miss 重算；`clearAnalysisSessionCaches` 显式清空（`evictProjectConfigMemo`，项目配置 watch 通道），覆盖「同 size + 同 mtime」极端写入。新增诊断导出 `projectConfigMemoStats`（条目数 / 实际读盘次数）。
