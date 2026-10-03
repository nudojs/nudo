---
"@nudojs/service": patch
---

fix(service): `absModuleCache` 子树内容指纹不再对宿主 custom loader 磁盘盲——补齐 loader-aware 命中修复（上一条 changeset）记录的传递依赖残余。依赖指纹条目从只存 `path` 扩展为携带装载询问证据 `via = { spec, fromFile }`（无条件记录：该对恒已知，条目不存 loader 引用）：带 loader 复核时按原询问对重问**当前** loader 比对内容 hash——loader 覆写**传递**依赖（LSP 未保存 buffer）的两个方向都不再陈旧：编辑方向（buffer A→B 磁盘未动）与接管方向（首轮磁盘装载、loader 新近接手）；loader 不接手（undefined）回落磁盘内容比对（该依赖此刻本就从磁盘装载），loader 抛错 / 依赖被删按 miss 重装载（宁冷勿陈旧）；loader 虚拟内容与磁盘不一致但稳定时，子树从「永久 miss」转为正常命中（复核按 loader 当前内容）。默认 loader（未传 `opts.loadModule`）行为与性能零变更：无 loader 时子树复核纯磁盘读取，stat 快路径保留（既有计数护栏钉住）。公共类型 `AbsModuleDepFingerprint` 新增可选字段 `via`（向后兼容，不构成 minor）。
