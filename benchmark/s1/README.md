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
  ⚠️ **2026-11-12 口径订正**：该首测的 cold 102.8s 里 44.2% 来自误纳入语料的
  `packages/vscode/out/extension.js`（15 KiB esbuild bundle），宿主 `NODE_OPTIONS` 注入的
  fs-broker shim 又让磁盘密集的 harness 放大约 2×。**旧文件保留不覆盖、不再引用其数字**，
  结论与 A/B 见 `docs/design/plans/2026-11-09-abs-improvement-plan.md` §5。
- 额外产出：主机信息（node / CPU / 内存 / 峰值 RSS）、`fn-summary` 两层缓存的
  **命中率遥测**、以及被跳过的 bundle 文件数（> 256 KiB 视为构建产物，如实计数）
- `--quick` 只减少重复次数，报告会写明各相的 `n`；默认档的 3/5/3/8/10 次采样不变
- edit 目标从模块图动态挑（hub = 最大扇入 / mid = 中位数 / leaf = 零扇入）

**干净口径（2026-11-12，推荐引用）**：

```bash
pnpm run benchmark:s1:real:clean
# = 清掉 NODE_OPTIONS 后起测量进程 + --clean-corpus（额外跳 out / tmp / .docusaurus）
#   + --report clean；报告另存，不覆盖任何既有基线
```

- 报告：`docs/reports/s1-perf-baseline-real-clean.{md,json}`，头部记录 **host env**
  （`NODE_OPTIONS` 有无、fs shim 是否注入）与 **skip dirs / corpus filter**。
- `--clean-corpus` 是 **opt-in**：默认过滤规则逐字不变，保证 2026-11-11 首测可复现。
- `--report <suffix>` 另存任意 A/B 报告（如 `--report ab-20261112`）；suffix 只接受字母/数字/连字符。

**逐文件诊断**（`ABS-17` 复现工具，只读，不写仓库文件）：

```bash
pnpm exec tsx benchmark/s1/profile-cold.mts --corpus . --rounds 1 --top 30
pnpm exec tsx benchmark/s1/profile-cold.mts --corpus . --clean-corpus   # 与干净报告同口径
pnpm exec tsx benchmark/s1/profile-cold.mts --corpus . --only packages/vscode/out/extension.js
pnpm exec tsx benchmark/s1/profile-cold.mts --corpus . --clean-corpus --mode check --rounds 2 --limit 286
```

- `--mode check` 逐文件跑 `checkSource`（默认 `analyze`），用于整文件 `CheckReport` memo 的
  冷/暖两轮对照；`--limit N` 取排序后前 N 个文件，用于复现 LRU 容量阈值
  （2026-11-12：容量 256 时 260 文件就 100% miss，提到 1024 后 286 文件 warm 436.67ms）。
- CPU 栈请加 `node --import tsx --cpu-prof --cpu-prof-dir=/tmp/prof ...`（命令见 plan §5 `ABS-17`）。

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
