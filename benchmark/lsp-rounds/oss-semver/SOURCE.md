# Provenance — 真实开源历史 bug 切片

| 项 | 值 |
|----|----|
| 上游 | https://github.com/npm/node-semver |
| 形态 | 纯 JS 多文件模块图（classes / functions / ranges / internal） |
| 切片规模 | ~2.4k LOC · 40+ 文件 |
| 回放方式 | 在当前 HEAD 上**反向应用**下列 **最近** fix 提交（逻辑回灌） |
| 时间窗 | **≥2025-09**（优先 2026 上半年）— 压低模型训练污染 |
| 验收 | 上述 fix 提交自带 fixture 的蒸馏（node:test，`bug#N`） |
| 对照 | 类型面 bug 若存在会走 LSP；纯语义坑两侧同难（噪声对照） |
| 网络 | 夹具构建/评测 **禁用 web**；仅本地 git 回灌 |

## 回灌的 fix 提交

| bug# | commit | 日期 | 标题 | 主文件 |
|------|--------|------|------|--------|
| 1 | `5f3ca13` | 2026-05 | fix: handle prerelease bounds in subset (#867) | ranges/subset.js |
| 2 | `9c8692a` | 2026-06 | fix: include prereleases in tilde range lower bound with includePrerelease (#878) | classes/range.js |
| 3 | `046da7f` | 2026-06 | fix: align caret includePrerelease lower bounds (#872) | classes/range.js |
| 4 | `e583226` | 2026-06 | fix: reject numeric segments after x-ranges | classes/range.js |
| 5 | `bea6028` | 2026-06 | fix: increment dotted prerelease identifiers (#870) | classes/semver.js |
| 6 | `2471d75` + `17aa702` | 2025-09 + 2026-05 | x-range build metadata / strip build before comparator trim | classes/range.js |

> bug#6 同时反了 `2471d75` 与 `17aa702`：后者在 `parseRange` 全局剥 build，会掩盖前者
> 在 `parseComparator` 的缺口；两处都去掉才能让两类样例同时红。

## 为什么是这张模块图

- **多文件真实依赖**（SemVer / Comparator / Range / subset / inc），不是 8 坑玩具面。
- **约束域**（range ⊆ range、prerelease 边界、inc 序列）贴近 Abs 代数的主战场。
- **历史真 bug、有 fixture**，不是自造注入；fix 文案里的「不变式」写进 issue 简报。
- 缺陷切在 2025-09→2026-06 的真实提交上，训练污染面相对可控（仍可能有背题风险，报告需注明）。

## 重建（生成物不进仓）

`starters-oss-semver/` 是 **gitignore 的生成物**。上游 ISC 源码不 vendoring；
仓库里只有反向补丁、验收测试、issue 文案。

```bash
git clone https://github.com/npm/node-semver /tmp/nudo-oss-candidates/semver
node benchmark/lsp-rounds/oss-semver/build.mjs /tmp/nudo-oss-candidates/semver
```

评测前先跑 build；`harness/run.mjs --task oss` 假定 starters 已生成。
