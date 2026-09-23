# DX 运营指标基线（C4）

> 内部基线，**不是 CI 门禁**。与 `scripts/learning-cost.mjs` 同级。  
> 运行：`pnpm run dx-metrics` · `pnpm run dx-metrics -- --json`（或 `node scripts/dx-metrics.mjs --json`）

## 度量什么

| 指标 | 定义 | 目标（rev 5） |
|------|------|----------------|
| **fix-rate** | 按错误面文档路径修完后 check 变绿的比例 | **100%**（文档路径必须可走通） |
| **time-to-green** | 红 → 修 → 绿 的墙钟（本地 tsx CLI） | **avg &lt; 2s** |

## 场景

1. **fix-callsite** — `setDelay(0)` ⊭ `ms>0` → 改调用点 `setDelay(250)`  
2. **relax-contract** — 同上 → 侧车 `number().ge(0)`（错误面 “or relax the precondition”）

每条违例的 `fix: nudo contract --draft` / `→ use a value satisfying …` 是 fix-rate 的「文档路径」。若某条路径走不通，fix-rate &lt; 100% = 文档或诊断建议有洞。

## 最近一次（2026-09-23，本机）

```
fix-callsite:   fixRate=1  timeToGreen≈1.8s
relax-contract: fixRate=1  timeToGreen≈1.8s
fix-rate: 100% · time-to-green avg ≈1.8s
```

## 与 learning-cost 的分工

| 脚本 | 回答 |
|------|------|
| `learning-cost` | 新手 Day0→Day1 路径要多久 |
| `dx-metrics` | **看到红 → 修绿** 要多久、文档路径是否闭环 |
