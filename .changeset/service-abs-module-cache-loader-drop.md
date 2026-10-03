---
"@nudojs/service": patch
---

fix(service): `absModuleCache` 自身命中的 loader 弃管方向不再陈旧——custom loader 曾覆写某路径（LSP 未保存 buffer）、随后不再接管该路径（buffer 未保存即关闭回退磁盘）时，回落分支此前只比磁盘 `mtimeMs+size`，条目里的 buffer 版导出会在磁盘 stat 未动时被陈旧命中。现在 `opts.loadModule` 在场且 loader 不接手的路径在 stat 相等后再补「磁盘内容 hash == 插入时求值源码 hash」复核（读出的磁盘内容进 preloaded，miss 重装载复用不二次读盘）；默认 loader（未传 `opts.loadModule`）保持纯 stat 快路径零退化。回归：buffer 覆写 v=2 → loader 弃管 → 必回磁盘真值 v=1（修复前红：陈旧返回 2）。
