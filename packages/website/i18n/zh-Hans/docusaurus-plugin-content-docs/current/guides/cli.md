---
sidebar_position: 1
description: "用 nudo 命令行驱动类型推断：对文件或目录运行 infer、把调用点用例固化为指令、在 CI 中做漂移门禁。"
---

# CLI 使用指南

`nudo` CLI 是在 `.js`、`.mjs`、`.ts` 文件上运行类型推断的主要方式。可通过全局安装或 `npx` 使用：

```bash
npm install -g @nudojs/cli
# or
pnpm add -g @nudojs/cli
```

## `nudo infer`

从单个文件推断类型——也可以一次推断目录下的全部推断目标。带 `@nudo:case` 指令的函数使用指令；其余函数也会被分析（全程序推断）——观察到的调用合成为 `call@L` 用例，没有任何调用证据的函数则产出 `entry@L` 用例，参数默认为 `unknown`。

```bash
nudo infer <file-or-directory>
```

目标可以是 `.js`、`.mjs` 或 `.ts` 文件（TypeScript 类型标注在 parser 层剥除，按 JS 语义推断），也可以是目录——目录会递归收集推断目标文件（`.js`/`.mjs`/`.ts`，排除 `.d.ts`），每个文件各自运行一次分析。`--json` 仅支持单文件。

给定 `lib/`：

```js
// lib/slug.js
export function slugify(title) {
  return title.toLowerCase().replace(/ /g, "-");
}
console.log(slugify("Hello World"));
```

```ts
// lib/note.ts
export function note(text) {
  return "note: " + text;
}
```

```bash
nudo infer lib/
```

输出——每个函数一个区块，文件按扫描顺序出现：

```text
=== note ===

Case "entry@L1": (unknown) => unknown
# no call sites found; parameters default to unknown

=== slugify ===

Case "call@L4": ("Hello World") => string
```

`slugify` 从顶层调用得到 `call@L4` 用例——`toLowerCase()` 折叠为字面量，`.replace(...)` 再拓宽为 `string`，因此结果为 `string`。当一个被分析文件从另一个文件导入函数时，被导入函数的用例会出现在 `--- <路径> (imported) ---` 区块中。

### 选项

| 选项 | 描述 |
|--------|-------------|
| `--dts` | 在源文件旁生成 `.d.ts` 声明文件 |
| `--loc` | 在输出中显示源码位置（file:line:column） |
| `--json` | 以结构化 JSON 输出结果——仅支持单文件（示例见 [CLI 参考](../api/cli-reference.md#nudo-infer)） |
| `--callsites <paths...>` | 从使用处文件（测试、示例、应用）挖掘真实参数形状并合成用例——参见[调用点发现](./callsite-discovery.md) |
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

```text
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

```text
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

```text
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

```text
--- src/plain.js (imported) ---

=== add ===

Case "call@L3": (2, 3) => 5
Case "call@L4": ("2", "3") => "23"

Combined: 5 | "23"
```

要从独立的使用处文件（测试、示例、应用）挖掘参数形状，请用 `--callsites` 传入——参见[调用点发现](./callsite-discovery.md)。

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

```text
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

```text
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

```text
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

```text
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

固化绝不触碰手写内容，只管理自己的 `call@` 指令：手写用例一律不改；已有生成指令的函数在 `add` 模式下报告 `already-generated`、在 `update` 模式下全量重新同步；entry-only 函数不写入；不可序列化的用例会被跳过。完整的合并策略表见[调用点发现 —— 合并策略](./callsite-discovery.md#合并策略)；编程接口见 [service API —— 用例固化](../api/service.md#用例固化)。

---

## `nudo check`

检查单个文件的类型错误。`check` 每条诊断输出一行，格式为 `[severity] 路径:行:列 消息 (错误码)`；存在 error 级诊断时以退出码 `1` 结束——仅有 warning 时退出码保持 `0`，因此适合在 CI 中使用。

```bash
nudo check src/broken.js
```

```text
[warning] src/broken.js:2:9 Cannot resolve 'name' on unknown value (nudo:unknown-recv)
[warning] src/broken.js:2:9 Cannot resolve 'toUpperCase' on unknown value (nudo:unknown-recv)
```

提示行、error 级断言与退出码规则参见 [`nudo check` 参考](../api/cli-reference.md#nudo-check)。

---

## `nudo interface`

interface 产品：逐函数精化契约与来源分层。无侧车无注解时，每个导出也因其调用点推断获得**隐式**（implicit）接口；侧车绑定与 `@nudo:refine` 提升为**手写**（handwritten）；`--emit` 固化段显示为**生成**（generated）。

```bash
nudo interface [paths...]       # 只打印，永不写盘
nudo interface --emit <file> --fn <name>   # 固化推断域
nudo interface --draft <file>   # 从已有逻辑生成可审阅契约草稿
nudo refine                     # nudo interface 的别名
```

### `--draft` — 代码优先 / 迁移

从**已有实现**生成可审阅的 interface 草稿。适用于迁移既有 JS 包，或「先写逻辑、后补契约」。

```bash
nudo interface --draft lib.js           # 打印 *.nudo.draft.js 模块
nudo interface --draft --write lib.js   # 写入 lib.nudo.draft.js
nudo interface --draft lib.js --fn greet
```

草稿中的证据分层（**不发明义务**）：

| 证据 | 含义 |
|------|------|
| `callsite` / `directive` | 观察到的实参域（`joinThenProject`） |
| `body` | 实现里对参数读到的字段 — **仅建议**，永不作为 check 义务 |
| `symbolic` | 返回位 `generalizeFromAst` 兜底 |
| 省略的参数槽 | 无证据 — 注释 `/* tighten */`，不是契约 |

规则：手写契约跳过不覆盖；产物 `*.nudo.draft.js` **不** ambient 绑定；审阅后复制进 `*.nudo.js` 才生效。`--emit` 固化调用点事实，`--draft` 是给人审的起点。

文件内有调用点、无侧车：

```js
// lone.js
export function scale(x) {
  return x * 2;
}

scale(3);
scale(5);
```

```bash
nudo interface lone.js
```

```text
lone.js
  scale  [implicit]  (x: 3 | 5) → 6 | 10
```

有手写侧车（`calc.nudo.js` 引入 `std.nudo.js`）：

```bash
nudo interface calc.js
```

```text
calc.js
  addTax  [handwritten]  (x: number().gt(1)) → number()
  greet  [handwritten]  (name: union(lit("ada"), lit("bob"))) → string()
```

### 写盘

`--emit` 按目标文件角色分两条路径（设计 §7.3）：

1. **Root 驱动下行**——文件含手写契约根时，`--fn` 可点名推导闭包内的**下游**导出。`nudo interface --emit lib.js --fn add2` 写入 `add.nudo.js` 的组合式段（`const x = positive.shift(1); export const add2 = fn({ x }, x.shift(2))`），含 `derived-from: lib.js:add4` 标注与 `import { positive } from "./std.nudo.js"`（与根侧车同构）。
2. **调用点域**——对目标文件自身导出，把观察到的调用点域投影为侧车 `@generated` 段。域根（本文件无调用点的导出）需要 `--callsites <paths...>`。

```bash
# 从手写根推导下游契约
nudo interface --emit lib.js --fn add2

# 本文件调用点域
nudo interface --emit double.js --fn double
```

```text
Updated double.js → double.nudo.js
  written: double
  re-run `nudo check double.js` to see the persisted interfaces in action
```

```javascript
// double.nudo.js
// @generated by nudo — do not edit; regenerate with `nudo interface --emit`
// source: double.js:double
export const double = fn({ x: lit(4) }, lit(8));
```

```javascript
// add.nudo.js（由 lib.js:add4 下行）
// @generated by nudo — do not edit; regenerate with `nudo interface --emit`
// source: add.js:add2
// derived-from: lib.js:add4
import { positive } from "./std.nudo.js";

const x = positive.shift(1);
export const add2 = fn({ x }, x.shift(2));
```

```bash
nudo interface double.js
```

```text
double.js
  double  [generated]  (x: lit(4)) → lit(8)
```

跨原始类型字面量域固化为 union（设计形态）：

```javascript
// mixed.nudo.js
export const scale = fn({ x: union(lit(42), lit("a")) }, number());
```

### 选项

| 选项 | 说明 |
|------|------|
| `--emit` | 写/更新 `@generated` 段而非打印（update 模式：剥离并重写生成段；幂等） |
| `--draft` | 从已有逻辑生成可审阅契约草稿（打印 `*.nudo.draft.js` 模块） |
| `--write` | 配 `--draft`：写入/更新 `<file>.nudo.draft.js`（绝不碰手写 `*.nudo.js`） |
| `--fn <name>` | 配 `--emit`/`--draft`：只处理这些导出名（可重复）。emit 时可点名 root 推导闭包内的下游导出 |
| `--all` | 配 `--emit`：目标为全部顶层导出（显式 opt-in；优先 `--fn` 保持 diff 可审） |
| `--dry-run` | 配 `--emit`：打印 unified diff 而非写盘 |
| `--exit-on-diff` | 配 `--emit` + `--dry-run`：侧车将变更时退出码 `1`（CI 门禁） |
| `--callsites <paths...>` | 使用现场文件，为打印/写盘提供域证据 |

退出码：`0` 正常；`1` 用于用法错误、`--exit-on-diff` 有变更、以及 emit issue（`nudo:interface-name-clash`——手写绑定优先，跳过写入）。

```text
$ nudo interface --emit calc.js --fn addTax
calc.js: no interface changes
  skipped addTax (name-clash)
  [error] nudo:interface-name-clash: sidecar already has a handwritten binding 'addTax' (calc.js); handwritten wins — skipping emit for it
# exit 1
```

证据不变时重跑 `--emit` 是 no-op（`no interface changes`）；证据消失时（如 update 未带 `--callsites`），已固化段**原样保留**，绝不静默删除。侧车自动绑定可用 `package.json` → `"nudo": { "interface": { "autoBind": false } }` 在项目级整体关闭——开关同样接线到 `nudo check` 与 LSP 执法路径，不只打印路径。

**emit 白名单（Phase 3）。** `package.json` → `"nudo": { "interface": { "emit": ["src/api/**"] } }` 限制可写的**源文件**路径（侧车写在源文件旁）。省略/空 = 不按路径过滤。模式为相对项目根的 glob（`**` 跨目录，`*` 不跨）。未带 `--fn`/`--all` 时，root 驱动 emit 只刷新已有下游 `@generated` 段，不发明新契约。

固化段是快照：`nudo check` 对其做语义比较，源码演进时报 `nudo:interface-drift` warning——见 [check](../guides/check.md#interface-诊断)。`nudo doctor` 对侧车已含 `@generated` 的文件把同一 drift 作为 CI 门禁。

---

## `nudo types`

类型即计算视图：展示每个函数在 Abs 代数上的**内涵**——形状、`term`、`pred` 与置信度——而不是 `infer` 汇报的外延形状。精化参与代数运算，所以声明的前置条件会出现在推断出的 term 内部：

```bash
nudo types docs/examples/algebra/0-add-intensional.js --assume "x>0"
```

```text
nudo types  0-add-intensional.js
assume: x > 0

add(unknown, unknown)
  number | string
  conf: partial

scale(number)
  number
  term: (x + 1)
  pred: (x + 1) > 1
  conf: path

twice(number)
  number
  term: ((x + 1) + 1)
  pred: ((x + 1) + 1) > 2
  conf: path
```

`scale` 的签名是 `number`，`term: (x + 1)`、`pred: (x + 1) > 1`——`@nudo:refine x positive` 的前置条件（`x > 0`）参与了运算并推出更强的后置。`add` 没有约束，其 `number | string` 结果为 `conf: partial`。选项（`--fn`、`--assume`、`--generalize`）见 [`nudo types` 参考](../api/cli-reference.md#nudo-types)；这个文件的同一命令已被 CI 钉在[示例矩阵](https://github.com/nudojs/nudo/blob/main/docs/examples/README.md)里。

---

## `nudo harvest`

把已安装的 `@types/<pkg>` TypeScript 声明转成 Nudo env 文件——用 `T.*` 构造器重建这些类型的 TypeScript 源码。`@types` 包必须先安装：

```bash
pnpm add -D @types/node
nudo harvest node
```

在需要这些环境类型的文件中引用生成的 `nudo-harvest-node.ts`：

```js
/// @nudo:env nudo-harvest-node.ts
```

选项（`--out`）与输出格式参见 [`nudo harvest` 参考](../api/cli-reference.md#nudo-harvest)。

---

## `nudo watch`

监听文件或目录，在变更时重新运行推断：

```bash
nudo watch .            # 当前目录
nudo watch src/math.js  # 单个文件
nudo watch . --dts      # 同时生成 .d.ts
```

目录会递归收集推断目标文件（`.js`/`.mjs`/`.ts`，排除 `node_modules`）；变更防抖 200ms，每次运行只重新分析变更文件及其依赖方。完整行为参见 [`nudo watch` 参考](../api/cli-reference.md#nudo-watch)。

---

## 运行时校验器生成

`nudo generate` 把推断出的类型转成运行时产物——Zod schema、类型守卫函数与 `.d.ts` 声明——依据同一份 `@nudo:case` 证据：

```bash
nudo generate src/user.js               # zod + guard + dts 输出到 stdout
nudo generate src/user.js --format zod  # 只要 zod
nudo generate src/user.js --output dist # 写出 dist/user.nudo.zod.ts、user.nudo.guard.ts、user.d.ts
```

`nudo emit` 是仅 `.d.ts` 的别名（`generate --format dts`），`nudo guard` 是仅守卫函数的别名（`--format guard`）；守卫优先走无损 Abs 路径（形状 + 可判定的数值 Pred），失败时回退到外延投影。选项与输出格式参见 [`nudo generate` 参考](../api/cli-reference.md#nudo-generate)。

---

## 健康检查与 CI 漂移门禁

[`nudo doctor`](../api/cli-reference.md#nudo-doctor) 一条命令复查整个项目：分析报错，以及——搭配 `--callsites`——[`--emit-cases`](#固化-case-指令) 固化的 `call@` 指令是否仍与使用处如今会产出的调用形状一致。漂移或报错以退出码 `1` 结束，因此 `doctor` 可以作为固化漂移的 CI 门禁。

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

   ```text
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

5. **复检**——再次运行 `doctor`，恢复绿色：`Result: OK (uncovered function(s) are informational only)`。

CI 中一行命令即可让整个源码树对照测试套件做检查——任一漂移即构建失败：

```bash
nudo doctor src/ --callsites tests/
```

退出码：漂移或分析报错 → `1`；uncovered 函数仅为信息级，绝不会导致失败。全部选项与 `--json` 输出参见 [`nudo doctor` 参考](../api/cli-reference.md#nudo-doctor)。

---

## 实用工作流

1. **使用监听模式开发**：编辑时在终端运行 `nudo watch . --dts`。每次保存都会触发重新推断和 `.d.ts` 生成。

2. **CI / 提交前检查**：`nudo check` 在存在 error 级诊断时以退出码 `1` 结束，可用于 CI 门禁。传目录即可一次检查其下全部推断目标（`nudo check` 递归扫描目录并跳过 `node_modules`）：

   ```bash
   nudo check src/
   ```

   需要排除特定路径（如生成文件）时，再显式遍历要门禁的文件：

   ```bash
   find src \( -name "*.js" -o -name "*.mjs" -o -name "*.ts" \) \
     -not -name "*.d.ts" -not -path "*/node_modules/*" -print0 |
     xargs -0 -n1 nudo check
   ```

3. **生成声明文件**：使用 `nudo infer src/ --dts`（或单个文件）为需要 TypeScript 定义的使用方生成 `.d.ts`。

4. **复用环境类型**：每个 `@types` 包运行一次 `nudo harvest <pkg>`，在需要它的文件里用 `/// @nudo:env ./nudo-harvest-<pkg>.ts` 引用生成的 env 文件。

5. **查看代数视图**：精化签名表现异常时，读它的内涵——`nudo types src/math.js --assume "x>0"` 展示推断类型背后的 `term` / `pred` / `conf`（见 [`nudo types`](#nudo-types)）。
