---
slug: /guides/test
description: nudo test —— Abs 上逐调用点真值报告；合成 call@/entry@ case 默认全部打印；声明的 @nudo:case 断言决定退出码；--from、--freeze、--json、--abs。
---

# nudo test

**读完你将获得：** 默认 case 报告的读法（`call@` / `entry@` / `debug` 见证）、声明断言 —— 唯一能让运行失败的东西 —— `--freeze` 见证固化，以及 `test` 与 `check` 的清晰分工。

`nudo test` 是 Nudo 的 **case 报告**：Abs 上逐调用点的真值。它是**观察面**，不是 CI 门禁。

- 所有推导出的 case 默认全部打印 —— 合成 `call@L…` / `entry@L…` case **和** `debug` 见证。
- 只有**声明断言**（`@nudo:case "…" (args) => expected`）进入 pass/fail；只有它们的失败才置 exit `1`。
- 分析诊断在报告之后上屏供知悉 —— 它们不决定退出码。

门禁在 [`nudo check`](./check.md)（L1 契约 + L2 入口 throws）。观察不需要独立动词：它就是 `check` 签名、`test` case 报告和 IDE hover。

```bash
nudo test <path> [--watch|-w] [--from paths…] [--freeze[=mode]] [--dry-run] [--exit-on-diff] [--json] [--abs]
```

## 默认输出

```js
export function subtract(a, b) {
  return a - b;
}

subtract(5, 3);
subtract(1, 10);
```

```bash
nudo test math.js
```

```text
nudo test  math.js

=== subtract ===
  call@L5  (5, 3) => 2
  call@L6  (1, 10) => -9

assertions
  — 0 passed · 0 failed · 0 unchecked (no declared @nudo:case expectations; 2 synthetic case(s) printed above)
```

这些 case 没有人写过。Nudo 用每个调用点实际传入的参数执行了 `subtract`，并报告结果。各节读法：

| 行 | 含义 |
|----|------|
| `=== fn ===` | 每个被分析函数一节；导入的模块归在 `--- <module> (imported) ---` 下 |
| `call@L…` | 真实调用点（`L` 为被分析文件或 `--from` 使用处文件中的行号），以实际实参执行 |
| `entry@L…` | 无人调用的函数的 fallback —— 参数默认 **`any`**（无约束），绝不是 `unknown`。存在 `call@` case 时，该函数不再合成 `entry@` |
| `debug "name"` | 一条 `@nudo:case` 见证（见下） |
| `   throws TypeError` | 追加在路径可能抛出的 case 上 |

无人调用时的 entry-only fallback：

```js
export function getName(user) {
  return user.name;
}
```

```text
=== getName ===
  entry@L1  (any) => any   throws TypeError
```

### assertions 汇总

`assertions` 块只统计**声明 case** —— 合成 `call@` / `entry@` 永不进入：

- 存在声明期望时为 `✓ N passed · N failed · N unchecked`（有失败则 `✗`）；
- 没有声明时为 `— 0 passed · 0 failed · 0 unchecked (no declared @nudo:case expectations; N synthetic case(s) printed above)`。

`unchecked` 指**不带** `=> expected` 的 `@nudo:case`：Nudo 执行并报告的见证，但不下判断。分析诊断存在时在报告之后以 `[severity] file:line:col message (code)` 上屏 —— 供知悉；退出码仍由声明断言驱动。

## 声明断言

`@nudo:case "name" (args) => expected` 声明一个期望。Nudo 执行该 case 并用实际结果对照期望 Abs 检查（`leqAbs`）：

```js
/**
 * @nudo:case "double" (2) => 4
 * @nudo:case "bad" (3) => 7
 */
export function double(x) {
  return x * 2;
}
```

```bash
nudo test dbl.js
```

```text
nudo test  dbl.js

=== double ===
  debug "double"  (2) => 4
  debug "bad"  (3) => 6

assertions
  ✗ 1 passed · 1 failed · 0 unchecked
  [ok]   double  case "double" → 4
  [FAIL] double  case "bad"
         expected: 7
         actual:   6

diagnostics
  [error] dbl.js:3:0 debug "bad": expected 7, got 6. The inferred return type does not match the expected type declared in the @nudo:case witness (nudo:case-expected)
```

exit `1` —— 一条声明断言失败了。

case 也可以用 `!! throws` 后缀申报有意的 throw 域（`@nudo:case "neg" (0) !! throws` 申报任意 throw；`!! throws Error` 按类型申报）。它与 `@nudo:throws` 在 core 的 `refine.ts` 中同路解析 —— 完整语法见[指令参考](../concepts/directives.md#nudocase--debug-witnesses)。`@nudo:case` 仍是 debug/test/LSP 面；契约产品是 `*.nudo.js` / `@nudo:contract`。

| 码 | 含义 |
|------|------|
| `0` | 全部声明断言通过（或未声明） |
| `1` | 任一**声明断言**失败 —— 合成 `call@` / `entry@` case 永不挡 exit |

完整退出码契约：[CLI 参考](../api/cli-reference.md#nudo-test)。

## 固化见证（`--freeze`）

合成 case 只存在于产出它的那次运行里。`--freeze` 把它们作为真正的 `@nudo:case` 指令写回被分析文件，让这些形状在运行之外存活：

```bash
nudo test lib/ --from tests/ --freeze          # add（默认）：只填充没有 case 指令的函数
nudo test lib/ --from tests/ --freeze=update   # 重新同步此前生成的 call@ 指令
```

- 手写 case（名字不以 `call@` 开头）**绝不被触碰**；`call@` 是保留前缀。
- `--dry-run` 打印 unified diff 而不写盘：

```text
freeze: would write cases → math.js (dry run)
  subtract: call@L5, call@L6
--- a/math.js
+++ b/math.js
@@ -1,3 +1,7 @@
+       /**
+        * @nudo:case "call@L5" (5, 3)
+        * @nudo:case "call@L6" (1, 10)
+        */
 export function subtract(a, b) {
   return a - b;
 }
```

- `--exit-on-diff`（需要 `--dry-run`）在 diff 非空时 exit `1` —— 固化见证的 CI 漂移门禁。

合并策略（各模式触碰什么、可序列化形状的限制）规定在 [Call-Site Discovery](./callsite-discovery.md)。想持续守望这种漂移而不是手动刷新：[`nudo health`](./health.md) 重跑同一条再固化链，一旦生成指令会变就 exit `1`。

## 使用处（`--from`）

`--from <paths…>` 指向使用处文件 —— 测试、示例、上游应用。Nudo 采集它们的真实调用记录，并把每条匹配的调用注入为 `call@L` case，于是实参形状来自代码**实际**被怎么用，而不是手写指令。两阶段采集、归因门与试跑数据见 [Call-Site Discovery](./callsite-discovery.md)。

## 机器可读与代数面

`--json` 输出 `CaseJson` v1 —— **仅单文件**；不能与 `--abs` 或 `--freeze` 组合 —— 含 `version` / `file` / `summary` / `functions[].cases[]`（外延的 `args` / `result` / `throws`，以及可得时无损的 `argsAbs` / `resultAbs` / `intension`），并在其上加 `assertions` 汇总。节选（有裁剪）：

```json
{
  "version": 1,
  "file": "dbl.js",
  "summary": { "functions": 1, "externalFunctions": 0, "cases": 3, "diagnostics": 1 },
  "functions": [
    {
      "name": "double",
      "entryOnly": false,
      "cases": [
        {
          "name": "double",
          "args": ["2"],
          "result": "4",
          "throws": null,
          "source": "directive",
          "argsAbs": ["2  #exact"],
          "resultAbs": "4  #exact",
          "intension": {
            "display": "double: (x: A1) => number = (A1 * 2)",
            "abs": "4  #exact",
            "term": "(A1 * 2)",
            "conf": "exact"
          }
        }
      ]
    }
  ],
  "assertions": { "passed": 1, "failed": 1, "unchecked": 1 }
}
```

声明断言失败时 `--json` 仍 exit `1`。

`--abs` 先打印 `check --abs` 代数面（逐函数 shape + conf），再打印 case 报告 —— 声明断言失败保持可见且仍挡 exit。`--watch` / `-w` 变更时重跑（模式旗标，不是动词）。

## test 与 check 的分工

| | `nudo check` | `nudo test` |
|---|---|---|
| 职责 | **门禁**：L1 显式契约 + L2 入口 may-throw | **报告**：逐 case 真值 + 声明断言 |
| 打印 | Signatures（始终，成功也是）+ issues | 全部 case（`call@` / `entry@` / `debug`）+ assertions 汇总 |
| Exit `1` | 任一 error 级诊断 | 任一声明断言失败 |
| CI | 产品门禁（对标 `tsc --noEmit`） | 可选：声明断言、freeze 漂移 |

观察不是独立动词 —— 它落在 `check` 签名、`test` case 报告和 IDE hover 里。

## 选项

| 选项 | 说明 |
|--------|-------------|
| `--watch` / `-w` | 变更时重跑（旗标，不是动词） |
| `--from <paths…>` | 使用处文件，其调用成为 `call@L` case |
| `--freeze[=mode]` | 把合成 case 写回为 `@nudo:case` 指令（默认 `add` / `update`） |
| `--dry-run` | 搭配 `--freeze`：打印 unified diff 而不写盘 |
| `--exit-on-diff` | 搭配 `--freeze --dry-run`：diff 非空时 exit `1` |
| `--json` | `CaseJson`（单文件；不能与 `--abs` / `--freeze` 组合） |
| `--abs` | 代数面（同 `check --abs`），随后是 case 报告 |

完整旗标与退出码表：[CLI 参考](../api/cli-reference.md#nudo-test)。

## 下一步

- [nudo check](./check.md) —— CI 门禁详解
- [Call-Site Discovery](./callsite-discovery.md) —— `--from` 采集、归因门、freeze 合并策略
- [nudo health](./health.md) —— 漂移作为 CI 门禁
- [CLI 参考](../api/cli-reference.md#nudo-test) —— 全部旗标与退出码
