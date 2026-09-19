<!-- DESIGN-CONFLICT:cli-semantics → docs/design-cli-semantics.md §2 / design-cli-semantics-conflicts.md
     C-ANY: unknown/any 并格（zh 镜像）。已按 §2 拆开。 -->
---
sidebar_position: 1
description: "类型值——作为单一可计算系统的符号值集合：Abs 代数（shape × term × pred × conf）、指令约束构建器文法与四条设计原则。"
---

# 类型值（Type Values）

类型值是 JavaScript 可能值的集合的符号表示——它不像具体值 `42` 或 `"hello"` 那样只持有一个值，而是表示共享某些特征的*所有*值（如「任意数字」或「字面量 1」）。

类型系统是 **Abs**——`{ shape, term?, pred?, conf }`——而且它是*唯一*的类型系统：一个可计算的值，其约束参与代数（`x > 0` ⇒ `x + 1 > 1`）。分析、展示与投影（`.d.ts` / zod / guard）全部直接消费 Abs；不存在独立的 IR，也没有有损桥接。

## 四个组成

- **shape**——外延载体：值长什么样。种类：`prim`（带 `lit` term 即精确值）、`obj`、`arr`、`tuple`、`fn`、`eff`（`promise<…>` / `generator<…>`）、`brand`（名义实例）、`sum`（联合）、`never`、**`any`**（无约束：JS 值并集，开发者细化）、**`unknown`**（推导失败 / 引擎无信息，Nudo 负责修）。
- **term**——抽象值身份：`lit`（具体值）、`var`（符号 α，如 `A1`）或 `app`（应用表达式，如 `(x + 2)`）。
- **pred**——相对 term 的约束：`(x + 2) > 3`。
- **conf**——抽象的精确度：`exact` / `path` / `widened` / `mock` / `partial` / `opaque`。

构造器（`num()`、`strLit(…)`、`obj({…})`…）与核心函数（`leqAbs`、`formatAbs`、`checkSource`…）见 [core API](../api/core.md)。

### 字面量

带 `lit` term 的 `prim` shape 表示恰好一个具体值——引擎从代码字面量或具体 `@nudo:case` 实参产出它：

```text
25  #exact            // 精确的数字 25
"localhost"  #exact   // 一个特定字符串
```

### 基本类型

不带 `lit` term 的 `prim` shape 是整个域——知道值属于该类型但不知道具体是哪个：

```text
number   // 任意数字
string   // 任意字符串
boolean  // true 或 false
```

### 对象、数组、元组

`obj` 携带已知槽位（每键 `{ value, optional? }`），`arr` 单一元素类型，`tuple` 定长逐元素：

```text
{ host: "localhost", port: 8080, debug: false }
[2, 4, 6]           // 字面量元组——元素抽象时为 arr
number[]            // 抽象元素
```

### 函数与 Promise

`fn` 携带参数名（或 `paramTypes`/`returnType` 签名）；`eff` 包装异步效应，小写渲染：

```text
load: (id) => ?                      // 函数值，返回未知
promise<{ id: 7, name: "u7" }>       // 异步结果
```

### 联合

`sum` 是成员 Abs 的联合——值可能是任一成员：

```text
25 | 9                // 两个精确数字（来自两个调用点）
number | string       // 异构联合
```

`never` 是空集（不可达）。

### any 与 unknown

二者在**产品语义上永不混用**：

| | `any` | `unknown` |
|---|-------|-----------|
| 含义 | 无约束：JS 值的并集；**开发者**负责细化 | **推导失败** / 引擎无信息；**Nudo** 负责修 |
| 来源 | 未标注入口参数、显式 `any()`、refine 解析失败回退 | 求值失败、native 未建模、截断、泄漏、opaque |
| 运算 | 按真实 JS 语义取并集；不是「分析失败」 | 不得假装成合法契约；应触发引擎债诊断 |
| 窄化 | 条件语句可窄化（`typeof` / `===` / `Array.isArray` / `switch` / 真值 / 判别字段） | 用户条件不能「合法化」；先修推导或补 env/mock/refine |
| 展示 | `any`（可带 type-var 如 `A1`） | `unknown` + conf 标注 |
| 产品话术 | 「未写契约 ⇒ 默认约束为 any + JS 运行时效果」 | 「Nudo 遇到无法处理的场景」 |

**规则：** 无约束入口参数显示为 **`any`**，绝不显示为 `unknown`。CLI / `check` 签名遵循此契约。

---

## 指令中的类型表达式

`@nudo:case` / `@nudo:mock` / `@nudo:refine` 的实参用**约束表达式文法**书写——与 `*.nudo.js` 模板相同的构建器：

| 表达式 | 含义 | 示例 |
|-----|-------------|-------------|
| `number()` / `string()` / `boolean()` | 基本类型域 | `@nudo:case "symbolic" (number())` |
| `lit(v)` | 字面量域 | `lit(42)` / `lit("ada")` / `lit(true)` |
| `union(…)` | 成员联合 | `union(lit(1), lit(2))` |
| `shape({ … })` | 对象形状（字段递归） | `shape({ id: number().gt(0) })` |
| `array(…)` / `record(…)` | 数组 / 记录域 | `array(number())` |
| `fn({ … }, …)` | 函数关系 | `fn({ x: number().gt(0) }, number())` |
| 构建器链 | `.gt/.gte/.lt/.lte/.shift/.int…` | `number().gt(0).int()` |
| 裸字面量 | 直接解析 | `42`、`"abc"`、`true`、`[1, 2]` |

指令类型表达式使用上面的约束构建器加具体字面量。`@nudo:mock` body 内写普通 JavaScript 值和闭包，不要把构建器调用当作返回负载。

```javascript
/**
 * @nudo:case "concrete" (5, 3)
 * @nudo:case "symbolic" (number(), number())
 * @nudo:case "mixed" (lit(0), string())
 */
function combine(a, b) {
  return a + b;
}
```

---

## 设计原则

Nudo 的类型值体系遵循四条核心原则，决定运算与推断的行为。

### 1. 字面量保持

所有输入都是字面量时，输出也是字面量。引擎计算出具体结果。

```javascript
combine(5, 3)   // → 8  #exact，不是 number
"ab" + "c"      // → "abc"  #exact
```

信息足够时推断类型保持精确。

### 2. 抽象时拓宽

任一输入抽象（非字面量）时，结果拓宽到相应域——但 Nudo 尽可能保留结构。

```javascript
1 + number        // → number  #path（展示为域）
"xy" + string     // → string  #path（展示为域）
string + string   // → string（无结构可保留）
```

字符串拼接涉及至少一个字面量时，Nudo 内部追踪**模板字符串**——已知前后缀被保留，这正是 `("user-" + x).startsWith("user-")` 在符号 `x` 下也能折叠为 `true #exact` 的原因。

### 3. 惰性联合分布

联合按原样传播。符号值上的运算保持符号——不会急切展开成成员笛卡尔积。这避免组合爆炸并保持相关性：

```javascript
function selfAdd(a) {
  return a + a;   // intension: (A1 + A1)——一个符号变量，不是 A1 + A1'
}

selfAdd(1);       // → 2  #exact（逐调用点）
selfAdd(2);       // → 4  #exact
// Observed: 2 | 4——相关性保持，绝不会是 1+1 | 1+2 | 2+1 | 2+2
```

抽象实参下结果拓宽到代数判定的域（`sum(number, string)` → `string #path`；`selfAdd(number)` → `number #widened`）——只有运算符或方法*必须*区分成员时才逐成员展开。

### 4. 守卫窄化

类型守卫在分支中窄化值。检查 `typeof x === "string"` 或 `x === null` 时，引擎在 `if` 分支窄化 `x`，在 `else` 分支排除这些值。

```javascript
function process(x) {
  if (typeof x === "string") {
    // 这里 x 是 string
    return x.length;  // → number
  }
  if (x === null) {
    // 这里 x 是 null
    return 0;
  }
  // x 已窄化（如输入为 string | number | null 时是 number）
  return x;
}
```

窄化规则支持 `typeof`、`===`、`!==`、`instanceof`、`Array.isArray` 与真值检查。
