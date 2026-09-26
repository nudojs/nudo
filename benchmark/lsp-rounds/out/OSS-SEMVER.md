# OSS 历史 bug 切片 · Nudo vs TypeScript（保留档）

**唯一保留的评测轮。** 夹具：`npm/node-semver` 多文件模块图 + 6 个最近真实历史 bug（见 `../oss-semver/SOURCE.md`）。
模型同权重不同账号：Nudo=`sn0/sensenova-6.8-flash-lite` · TS=`sn1/sensenova-6.8-flash-lite`。

## 主表（两侧均 6/6 跑完）

| | Nudo | TypeScript |
|--|--|--|
| **detectRate** | **6/6** | **6/6** |
| **silentGreen** | false | false |
| repairLoops | 16 | 21 |
| tokenTotal | **569k** | 993k |
| rounds | **45** | 63 |
| timedOut | false | false |
| gate / tests | 绿 / 绿 | 绿 / 绿 |
| mem gate peak | **226MB**（`nudo check`，0.5s） | 289MB（`tsc --noEmit`，0.9s） |
| mem LSP peak | —（见微基准） | 545MB（tsserver，本轮） / 113MB（短会话） |

### bug 明细（两侧全 pass）

| | Nudo | TS |
|--|--|--|
| bug#1 subset prerelease | pass | pass |
| bug#2 tilde `-0` 下界 | pass | pass |
| bug#3 caret 精确 0.x | pass | pass |
| bug#4 x 后跟数字 | pass | pass |
| bug#5 点分 prerelease inc | pass | pass |
| bug#6 build metadata | pass | pass |

## 原始记录

| 侧 | 跑次 | 文件 |
|--|--|--|
| Nudo | 20min 预算，正常收工 | `1790254149355-seed1-nudo.json` |
| TS | 40min 预算，约 23min 收工 | `1790264057712-seed1-typescript.json` |

会话审计（禁改文件未动、仅 `lib/` 真修复、复跑 6/6）见会话记录 2026-09-24。

## 读法（收束后）

1. **大模块 + 最近真 bug** 上，detect 天花板两侧都能摸到 6/6——不是小夹具的 8/8 触顶假象。
2. **同样正确率下成本差一截**：TS 约 **+75% token**（993k vs 569k）、+18 repair、+18 rounds。
3. **内存**：gate 峰值 Nudo 更轻（226MB vs 289MB）；tsserver 常驻可达数百 MB。
4. 中间几轮 TS 4/6 + silentGreen 是预算不足/方差；充足预算下可修完。产品点仍在：**假绿就停**曾在 2/3 次 TS 跑次出现，Nudo 成功轮未出现。

## 复现

```bash
# 生成 starters（gitignore 生成物；ISC 上游源码不进仓）
git clone https://github.com/npm/node-semver /tmp/nudo-oss-candidates/semver
node benchmark/lsp-rounds/oss-semver/build.mjs /tmp/nudo-oss-candidates/semver

node benchmark/lsp-rounds/harness/run.mjs --seed 1 --task oss --timeout-ms 2400000
```

夹具定义：`oss-semver/build.mjs`（反向补丁）+ 内嵌 acceptance + `BUGS.md` / `SOURCE.md`。
`starters-oss-semver/` 仅为本地生成树，见 `.gitignore`。
