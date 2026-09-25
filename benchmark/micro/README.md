# Nudo vs tsc 微基准

分离测量：冷启动 / 进程内热分析 / 缩放 / polyvariant 调用点。

```bash
npx tsx benchmark/micro/run.mts
# 结果 JSON：benchmark/micro/out/micro-*.json
```

## 测什么

| 名称 | 含义 |
|---|---|
| cold tsx empty | `tsx -e` 空脚本进程成本 |
| cold CLI infer | `tsx packages/nudojs/src/index.ts infer` 全链路 |
| cold import first analyze | 进程已起 + 首次 `analyzeFile` |
| nudo warm | 同进程反复 `analyzeFile`（稳态） |
| tsc CLI | 每次新进程 `tsc --noEmit`（含编译器加载） |
| tsc api warm | 同进程 `createProgram`（对照 analyzeFile） |
| scaling ×N | N 个函数 × 1 case，两边缩放曲线 |
| scaling ×sites | 1 个被调函数 × K 个调用点（polyvariant 压力） |

## 设计约束

- Workload 为合成小文件（算术 / typeof 分支 / union / 多函数 / 多调用点），不是真实 monorepo。
- tsc API 每次新建 Program + 最小 `lib.es2022`；真实 tsserver 会复用 Program/LanguageService，固定成本更低。
- Nudo `analyzeFile` 每次会 `resetMemo`；结果反映「单次分析」而非跨编辑会话缓存。
- 两边任务不同：tsc 做可赋值检查，Nudo 做抽象解释推断——比的是**分析延迟**，不是同一问题的算法常数。
