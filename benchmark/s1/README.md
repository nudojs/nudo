# S1 — monorepo cold / warm / edit 基线

中型 monorepo 的采用延迟证据（`docs/design/plans/2026-09-19-close-remaining-dx-gaps.md` S1 / A6）。

```bash
pnpm run benchmark:s1
pnpm run benchmark:s1 -- --regen   # 强制重建语料
```

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
