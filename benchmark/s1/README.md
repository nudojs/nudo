# S1 — monorepo cold / warm / edit 基线

中型 monorepo 的采用延迟证据（`docs/design/plans/2026-09-19-close-remaining-dx-gaps.md` S1 / A6）。

```bash
pnpm run benchmark:s1
pnpm run benchmark:s1 -- --regen   # 强制重建语料
pnpm run benchmark:s1 -- --quick   # 低采样档（慢宿主；默认采样次数不变）
```

**ABS-16 真实 monorepo 基准**（语料 = 本仓自身，纯内存 edit，不写你的文件）：

```bash
pnpm run benchmark:s1:real          # 完整采样
pnpm run benchmark:s1:real:quick    # 低采样档（首测用）
# 任意真实仓库：pnpm run benchmark:s1 -- --corpus /path/to/repo
```

- 报告：`docs/reports/s1-perf-baseline-real.{md,json}`（**不覆盖**生成式基线）
- 额外产出：主机信息（node / CPU / 内存 / 峰值 RSS）、`fn-summary` 两层缓存的
  **命中率遥测**、以及被跳过的 bundle 文件数（> 256 KiB 视为构建产物，如实计数）
- `--quick` 只减少重复次数，报告会写明各相的 `n`；默认档的 3/5/3/8/10 次采样不变
- edit 目标从模块图动态挑（hub = 最大扇入 / mid = 中位数 / leaf = 零扇入）

- **语料**：`generate-corpus.mts` 确定性生成到 `.corpus/`（gitignore，**不进仓库**）
- **报告**：`docs/reports/s1-perf-baseline.md` + `.json`（生成物，可提交）

| 测什么 | 含义 |
|---|---|
| analyze all cold | 空缓存全量（首次打开） |
| analyze all warm | 会话缓存命中再跑 |
| check all warm | `checkSource` 门禁路径 |
| edit leaf/mid/hub | 小编辑 → dirty 集重析（LSP/watch） |
| live editor 1 | 内存 buffer 编辑后单文件 analyze/check |

单文件合成负载与 tsc 对照见 `benchmark/micro/`。  
**真实 OSS 包**（非合成）冷分析 / check / hub-edit / L1 零误报见 [`../oss/`](../oss/)。
