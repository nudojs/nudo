---
description: "@nudojs/core API —— Abs 类型体系（shape × term × pred × conf）、构造器、可赋值性与格式化、运算符语义、模板字符串、mock 帮助函数与 Environment。"
---

# @nudojs/core

core 包提供 Abs 类型体系、运算符语义以及环境抽象，是 Nudo 抽象解释引擎的核心支撑。类型体系**只有一个——Abs**：分析、展示与投影（`.d.ts` / zod / guard）全部直接消费 Abs，不存在平行 IR。

## Abs

`Abs` 就是类型系统——一个可计算的值 `{ shape, term?, pred?, conf }`：

- **shape**——外延载体：值长什么样（`prim`、`obj`、`arr`…）。
- **term**——抽象值身份：`lit`（具体值）、`var`（符号 α，如 `A1`）或 `app`（应用表达式，如 `(x + 2)`）。约束因此能参与代数：`x > 0` ⇒ `x + 1 > 1`。
- **pred**——相对 term 的约束（如 `(x + 2) > 3`），恒真时为 `undefined`。
- **conf**——`Confidence`：`"exact" | "path" | "widened" | "partial" | "opaque"`。

### Shape 种类

| `shape.k` | 描述 |
|-----------|-------------|
| `prim` | 基本类型域（`number`、`string`、`boolean`、`bigint`、`symbol`）；带 `lit` term 即具体值 |
| `obj` | 已知槽位的对象——每个键为 `{ value: Abs; optional?: boolean }` |
| `arr` | 单一元素 Abs 的数组 |
| `tuple` | 定长、逐元素 Abs |
| `fn` | 函数值——参数名，或仅签名的 `paramTypes`/`returnType` |
| `eff` | 效应包装（`promise` / `generator`）包裹内层 Abs——渲染为 `promise<inner>` |
| `brand` | 名义类实例（如 `MemoryStore`、`Error`） |
| `sum` | 成员 Abs 的联合 |
| `never` | 空集（不可达） |
| `any` | 无约束 JS 值并集 —— 未标注入口参数的默认；开发者负责细化 |
| `unknown` | 推导失败 / 引擎无信息 —— **不是** `any` 的同义词；Nudo 负责修 |

详见 [Abs — any vs unknown](/docs/concepts/type-values#any-vs-unknown)。

---

## Abs 构造器

```typescript
// 基本类型（域，无 term）
num(): Abs
str(): Abs
bool(): Abs

// 字面量值（prim shape + lit term）
numLit(value: number): Abs
strLit(value: string): Abs
boolLit(value: boolean): Abs

// 对象：按属性名给槽位
obj(slots: Record<string, { value: Abs; optional?: boolean }>): Abs

// 符号变量（内涵签名的形参）
anyVar(id: string, conf?): Abs
numVar(id: string, pred?, conf?): Abs

// 常量
never: Abs            // { shape: { k: "never" }, conf: "exact" }
// any / unknown 是不同产品概念：
//   any     —— 无约束（未标注入口的默认）
//   unknown —— 推导失败（引擎债），conf 通常为 partial/opaque
unknown: Abs          // { shape: { k: "unknown" }, conf: "partial" }

// 通用构造器（pred=true 会被丢弃）
abs(shape: Shape, term: Term | undefined, pred: Pred | undefined, conf: Confidence): Abs

// 函数值（impl：body AST、闭包 env 或直接派发的 apply）
absFunction(params: string[], impl: { body?: Node; async?: boolean; env?: AstEnv; apply?: (args: Abs[]) => Abs }): Abs
```

term 与 pred 也是一等公民：`lit(value)` / `v(id)` 构造 term，`eq/ne/lt/le/gt/ge`、`ptypeof`、`and/or/not` 构造 pred（`pred.ts`、`term.ts`）。

---

## 核心函数

| 函数 | 描述 |
|----------|-------------|
| `leqAbs(src, tgt, opts?)` | 可赋值性：`src` 能否流入 `tgt`？返回 `{ ok, reason? }`——`reason` 是 Nudo 式 `actual ⊭ expected` 证据，不是 TS 文案。 |
| `formatAbs(a, opts?)` | 人类可读单行：shape、`= term`、`where pred`、`#conf`。 |
| `formatShape(a)` | 仅 shape 渲染（`{ host: "localhost", port: 8080 }`、`[2, 4, 6]`、`promise<{…}>`）。 |
| `formatAbsMultiline(a, label?)` | 多行展示（CLI inlay）。 |
| `absToString(a)` / `shapeToString(s)` | 调试渲染，含 `term=`。 |
| `litValue(a)` | 若 Abs 是精确字面量，取出具体值。 |
| `confJoin(a, b)` | 连接两个置信度（取更差的）。 |
| `checkSource(source, opts?)` | CI 门禁：Abs 上的精化/Pred 蕴含——见 [Check](../guides/check.md)。 |
| `runTranspiled` / `callTranspiledExportFull` / `analyzeFn(…)` | Abs 原生求值入口（B-path）。 |
| `generalizeFromAst(…)` | 内涵签名提取——`intension:` 行与 `A1` 形参的来源。 |

---

## 运算符语义（Abs 原生）

运算符在 Abs 上代数化。算术、比较、一元与 spread 位于：

| 位置 | 内容 |
|-------|------|
| `core/src/algebra/surface.ts` | `typeofAbs`、`negAbs`、`notAbs`、`strictEqAbs`（一元运算 + 严格相等） |
| `core/src/algebra/arithmetic.ts` | 二元算术（`+` `-` `*` `/` `%`）与比较 |
| `service/src/evaluator/abs-route.ts` | 二元/一元运算与对象 spread 的 union 逐成员路由 |

唯一求值引擎是 B-path（`core/algebra/exec`：转译 → 以 Abs 值执行 `new Function`）。B 不可托管源 fail-closed（`unknown` / 空导出）。

---

## 模板字符串

字面量与抽象字符串拼接（至少一侧是字面量）会产生**模板** Abs——已知前后缀作为 pred 元数据保留，使 `startsWith` / `endsWith` / `includes` 精确。

```typescript
createTemplateAbs(parts: Abs[]): Abs   // 如 [strLit("0x"), str()]——单段或
                                       // 全字面量输入会坍缩为普通 Abs
isTemplateLike(a: Abs): boolean
```

数值区间在代数里不是类型包装——窄化出的边界是 term 上的 **pred**（`x >= 0` 存 `ge(x, lit(0))`），`checkSource` 的蕴含门禁正是在它上面推理。

---

## Mock 帮助函数

`@nudo:mock` 表达式与 env 文件共享的类型安全 mock 构造器——`MockHelper` 是一个普通记录，其值字段为 **Abs**（唯一类型系统；分析从不读回投影）。`@nudojs/parser` 经 `parseNudoMockExpr` 从 `@nudo:mock` 表达式构建它；`@nudojs/service` 的 `mockDirectivesToAbsSeeds` 将其转为 Abs mock 种子：

```typescript
type MockHelper = {
  kind: "mock-helper";
  returnValue?: Abs;        // stub().returns(v)
  resolvedValue?: Abs;      // stub().resolves(v) —— 调用返回 Promise<v>
  rejectedValue?: Abs;      // stub().rejects(v) —— 调用抛出/拒绝 v
  onFirstCallValue?: Abs;   // stub().onFirstCall(v)
  onSecondCallValue?: Abs;  // stub().onSecondCall(v)
  withArgsCases?: { args: Abs[]; returnValue: Abs }[];  // stub().withArgs(...)
  callsFakeImpl?: { params: string[]; body: Node; async?: boolean };  // stub().callsFake(fn) —— 调用时执行 fn
};

function stub(): MockHelper;
function spy(): MockHelper;
function mock(): MockHelper;
```

`stub`、`spy`、`mock` 返回相同的基础 helper，只是语义意图不同；行为来自**挂在 `stub`/`spy` 上的静态构造器**——每个都返回完整的 `MockHelper`（没有实例级链式调用）：

```typescript
stub.returns(v: Abs): MockHelper
stub.resolves(v: Abs): MockHelper       // 调用返回 Promise<v>
stub.rejects(v: Abs): MockHelper        // 调用以 v 拒绝
stub.onFirstCall(v: Abs): MockHelper
stub.onSecondCall(v: Abs): MockHelper
stub.withArgs(...args: Abs[]): MockHelper
stub.callsFake(fn: { params: string[]; body: Node; async?: boolean }): MockHelper
spy.returns(v: Abs): MockHelper
```

在 `@nudo:mock` 表达式中写的是 sinon 风格链 `stub().…`——解析器对整条链做模式匹配，构造等价的 `MockHelper`（`stub()` 调用本身不会执行）：

```javascript
/**
 * @nudo:mock fetch = stub().resolves({ ok: true })
 * @nudo:mock parse = stub().withArgs(string()).returns(number())
 */
```

`withArgs` 按位置逐位匹配实参（sinon 深比较的保守近似），在更长链中优先级高于全局 `returnValue`；`callsFake(fn)` 直接解析为 fake 函数值本身，调用时会以真实实参执行它——与行内箭头函数 mock 走同一机制。

---

## Environment

Environment 管理变量绑定（名称 → Abs），支持词法作用域。

```typescript
createEnvironment(parent?, bindings?)
```

- `parent` — 可选的父 Environment，用于作用域链。
- `bindings` — 可选的 `Map<string, Abs>`，作为初始绑定（默认：`new Map()`）。

### Environment 方法

| 方法 | 描述 |
|--------|-------------|
| `lookup(name)` | 获取绑定到 `name` 的 Abs；沿父链查找；未找到时返回 `unknown` Abs。 |
| `bind(name, value)` | 在当前 env 中设置绑定；返回 env 以支持链式调用。 |
| `update(name, value)` | 更新当前 env 或父 env 中已有的绑定；返回 `boolean` 表示是否成功。 |
| `extend(bindings)` | 创建带有新绑定的子 env（普通 `Record<string, Abs>`）。 |
| `fork()` | 创建共享当前作用域链的空子 env——分支分叉时使用。 |
| `has(name)` | 检查名称是否已绑定（当前 env 或父 env）。 |
| `snapshot()` | env 的深拷贝（用于分支分叉）。 |
| `getOwnBindings()` | 获取仅当前 env 绑定的 `Record<string, Abs>`。 |
