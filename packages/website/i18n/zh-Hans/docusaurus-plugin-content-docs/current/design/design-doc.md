---
description: "Nudo 设计内幕：Abs = shape × term × pred × conf 作为唯一类型系统、外延投影用于展示、指令系统与抽象解释。"
---

# 设计文档

> **Nudo** — 面向 JavaScript 的类型推断引擎。类型系统是 **Abs**（`shape × term × pred × conf`）——类型是可计算值，携带约束并参与代数。不存在第二套 IR：dts/LSP/序列化直接消费 Abs，外延视图是单向、有损的渲染。生产分析 Abs 原生。

---

## 1. 愿景与核心思想

### 1.1 问题

TypeScript 的类型系统强大，但它运行在一个**独立于 JavaScript 的语言**中。复杂的类型级计算需要「类型体操」——条件类型、映射类型、`infer`、模板字面量类型——这是一套与开发者日常编写的值级 JavaScript 完全不同的编程模型。

```typescript
// 开发者在值层面编写的代码（直观）：
function transform(x) {
  if (typeof x === "string") return x.toUpperCase();
  if (typeof x === "number") return x + 1;
  return null;
}

// 他们必须在类型层面编写的代码（晦涩）：
type Transform<T> =
  T extends string ? Uppercase<T> :
  T extends number ? number :
  null;
```

这两种表示描述的是**同一个逻辑**，却存在于两个互不相通的世界。当逻辑复杂时，保持它们同步既痛苦又容易出错。

### 1.2 核心洞察

**如果值级代码本身就是类型级计算呢？**

Nudo 既不像 TypeScript 那样静态分析代码，也不像测试那样用具体值运行代码，而是**用抽象值（Abs）执行代码**——类型携带 shape、符号项与约束。执行本身产生类型；约束随运算传播（`x>0` ⇒ `x+1>1`）。

```text
传统方式：   源代码  →  静态分析  →  类型
Nudo：       源代码  +  Abs     →  执行  →  类型 + 约束
```

这不是「通过样例归纳类型」。这是**抽象解释（Abstract Interpretation）**——以「运行代码」这一熟悉心智模型呈现。

### 1.3 关键区分：具体执行 vs 符号执行

| 方式 | 输入 | 输出 | 完备性 |
|----------|-------|--------|--------------|
| 单元测试 | 具体值（`1`、`"hello"`） | 具体结果 | 仅覆盖测试用例 |
| Nudo | Abs（shape × term × pred） | Abs（展示时外延渲染） | 覆盖抽象集合中的所有值 |
| TypeScript | AST（不执行） | 类型 | 覆盖所有语法路径 |

---

## 2. 类型系统：Abs

### 2.1 Abs —— 类型系统本体

**Abs** 是唯一类型系统：`shape × term × pred × conf`。

| 分量 | 含义 |
|-----------|---------|
| **shape** | 结构种类：`any` / `unknown` / `prim` / `obj` / `arr` / `tuple` / `fn` / `brand` / `eff` / `sum` / `never` |
| **term** | 值的符号身份：字面量、变量或应用（`x+1`） |
| **pred** | 相对 term 的约束：`x>0`、合取等 |
| **conf** | 置信度：`exact` / `path` / `widened` / `mock` / `partial` / `opaque` |

`any` 表示「任意 JS 值」（无约束参数）；`unknown` 表示「分析拿不到信息」。二者不同。

Abs 上的运算是代数的：单调算术、比较、`leq` 可赋值、谓词蕴含。`nudo check` 是这套代数上的 CI 门禁（金标 recall = precision = 1.0）。

### 2.2 外延投影（不是第二套类型系统）

不存在第二套 IR。dts（`Case:` JSDoc 行）、LSP hover 表面、序列化与 `*.nudo.js` 模板约束都**直接消费 Abs**——外延视图是一种渲染（展示用 `formatShape`，投影用 `absToTSType` / `absToSchemaSource` / `projectAbsToSchema` / 守卫生成器）。渲染按设计即有损（`formatShape` 丢弃非字面量 term），但不存在回读：分析从不消费投影。生产分析 Abs 原生（单引擎 B-path 转译+执行；B 不可托管源 fail-closed）。

### 2.3 设计原则

**原则 1：字面量保留。** 当所有输入都是字面量时，结果也应该是字面量。

```javascript
combine(5, 3)   // → 8  #exact，而非 number
"ab" + "c"      // → "abc"  #exact
```

**原则 2：抽象时拓宽。** 当任一输入是抽象的（非字面量），结果拓宽为对应的域——但代数能保留的结构仍保留（模板字符串把已知前缀作为 pred 元数据跟踪）。

```javascript
1 + number        // → number  #path
"0x" + string     // → string  #path，模板元数据内部跟踪
```

**原则 3：联合类型懒分配。** 联合类型作为整体传播，只在运算符**必须区分成员**时才展开。这避免了笛卡尔积导致的组合爆炸——并保留相关性（`a + a` 保持同一符号变量：`(A1 + A1)`，绝不会变成 `A1 + A1'`）。

```javascript verify
function selfAdd(a) { return a + a; }
selfAdd(1);  // → 2  #exact
selfAdd(2);  // → 4  #exact
// 合并：2 | 4 —— 绝不是 1+1 | 1+2 | 2+1 | 2+2
```

**原则 4：守卫窄化（逐调用点）。** 类型守卫（`typeof`、`instanceof`、真值检查）只在条件对**该调用的具体实参**确定可判定时分叉分支；抽象实参不窄化，两分支以相同值运行后合并。

```javascript
function len(x) {              // x: number | string（抽象联合）
  if (typeof x === "string") {
    // 抽象实参下两分支都运行，x 不被窄化；
    // 具体调用 len("abc") 才走此分支
    return x.length;
  }
  return -1;
}
```

### 2.4 Abs API

```typescript
// --- 构造（分析 / 测试 / env 模块）---
numLit(value)                 // 精确数值字面量
strLit(value)                 // 精确字符串字面量
num() / str() / bool()        // 基本类型域
never / unknown               // 空集 / 推导失败标记（全集是 `any`）
obj({ key: { value, optional? } })  // 对象形状
abs(shape, term, pred, conf)  // 通用构造器
absFunction(params, { body, env, apply })  // 函数值

// --- 内省 ---
formatShape(a)                // 外延渲染："number", "1 | 2", "string | number"
formatAbs(a)                  // 无损：shape、= term、where pred、#conf
leqAbs(src, tgt)              // 可赋值性（代数的子类型检查）
```

源码级契约用 `@nudo:refine` + `*.nudo.js` 模板（约束构造器）声明，不用裸构造器。

### 2.5 运算符语义（Abs 原生表面）

算术、比较、一元与 spread 都在 Abs 上代数化——不存在独立的 `Ops` 层，也不路由到其他 IR。语言表面分三处：

- `core/src/algebra/surface.ts` — `typeofAbs`、`negAbs`、`notAbs`、`strictEqAbs`（一元运算与严格相等，在 Abs 上）。
- `core/src/algebra/arithmetic.ts` — 二元算术（`add` / `sub` / `mul` / `div` / `mod` / `cmp`）：单调性 + 常量折叠 + 约束传播，在 Abs 上。
- `service/src/evaluator/abs-route.ts` — 分支合并对象形状时的对象 `join` / φ 合并辅助。

```typescript
// 二元算术经代数路由：
add(left, right)       // number + number、string/template 拼接
cmp("<", left, right)  // 数值/字符串比较
```

精化子集（模板字符串、数值区间）把约束作为 term 上的 Pred 携带，而非覆写表；代数在 `+`/比较时读取这些 pred。

---

## 3. 求值引擎（Nudo Engine）

### 3.1 架构概览

```text
parser ──▶ core
            ├── algebra/     ← 类型本体（Abs / Term / Pred / Φ / check）
            └── format       ← 外延渲染（dts / hover / 序列化）
                 │
                 ▼
            service/evaluator    ← Abs 原生：B-path（转译+执行）单引擎
                 │
                 ▼
            service / lsp / vite / dts
```

| 组件 | 职责 |
|-----------|-----------|
| **Parser** | 将 JS/TS 源码解析为 AST（Babel） |
| **Directive Extractor** | 提取 `@nudo:*`；refine/import 在 core 解析 |
| **algebra (Abs)** | 类型即计算：eval / check / leq / generalize |
| **Evaluator（Abs 原生）** | 仅 B-path 转译+执行；B 不可托管源 fail-closed |
| **surface / arithmetic / abs-route** | 算术、比较、一元、spread 经代数路由 |
| **Environment** | 变量绑定（名称 → Abs） |

### 3.2 求值规则

求值器是一个 AST 遍历器。对每种节点类型有对应规则：

**字面量：**
```text
eval(NumericLiteral 42)  →  lit(42)
eval(StringLiteral "hi") →  lit("hi")
eval(NullLiteral)       →  lit(null)
```

**变量：**
```text
eval(Identifier "x")  →  env.lookup("x")
```

**二元表达式：**
```text
eval(BinaryExpression { left, op, right })  →  arithmetic(op, eval(left), eval(right))
```

**条件语句（if-else）：** 测试不可判定时引擎分叉两个分支——**不窄化**任一分支：

```text
eval(IfStatement { test, consequent, alternate }) →
  condition = eval(test)
  if condition === lit(true)   → eval(consequent)
  if condition === lit(false)  → eval(alternate)
  else:
    // 两分支以相同 env 运行；结果合并（无窄化）
    resultTrue  = eval(consequent, env)
    resultFalse = eval(alternate, env)
    return union(resultTrue, resultFalse)
```

### 3.3 窄化规则

窄化是**逐调用点**的：条件对该调用的具体实参求值为*确定*真/假时才选分支（`typeof` / `===` / `Array.isArray` / `switch` / 真值 / 判别字段）。抽象实参（`number()`、union）无法判定条件——两分支以相同值运行后合并；不存在抽象类型交集/减法。`in` / `?.` / `??` 仅部分支持。已验证走查：[控制流收窄](../concepts/control-flow-narrowing.md)。

---

## 4. 复杂结构

### 4.1 循环

循环使用**有界展开**，而非不动点迭代。具体边界按该次数展开。抽象边界——其测试永远不会*确定地为假*——最多展开到上限（`DEFAULT_MAX_LOOP_ITERS = 8`），这是抽象条件的终止守卫。在上限之内，当测试变为确定地为假、或相邻两个循环状态不再变化（`leqAbs`）时提前退出。

```javascript
let sum = 0;
for (let i = 0; i < arr.length; i++) {
  sum += arr[i];
}
```

具体边界逐元素累加得到字面量。抽象边界展开至上限为止，报告各次迭代的拓宽联合（数值累加器为 `number`）——这是终止守卫，而非不动点精化。

### 4.2 闭包与高阶函数

函数是一等 Abs 值（`fn` shape）。当函数作为参数传递时，引擎经其 Abs 表示（参数、函数体、闭包环境）求值调用。

### 4.3 递归

递归由**调用预算**约束（`MAX_CALL_DEPTH = 64`）。超过预算重新进入同一签名的递归调用被截断，结果拓宽为 `unknown`，报 `nudo:recursion-truncated`——不存在不动点精化。预算内的具体基例仍求值为字面量。

### 4.4 异步 / Promise

Promise 建模为效果形状（`eff`）。`await` 解包 promise；`async function` 将返回值包装为 `promise<...>`。

### 4.5 异常与 throws 追踪

Nudo 将异常作为函数类型的一等部分追踪。每个函数不仅有 `returns` 还有 `throws`——这是 TypeScript 类型系统所不具备的。try-catch 会从函数的 `throws` 中移除被捕获的类型；catch 参数接收到所抛类型的联合。

### 4.6 可变性（引用语义，写时复制）

对象 Abs 值采用**引用语义**。赋值复制引用。进入分支时，对被修改的对象进行深拷贝，使每个分支拥有自己的副本；合并时对属性做联合。

---

## 5. 指令系统

指令是引导引擎的结构化注释，使用 `@nudo:` 命名空间。

| 指令 | 用途 |
|-----------|---------|
| `@nudo:case` | 提供具名执行用例（具体或符号化输入） |
| `@nudo:mock` | 用 Abs 值 stub mock 外部依赖 |
| `@nudo:pure` | 标记函数为纯函数，启用记忆化 |
| `@nudo:skip` | 跳过求值；可选的约束构建器表达式直接声明返回类型（如 `@nudo:skip number()`） |
| `@nudo:sample` | 保留的无效果指令（已解析，未消费） |
| `@nudo:refine` | 精化契约：`@nudo:refine param name` / `@nudo:refine return name`（Pred 进入 Abs） |
| `@nudo:env` | 声明运行时环境 API（文件级 `///` 注释） |
| `@nudo:mock-module` | 用 mock 文件替换导入的模块（文件级 `///` 注释） |
| `@nudo:as` | 覆盖下一条语句的值类型（行注释 `//`） |
| `@nudo:replace` | 替换下一条语句中子表达式的类型（行注释 `//`） |

每个指令的完整语法与约束见[指令参考](../concepts/directives.md)。

---

## 6. 相比 TypeScript 的优势

### 6.1 无需独立的类型语言

值级代码即类型计算。无需学习或维护并行的类型语言。

### 6.2 TypeScript 无法表达的计算

算术、正则、复杂字符串操作在 Nudo 的执行模型中很直接；在 TypeScript 类型系统中则极其困难或不可能。

### 6.3 第三方 JS 库

对有 JS 源码的库，Nudo 可直接执行代码推导类型。对 native 或 opaque 依赖，`@nudo:mock` 提供感知 Abs 的 stub。

### 6.4 依赖类型

Nudo 自然产生依赖类型（依赖值的类型），无需特殊语法：

```javascript verify
function clamp(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
// clamp(5, 0, 10) → 5
// clamp(number, 0, 10) → number
clamp(5, 0, 10);
```

### 6.5 更精确的字符串拼接

Nudo 在字符串拼接中保留结构，产生模板字符串类型：

```javascript verify
function apiUrl(path) {           // path: string
  return "https://api.example.com" + path;
}
// Nudo: 带已知前缀的模板 `https://api.example.com${string}`
// TypeScript: string（丢失已知前缀）

apiUrl("/x").startsWith("https://")  // Nudo: true | TypeScript: boolean
```

### 6.6 字面量级别的字符串方法推导

Nudo 在编译时对字面量执行字符串方法：

```javascript
"hello".toUpperCase()    // Nudo: "HELLO"     | TS: string
"hello".slice(1, 3)      // Nudo: "el"        | TS: string
"hello".startsWith("he") // Nudo: true        | TS: boolean
"a,b,c".split(",")       // Nudo: ["a","b","c"] | TS: string[]
```

### 6.7 循环的类型级求值

Nudo 对具体边界的循环求值，计算精确结果：

```javascript
let sum = 0;
for (let i = 0; i < 5; i++) sum += i;
// Nudo: sum → 10 | TS: number
```

### 6.8 声明式精化（无需类型语法）

用户侧契约用 `@nudo:refine` 和 `*.nudo.js` 模板声明——不是 `interface` / `type`：

```javascript
// shapes.nudo.js
export const positive = number().gt(0);
export const user = shape({ id: number().gt(0), name: string() });

// app.js
/// @nudo:import { positive, user } from "./shapes.nudo.js"

/**
 * @nudo:refine x positive
 * @nudo:refine return positive
 */
function inc(x) {
  return x + 1;
}
```

Pred 进入 Abs 并参与代数（`x>0` ⇒ `x+1>1`）。模板的约束构造器直接 lowering 为 Abs 上的 term/pred 约束。

---

## 7. 端到端示例：calc

**源码：**

```javascript verify
/**
 * @nudo:case "concrete" (1, 2)
 * @nudo:case "symbolic" (number(), number())
 */
function calc(a, b) {
  if (a > b) return a - b;
  return a + b;
}
```

**debug "concrete" — `calc(1, 2)`：**
1. 绑定：`a = lit(1)`，`b = lit(2)`
2. 条件：`a > b` → `lit(false)`
3. 走 alternate：`a + b` → `lit(3)`
4. 结果：`lit(3)`

**debug "symbolic" — `calc(number(), number())`：**
1. 绑定：`a = number`，`b = number`
2. 条件：`a > b` → `boolean`（抽象）
3. Fork 两个分支：
   - True：`a - b` → `number`
   - False：`a + b` → `number`
4. 合并：`number`

**`nudo test` 渲染两个用例：**

```text
debug "concrete"  (1, 2) => 3
debug "symbolic"  (number, number) => number
```

---

## 8. 实现路线图

### 已完成
- **求值器 MVP** — Babel、Abs 求值、ops、窄化、调用点观测 + 调试 `@nudo:case`。（原 `infer` CLI 动词已删除；观察面现为 `nudo check` / `nudo test`。）
- **对象/数组** — 对象、数组、元组、Array 方法、`@nudo:mock`。
- **高级语言特性** — 闭包、递归预算、async/Promise、try-catch、类。
- **工具链** — LSP、watch、`.d.ts`、Vite 插件、VS Code 扩展。
- **精化 IR** — 模板/区间精化；源码契约 `@nudo:refine`。
- **Abs 代数（单轨）** — Term/Pred/Abs、算术核、`leqAbs`、generalize、`nudo check` / `nudo test` / `nudo contract` / `nudo export`、CheckJson、金标（recall = precision = 1.0）。
- **调用预算** — depth/cycle/total 守卫，递归 check 不再栈溢出。
- **Emit 往返** — 生成的 `.d.ts` 通过 `tsc --noEmit --strict`（`emit-tsc-roundtrip.test.ts`）。
- **Harvest 内部化** —— 分析经 `bareSpecToAbsModules` 自动补洞 `@types`；env 包生成用 `@nudojs/harvester`。不是产品 CLI 动词。

### 待做
- esbuild / webpack 插件；错误定位 source map

---

## 9. 附录

### 相关工作对比

| 系统 | 方式 | 优势 | 局限 |
|--------|----------|----------|------------|
| TypeScript | 静态分析、结构化类型 | 快速、成熟、生态大 | 独立类型语言、计算能力有限 |
| Flow | 静态分析、名义类型 | 推导好 | 生态衰退 |
| io-ts / zod | 运行时 schema 验证 | 桥接运行时与编译时 | 需手写 schema，非推断 |
| Nudo | 通过执行的抽象解释 | 统一值/类型模型、依赖类型 | 新方案、运算符覆盖工作量 |

### 运算符语义表（非联合）

| 运算符 | Literal × Literal | Literal × Abstract | Abstract × Abstract |
|----------|-------------------|--------------------|---------------------|
| `+`（数值） | `lit(a + b)` | `number` | `number` |
| `+`（字符串） | `lit(a + b)` | `string` | `string` |
| `-`、`*`、`/`、`%` | `lit(op(a,b))` | `number` | `number` |
| `===`、`!==` | `lit(a === b)` | `boolean` | `boolean` |
| `>`、`<`、`>=`、`<=` | `lit(op(a,b))` | `boolean` | `boolean` |
| `typeof` | `lit("...")` | `lit("...")` | `string` |
| `!` | `lit(!a)` | `boolean` | `boolean` |
