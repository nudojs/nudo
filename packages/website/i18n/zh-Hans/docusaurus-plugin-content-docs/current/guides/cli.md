---
sidebar_position: 1
---

# CLI 使用指南

`nudo` CLI 是在 JavaScript 文件上运行类型推断的主要方式。可通过全局安装或 `npx` 使用：

```bash
npm install -g @nudojs/cli
# or
pnpm add -g @nudojs/cli
```

## `nudo infer`

从单个 JavaScript 文件推断类型。带 `@nudo:case` 指令的函数使用指令；其余函数也会被分析（全程序推断）——观察到的调用合成为 `call@L` 用例，没有任何调用证据的函数则产出 `entry@L` 用例，参数默认为 `unknown`。

```bash
nudo infer <file>
```

`<file>` 必须是单个 `.js` 文件——传目录会报 `EISDIR` 错误。目录请用 [`nudo watch`](#nudo-watch)，多文件可用 shell 循环。

### 选项

| Option | Description |
|--------|-------------|
| `--dts` | 在源文件旁生成 `.d.ts` 声明文件 |
| `--loc` | 在输出中显示源码位置（file:line:column） |
| `--json` | 以结构化 JSON 输出结果（示例见 [CLI 参考](/docs/api/cli-reference#nudo-infer)） |
| `--callsites <paths...>` | 从使用处文件（测试、示例、应用）挖掘真实参数形状并合成用例——参见[调用点发现](/docs/guides/callsite-discovery) |
| `--emit-cases [mode]` | 把合成的用例写回源文件，成为 `@nudo:case` 指令——参见[固化 case 指令](#固化-case-指令) |
| `--dry-run` | 搭配 `--emit-cases`：打印 unified diff 而不写盘 |
| `--exit-on-diff` | 搭配 `--dry-run`：diff 非空时以退出码 `1` 结束 |

### 示例

给定 `math.js`：

```js
/**
 * @nudo:case "positive numbers" (5, 3)
 * @nudo:case "negative result" (1, 10)
 * @nudo:case "symbolic" (T.number, T.number)
 */
export function subtract(a, b) {
  return a - b;
}
```

基本推断：

```bash
nudo infer math.js
```

输出：

```
=== subtract ===

Case "positive numbers": (5, 3) => 2
Case "negative result": (1, 10) => -9
Case "symbolic": (number, number) => number

Combined: number
```

组合类型按吸收律化简：符号化用例已贡献 `number`，字面量结果 `2 | -9` 被吸收。不含基类型成员的纯字面量联合会保留每个字面量。

生成 TypeScript 声明文件：

```bash
nudo infer math.js --dts
```

这会在源文件旁创建 `math.d.ts`，包含推断出的函数签名。

显示源码位置：

```bash
nudo infer src/math.js --loc
```

输出包含位置信息：

```
=== subtract (src/math.js:6:0) ===

Case "positive numbers": (5, 3) => 2
Case "negative result": (1, 10) => -9
Case "symbolic": (number, number) => number

Combined: number
```

### 无指令的函数

没有 `@nudo:case` 指令的函数同样会根据其使用方式推断。没有记录到调用时，参数默认为 `unknown`，用例命名为 `entry@<行号>`：

```js
// src/plain.js
export function add(a, b) {
  return a + b;
}
```

```bash
nudo infer src/plain.js
```

```
=== add ===

Case "entry@L1": (unknown, unknown) => number | string
# no call sites found; parameters default to unknown
```

当被分析的文件调用某个导入函数时，每次观察到的调用都会合成为一个带真实参数形状的 `call@<行号>` 用例：

```js
// src/main.js
import { add } from "./plain.js";

console.log(add(2, 3));
console.log(add("2", "3"));
```

```bash
nudo infer src/main.js
```

```
--- src/plain.js (imported) ---

=== add ===

Case "call@L3": (2, 3) => 5
Case "call@L4": ("2", "3") => "23"

Combined: 5 | "23"
```

要从独立的使用处文件（测试、示例、应用）挖掘参数形状，请用 `--callsites` 传入——参见[调用点发现](/docs/guides/callsite-discovery)。

### 固化 case 指令

合成的 `call@L` 用例只存在于当次分析运行中——不带 `--callsites` 再跑一次 `nudo infer lib.js`，它们就没了。`--emit-cases` 把它们固化进源文件，成为真正的 `@nudo:case` 指令，文件因此自包含：后续运行（以及其他工具——`check`、`watch`、`.d.ts` 生成）无需重新求值使用处文件即可看到同样的形状，且采集到的形状像手写指令一样可评审、可进版本库。

#### 引导：采集一次，写回

给定一个库和一个调用它的测试：

```js
// lib.js
function add(a, b) { return a + b; }
function greet(name) { return "hi " + name; }
console.log(add(1, 2));
add("x", "y");
module.exports = { add, greet };
```

```js
// test.js
const { greet } = require("./lib.js");
greet("ada");
greet("bob");
```

以测试作为使用处运行推断，并把合成的用例写回：

```bash
nudo infer lib.js --callsites test.js --emit-cases
```

```
=== add ===

Case "call@L3": (1, 2) => 3
Case "call@L4": ("x", "y") => "xy"

Combined: 3 | "xy"

=== greet ===

Case "call@L2": ("ada") => "hi ada"
Case "call@L3": ("bob") => "hi bob"

Combined: "hi ada" | "hi bob"

Emitted cases → lib.js (4 directive(s) across 2 function(s))
  add: call@L3, call@L4
  greet: call@L2, call@L3

```

`lib.js` 从此携带这些指令（插入在每个函数声明上方的 JSDoc 块中）：

```js
/**
 * @nudo:case "call@L3" (1, 2)
 * @nudo:case "call@L4" ("x", "y")
 */
function add(a, b) { return a + b; }
/**
 * @nudo:case "call@L2" ("ada")
 * @nudo:case "call@L3" ("bob")
 */
function greet(name) { return "hi " + name; }
console.log(add(1, 2));
add("x", "y");
module.exports = { add, greet };
```

再跑一遍同一命令是幂等的——末尾摘要变为：

```
No changes.
  add: already-generated
  greet: already-generated
```

#### 漂移检测：`update` 模式

使用处会演进，由它们固化的指令也会过期。`=update` 全量重新同步已生成的指令：先从源码剥离所有 `call@` 指令，在剥离后的源码上重新分析，再回写刷新后的指令集——使用处的增加、修改*和删除*都会体现出来。假设测试漂移成了另一个调用：

```js
// test.js —— 使用处漂移
const { greet } = require("./lib.js");
greet(42);
```

把 `update` 与 `--dry-run`、`--exit-on-diff` 组合，即可用作 CI 门禁：

```bash
nudo infer lib.js --callsites test.js --emit-cases=update --dry-run --exit-on-diff
```

```
=== add ===

Case "call@L3": (1, 2) => 3
Case "call@L4": ("x", "y") => "xy"

Combined: 3 | "xy"

=== greet ===

Case "call@L2": (42) => "hi 42"

Would emit cases → lib.js (dry run)
  add: call@L3, call@L4
  greet: call@L2

--- a/lib.js
+++ b/lib.js
@@ -4,8 +4,7 @@
  */
 function add(a, b) { return a + b; }
 /**
- * @nudo:case "call@L2" ("ada")
- * @nudo:case "call@L3" ("bob")
+ * @nudo:case "call@L2" (42)
  */
 function greet(name) { return "hi " + name; }
 console.log(add(1, 2));

```

diff 非空，命令以退出码 `1` 结束。去掉 `--dry-run`（和 `--exit-on-diff`）即可写盘：

```bash
nudo infer lib.js --callsites test.js --emit-cases=update
```

```
=== add ===

Case "call@L3": (1, 2) => 3
Case "call@L4": ("x", "y") => "xy"

Combined: 3 | "xy"

=== greet ===

Case "call@L2": (42) => "hi 42"

Emitted cases → lib.js (3 directive(s) across 2 function(s))
  add: call@L3, call@L4
  greet: call@L2

```

`update` 同样幂等——再跑一遍输出 `No changes.`

要在不阅读 diff 的情况下检查整个项目的过期指令，参见[健康检查与 CI 漂移门禁](#健康检查与-ci-漂移门禁)——`nudo doctor` 一次运行即可报告多文件的漂移。

#### 固化会动哪些内容

固化绝不触碰手写内容；它只管理自己的 `call@` 指令：

| 函数已有用例状态 | `--emit-cases`（add） | `--emit-cases=update` |
|------------------|------------------------|------------------------|
| 手写 `@nudo:case`（名字不以 `call@` 开头） | 一律不动 | 一律不动 |
| 已有生成指令（`call@` 前缀） | 不动——报告 `already-generated` | 全量重新同步：按当前调用证据增/改/删（只剩空 JSDoc 块时整块删除） |
| 零指令，但有调用证据 | 写入指令 | 写入指令 |
| 完全没有调用点（entry-only） | 不写入——报告 `entry-only` | 不写入——报告 `entry-only` |

- `call@` 是生成指令的保留名前缀——手写但以 `call@` 命名的 case 会被当作生成物。
- 实参形状无法表达为指令文本的用例（函数、Promise、类实例、`bigint`、`symbol` 值）会被跳过并报告 `no-serializable-cases`；函数其余可序列化的用例仍会写入。
- `--emit-cases` 不能与 `--json` 组合；`--exit-on-diff` 必须搭配 `--dry-run`——两种违规都打印错误并以退出码 `1` 结束。

同一策略从采集侧的表述见[调用点发现 — 持久化采集结果](/docs/guides/callsite-discovery#持久化采集结果)；编程接口见 [service API —— 用例固化](/docs/api/service#用例固化)。

---

## `nudo check`

检查单个 JavaScript 文件的类型错误，每条诊断输出一行，格式为 `[severity] 路径:行:列 消息 (错误码)`。存在 error 级诊断时 `check` 以退出码 `1` 结束——仅有 warning 时退出码保持 `0`——因此适合在 CI 中使用。

```bash
nudo check <file>
```

### 示例

```bash
nudo check src/broken.js
```

```
[warning] src/broken.js:2:9 Cannot resolve 'name' on unknown value (nudo:unknown-recv)
[warning] src/broken.js:2:9 Cannot resolve 'toUpperCase' on unknown value (nudo:unknown-recv)
```

无诊断的文件输出：

```
No issues found.
```

`@nudo:returns` 断言失败属于 error 级，会使 `check` 以 `1` 退出：

```bash
nudo check src/assert.js
```

```
[error] src/assert.js:5:0 @nudo:returns assertion failed for case "sample": expected string, got 10. Update the @nudo:returns directive to match the inferred type, or fix the function implementation (nudo-assertion-failed)
```

---

## `nudo harvest`

把已安装的 `@types/<pkg>` TypeScript 声明转成 Nudo env 文件——用 `T.*` 构造器重建这些类型的 TypeScript 源码。`@types` 包必须先安装。

```bash
nudo harvest <pkg> [--out <file>]
```

### 选项

| Option | Description |
|--------|-------------|
| `--out <file>` | 输出的 `.ts` env 文件（默认：`./nudo-harvest-<pkg>.ts`） |

### 示例

```bash
pnpm add -D @types/node
nudo harvest node
```

输出：

```
Harvested @types/node → nudo-harvest-node.ts
  files:    80
  symbols:  1671
  skipped:  148

Usage — add this directive at the top of your JS file:
  /// @nudo:env nudo-harvest-node.ts
```

生成的文件以 `// Auto-generated by nudo harvest — DO NOT EDIT` 开头，导出一个由 `T.fnSig(...)`、`T.union(...)`、`T.instanceOf(...)` 构造器组成的 `defineEnv()` 函数。在需要这些环境类型的文件中引用它：

```js
/// @nudo:env nudo-harvest-node.ts
```

---

## `nudo watch`

监听文件或目录变化，在变更时重新运行推断。

```bash
nudo watch <path>
```

### 选项

| Option | Description |
|--------|-------------|
| `--dts` | 每次运行时生成 `.d.ts` 文件 |

### 示例

监听当前目录：

```bash
nudo watch .
```

监听特定文件：

```bash
nudo watch src/math.js
```

监听并生成 `.d.ts`：

```bash
nudo watch . --dts
```

### 监听模式行为

- **全程序扫描**：监听目录时，Nudo 递归扫描**所有** `.js` 文件，排除 `node_modules`。不含 Nudo 指令的文件也会被分析——其函数类型从被监听文件之间的调用点推导。
- **文件监听**：监听单个文件时，Nudo 监听该文件所在目录，追踪文件变更后重新分析。
- **防抖**：文件变更会防抖（200ms），避免在快速编辑时重复执行。
- **增量重分析**：每次变更只重新分析变更文件及其依赖方（`Incremental: re-analyzed N, skipped M (…ms)`），并以源码位置形式重新打印结果。

---

## 健康检查与 CI 漂移门禁

[`nudo doctor`](/docs/api/cli-reference#nudo-doctor) 一条命令复查整个项目：分析报错，以及——搭配 `--callsites`——[`--emit-cases`](#固化-case-指令) 固化的 `call@` 指令是否仍与使用处如今会产出的调用形状一致。漂移或报错以退出码 `1` 结束，因此 `doctor` 可以作为固化漂移的 CI 门禁。

典型生命周期：

1. **固化一次**——从使用处引导指令（参见[固化 case 指令](#固化-case-指令)）：

   ```bash
   nudo infer lib.js --callsites test.js --emit-cases
   ```

2. **使用处演进**——测试的调用形状变了，固化的指令随之过期。

3. **`doctor` 报告漂移**：

   ```bash
   nudo doctor lib.js --callsites test.js
   ```

   ```
   lib.js
     · 3 function(s), 1 entry-only
     ✗ drift: 5 directive(s) changed (+3 new, -2 removed) — refresh with: nudo infer lib.js --callsites test.js --emit-cases=update

   Summary: 1 file(s) · 1 drift · 0 error(s) · 0 uncovered function(s)
   Result: FAIL (drift or errors found)
   ```

4. **按提示刷新**——命令可原样复制：

   ```bash
   nudo infer lib.js --callsites test.js --emit-cases=update
   ```

5. **复检**——再次运行 `doctor`，恢复绿色：

   ```
   lib.js
     · 3 function(s), 1 entry-only

   Summary: 1 file(s) · 0 drift · 0 error(s) · 0 uncovered function(s)
   Result: OK (uncovered function(s) are informational only)
   ```

CI 中一行命令即可让整个源码树对照测试套件做检查——任一漂移即构建失败：

```bash
nudo doctor src/ --callsites tests/
```

退出码：漂移或分析报错 → `1`；uncovered 函数仅为信息级，绝不会导致失败。全部选项与 `--json` 输出参见 [`nudo doctor` 参考](/docs/api/cli-reference#nudo-doctor)。

---

## 实用工作流

1. **使用监听模式开发**：编辑时在终端运行 `nudo watch . --dts`。每次保存都会触发重新推断和 `.d.ts` 生成。

2. **CI / 提交前检查**：`nudo check` 在存在 error 级诊断时以退出码 `1` 结束，可用于 CI 门禁。`infer` 只接受单个文件——遍历源码文件：

   ```bash
   find src -name "*.js" -not -path "*/node_modules/*" -print0 |
     xargs -0 -n1 nudo check
   ```

3. **生成声明文件**：使用 `nudo infer main.js --dts` 为需要 TypeScript 定义的使用方生成 `.d.ts`。

4. **复用环境类型**：每个 `@types` 包运行一次 `nudo harvest <pkg>`，在需要它的文件里用 `/// @nudo:env ./nudo-harvest-<pkg>.ts` 引用生成的 env 文件。
