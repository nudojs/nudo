---
description: "第一个小时的常见问题：any 与 unknown、number | string 联合、编辑器无输出、nudo test 与 vitest、entry-may-throw、被移除的动词、成功时也打印签名。"
---

# 故障排查

使用 Nudo 的第一个小时里最常出现的问题——每个问题一段话讲清，并附上完整说明的链接。这里都对不上？所有 `nudo:*` 诊断码都列在[诊断术语表](../reference/diagnostics.md)里。

## 为什么我的参数是 `any`？

`any` 表示**未约束**——既没有契约，也还没有调用点证据。它不是推断失败，也不是 bug：Nudo 绝不通过扫描函数体来"发明"义务（[边界](../concepts/limits.md)）。想让参数收窄，就给它证据：

- 侧车 `*.nudo.js` 契约或 [`@nudo:contract`](../concepts/directives.md#nudocontract--source-contract)——见 [nudo contract](../guides/contract.md)
- 调用点——真实实参会收窄签名（[快速开始](./quick-start.md)、[调用点发现](../guides/callsite-discovery.md)）

`any` ≠ `unknown`：`unknown` 专指推断失败（[简介](../intro.md)）。

## 为什么 `+` 返回 `number | string`？

```js verify#day0
export function scale(x) {
  return x + 1;
}

export function formatName(first, last) {
  return first + " " + last;
}

scale(5);
formatName("Ada", "Lovelace");
```

用 `nudo check` 跑一遍，signatures 段是：

```text
scale(x: any) => number | string
```

这是如实的 JavaScript 语义，不是 bug：未约束的操作数既能走数值相加，也能走字符串拼接（`"7" + 1`），所以两条分支都被保留，而不是瞎猜。给 `x` 加约束——契约或调用点证据——联合就会坍缩为 `number`（`scale(x: number) => number`）。完整说明：[语言语义](../concepts/semantics.md) · [快速开始](./quick-start.md)。

## `unknown` 是什么意思，怎么修？

`unknown` 是**推断失败**（引擎债务）——绝不是未约束入口参数的默认显示（[边界](../concepts/limits.md)）。修法按优先级：

1. 给依赖补类型：安装 `@types/*`（声明会被自动拾取）或声明命名 env——[依赖类型](../guides/env-harvest.md)
2. Mock 掉分析无法执行的部分（`fetch`、原生绑定）——[Mock 外部依赖](../concepts/mocking.md)
3. 优先使用已建模的写法，避开未建模列表——[语言语义](../concepts/semantics.md)

## VS Code（或其他编辑器）没有任何输出

IDE 的分析闸门是 `nudo.analysis.mode`，出厂默认 `"exports"`：只有带 `export` / 侧车 / `@nudo:*` 指令的文件会被分析（[VS Code 扩展](../guides/vscode.md)）。打开一个有导出的文件试试。还是没有？检查闸门：

- 单体仓库：用 `package.json#nudo.analysis` 的 `include` / `exclude` 圈定范围，然后重载窗口——[共存配方](../guides/coexistence.md#recipe-mixed-js-ts-no-double-error-storm)
- `.ts` / `.tsx` 缓冲区默认刻意不是 Nudo 的分析目标

## 为什么 `nudo test` 看不到我的 vitest 套件？

`nudo test` 是**用例报告器**——报告 `call@L` / `entry@L` 用例以及声明的 `@nudo:case` 断言——不是测试运行器；它从不运行 vitest，你不指过去它就不会读测试文件（[CLI 参考](../api/cli-reference.md#nudo-test)）：

```bash
nudo test lib/ --from test/
```

采集阶段在 Nudo 求值器内部执行的是每个测试文件的*形状*（`it` / `test` / `describe` 回调会被调用；测试框架本身从不运行），并把观察到的每次调用注入为合成用例——[调用点发现](../guides/callsite-discovery.md)。

## `nudo check` 在故意抛错上报 `nudo:entry-may-throw`

L2 要求入口/导出函数不得携带**未声明、未捕获**的抛出——就像 Node 进程遇到未捕获异常会以非零码退出一样（[L2 — 入口抛出](../guides/check.md#l2--entry-throws)）。修法按优先级：

1. 声明它：在函数上方写 `@nudo:throws RangeError`——[`@nudo:throws`](../concepts/directives.md#nudothrows--declare-intentional-throws)
2. 消化它：在边界 `try`/`catch`，或对参数加 refine 让抛出路径收窄消失
3. 仅限迁移期缓解：`--ignore-throws`、`--entry-throws warning` 或 `--profile adoption`，可固化在 `package.json#nudo.check`（[CLI 参考](../api/cli-reference.md#nudo-check)）

## `infer` / `types` / `interface` / `refine` 动词去哪了？

在 CLI 产品面清理中被删除——破坏性变更，无兼容层（[完整发布历史](../releases-history.md)）。如今的主动词是 `check` / `test` / `contract` / `export` / `health`。

各包当前版本说明：[发布说明](../releases.md)。

## 成功时也打印签名——是 bug 吗？

不是——这就是观察面。`check` 在成功*和*失败时都打印签名；只有 `FAILED` / issues 块和退出码（任一 error 级诊断即为 1）才说明门禁是否通过（[nudo check](../guides/check.md)；下方输出引自[快速开始](./quick-start.md)）：

```text
nudo check  calc.js
OK
  0 error · 0 warning · 0 info · 2 fn
signatures
  scale(x: any) => number | string
```
