---
"@nudojs/service": patch
---

fix(service): `absModuleCache` 命中校验不再对宿主 custom loader 磁盘盲。loader 接管的依赖模块（磁盘存在 + loader 覆写内容，LSP 未保存 buffer 的典型形态）自身命中条件从「stat mtime+size 严格相等」改为「loader 当前内容 hash == 插入时实际求值源码 hash」——buffer 内容 A→B 而磁盘未动时不再陈旧返回 A 的旧导出；loader 不接手该路径（undefined）回落 stat，loader 抛错按 miss 重装载（宁冷勿陈旧）；默认 loader（未传 `opts.loadModule`）行为零变更，stat 快路径保留。命中校验取过的 loader 内容在 miss 重装载时复用（同参不二次调用）。当时记录的传递依赖残余（子树指纹仍按磁盘复核）由紧随的 loader 感知子树指纹修复 changeset 补齐。
