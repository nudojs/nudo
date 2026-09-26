---
slug: /guides/health
description: nudo health —— CI 中的分析错误与固化漂移。
---

# nudo health

`nudo health` 报告**分析错误**与**调用点固化漂移**。它与 `nudo check`（契约门禁）互补：health 盯的是已记录证据是否仍与代码匹配。

```bash
npx nudojs health [paths…] [--watch] [--from paths…] [--json]
```

漂移或分析错误时退出 `1`。未覆盖函数仅为信息级。

## health 盯什么 vs check 门禁什么

| | `nudo check` | `nudo health` |
|---|---|---|
| 门禁 | L1 显式契约 + L2 入口 may-throw | 分析错误 + 调用点固化漂移 |
| 真理 | Abs 上的 Pred 蕴含 | 生成的 `call@` 指令是否仍匹配使用点 |
| 未覆盖函数 | 入口回落（`any` 参数） | 会报告，但仅为信息级 |
| CI 角色 | 产品门禁 | 可选的证据新鲜度监视 |
| 退出 `1` | 任意 error 级诊断 | 漂移或分析错误 |

`check` 回答「契约还成立吗？」。`health` 回答「已记录的调用点证据还描述得出这段代码怎么被用吗？」。管道里保留 `check`；当你固化了 `call@` 用例、希望 CI 发现测试变动时，再加 `health`。

## Flags

| Flag | 说明 |
|---|---|
| `paths…` | 要做 health 检查的文件或目录 |
| `--watch` | 文件变更时重跑 |
| `--from paths…` | 使用点文件（测试、应用）。health 重跑与 `test --freeze=update` 相同的再固化链，生成的 `call@` 指令会变化时报告漂移 |
| `--json` | 结构化 health 报告 |

不带 `--from` 时，health 只报告分析错误与契约漂移 —— 调用点漂移需要使用点文件才能再 harvest。

## 走读示例 —— 代码改动后的漂移

从一个库和覆盖它的测试开始。先把 harvest 到的用例固化一次：

```bash
npx nudojs test lib/slugify.js --from tests/ --freeze
# 在 lib/slugify.js 里写入生成的 call@ 指令
```

之后测试改了实参 —— 比如 `slugify("Hello World")` 变成 `slugify("Hello  World")`，或换了另一种形状调用。固化的 `call@` 指令不再匹配使用点。`health` 会报告：

```bash
npx nudojs health lib/ --from tests/
```

```text
lib/slugify.js
  · 1 function(s)
  ✗ drift: 3 witness directive(s) changed (+2 new, -1 removed) — refresh: nudo test lib/slugify.js --from tests/ --freeze=update

Summary: 1 file(s) · 1 case drift · 0 contract drift · 0 error(s) · 0 uncovered function(s)
Result: FAIL (drift or errors found)
```

建议的 refresh 就是再固化命令：

```bash
npx nudojs test lib/slugify.js --from tests/ --freeze=update
```

`--freeze=update` 会先剥离此前生成的 `call@` 指令，对剥离后的源码重新分析，再写回刷新后的集合。手写 `@nudo:case` 指令永不触碰（`call@` 是保留的生成前缀）。`freeze` 与 `freeze=update` 在已同步文件上都是幂等的（`freeze: no changes.`）。

> `test --freeze` 是**可选**的调试固化工具 —— 产品 CI 门禁仍是 `nudo check`。health 是那个在可选固化过期时提醒你的监视者。

若想把漂移检测变成不写文件的门禁，用[调用点发现](./callsite-discovery.md#持久化采集结果)里的 dry-run 形态：

```bash
npx nudojs test lib/ --from tests/ --freeze=update --dry-run --exit-on-diff
```

## CI 配方

### GitHub Actions

```yaml
# .github/workflows/nudo.yml
jobs:
  nudo:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm i -g nudojs
      - run: npx nudojs check src/
      - run: npx nudojs health src/ --from tests/
```

`check` 放前面：它是产品门禁。`health` 在已记录证据漂移时让 job 失败。

### 退出码

| 码 | 含义 |
|---|---|
| `0` | 无漂移、无分析错误 |
| `1` | 漂移或分析错误（未覆盖函数仅为信息级） |

对 CI 而言退出面与 `check` 相同 —— 非零即挡流水线。

### JSON

`--json` 输出结构化 health 报告，供看板与 agent 工具使用。机器人需要同时解析契约门禁与漂移监视时，与 `check --json` 配对。

## 何时跑 health vs check

| 场景 | 命令 |
|---|---|
| 每个 PR 的 CI（观察层 / 契约层） | `nudo check` |
| 固化 `call@` 用例之后的 CI | `nudo check` 然后 `nudo health --from` |
| 编辑时本地 watch | `nudo health --watch`（或 `nudo check --watch`） |
| 发布前、已有固化用例 | `nudo health src/ --from tests/` |
| 尚未固化用例 | 只跑 `nudo check` —— health 没有可再固化的内容 |

更多任务配方：[Recipes](./recipes.md)。

## 下一步

- [nudo check](./check.md) —— health 所互补的契约门禁
- [调用点发现](./callsite-discovery.md) —— harvest、`--freeze` 与再固化链
- [诊断](../reference/diagnostics.md) —— 分析错误的代码索引
- [Recipes](./recipes.md) —— CI 门禁与 monorepo 配方
- [CLI 参考](../api/cli-reference.md#nudo-health) —— flag 与退出码契约
