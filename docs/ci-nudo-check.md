# nudo check 在 CI 中的用法

> 产品语义 / 诊断码 / 报告格式 / 金标含义：[`design/cli-semantics.md`](./design/cli-semantics.md) §5。
> 本文只写 **CI 接线**。

## 接线

```yaml
# GitHub Actions 片段（示意）
- run: pnpm install
- run: pnpm run lint
- run: pnpm run build
- run: pnpm run check src/          # 门禁：有 error → exit 1
# GITHUB_ACTIONS=true 时自动打 PR 行内注解（::error / ::warning）
```

| 命令 | 用途 | exit 1 |
|------|------|--------|
| `pnpm run check <path>` | Day 0/CI 门禁 + 打印 signatures | 任一 error 级诊断（L1 或未 ignore 的 L2） |
| `pnpm run test:cli <path>` | case 报告 + 声明断言 | 仅**声明** `@nudo:case` 断言失败 |
| `pnpm run nudo -- health` | drift / 分析错误 | drift 或 analysis error |
| `pnpm run verify:examples` | 示例命令 × 退出码矩阵 | 矩阵不匹配 |

CI 门禁**只认** `check`（及 `test` 的声明断言、`health` 的 drift）。

## PR 行内注解（好过裸 tsc 日志）

诊断会贴到 **Files changed** 对应行，而不是埋在 job log 里。

### GitHub Actions（推荐默认）

```yaml
jobs:
  nudo:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pnpm install
      # 自动注解：GITHUB_ACTIONS=true 即开；也可显式 --gha
      - run: pnpm exec nudo check packages/*/src
      # 要 JSON 留档时：stdout=CheckJson，注解仍进日志（stderr）
      - run: pnpm exec nudo check packages/*/src --json > nudo-check.json
```

单文件/多文件都支持；`--json` 多文件是 `kind:"multi"` 信封。

### GitLab Code Quality

```yaml
script:
  - pnpm exec nudo check src --gitlab > gl-code-quality-report.json
artifacts:
  reports:
    codequality: gl-code-quality-report.json
```

### pre-commit / 本地

```bash
pnpm exec nudo check src          # 人类可读 + exit 1
# 不需要 GHA 注解时不要设 GITHUB_ACTIONS
```

| 旗标 | 作用 |
|------|------|
| `--gha` | 强制 GHA 注解（默认在 `GITHUB_ACTIONS=true` 自动开） |
| `--gitlab` | GitLab Code Quality 数组 |
| `--json` | CheckJson（机器契约）；与 `--gha` 同用时注解在 **stderr** |

## 消费方 monorepo 配方（不入库测试语料）

在**你自己的**仓库接门禁。本仓**不**提交完整测试 monorepo——集成夹具只保留
`docs/examples/mini-repo/`（小、钉退出码）。

```yaml
# 消费方仓库 .github/workflows/nudo.yml（示意）
jobs:
  nudo:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install
      # L1：显式契约门禁（默认 L2 error，见下）
      # 目录/多文件 → CheckJsonMulti 信封（kind:"multi" + reports[]）
      - run: pnpm exec nudo check packages/*/src --json > nudo-check.json
      # 可选：把 signatures 贴进 PR comment / artifact
      - uses: actions/upload-artifact@v4
        with:
          name: nudo-check
          path: nudo-check.json
```

要点：

1. **只扫源码根**（`src/` / `lib/`），不要扫 `node_modules`、构建产物、benchmark 语料。
2. **L2 策略显式选**：默认入口 may-throw = error。渐进迁移可先
   `--ignore-throws TypeError` 或 `package.json#nudo.check.entryThrows: "off"`，
   等价于 Day0 只锁 L1 契约违例。
3. **成功也打印 signatures**——CI 日志里的 `any` 是无约束入口，不是 unknown。
4. **金标/zero-FP 叙述以 L2 off 为准**；你的 CI 若开 L2，期望要单独钉。
5. 大 monorepo：会话缓存可配 `NUDO_CACHE_MAX_FILES=32`（多项目）或 `512`（单大仓）。

本仓自检（开发 Nudo 时）：

```bash
pnpm run check docs/examples/mini-repo/user-service.js   # 集成夹具
pnpm run verify:examples                                  # 示例 × 退出码矩阵
npx tsx scripts/scan-real-packages.ts commander           # 真实包扫描报告
```

## 可信 runner 的磁盘缓存配方（可选提速）

零配置时无需 restore：项目缓存默认关，`nudo check` 每次诚实重算。**可信 CI runner 上的推荐配置**是打开项目缓存并在运行间 restore `.nudo/cache` —— 键内容寻址（源码 + 侧车 + 依赖 + 配置的 sha256，带分析 ABI 前缀），restore 出来的层不可能给出陈旧/错误命中，最坏是干净 miss 重算。事实面见 [`design/persistent-cache.md`](./design/persistent-cache.md)；用户向叙述见 website 性能指南（performance.md）。

```jsonc
// package.json —— 配置入库；缓存目录绝不入库（gitignore `.nudo/cache/`）
{ "nudo": { "cache": true } }
```

```yaml
# .github/workflows/nudo.yml —— 在 check 步骤前后各加一步（可信 runner）
jobs:
  nudo-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install
      # 先 restore：miss（首次运行、冷层）只是诚实重算
      - uses: actions/cache/restore@v4
        with:
          path: .nudo/cache
          # 桶键 = lockfile + 受跟踪源码 hash。不必精确：nudo 逐文件键
          # （源码+侧车+依赖+配置 sha256，ABI 前缀）负责真正失效；
          # restore-keys 恢复的旧桶只会逐文件 miss。
          key: nudo-check-${{ runner.os }}-${{ hashFiles('pnpm-lock.yaml') }}-${{ hashFiles('packages/*/src/**') }}
          restore-keys: |
            nudo-check-${{ runner.os }}-${{ hashFiles('pnpm-lock.yaml') }}-
            nudo-check-${{ runner.os }}-
      - run: pnpm exec nudo check packages/*/src
      # check exit 1 时自动跳过；要红的运行也回填加 `if: always()`
      # （条目是内容键寻址的整文件报告，不是裁决）
      - uses: actions/cache/save@v4
        with:
          path: .nudo/cache
          key: nudo-check-${{ runner.os }}-${{ hashFiles('pnpm-lock.yaml') }}-${{ hashFiles('packages/*/src/**') }}
```

key 建议：lockfile hash 钉依赖面、源码 `hashFiles` glob 钉源面 —— 两者只负责**选桶**，真正的失效由 nudo 自己的逐文件内容键完成，所以桶键不必精确。用单个 `actions/cache@v4` 步骤亦可；`restore`/`save` 拆分只是把保存显式化、可加条件。

边界：

- **不可信 runner 上照抄本配方不安全**：结构合法的伪造 `CheckJson` 可制造假阴性。保持 `nudo.cache` 关闭（或 `NUDO_CACHE_DIR=off`）；仍想要缓存就开条目签名（`nudo.cache.sign: true` + CI secret 的 `NUDO_CACHE_KEY`，篡改条目验签失败当 miss）。
- 契约文件（`*.nudo.js`）进 git；`.nudo/cache` 绝不进。
- 依赖层（`~/.cache/nudo/deps`，`NUDO_DEPS_CACHE_DIR` 指向 restore 出的目录）默认开、跨项目，同样值得在 CI 里 restore。

## L2（入口 may-throw）

默认 **error**。CI 里可选放宽：

```bash
pnpm run check src/ --ignore-throws TypeError,RangeError
# 或 package.json
"nudo": { "check": { "ignoreThrows": ["TypeError"], "entryThrows": "error" } }
```

- `ignoreThrows` / `entryThrows` **只作用于 L2**，不吞 L1 契约违例。
- 金标与 zero-FP 叙述默认以 **L2 off** 基线为准；开 L2 的 CI 应显式配置或拆期望。

## 精度门禁（本仓库）

| 门禁 | 位置 |
|------|------|
| 人工 recall = precision = 1.0 | `packages/core/src/algebra/__tests__/check-recall-gold.test.ts`（144 条，knownFn=0） |
| shape 精化 | `check-shape-gold.test.ts` |
| case ⊆ refine | `check-case-consistency.test.ts` |
| 真实包零误报 | `check-real-packages.test.ts` / `check-real-commander.test.ts` |
| 示例矩阵 | `docs/examples/README.md` + `scripts/verify-examples.sh` |

```bash
# 真实包扫描（报告态产物）
npx tsx scripts/scan-real-packages.ts commander
# → docs/check-real-packages.md
```

## 报告要点（CI 消费）

- **成功也打印 signatures**；入口无约束参数为 **`any`**。
- issues 为 `actual ⊭ expected`（蕴含失败），不是 tsc 诊断换皮。
- 机器可读：`nudo check <file> --json`（单文件 CheckJson v1）；gate/签名与 `test --json` cases **分命令**。
- 契约测试：`check-json.test.ts`；实现 `packages/core/src/algebra/check-report.ts`。
