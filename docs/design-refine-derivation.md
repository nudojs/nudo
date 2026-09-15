# Interface 分层推导与契约生成

> **状态**：设计稿（未实施）。
> **真理源关系**：类型本体仍是 `Abs = shape × term × pred × conf`（见
> [`design-kernel-merge.md`](./design-kernel-merge.md)）。本文定义的是
> **接口表面**——约束如何落在同名 `*.nudo.js` 并与源码自动绑定，以及
> case 在新模型中的位置。
>
> **一句话**：interface = 接口（泛化域 / 契约）；case = 特例（debug / 断言）。
> `foo.nudo.js` 同名导出自动绑定 `foo.js`；顶层手写契约向下推导；
> 调用点观察向上沉淀；手写不覆盖，冲突即检查。
>
> **命名**（见 §0）：产品面用 **interface**；机制层「精化约束 / Abs pred」
> 仍可称 refinement。现行 `@nudo:refine` 作兼容别名保留。

---

## 0. 命名：interface vs refine

「refine / 精化」偏 PL 术语（refinement types），对 JS 开发者生僻；
本文模型本来就是**接口优先**，产品词用 **interface** 更贴角色。

| 层 | 用词 | 例 |
|---|---|---|
| **产品 / 文档 / CLI / IDE** | **interface** | `nudo interface`、`nudo.interface.emit`、「接口漂移」 |
| 侧车文件 | `*.nudo.js`（不变） | 已是 Nudo 约束模块，不叫 `*.refine.js` |
| 源码内注解（兼容） | `@nudo:refine` **别名** `@nudo:interface` | 渐进迁移；主路径是侧车绑定，本就不写注解 |
| 机制 / 内核 | refinement、Pred、约束代数 | `refine.ts`、`entryReqs`、check 内部名可不动 |
| 诊断码 | 产品文案用 interface | 如 `nudo:interface-drift`（原 refine-drift） |

**与 TS `interface` 的碰撞：** TS interface 主要是对象结构；我们的
interface 还含参数/返回约束、数值界、字面量域、代数组合。文档里写
「Nudo interface」并给出 `fn` / `shift` 示例，避免被读成「只有 shape」。

**不采用 `contract` 作主词**：与 gradual typing 的 contract wrapper 易混；
且中文语境「接口」已与本设计一致。`contract` 可在散文里作同义描述。

---

## 1. 模型

### 1.1 两层语义（纠偏）

此前讨论里容易把 refine 说成「粗粒度类型」（`number | string`），这是错的。

| 概念 | 含义 | 例子 |
|---|---|---|
| **interface**（旧称 refine） | 观察或契约所刻画的**域**（可含字面量、界、形状） | 调用点只有 `(42)` 与 `('a')` → 接口是 `42 \| 'a'`；契约是 `x positive` |
| **case** | 域上的**一个点**（可执行、可断言） | `@nudo:case "num" (42) => 44` |

refine 是 **泛化（join）**，不是 widen 到基类型。`42 | 'a'` 比 `number | string`
更精确，且仍是接口——只是接口恰好由有限见证张成。

### 1.2 正常开发流

```
对外顶层接口（手写 refine，exported）
        │  代数推导 / 约束下行
        ▼
文件内接口（生成 refine，exported，落 *.nudo.js）
        │
        ▼
私有函数 / 变量（推导结果仅内存态，不落盘）
        │
        ▼
case（特例，可选，debug / nudo test）
```

- **先定对外顶层接口**，再从顶层推文件内，再推私有（私有只参与分析）。
- **每一次重新生成** = 内部或外部接口发生变化（可 diff、可 review）。
- **用户手动维护的不生成**；推不出、与声明不一致、固化后漂移 → **报给用户**，
  这就是接口检查。
- **契约文件只承载 exported 绑定**——私有推导是手段，不是接口产物。

### 1.3 与 case 的分工

| | refine | case |
|---|---|---|
| 角色 | 接口 | 特例 / 见证 |
| 来源 | 手写契约；调用点域；分层推导 | 手写；`--emit-cases` 固化 |
| 用途 | check 门禁、代数推导、dts/IDE 默认表面 | `nudo test`、CodeLens 切场景、what-if |
| 是否生成 | 是（生成物可再生成） | 可选（debug 固化），非接口主产物 |

case **不删除**。`nudo:case-inconsistency`（见证 ⊭ 契约）仍依赖 case 作为
refine 的对账对象。

---

## 2. 约束表面：只走 `*.nudo.js`

### 2.1 同名导出自动绑定（主约定）

**`foo.nudo.js` 里导出的名字，自动成为 `foo.js` 里同名绑定的约束。
源码不必写 `@nudo:refine` 注释。**

```js
// add.js —— 干净，无契约注释
export function add2(x) {
  return x + 2;
}

// add.nudo.js —— 契约旁路，按名绑定 add2
import { positive } from "./std.nudo.js";

const x = positive.shift(1);           // call add2(x+1)，x positive
export const add2 = fn({ x }, x.shift(2)); // body x+2
```

绑定规则：

| `*.nudo.js` 导出 | 与 `*.js` 的关系 |
|---|---|
| 名字是对应 `.js` 的 **exported** 绑定 | **自动绑定**为该导出的约束 |
| 名字不是该 `.js` 的导出 | 本地模板，可被其他 `*.nudo.js` import，**不绑源码** |
| 函数导出 | 必须是 `fn(…)` 且 `isNudoConstraint` —— **一等约束**，带 `fn.params` / `fn.returns` |
| 变量 / 常量导出 | 裸 `NudoConstraint`（`number().gt(0)`、`shape({…})`、嵌套 `fn` 等） |

**私有函数不绑定、不落盘。**

- 侧车导出 = **模块接口面**；未 `export` 的绑定不是接口，没有同名契约。
- 若允许私有名进侧车：`helper` / `parse` / `internal` 等极易与本地模板
  撞名，生成物也会被内部实现细节淹没。
- 分层推导仍会算私有函数的参数/返回约束（Abs 内存态，供 check / 内部
  传播），但**不写入** `*.nudo.js` 导出。要看私有推导结果走 `nudo interface`
  打印或 IDE hover，不进契约文件。

函数契约的结构形式（`fn` 由 `@nudojs/core` 提供）：

```js
fn({ x: positive, y: number().int() }, /* returns? */ positive4)
// 读法：x 满足 positive，y 满足 int；返回满足 positive4（可省略 = 无后置）
```

链式推导时用局部量承接中间节点，再装进 `fn`：

```js
const x = positive.shift(1);
export const add2 = fn({ x }, x.shift(2));
```

**与源码 `@nudo:refine` 的关系：**

- 主路径：旁路同名绑定，源码零注释。
- `@nudo:refine` **仍支持**（向后兼容 / 愿把契约写在导出函数上时）；
  只对 **exported** 函数有意义（与绑定范围一致）。
- 二者同时存在且不一致 → `nudo:interface-conflict`（error）；一致则合并，不报。
- 跨文件共享模板继续用 `/// @nudo:import`（那是模块边，不是绑定边）。

导入共享模板不变：

```js
/// @nudo:import { positive } from "./std.nudo.js"   // 仅当源码内 @nudo:refine 时需要
```

旁路自动绑定**不需要**源码侧 import 指令——分析 `add.js` 时直接加载
`add.nudo.js`。

### 2.2 `*.nudo.js` 如何加载（为何不走 Node require）

**`*.nudo.js` 不是用户项目里的 Node 模块，而是约束 DSL。** 执行路径是：

```
host loadModule(spec, fromFile)     ← CLI 读盘 / LSP 读打开缓冲
        │  得到源码文本
        ▼
execNudoModule(src)                 ← 沙箱：剥 ESM 壳，new Function
        │  注入 number/shape/fn/…
        ▼
exports: Record<string, Constraint | FnInterface>
```

文件里写的 `import { number } from "@nudojs/core"` **只是为了编辑器与
可读性**；引擎不解析 `node_modules` 里的 `@nudojs/core`，而是注入同一套
构建器。因此：

| 不用 Node require / 动态 import 的原因 | 说明 |
|---|---|
| 宿主可能不是 Node 运行时语义 | LSP 从 buffer 读，路径/未保存内容与磁盘 ESM 图不一致 |
| 不依赖用户工程的 `node_modules` | 约束构建器版本由 Nudo 引擎锁定，避免用户装错 core |
| 沙箱 | `.nudo.js` 只能造约束，无 fs/net；分析器可安全执行第三方模板 |
| 与 `loadModule` 统一 | 已有 `RefineResolveOpts.loadModule`；`.nudo.js` 互 import 走同一宿主 |

**相对路径 `*.nudo.js` 互 import 也走 `loadModule` 递归，不引入 Node ESM：**

```js
// add.nudo.js
import { positive } from "./std.nudo.js";  // 引擎：loadModule("./std.nudo.js", from=add.nudo.js)
import { number } from "@nudojs/core";     // 引擎：注入，不 load
```

实现要点（Phase 1 硬前置，替换「再发明一套编译」）：

1. `execNudoModule` 对 **相对/包外 `.nudo.js` specifier** 调 `loadModule`
   递归求值，缓存按源码内容（已有 `nudoModuleExecCache`）。
2. 对 `@nudojs/core`（及约定 builtin）**注入**，与今日一致，仅扩充
   `fn/lit/union/shift/partial/…`。
3. 循环依赖：检测 spec 环，报 `nudo:interface-cycle`，不 stack overflow。
4. **不要**把 `.nudo.js` 编译成内部 AST 再解释——那就是「设计应避免的编译」；
   保持「真实 JS + 注入 API」。

### 2.3 构建器需要补的能力

现有 `ConstraintBuilder`（`packages/core/src/algebra/constraint.ts`）只有
`gt/ge/lt/le/int/min/…`。分层推导还需要：

| API | 含义 | 例 |
|---|---|---|
| `.shift(n)` | 数值约束平移（保序） | `positive.shift(1)` |
| `lit(v)` | 字面量域 | `lit(42)` |
| `union(...cs)` | 域的 join | `union(lit(42), lit("a"))` |
| `fn(params, returns?, opts?)` | **一等 NudoConstraint**（函数接口） | 见下 |
| `.and(...cs)` / 既有 preds | 契约合取 | 已有链式 `.gt().int()` 覆盖标量 |

**`fn` 是普通约束引用，不是平行类型。** 与 `shape` / `number()` 同级：

- `isNudoConstraint(fn(...)) === true`
- 可 `export` / `import` / 作为其他约束的字段值
- 读字段用属性访问，和 `shape` 字段一样是约束本身，不是旁路类型

在 `NudoConstraint` 上扩展函数形态（示意，字段名可再定）：

```ts
type NudoConstraint = {
  __nudoConstraint: true;
  prim?: PrimName;
  preds: Pred[];
  fields?: Record<string, NudoField>;   // shape
  element?: NudoConstraint;             // array
  members?: NudoConstraint[];           // union
  int?: boolean;
  isOptional?: boolean;
  /** 函数接口：与 shape.fields 同构的「一等」槽位 */
  fn?: {
    params: Record<string, NudoConstraint>;
    returns?: NudoConstraint;
    throws?: NudoConstraint;
  };
};
```

构建器：

```js
const add2 = fn({ x: positive }, positive.shift(2));
// add2.__nudoConstraint === true
// add2.fn.params.x     —— 参数约束（仍是 NudoConstraint）
// add2.fn.returns      —— 返回约束
```

组合时把 `fn` 当值用（高阶、回调字段、再导出）：

```js
export const mapMaybe = fn(
  { f: fn({ x: number() }, number()), xs: array(number()) },
  array(number()),
);

// shape 字段里嵌函数接口
export const api = shape({
  add2,                    // 直接嵌一等约束
  onDone: fn({ ok: boolean() }, undefined /* 或 never() */),
});
```

链式读写用属性，**不**发明第二套引用系统：

```js
import { add2 } from "./add.nudo.js";
export const add4 = fn({ x: positive }, add2.fn.returns.shift(1));
```

（若希望更短，可另加 getter 别名 `.returns` → `.fn.returns`，语义同一。）

**与 Abs 共用代数。** `shift` / `union` / 后续组合子不得是约束层私有重写——
实现必须走与 Abs 相同的 term/pred 变换（`shift` ≡ 在 term 上 `+ n` 后重写
界；`union` ≡ `joinAbs` 的约束投影）。`fn` 的 instantiate / check 则是
「参数 Abs 实例化 + 返回 Abs ⊭ returns」，复用现有 `analyzeFn` / entry 路径，
不为函数接口另建求值器。

### 2.4 生成物写组合式，不展开

**展开写法是错的。** 对整数 `gt(1)` 与 `positive.shift(1)` 看起来差不多；
对复杂形状（嵌套 `shape`、字段级约束）展开会：

1. 丢失推导关系——读的人看不出「这个约束从谁、经哪条调用边来」。
2. 可读性灾难——深层嵌套变成重复字面量墙。
3. 破坏模块依赖——`*.nudo.js` 之间的 import 应与源码 import **基本同构**。

生成物 **必须** 保留组合与 import，且导出名 = 源码绑定名（自动绑定）：

```js
// add.nudo.js（生成）
import { positive } from "./std.nudo.js";

// derived-from: lib.js:add4 → call add2(x+1); body x+2
const x = positive.shift(1);
export const add2 = fn({ x }, x.shift(2));
```

依赖规则：

| 源码依赖 | 契约文件依赖 |
|---|---|
| `lib.js` import `add.js` | `lib.nudo.js` import `add.nudo.js` 的 `add2` 再组合 |
| `lib.js` 的共享模板 | 生成物 import 同一 `*.nudo.js` 导出并 `.shift` |
| 无源码边 | 不造假契约边 |

**链式，不加总。** 返回约束挂在已推导的入参上（`x.shift(2)`），
不要写成 `positive.shift(1 + 2)`——后者抹掉中间节点，和源码逻辑脱节。
重新生成时 diff 反映的是**关系变化**（`shift(1)` → `shift(2)`），不是一堆
`gt(n)` 字面量跳动。

### 2.5 Utility helpers

语义对齐 [TS Utility Types](https://www.typescriptlang.org/docs/handbook/utility-types.html)，
但 **命名跟既有构建器走小写**（`number()` / `shape()` / `array()`），不用
TS 的大驼峰：

| helper | 语义（约束层） | 对应 TS |
|---|---|---|
| `partial(c)` | shape 字段全变可选 | `Partial<T>` |
| `required(c)` | 去掉可选 | `Required<T>` |
| `pick(c, keys)` | 子形状 | `Pick<T, K>` |
| `omit(c, keys)` | 去掉字段 | `Omit<T, K>` |
| `record(k, item)` | 键域 → 值约束 | `Record<K, V>` |
| `readonly(c)` | 标记只读（分析侧可忽略或用于写回检查） | `Readonly<T>` |
| `exclude` / `extract` | union 成员过滤 | 同名 |
| `nonNullable(c)` | 去 `null`/`undefined` | `NonNullable<T>` |

原则：帮助函数是**约束代数上的组合子**，同样投影到 Abs，不是另起一套
类型系统。手写与生成都可以用：

```js
import { shape, number, string, partial, pick } from "@nudojs/core";

export const user = shape({
  id: number().int().gt(0),
  name: string().min(1),
  email: string().min(3),
});

export const userId = pick(user, ["id"]);
export const userPatch = partial(user);
```

### 2.6 生成物标识

沿用「生成块 + 可剥离」策略，导出名已是源码名（无 `derived_` 前缀需要）：

```js
// @generated by nudo — do not edit; regenerate with `nudo interface --emit`
import { positive } from "./std.nudo.js";

// derived-from: lib.js:add4
const x = positive.shift(1);
export const add2 = fn({ x }, x.shift(2));
```

- 文件头 `@generated` 块；`update` 模式先剥离生成段再重写。
- **手写导出永不覆盖**：emitter 若发现该名已是手写绑定则**跳过写入**并报
  `nudo:interface-name-clash`（同一文件不能字面出现两个 `export const add2`）。
- **import 与组合照写**，与源码依赖同构（见 §2.3），不展开成 `number().gt(n)`。

---

## 3. 两种 refine 来源

同一 `@nudo:refine` 表面，**来源（provenance）不同**，检查语义不同。

### 3.1 契约 refine（top-down）

- **谁写**：用户，在对应 `*.nudo.js` 里**同名导出**（可选：源码 `@nudo:refine`）。
- **语义**：∀ 入口满足契约的调用，后置必须满足（现有 check）。
- **如何下行**：在契约入口上做 Abs 求值 / generalize，沿调用图把
  **参数约束**与**返回约束**传播到被调函数，写入被调方同名 `*.nudo.js`。

### 3.2 域 refine（bottom-up）

- **谁生成**：引擎，从**观察到的调用点**。
- **语义**：被调用方式的精确 join——`42 | 'a'`，不是 `number | string`。
- **与 call@ 的关系**：现有 `call@L*` / `call@symbolic` 已是域的见证；
  新模型把这些见证的 **join 沉淀为 refine**，case 仍可另存为 debug。

### 3.3 二者相遇

```
手写契约 refine     生成域 refine
     │                    │
     └────── check ───────┘
              │
   域 ⊄ 契约  →  error（接口被用穿）
   域 ⊆ 契约  →  ok
   域变化     →  drift（若曾固化）
   契约推不出 →  info（opaque / 截断）
```

---

## 4. 分层推导算法

### 4.1 根（roots）

按优先级：

1. **手写 refine 的导出函数** —— 契约根。
2. **仅有外部调用记录的导出函数** —— 域根（`--callsites` / 跨文件 call@）。
3. 无任何证据的导出 —— 不生成，或生成 `unknown` 域并标 `entryOnly`（info）。

私有函数**不是根**；其 refine 只能从上层传播得到。

### 4.2 下行（契约路径）

对每个根 `f`，在其入口 Abs（entryReqs）上求值 body：

1. 调用点 `g(e1, …, en)`：把实参 Abs **投影**为 `g` 的参数约束
   （shape / pred / 字面量域；`x+1` 在 `x>0` 下 → 值 `>1`）。
2. `g` 的返回 Abs **回传**为 `f` 路径上的中间结果，继续参与 `f` 的代数。
3. 同一 `g` 被多个上层调用时，参数约束取 **join**（接口是并集，不是交集）；
   若上层契约互斥且应区分场景，用 case/debug，不拆 refine。

### 4.3 上行（域路径）

现有 call@ 收集保留，输出改为：

- 每函数：实参域 join、返回域 join、throws 域。
- 序列化进该函数源文件旁的 `*.nudo.js`（生成导出）。
- `call@L` 明细仍可作为 case 固化（可选）。

### 4.4 不动点与文件边界

- 同文件内调用：在单次 `analyzeFile` / module graph 内传播到不动点。
- 跨文件：以**导出边界**为切面——上文件写入下文件的 `*.nudo.js`；
  下文件变更使上文件 L0 / check 缓存失效（已有 `*.nudo.js` → parent 逐出）。
- 循环依赖：按现有 module graph 截断策略，结果 conf 降为 `partial`，
  不写入生成 refine（诚实缺口）。

---

## 5. 工作示例

### 5.1 源码（无契约注释）

```js
// add.js
export function add2(x) {
  return x + 2;
}

// lib.js
import { add2 } from "./add.js";

export function add4(x) {
  return add2(x + 1) + 1;
}
```

`std.nudo.js`（共享模板库，手写）：

```js
import { number } from "@nudojs/core";
export const positive = number().gt(0);
export const positive4 = number().gt(4);
```

`lib.nudo.js`（顶层手写契约，同名绑定 `add4`）：

```js
import { positive, positive4 } from "./std.nudo.js";

export const add4 = fn({ x: positive }, positive4);
```

`add.js` 不必写任何 `@nudo:refine`——分析 `add.js` 时自动读 `add.nudo.js`。

### 5.2 推导（代数）

记 `positive = (0, +∞)`。每一步在**上一步结果**上继续运算，不把路径偏移
加总后从根重写：

| 步骤 | 约束 | 说明 |
|---|---|---|
| `add4` 入口 | `positive` | 手写 `lib.nudo.js` |
| 实参 `x+1` | `positive.shift(1)` | → **`add2` 参数** |
| `add2` 体 `x+2` | `x.shift(2)`（x 为上一行） | → **`add2` 返回** |
| `add4` 返回 `add2(…)+1` | `add2.fn.returns.shift(1)` | 与手写 `positive4` 对账 |

链式关系直接对应源码：

```
positive ──shift(1)──► add2 入参 ──shift(2)──► add2 返回 ──shift(1)──► add4 返回
              ▲                ▲                              ▲
         call (x+1)        body x+2                      outer +1
```

落到 `add.nudo.js` 的是 **add2 的** `fn`；`add4` 手写契约在 `lib.nudo.js`。
若 `add4` 也改为生成，则 `lib.nudo.js` import `add2` 再 `.shift(1)`。

### 5.3 生成物（同名绑定）

`add.nudo.js`（生成）：

```js
// @generated by nudo — do not edit
// source: add.js:add2
// derived-from: lib.js:add4 (contract: x positive)
import { positive } from "./std.nudo.js";

const x = positive.shift(1); // call add2(x+1)
export const add2 = fn({ x }, x.shift(2)); // body x+2
```

`lib.nudo.js` 若改为生成 `add4` 后置（手写契约优先时不会覆盖）：

```js
// @generated by nudo — do not edit
import { add2 } from "./add.nudo.js";
import { positive } from "./std.nudo.js";

export const add4 = fn({ x: positive }, add2.fn.returns.shift(1)); // outer +1
```

依赖与源码同构：`lib.js → add.js` ⇒ `lib.nudo.js → add.nudo.js`。
生成物**不**写成 `positive.shift(1 + 2 + 1)`——那是把链加总后从根重算。

### 5.4 域 interface 示例（调用点）

```js
// 使用处
add2(42);
add2("a");
```

调用点域是 `add2` 隐式 interface 的一部分（参数域 join）。对账对象是
**有效契约** `add2.fn.params.x`（手写或已 emit 的生成段），不是另一个导出名：

| 检查 | 含义 |
|---|---|
| `42 ⊆ add2.fn.params.x` | ok（若契约为 `positive.shift(1)`） |
| `"a" ⊄ add2.fn.params.x` | `nudo:interface-domain-exceeds` |

域**不**用 `export const add2_domain` 落盘——那会与「侧车导出 = 源码导出
绑定」规则打架（`add2_domain` 不是 `add.js` 的导出）。域要么留在隐式
interface / 缓存里，要么在 emit 时并入 `fn` 的见证字段（后续选项）。

---

## 6. 冲突与检查码

| code | severity | 触发 |
|---|---|---|
| `nudo:constraint-violated` | error | 推断返回/调用 ⊭ 手写契约（已有） |
| `nudo:case-inconsistency` | error | case 见证 ⊭ refine（已有） |
| `nudo:interface-domain-exceeds` | error | 生成域 ⊄ 有效契约（手写 ∪ 生成） |
| `nudo:interface-drift` | warning | 固化的生成 interface ≠ 今日重算结果 |
| `nudo:interface-name-clash` | error | 生成段与手写同名导出冲突（手写优先） |
| `nudo:interface-conflict` | error | 源码 `@nudo:refine`/`@nudo:interface` 与旁路同名绑定不一致 |
| `nudo:refine-underivable` | info | 上层约束传不下来（opaque / 循环 / native） |
| `nudo:refine-entry-only` | info | 导出无契约根且无调用域 |

`nudo check` 聚合上表；`nudo doctor --callsites` 将 drift 作 CI 门禁
（类比现有 `--emit-cases=update --exit-on-diff`）。

---

## 7. 隐式推导 vs 显式落盘

### 7.1 三层存在形态

| 形态 | 默认 | 用户可见 | 用途 |
|---|---|---|---|
| **隐式 interface** | **始终** | hover / `nudo interface` 打印 | 分析、check、下行传播的输入 |
| **显式契约**（手写或 `--emit`） | 仅用户要求 | `*.nudo.js` 进 VCS | 接口审查、CI drift、跨人共享 |
| **内部缓存** | 引擎自管 | 否（`.nudo/cache/` 或内存） | 加速 after-edit / 跨会话 |

推导结果在分析会话内**总是可算**——没有旁路契约文件时，check / IDE 用
的是：手写 `@nudo:refine`（若有）→ 调用点域 / 入口 Abs。  
**但**没有顶层契约根时，**不存在** `positive.shift(1)` 这种下行链——
`positive` 来自根契约或共享模板；无根时隐式接口 = 推断 Abs / 域 join，
不是「假装有契约」。落盘不是推导前提，而是把隐式结果固化的可选动作。

### 7.2 不要对每个文件生成契约

对全仓库无差别 `--emit` 会：

- 淹没 review：内部实现细节变成「接口 diff」；
- 与源码重构赛跑：重命名/拆文件 → 契约文件大面积假 diff；
- 用户没必要维护本就推导得出的东西。

**默认不写盘。** 只有用户点名要固化的导出才进 `*.nudo.js`。

### 7.3 生成 filter

CLI 必须默认可过滤，而不是 `--all` 一把梭：

| 选择器 | 例 | 含义 |
|---|---|---|
| 路径 | `nudo interface --emit src/lib.js` | 该文件（及其 `*.nudo.js`） |
| 导出名 | `--fn add2 --fn add4` | 仅这些 exported 绑定 |
| 已有契约文件 | `--emit --known` | 只更新已存在 `*.nudo.js` 中的生成段 |
| 项目配置 | `nudo.json` → `interface.emit: ["src/api/**"]` | 包级白名单 |
| 全量（显式） | `--emit --all` | 明确 opt-in；文档警告勿默认 |

无参数 `nudo interface` = **只打印**，不写盘。

### 7.4 与缓存打通

隐式 refine 应走现有分析缓存体系，而不是再发明一套：

| 已有 | 衔接 |
|---|---|
| L0 generalize memo | 下行入口 Abs 可 memo |
| `check` 整文件 memo + `*.nudo.js` → parent 逐出 | 显式契约变更仍逐出；隐式缓存随源码 hash 失效 |
| `fnAnalysisCache` | 每函数有效 refine（手写∪生成∪隐式）可挂在同一 key 上 |
| 跨会话 | 可选 `.nudo/cache/refine-*.json`（Abs/约束序列化），**不是**用户 `*.nudo.js` |

规则：

- **用户契约文件**（`foo.nudo.js`）= 产品表面，进 git，手写/emit 都算。
- **缓存**（`.nudo/cache/`）= 引擎私有，可丢、可重建，不参与 review。
- 显式契约变更 → 逐出依赖它的 L0/check（已有机制）。
- 源码变更 → 隐式 refine 与缓存失效；**不**自动改写已落盘契约（只报 drift）。

### 7.5 LSP：按导出粒度生成/更新

CLI filter 的同一套选择器应暴露给编辑器，粒度到 **单个 export**：

| 动作 | 命令 / UI | 参数 |
|---|---|---|
| 打印当前隐式 interface | `nudo.interface` | `{ file, functionName? }` |
| 固化单个导出 | `nudo.interface.emit` | `{ file, functionName, mode: "add"\|"update" }` |
| 固化当前文件全部导出 | 同上省略 `functionName` | 仍尊重 `nudo.json` 白名单 |
| 更新已固化的生成段 | `mode: "update"` | 先剥离 `@generated` 段再写 |
| CodeLens | `⚡ persist refine` / `↻ update refine` | 仅在该导出有隐式结果且未固化 / 已固化时出现 |

行为约定：

- LSP emit **立即**改 `*.nudo.js` 并触发依赖文件失效（与 CLI 同一写盘器）。
- 手写契约导出不提供 update（只读展示来源 `handwritten`）。
- 固化后 CodeLens 变为 drift 提示（若隐式结果已变），不静默改文件。
- 与 `nudo.selectCase` 并列：case 管 debug 场景，refine emit 管接口固化。

---

## 8. IDE 表面（选择）

CodeLens 默认面对 **refine（接口）**，case 降为 debug 副层：

```text
● interface / default       ← 默认；有契约用契约，否则隐式推导
○ case "num" (42)
○ case "call@L12" ("a")
⚡ persist interface        ← 可选：固化本导出（§7.5）
```

- **interface / default**：hover / inlay 走 symbolic + entryReqs（generalize 已有）。
- **选 case**：现有 TypeValue + activeCases 路径。
- `activeCases` 需区分「未选（default）」与「选了 index 0」。
- inlay 参数侧已只显示显式 refine——与本文一致：**接口表面 = refine**；
  未固化时 inlay 可展示隐式推导结果（灰/次要样式），标明 `derived`。

---

## 9. 命令面（草案）

| 命令 | 行为 |
|---|---|
| `nudo interface [paths…]` | **只打印**每导出有效 interface 与来源（handwritten / generated / implicit） |
| `nudo interface --emit [paths…]` | 按 filter 写盘；无路径且无 `--all` / `--fn` / `--known` → 报错提示用法 |
| `--fn <name>`（可重复） | 仅这些 exported 绑定 |
| `--known` | 只更新已有 `*.nudo.js` 生成段 |
| `--all` | 显式全量（文档警告） |
| `--dry-run` / `--exit-on-diff` | diff / CI 门禁 |
| `--roots <export…>` | 限定下行契约根（默认全部手写契约导出） |
| `nudo doctor` | interface drift（仅针对已落盘契约） |
| `nudo check` | §6 code；隐式契约参与判定，不要求已落盘 |

> 兼容：`nudo refine` 别名指向 `nudo interface`，一个大版本后可弃。

配置（`nudo.json`）：

```json
{
  "interface": {
    "emit": ["src/public/**"],
    "ignore": ["**/__tests__/**"]
  }
}
```

`--emit-cases` **保留**（debug 固化），文档标注非接口主路径。

---

## 10. 与现有机制的映射

| 现状 | 新模型中的位置 |
|---|---|
| `@nudo:refine` + `*.nudo.js` | 手写契约；语法不扩内联；侧车同名绑定为主 |
| `generalize` entryReqs | 下行推导入口 Abs |
| call@ 合成 case | 域证据源；join 为隐式域 refine |
| `--emit-cases` | 可选 debug 固化；接口路径改为 `refine --emit`（默认不写） |
| `nudo:case-inconsistency` | 保留：case ⊭ refine |
| `checkReturnConstraint` | 保留；有效契约 = 手写 ∪ 已落盘生成 ∪（判定用）隐式 |
| LSP `selectCase` | default/refine 档 + 按导出 `refine.emit` |
| L0 / check memo / `*.nudo.js` 逐出 | 隐式缓存 + 显式契约失效路径 |
| `.nudo/cache`（新） | 隐式 refine 跨会话缓存，非用户契约 |

Abs 代数本身**不需要新内核**：下行只是「在根入口约束下跑已有
`evalNode` / B-path，把实参/返回 Abs **投影回 NudoConstraint**」。

---

## 11. 分阶段实施

### Phase 1 — 表面与沉淀（可先落地）

1. `ConstraintBuilder` 增加 `shift` / `lit` / `union` / `fn`（core），**实现与 Abs
   代数共用**；首批 utility：`partial` / `pick` / `omit`（小写，对齐 `number()`/`shape()`）。
2. 隐式 interface 始终可算；`nudo interface` 默认只打印；`--emit` 必须带 filter
   （`paths` / `--fn` / `--known`），禁止无参全量写盘。
3. `nudo:interface-domain-exceeds` / `nudo:interface-drift` / `nudo:interface-name-clash`。
4. LSP CodeLens：`● interface / default` + case 副层；hover default 走 symbolic；
   `nudo.interface` / `nudo.interface.emit`（按 `functionName`）。
5. 文档：directives / check / CLI；case 降为 debug 叙事。

**验收**：无 `*.nudo.js` 时隐式 refine 仍可打印；`--emit src/lib.js --fn add2`
只写该导出；`add` 双调用点域 `union(lit(42), lit("a"))`；手写 `positive` 时
`"a"` 报 domain-exceeds。

### Phase 2 — 契约下行（provenance，不编译）

1. 调用图 + 实参 Abs → 被调参数约束投影（走 Abs，不另写一套）。
2. **求值期维护 provenance 图**（边带调用位点 / `+k` / join）；emit 直接
   打印该图的组合式，**禁止**事后从 Abs 反编译链。
3. 同名 `*.nudo.js` 生成 `fn({…}, returns?)`，跨文件 `import` 上游再组合；
   源码零注释；**仅 emit 选中的导出落盘**。
4. 多调用者 join（Abs join 后投影）；循环/截断 → `interface-underivable`。
5. 隐式结果接入 L0 / check memo；可选 `.nudo/cache` 跨会话（与契约文件分离）。
6. 示例矩阵：`docs/examples` 增加 lib/add 分层夹具。

**验收**：§5 隐式结果带 provenance；emit 打印
`const x = positive.shift(1); export const add2 = fn({ x }, x.shift(2))`；
`check` 回 `positive4`；未 emit 的导出不产生契约 diff。

### Phase 3 — 门禁与 IDE 打磨

1. `doctor` refine drift CI（只针对已落盘契约）。
2. LSP CodeLens `persist/update refine`；固化后 drift 提示。
3. `nudo.json` emit 白名单；agent API：`nudo.interface` / emit；SKILL.md 更新。
4. `--emit-cases` 文档降级；迁移说明。

---

## 12. 开放问题

1. **join vs 分场景契约**：多上层契约不同时，接口并集可能过宽。是否提供
   「按调用方分契约名」（侧车里 `add2_from_add4`，不绑源码）？默认 join，
   分名作后续选项。
2. **返回约束下行 vs 上行**：当前 check 是「推断返回 ⊭ 声明」。下行生成的
   返回契约是**义务**还是**事实**？建议：手写 = 义务；生成 = 事实快照，
   drift 检查，不反向当义务压回实现（避免循环责难）。
3. **私有绑定**：**不绑定、不落盘**（§2.1）。私有推导仅内存态，供 check /
   传播；契约文件只承载 **exported** 绑定。
4. ~~`derived_` 前缀~~ **已废弃**：改为同名自动绑定（§2.1），生成与手写
   共用源码名；冲突走 `nudo:interface-name-clash`。
5. **dts 与 TypeValue**：见 §12.1——**interface 驱动 dts** 已定方向；
   TypeValue 彻底移除是后续目标，不与本文绑定交付。

### 12.1 dts ← interface；TypeValue 的退出路径

**方向：`.d.ts` 的优先源是 refine，不是 TypeValue。**

dts 是公共接口的兼容出口；接口表面已是 refine，dts 应投影同一条链：

```
手写 refine  >  生成域 refine  >  推断 Abs（无契约时）
        │
        ▼
   dts 投影（有损：pred → TS 表达不了的落 number/string）
```

| refine | dts |
|---|---|
| `positive`（`number().gt(0)`） | `number`（TS 无原生 `gt`；不造假 branded） |
| `union(lit(42), lit("a"))` | `42 \| "a"` |
| `shape({ id: number().int().gt(0) })` | `{ id: number }` |
| `partial(user)` | `{ id?: number; … }` |

实现：`dts-generator` 改为 **Abs / NudoConstraint → TS AST**，
不再经 `absToTypeValue` 再打印。TypeValue 从 dts 路径**拿掉**。

**TypeValue 彻底移除是正确终态，但是多一步，不绑在 refine 下行上。**
今日 TypeValue 仍占着这些位：

| 位 | 能否立刻删 | 说明 |
|---|---|---|
| dts 源 | **能**（本设计） | 改走 refine / Abs 投影 |
| LSP hover / inlay 外延显示 | 部分 | B-path 已优先 Abs；`@nudo:case` 区仍走 TypeValue + activeCases |
| `@nudo:case` 实参文法 | 否 | `parseTypeValueExpr` / `T.*` 是指令表面；要删先改 case 文法 |
| TypeValue evaluator（非 capable 源） | 否 | 兜底求值 IR；要么 Abs-only 并接受覆盖缺口，要么长期保留 |
| `infer --json` / agent 序列化 | 可迁 | schema 换 Abs/refine 形状，属 breaking |
| 调用点 `CallRecord.argTypes` | 可迁 | 现为 TypeValue；应改 Abs |

**建议路径（与 kernel 单轨一致）：**

1. **本文 Phase 1–2**：refine 成为接口；dts 改从 refine/Abs 投影。
2. **随后**：LSP / 序列化 / CallRecord 全面 Abs 化；case 实参文法决定
   保留 `T.*` 仅作指令语法，还是换成约束表达式。
3. **最后**：删除 `TypeValue` 类型与 `absToTypeValue` 桥——前提是
   非 capable 路径要么消失、要么有 Abs 宿主。

在 (3) 之前，TypeValue 只是**评估/序列化残余**，不再是 dts 或接口真理源。
「彻底移除」写进路线图，不写进本设计的交付门槛。

---

## 13. 决策摘要

| 决策 | 选择 |
|---|---|
| refine 文法 | 不内联类型；`*.nudo.js` + `shift/lit/union/fn` + utility helpers |
| **命名** | 产品面 **interface**（CLI/IDE/诊断）；机制层 refinement；`@nudo:refine` 兼容别名 |
| **绑定** | **侧车同名导出自动绑定源码的 exported 绑定**；私有不落盘；源码零注释（`@nudo:refine`/`@nudo:interface` 兼容） |
| **隐式 vs 落盘** | 推导**始终隐式存在**；`--emit` 默认必须 filter，禁止无参全量写盘 |
| **缓存** | 隐式 interface 进 L0/check memo，可选 `.nudo/cache`；与用户契约文件分离 |
| 生成物形态 | **组合式 + import**，依赖与源码同构；禁止展开成 `gt(n)` 字面量墙 |
| 运算实现 | `shift` / `union` / helpers **与 Abs 代数共用**，不另写一套 |
| 推导方向 | 顶层手写契约 top-down；调用点域 bottom-up；二者对账 |
| 生成位置 | 被调源文件同名 `*.nudo.js`，导出名 = 源码绑定名 |
| **`fn`** | **一等 `NudoConstraint`**（`fn.params` / `fn.returns`），可 import / 嵌 shape |
| 手写物 | 永不覆盖；撞名 / 源码注释不一致 → 报错 |
| case | 保留为特例/debug；非接口主产物 |
| 冲突 | 契约违例 / 域超出 / drift / name-clash / 源码-旁路 conflict 分码 |
| IDE 默认 | interface / default；case 副层；**按导出** `interface.emit` |
| dts | **refine / Abs 直接投影**；不再经 TypeValue |
| TypeValue | 接口/dts 真理源退役；评估 IR 与 case 文法残余另轨退出 |
| 内核 | 不改 Abs 本体；约束组合子走 Abs 投影 + 生成编排 |

---

## 14. 设计评审（完备性 / 冲突 / 可实现性）

对照 `constraint.ts` / `refine.ts` / `check.ts` / `analyzer.ts` / LSP 现状。

### 14.1 可直接实现（低风险）

| 点 | 依据 |
|---|---|
| 侧车同名绑定（仅 exported） | 加载 `foo.nudo.js` + 名字匹配导出表；`isNudoConstraint` 已有 |
| `lit` / `union` | 扩 `NudoConstraint`（需加 members 字段，见 14.3） |
| `shift(n)`（常数界） | 对 `gt/ge/lt/le` 的 lit 右端加 n；走 Pred 重写 |
| emit filter / `--fn` / `--known` / `nudo.json` | 编排层，复用 `case-emitter` 的剥离/写盘思路 |
| 隐式不落盘、手写优先 | 纯策略；`name-clash` 在 emitter 写盘前判定 |
| LSP `nudo.interface(.emit)` | 薄封装 + 写盘器；粒度到 export |
| drift 门禁 | 重算有效契约做**语义相等**（Abs/Pred 规范化后比），不是比源码字符串 |
| case 保留、`@nudo:refine` 别名 | 兼容层 |

### 14.2 有条件可实现（须先补前置）

| 点 | 缺口 | 建议 |
|---|---|---|
| `*.nudo.js` **嵌套 import** | 现 `execNudoModule` 注掉 import，只注入 `number/string/boolean/shape/array`；**不能** `import { positive } from "./std.nudo.js"` | Phase 1：相对 `.nudo.js` 走 `loadModule` 递归（§2.2），`@nudojs/core` 仍注入 |
| `fn` 一等约束 | 扩 `NudoConstraint.fn = { params, returns?, throws? }`；`isNudoConstraint` 收 `fn`；可嵌 shape / 被 import | Phase 1：类型 + `fn()` 构建器 + 属性读写；勿另建平行类型 |
| Abs → 约束投影（下行第 1 步） | 有 `constraintToEntryAbs`；**反向** Abs→NudoConstraint 无 | 只投影可表达子集：prim / 常数界 / shape / 字面量 union；其余 conf=partial，不 emit |
| 多调用者 join | `joinAbs` 已有；投影后再 join 或 join 后再投影需定序 | **先 Abs join，再投影**（与「与 Abs 共用代数」一致） |
| dts ← interface | `dts-generator` 现吃 TypeValue | 新路径 Constraint/Abs → TS AST；与旧路径并行直至切换 |

### 14.3 设计内部冲突 / 须改口径

| # | 问题 | 处理 |
|---|---|---|
| 1 | 「无 `*.nudo.js` 仍有 `positive.shift(1)` 链」不成立——`positive` 来自根契约 | 已改 §7.1：无根时隐式 = Abs/域，不是下行链 |
| 2 | `export const add2_domain` 违反「侧车导出 = 源码导出」 | 已改 §5.4：域不另起导出名 |
| 3 | 手写与生成同名 `export const add2` 在同一文件是 **JS 语法错误** | 口径改为：emitter 见已有绑定则**不写**；「并存」指策略冲突而非字面双导出 |
| 4 | `nudo.json` 键名 `refine.emit` vs `interface.emit` | 已统一 `interface.emit` |
| 5 | §6 诊断码新旧混用（`refine-underivable` 等） | 建议全部 `nudo:interface-*`，`refine-*` 作 alias 一个版本 |
| 6 | 生成物 pretty `shift` 链 vs 语义等价 | drift 比语义；emit 的链式是**provenance 标注**，不是从 Abs 反编译出来的唯一形式——emit 时需在求值期记调用边 provenance，否则只能写出展开式（与 §2.3 冲突） |

**#6 是最大实现风险，且正确方法是 provenance 数据，不是反编译：**

设计原则：**尽量避免编译**。不把 Abs「编译」回 `shift` 链；链式不是
反编译产物，而是推导过程本身的数据结构。

1. 下行求值时显式携带 **provenance 图**：节点 = 约束/Abs，边 =（调用位点、
   `+k`、body 步进、join）。`positive.shift(1).shift(2)` 是这张图的**投影打印**。
2. emit 写出的是 provenance 的可读形式；语义相等用 Abs/Pred 判，不比字符串。
3. 无 provenance（纯 call@ 域 join）时只 emit 域本身，不编造链。
4. **禁止**「跑完 Abs → 猜测/恢复 shift 链」的后处理编译器。

### 14.4 语义上仍开放（非缺陷，但要拍板）

| 点 | 风险 | 默认建议 |
|---|---|---|
| join 过宽（多上层契约） | 接口失去区分度 | 默认 join；分场景名后置 |
| 生成返回当义务 vs 事实 | 循环责难 | 生成 = 事实快照 + drift；仅手写是义务 |
| `readonly` | TS 可写、Nudo 难查 | Phase 1 可砍 |
| `exclude`/`extract` | 依赖尚未存在的 union 成员集 | 随 `union` 一起，勿提前 |
| 循环 `.nudo.js` import | `execNudoModule` 无环检测 | 与模块图同一套 cycle 策略 |
| 跨文件 emit 顺序 | `lib.nudo.js` import `add.nudo.js` | 先依赖后被依赖；或 emit 后不求值、只写文本 |
| 非 capable 源的下行 | B-path 不可用时约束从哪来 | 明确：下行仅 B-path / Abs；TypeValue 路径不产 interface emit |

### 14.5 完备性缺口（未写清但实现会撞上）

1. **参数名对齐**：`fn({ x })` 的 `x` 必须与源码形参名一致；重命名形参
   → drift/冲突规则？（建议：名字对不上 → `interface-conflict`，不静默错绑。）
2. **默认参 / rest / 解构形参**：`fn` 文法未定义；Phase 2 至少 rest 用
   `args` 数组约束或降级 partial。
3. **class / 方法**：侧车约定只覆盖 binding；`C.prototype.m` 不在模型内。
4. **throws 域**：§4.3 提了 throws，`fn` 结构未带 throws；建议 `fn(params, returns, { throws })`。
5. **有效契约合并序**：手写 ∪ 生成 ∪ 隐式的优先级只散落文中；check 须
   单点函数 `effectiveInterface(fn)`，避免各处各比各的。
6. **序列化 / agent JSON**：隐式 interface 如何出现在 `infer --json` 未定义。

### 14.6 结论

| 维度 | 判定 |
|---|---|
| 产品模型 | **一致**：interface=接口域，case=特例；隐式/显式/缓存三层清楚 |
| 与现有内核 | **兼容**：不改 Abs；但 **`.nudo.js` 嵌套 import** 是硬前置 |
| 内部冲突 | 文内 6 处已改/待改；**无根本性互斥** |
| 最大风险 | **provenance 链式 emit**（§2.3）与 **Abs→约束投影完备性** |
| Phase 1 可交付 | 是——构建器 + 嵌套 load + print/emit filter + 检查码骨架 |
| Phase 2 | 须带 provenance 图，否则只能展开式（与文风冲突，需降级验收） |

**建议修订优先级：** 嵌套 `execNudoModule` → `fn` 类型 → Abs 投影子集 →
emit filter → 下行+provenance → drift 语义相等。

---

## 附录 A. 与「粗归纳」的对照

| 错误直觉 | 本设计 |
|---|---|
| 调用点只有 `42`、`"a"` → refine 写成 `number \| string` | refine = `union(lit(42), lit("a"))` |
| refine = 模糊契约，精确信息全放 case | refine 可精确；case 是可执行特例 |
| 生成 case 指令就算接口 | 接口 = refine；case 仅 debug/断言 |
| 从调用点「猜」顶层类型 | 顶层契约手写；下行是推导不是猜测 |

## 附录 B. 相关源码锚点

| 模块 | 作用 |
|---|---|
| `core/algebra/refine.ts` | `@nudo:refine` / `@nudo:import` 解析 |
| `core/algebra/constraint.ts` | 模板构建器；待加 `shift/lit/union` + utilities，**共用 Abs 代数** |
| `core/algebra/generalize.ts` | entryReqs → 入口 Abs；下行入口 |
| `core/algebra/check.ts` | 契约门禁；待加 domain-exceeds / drift |
| `service/analyzer.ts` | call@ 合成；域 join 的原料 |
| `service/case-emitter.ts` | case 固化；refine emitter 可参照 |
| `lsp/server.ts` | CodeLens / selectCase；默认 refine 档 |
