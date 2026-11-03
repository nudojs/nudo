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

## 最近一次（2026-11-03，本机）

```
fix-callsite:   fixRate=1  timeToGreen≈3.0s
relax-contract: fixRate=1  timeToGreen≈2.7s
fix-rate: 100% · time-to-green avg ≈2.8s（单次 check ≈1.3s，tsx 冷启动主导）
```

与 2026-09-23 基线（avg ≈1.8s）的差异是**机器因子**（该机单次 check ≈0.9s），非引擎回归；
time-to-green 只做 sanity 上界钉（见下节），跨机器可钉的只有 fix-rate。

## 与 learning-cost 的分工

| 脚本 | 回答 |
|------|------|
| `learning-cost` | 新手 Day0→Day1 路径要多久 |
| `dx-metrics` | **看到红 → 修绿** 要多久、文档路径是否闭环 |

## 发布面（vs-typescript.md 生成块）

`--md` 输出带 `<!-- dx-metrics:begin/end -->` 标记的 markdown 块（生成日期、fix-rate、time-to-green、目标行），粘贴进 website 的 vs-typescript.md 性能节：

```bash
pnpm run dx-metrics -- --md            # en 块（docs/guides/vs-typescript.md）
pnpm run dx-metrics -- --md --lang zh  # zh 镜像块（i18n/zh-Hans/…/guides/vs-typescript.md，同数字、镜像文案）
```

钉面：`packages/website/tests/dx-metrics-publication.test.ts` 实跑 `--json` 后钉
**fix-rate（=1，跨机器可复现的主张，硬钉）、块结构**（标记对、日期、目标行、fix-rate
数值一致）与 time-to-green 的 **sanity 上界（< 10s）**。time-to-green 秒数与 2s 目标
**不硬钉**——机器相关量（本机 tsx 冷启动 ≈1.3s/check，2026-09 基线机 ≈0.9s，CI runner
更慢），硬钉必在慢机器上假红（机器因子先例见 benchmark gate 的 `--allow-uniform-shift`），
且本脚本自身的 exit 分级也只把 fix-rate<1 当失败。实跑超 2s 目标时测试以 console.warn
给出「机器慢，非文档漂移」的可区分提示。改文档块后再生成 = 重跑该测试确认 fix-rate 仍复现。
