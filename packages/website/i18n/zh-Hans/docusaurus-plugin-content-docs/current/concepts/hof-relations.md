---
slug: /concepts/hof-relations
description: HOF 关系 —— Nudo 如何在没有泛型语言的前提下推导 map(xs, f) 这类高阶函数的返回形状（fnRels / entryShapes / hofSites），以及面向 env 作者的 relationFn()。
---

# HOF 关系

**你将带走：** 为什么 `map(xs, f)` 这类高阶函数在 Nudo 里照样能得到真实的返回形状 —— **没有** `<T, U>` 语法，也没有第二套类型系统。

## 问题：符号回调

```js
export function processItems(items, transform, filter) {
  return items.filter(filter).map(transform);
}
```

`transform` 与 `filter` 是 `processItems` 内部没有自己函数体的函数参数。朴素的结构分析会把两侧一起压塌：参数变 opaque、返回变 `unknown` —— 「输入 → 输出」的关系丢失。Nudo 的答案是 **Abs 上的关系**：符号运行期记录的观测，在每个调用点重放。

## 可运行样例

以下三个样例作为一个文件运行 —— `nudo test` 报告每个调用点及其推导结果。摘录里的行号指向这个合并文件。`(n) => ?` 的展示意思是「一个函数值，其函数体已用你的实参跑过」。

### 1. 直接应用的回调

```js verify
export function applyTwice(fn, x) {
  return fn(fn(x));
}

applyTwice((n) => n + 1, 5);
applyTwice((s) => s + "!", "hi");
```

```bash
npx nudojs test hof-relations.js
```

```text
=== applyTwice ===
  call@L5  ((n) => ?, 5) => 7
  call@L6  ((s) => ?, "hi") => "hi!!"
```

同一函数对 number 回调推导出 `7`，对 string 回调推导出 `"hi!!"` —— 每个调用点用该处的实参集合重求函数体。

### 2. map/filter 链

```js verify
export function processItems(items, transform, filter) {
  return items.filter(filter).map(transform);
}

processItems([1, 2, 3, 4], (n) => n * 10, (n) => n % 2 === 0);
```

```text
=== processItems ===
  call@L11  ([1, 2, 3, 4], (n) => ?, (n) => ?) => [20, 40]
```

两个符号回调先 `filter` 后 `map` 串成链 —— 返回数组是精确的：保留偶数（`2`、`4`），各乘 10。

### 3. 映射到字段值

```js verify
export function pluckIds(rows, pick) {
  return rows.map(pick);
}

pluckIds([{ id: 1 }, { id: 2 }, { id: 3 }], (r) => r.id);
```

```text
=== pluckIds ===
  call@L16  ([{ id: 1 }, { id: 2 }, { id: 3 }], (r) => ?) => [1, 2, 3]
```

### 泛化面

同一文件过 `nudo check` 打印**入口**签名 —— 参数诚实地是 `any`（这里没有任何契约），但**返回关系**仍从 body 用法推导：

```text
signatures
  applyTwice(fn: any, x: any) => any
  processItems(items: any, transform: any, filter: any) => arr(B:transform)  throws TypeError
  pluckIds(rows: any, pick: any) => arr(B:pick)  throws TypeError
```

`arr(B:transform)` 读作「由 `transform` 的返回值组成的数组」—— 没有任何调用点并进签名，关系仍然成立。（`throws TypeError` 是 L2 面：无约束 `any` 上的 `.filter` 可能抛 —— 见[诊断](../reference/diagnostics.md#nudo-entry-may-throw)。）

## 机制：Abs 上的关系，不是泛型语言

关系住在 **fn Abs 自身的外延槽**里 —— 没有平行 IR：

| 载体 | 内容 |
|---|---|
| fn shape 的 `paramTypes` / `returnType` | 展示与 `formatShape` 读这里；term 可以是 α 变量（如 `A1`）或输出变量（如 `B:transform`） |
| `PolyFn.fnRels` | 函数参数的关系快照（含 `RelSource`：`promote` / `refine` / `relationFn`） |
| `PolyFn.entryShapes` | 值参数的提升形状快照（如 `items → arr(A1)`） |
| `PolyFn.hofSites` | body 内对这些参数的应用点记录 |
| `impl.relation` | 无 body 的纯关系（由 harvest / mock / `relationFn` 写入） |

关系**由用法产生，绝不预置** —— 符号运行只在观测到使用时提升参数形状：

| body 中观测到 | 提升的形状 |
|---|---|
| `p(x)`、`p(a, b)` | `fn([αOf(args)], B:p)` |
| `arr.filter(p)` | `fn([αOf(element)], boolean)` |
| `arr.map(p)` / `arr.flatMap(p)` | `fn([αOf(element)], B:p)` |
| `arr.reduce(p, init)` | `fn([αOf(init), αOf(element)], B:p)` |
| 未使用 / 仅转发 / 仅属性访问 | 不提升 |

并在**调用点消费**：内建 HOF（`map` / `filter` / `reduce` / `flatMap`）、`$call` 与 class 桥都走同一个入口（`applyCallbackAbs` / `applyAbsFn`），解析顺序 `impl.apply → impl.body → impl.relation → shape-only relation → unknown`。作为签名的读者，值得知道的纪律：先到先定（arrival-first）；提升是对环境条目的**替换**（不 mutate 共享 Abs）；`conf=path`；opaque（截断）证据不记录任何东西。

## 不是 TypeScript 泛型

| | TypeScript | Nudo |
|---|---|---|
| 谁写关系 | **作者**必须标注 `<T, U>` | 从 body 用法**观测**；无需书写 |
| 实例化 | 读者在每处使用时脑内模拟 | 引擎用每个调用点的实参集合重求函数体 |
| 缺少标注时 | 塌成 `unknown` / `any` | 无关系时保持诚实 `unknown`；值参数仍从用法提升 |
| 类型变量 | 一门你要写要读的语言 | α 变量的展示名（`A1`、`B:transform`）—— 仅呈现层 |

没有面向用户的类型参数语法、没有条件类型、没有 `infer` —— 多态 = 抽象解释 + 逐调用点实例化，跑在单一 Abs 轨道（`shape × term × pred × conf`）上。见[边界与非目标](./limits.md)。

## relationFn()：没有 body 的关系

Env、harvester 与嵌入方作者可以直接注册纯关系：

```js
import { relationFn, arr, str } from "@nudojs/core";

// Array.prototype.join: (arr(string)) => string
const join = relationFn([arr(str())], str());
```

设计上的两条规则：**双写** —— `relationFn` 同时写 fn shape 槽（展示面）与 `impl.relation`（求值路径）；**指纹必填** —— 预算身份来自签名的稳定 fingerprint，绝不用返回类型兜底。默认置信 `path`（绝不静默 `exact`）。完整签名：[核心 API 的 `relationFn`](../api/core.md)。收割出的 env 大量使用它 —— 见 [Env harvest](../guides/env-harvest.md) 与 [harvester API](../api/harvester.md)。

## 诚实边界

- **无关系信息 → `unknown`。** 绝不编造。HOF 参数从未被应用、也没有关系声明时，得到的是诚实的 `unknown`，不是猜测的形状。
- **promote 是 warning，不是门禁。** body 用法提升建议（`RelSource: promote`）绝不会让 `check` 失败；只有显式 relation / refine 契约才是 L1 错误。
- **`filter` 不增强元素 pred** —— `xs.filter(p)` 保持元素形状；不把回调的谓词传播到元素类型。
- **不跨文件自动归纳。** 关系跨文件要经 harvest、env 或 `relationFn` —— 不靠跨模块图重新泛化。
- **截断证据不记录。** 分析被截断成 `#opaque` 时，`fnRels` / `entryShapes` / `hofSites` 都不落。见[性能：预算与分析缓存](../guides/performance.md)。

## 下一步

- [Abs](./abs.md) —— 关系所依附的四槽值域
- [语言语义](./semantics.md)
- [Env harvest](../guides/env-harvest.md) —— 收割 env 中的 `relationFn`
- [边界与非目标](./limits.md)
- [核心 API](../api/core.md) —— `relationFn`、`relationFingerprint`
