---
sidebar_position: 8
---

# 调用点发现

`@nudo:case` 指令让你可以精确控制推断，但要为真实库里的每个导出函数手写指令，工作量非常可观——而且手写的 case 很少与函数*实际上*被使用的方式吻合。调用点发现把这个方向反过来：不是你向 Nudo 描述输入，而是 Nudo 阅读你已有的使用方代码——测试、示例、上游应用——采集真实的参数形状与结果，并据此合成 case。

```bash
nudo infer lib/ --callsites test/
```

## 快速开始

给定一个小库：

```js
// lib/slugify.js
module.exports = function slugify(title) {
  return title.toLowerCase().replace(/ /g, "-");
};
```

……以及一个调用它的测试：

```js
// test/slugify.test.js
const slugify = require("../lib/slugify");

it("slugifies titles", () => {
  expect(slugify("Hello World")).toBe("hello-world");
});
```

以测试作为使用方代码，对库运行推断：

```bash
nudo infer lib/ --callsites test/
```

输出：

```
=== slugify ===

Case "call@5": ("Hello World") => "hello-world"

Combined: string
```

这个 case 不是任何人写的——它采集自测试文件的第 5 行，因此被命名为 `call@5`。每个被记录的调用点都会成为一个合成的 case；对同一函数的多个调用点会合并为联合类型（combined type），与手写 `@nudo:case` 指令的行为完全一致。

### 选项

| 参数 | 描述 |
|----------|-------------|
| `<target>` | 要分析的文件或目录。目录会递归扫描。 |
| `--callsites <paths...>` | 一个或多个使用方文件或目录（测试、示例、应用）。目录会递归扫描。 |
| `--emit-cases [mode]` | 把采集到的用例写回被分析文件，成为 `@nudo:case` 指令（`add` 只补没有用例指令的函数；`=update` 重新同步已生成的指令）——参见[持久化采集结果](#持久化采集结果) |

## 工作原理

调用点发现分两个阶段运行。

### 阶段 1 —— 采集

对每个使用方文件，求值器执行该文件的顶层语句，并捕获它能观察到的每一个调用：

- **顶层求值** —— `require` 调用、初始化代码以及模块顶层的直接调用都会执行，因此它们的实参值会被捕获为具体的类型值。
- **测试回调注入** —— 传给 `it`、`test`、`describe` 的回调会以 `unknown` 参数被调用，从而执行测试体并捕获其中的调用。回调体在求值器内部执行——测试框架本身从不运行。只有解析到被分析目标内函数的调用才会被保留。
- 每个观察到的调用产生一条 **CallRecord**：被调函数名、参数类型、结果类型、调用是否抛出，以及调用位置。

测试套件从不真正针对你的代码运行——采集过程在 Nudo 的求值器内执行的是测试文件的*形状*，而不是你的真实模块。

### 阶段 2 —— 匹配与合成

采集到的记录通过三条路径与被分析文件中定义的函数匹配：

1. **导出名** —— 使用方按名字绑定了某个导出（例如 `const { merge } = require("@hapi/hoek")`），因此该记录指向以 `merge` 这个名字导出的函数。再导出与 barrel 中转通过"在函数首个定义处打标签、把后续导出名收进其 aliases"来处理。
2. **函数名** —— 记录的被调函数名与目标文件中声明的某个函数同名。
3. **单导出模块路径** —— 唯一导出就是函数本身的文件（`module.exports = function f() {}`）按模块路径匹配，因为这类模块的导出名全都相同（`default`），仅靠名字匹配会跨文件冲突。

匹配到的记录会作为合成的 `call@L` case 注入 `analyzeFile`，其中 `L` 是该调用在使用方文件中的行号。完全没有收到任何记录的函数仍会得到一个参数为 `T.unknown` 的 `entry@L` case，以便输出其签名——这些函数会被标记为仅入口（entry-only）。

## 安全性设计

挖掘真实使用方，前提是记录必须可信。三道防线把坏记录挡在门外：

- **归属门禁。** 只有一条记录的解析来源模块（经由调用所在函数的模块，或所绑定导出的目标模块）确实指向某个文件时，该记录才参与该文件的匹配。没有这道门禁，测试文件里定义的同名 helper 会把它的记录涂抹到恰好声明了同名函数的每一个文件上——在一次试验中，一条 test-helper 记录污染了 22 个文件、产出 51 个假的 "precise" 结果。
- **使用方环境泄漏标记。** 在执行使用方代码期间捕获的记录会被这样标记。它们作为*参数证据*被信任（调用方传入的形状是真实的），但求值器绝不会把测试局部的求值环境误认成库自身的环境。
- **`never` / `never` 过滤。** 结果类型为 `never` *且*抛出类型也为 `never` 的记录其实并没有真正返回——求值在调用中途被打断了（例如 `new Promise(async ...)` 执行器里的 `await`）。这类记录会在注入前被过滤掉，而不是被当作"返回 never"。

## 试验结果

以两个真实库、它们各自的测试套件作为使用方代码运行：

| 库 | 版本 | 精确率 | 错误数 |
|---------|---------|--------------|--------|
| `@hapi/hoek` | 9.3.0 (25 files, 42 functions) | 54.8% → **98.6%** | 291 → **0** |
| `@discoveryjs/json-ext` | 0.5.7 | 77.8% → **91.8%** | 41 → **0** |

这两个库都没有写任何指令——结果第二列里的每一个 case 都是由某个记录到的调用点合成的。

## 已知边界

- **仅入口回退。** 没有任何使用方调用的函数仍会产出 `entry@L` case，但参数是 `T.unknown`——签名存在，类型不存在。
- **嵌套函数。** 匹配链解析的是顶层声明与提升（hoisted）声明。定义在另一个函数体*内部*的函数表达式目前不参与名字匹配。
- **双入口变体。** 当同一行为可以通过两种入口形状触达（例如直接导出与再包装导出）时，每个入口各自贡献自己记录到的 case；组合类型是两个入口的并集，可能比任何单一入口都更宽。

## 持久化采集结果

采集到的用例只存在于采集它的那次运行中——记录被匹配、注入为 `call@L` 用例、打印，然后就丢弃了。`--emit-cases` 把它们持久化：将合成的用例写回被分析文件，成为真正的 `@nudo:case` 指令，使这些形状在采集运行之外依然存在。

```bash
nudo infer lib/ --callsites test/ --emit-cases         # add：补齐尚无用例指令的函数
nudo infer lib/ --callsites test/ --emit-cases=update  # update：重新同步已生成的指令
```

`add` 只补齐完全没有用例指令的函数。`update` 更进一步：先剥离此前生成的 `call@` 指令，在剥离后的源码上重新分析，再回写刷新后的指令集——因此它还能暴露使用处的*漂移*。测试改了实参，就会以 diff 的形式显现；`--emit-cases=update --dry-run --exit-on-diff` 把它变成 CI 门禁——diff 非空即以 `1` 退出。两种模式都幂等（已同步的文件输出 `No changes.`）。

### 合并策略

固化绝不触碰手写内容；它只管理自己的 `call@` 指令：

| 函数已有用例状态 | `--emit-cases`（add） | `--emit-cases=update` |
|------------------|------------------------|------------------------|
| 手写 `@nudo:case`（名字不以 `call@` 开头） | 一律不动 | 一律不动 |
| 已有生成指令（`call@` 前缀） | 不动——报告 `already-generated` | 全量重新同步：按当前调用证据增/改/删（只剩空 JSDoc 块时整块删除） |
| 零指令，但有调用证据 | 写入指令 | 写入指令 |
| 完全没有调用点（entry-only） | 不写入——报告 `entry-only` | 不写入——报告 `entry-only` |

### 限制

- **只支持可序列化的形状。** 指令文本能表达原始类型（`T.number`/`T.string`/`T.boolean`/`T.unknown`/`T.never`）、字面量、普通对象、数组、元组与联合。实参含函数、Promise、类实例、`bigint` 或 `symbol` 值的用例无法固化——会被跳过并报告 `no-serializable-cases`（函数其余可序列化的用例仍会写入）。
- **`call@` 是保留前缀。** 名字以 `call@` 开头的 `@nudo:case` 一律视为生成物：`update` 可能改写或删除它。不要把手写用例命名为 `call@…`。

端到端工作流示例（引导与漂移检测）见 [CLI 使用指南 —— 固化 case 指令](/docs/guides/cli#固化-case-指令)；基于这些函数的编程接口见 [service API —— 用例固化](/docs/api/service#用例固化)。

要主动检测这种漂移——在 CI 中或发版前——运行 [`nudo doctor`](/docs/guides/cli#健康检查与-ci-漂移门禁)：它对你的文件重跑同一条重新固化链路，任一生成指令会变化即以退出码 `1` 结束。

## 编程接口

service 包把两个阶段都暴露了出来：

```typescript
import { collectCallRecords, analyzeFile } from "@nudojs/service";

// Phase 1: harvest call records from a usage-site file
const records = collectCallRecords(usagePath, usageSource);

// Phase 2: analyze with external records injected as call@L cases
const result = analyzeFile(filePath, source, activeCases, records);
```

| 导出 | 描述 |
|--------|--------|
| `collectCallRecords(filePath, source)` | 对一个使用方文件运行阶段 1，返回其调用记录。 |
| `analyzeFile(filePath, source, activeCases?, externalCallRecords?)` | `analyzeFile` 接受采集到的记录作为第四个参数；这些记录会被匹配并作为 `call@L` case 注入。 |

完整的 `AnalysisResult` 结构请参阅 [service API 参考](/docs/api/service)。

## 下一步

- **[语言语义](/docs/guides/semantics)** —— 求值器能对调用点发现交给它的形状做些什么：`this` 绑定、Promise、可迭代对象等。
- **[CLI 使用指南](/docs/guides/cli)** —— 所有 `nudo infer` 与 `nudo watch` 选项。
