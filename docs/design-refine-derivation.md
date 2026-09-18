# Interface 分层推导与契约生成

> **状态**：Phase 1–3 已实施（feat/interface，含 root 驱动下行推导图 /
> 组合式 emit / doctor interface drift / emit 白名单）。已实施部分以代码
> 为准（§11 各步骤标注 [已实施]），其余条款是设计稿。
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
- **契约文件只承载本地 named export 绑定**（边界情形见 §2.1）——私有推导
  是手段，不是接口产物。

### 1.3 与 case 的分工

| | refine | case |
|---|---|---|
| 角色 | 接口 | 特例 / 见证 |
| 来源 | 手写契约；调用点域；分层推导 | 手写；`--emit-cases` 固化 |
| 用途 | check 门禁（仅手写，见 §3.3）、代数推导、dts/IDE 默认表面 | `nudo test`、CodeLens 切场景、what-if |
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
| 名字是对应 `.js` 的**本地 named export** | **自动绑定**为该导出的约束 |
| 名字不是该 `.js` 的导出 | 本地模板，可被其他 `*.nudo.js` import，**不绑源码** |
| 函数导出 | 必须是 `fn(…)` 且 `isNudoConstraint` —— **一等约束**，带 `fn.params` / `fn.returns` |
| 变量 / 常量导出 | 裸 `NudoConstraint`（`number().gt(0)`、`shape({…})`、嵌套 `fn` 等） |

**绑定集合 = 该 `.js` 的本地 named export。** 边界情形（Phase 1 拍板）：

| 情形 | 规则 |
|---|---|
| `export default` | **C4.4**：具名 `export default function add` 绑本地名 `add` + 登记 `"default"`；侧车可 `export const add = fn(…)` 或 `export default fn(…)`。匿名 default 仅 `"default"` |
| re-export / barrel（`export { add2 } from "./add.js"`、`export *`） | 不算本地导出、不参与同名绑定——re-export 的契约**永远跟随定义文件**的侧车；`lib.nudo.js` 里的 `add2` 只是 import 引用，不构成第二绑定 |
| CJS（`module.exports = {...}`） | **C4.3**：静态可解析形态参与绑定——`module.exports = { a, b }`、`exports.a = …`、`module.exports.a = …`、`module.exports = localFn`（登记 localFn 名）。动态计算导出名仍不猜 |
| class 实例方法 | **C4.2**：导出 class 的普通方法契约键 = **本地声明名** `Class.method`（不是 export 别名）；侧车可 `export const Class_method = fn(…)` 或 `export const Class = { method: fn(…) }`。constructor / static / get / set 不绑 |
| `export { Local as Public }` | 侧车/分析按**声明名**：函数键 `Local`（若导出）；class 方法键 `Local.method` / `Local_method`。`Public` 仅是对外 export 名，**不是**契约键。`export { Local as default }` 额外登记 `"default"` 与本地名 `Local` |

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
- `@nudo:refine` **仍支持**（向后兼容 / 愿把契约写在导出函数上时）。
  适用范围与侧车**不同**：侧车绑定限 exported；源码注释维持现状**全量**——
  今天私有函数的 refine 就是被支持的（`extractRefineLines` 的正则 export
  前缀可省，check 对任意函数生效），注释写在函数旁、无撞名问题，
  不跟着侧车规则收窄。
- 二者同时存在：语义等价 → 合一不报；**部分重叠（侧车 `x>0` + 源码 `x>1`）
  → 有效契约取合取（and）**；合取不可满足（如 `x>0` ∧ `x<0`）→
  `nudo:interface-conflict`（error）。
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
execNudoModule(src)                 ← 受控执行：剥 ESM 壳，new Function
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
| 无模块访问 | import 剥除后无模块系统、无 fs/net import；但 `new Function` **不是沙箱**（全局可达）——「可安全执行第三方模板」不成立，只承诺「不碰用户工程 `node_modules` / 模块图」；真隔离（shadow 全局 / vm）为后续可选项 |
| 与 `loadModule` 统一 | 已有 `RefineResolveOpts.loadModule`；`.nudo.js` 互 import 走同一宿主 |

**自动绑定的执行边界（Phase 1 硬前置）。** 自动绑定把侧车执行从 opt-in
（源码显式 `/// @nudo:import`）变为 **ambient**——被分析文件旁存在同名侧车
即执行。威胁模型随之改变，边界三条：

1. 自动加载**仅限项目根内**（`findProjectConfig` 定位的 `projectDir`）；
   `node_modules` 下的 `.nudo.js` **永不自动加载**——真实包分析（zero-FP
   套件）不会因依赖内混入侧车而执行第三方代码；确需时走今日的显式
   `@nudo:import`。**实施口径**：`node_modules` 半边已落地（sidecarAutoBindAllowed
   与 LSP 隐式边登记）；「项目根内」属宿主层判定（core 无 projectDir 概念），
   Phase 1 未实现，后续 Phase 补。
2. `package.json#nudo.interface.autoBind`（默认 `true`）可整体关闭自动
   绑定，退回显式指令模式。**已接线到 check 与 LSP 执法路径**（CLI
   runCheck / LSP checkToLspDiagnostics 解析配置后下传给 checkSource），
   不只是 `nudo interface` 打印路径。
3. LSP 以**磁盘**为侧车真值（与 CLI 一致）；未保存 buffer 的侧车内容
   不会被自动绑定执行（deps 预留给 open-buffer 通道，Phase 1 未实现）。

**相对路径 `*.nudo.js` 互 import 也走 `loadModule` 递归，不引入 Node ESM：**

```js
// add.nudo.js
import { positive } from "./std.nudo.js";  // 引擎：loadModule("./std.nudo.js", from=add.nudo.js)
import { number } from "@nudojs/core";     // 引擎：注入，不 load
```

实现要点（Phase 1 硬前置）：

1. **import/export 改写用真 parser，不再正则剥壳**。现状 `execNudoModule`
   是正则替换（剥 `export const`、删 import 行）：不认多行 named import、
   会命中注释/字符串里的同形文本；递归解析、环检测、**带位置的报错**
   在这个基座上做不可靠。Babel 已是依赖，用它做语句级改写即可。
2. `execNudoModule` 对 **相对/包外 `.nudo.js` specifier** 调 `loadModule`
   递归求值；对 `@nudojs/core`（及约定 builtin）**注入**，与今日一致，
   仅扩充 `fn/lit/union/shift/partial/…`。
3. **exec 缓存键并入依赖闭包指纹**。现 `nudoModuleExecCache` 按单文件
   源码内容 LRU——嵌套 import 后 `add.nudo.js` 的求值结果还依赖
   `std.nudo.js` 的内容，单文件键会在 LSP 编辑 `std.nudo.js` 时命中
   `add.nudo.js` 的陈旧导出。参照 `refineDepsFingerprint` 的做法。
4. 循环依赖：检测 spec 环，报 `nudo:interface-cycle`（带 spec 链），不
   stack overflow。
5. **静默吞错改诊断**。现 `collectConstraints` 的 `catch { continue }`
   意味着侧车里任何执行错误 = 约束静默消失 = 静默无契约；loader 只收
   `export const`，写成 `export function` 的侧车导出今天也被静默忽略。
   自动绑定下这两类都必须报（侧车加载失败 / 导出形式不识别），
   否则绑定无声失效。
6. 禁令收窄为：**不要**把 `.nudo.js` 编译成内部 AST 再解释、不发明 IR——
   执行保持「真实 JS + 注入 API」。「用真 parser 做 import/export 语句
   改写」不在此列，那是 loader 的正确性，不是「再发明一套编译」。

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

**组合子的定义域。** `.shift(n)` 只对**数值标量链**合法：preds 仅含
`gt/ge/lt/le` 且右端为 lit、无 `fields` / `element`、无 `length(self)` 类界
（`min/max/length` 产生的是长度界，平移无意义）。构建期对不合法形态直接
throw，不静默产出垃圾约束。`lit(v)` 的编码定为 `prim + eq(self, lit(v))`
pred（`eq` / `predEquals` 已有），不开新字段；`union` 的 `members` 是新
形态，需同时补 `instantiateConstraint` / `constraintToEntryAbs` / check
三条路径（现只认标量 / shape / array）。

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

同一 `@nudo:refine` 表面，**来源不同**（手写契约 vs 引擎生成），检查语义不同。

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

### 3.3 二者相遇：按来源分档执法

check 的对账对象不是笼统的「有效契约」，而是**手写契约 × root 链上的
会话内推导**（分轨见 §4.2）。契约来源分三档，执法语义不同：

| 契约来源 | 参数位 | 返回位 | 说明 |
|---|---|---|---|
| 手写（侧车同名 / `@nudo:refine`） | **义务**：调用 ⊭ 前置 → error | **义务**：返回 ⊭ 声明 → error | 即现有调用点 `constraint-violated` / `checkReturnConstraint` 语义 |
| 生成段（自上游契约下行） | **事实快照**：不执法，只 drift | **事实快照**：不执法，只 drift | 它是某条推导链的**假设**，不是被调方作者的承诺（见下） |
| 域（call@ 观察 join） | 永不执法，只 drift / 展示 | — | 证据门槛见 §6 |

**`fn` 在参数位（HOF）Phase 1 不执法。** 标量 / shape 参数位的「调用 ⊭
前置」无法直接推广到函数值实参——那需要参数逆变 × 返回协变的 fn 隶属
判定（另建一套 leq）。Phase 1 规则：`fn` 仅作为**绑定位**约束生效
（top-level exported 函数的契约，如 `add2 = fn({…}, …)`）；参数位 /
shape 字段位出现 `fn`（如 `mapMaybe` 的 `f: fn({…}, …)`）→ 只进展示
（hover / inlay / dts），不参与违例判定。完整 HOF 检查后置，勿据此
设计 Phase 1 验收。

对账矩阵：

```
域 ⊄ 手写契约   →  error（接口被用穿）    nudo:interface-domain-exceeds
域 ⊄ 生成段     →  warning（快照过期）    nudo:interface-drift
域 ⊆ 契约       →  ok
域变化          →  drift（若曾固化）      nudo:interface-drift
契约推不出      →  info（opaque / 截断）  nudo:interface-underivable
```

**为什么生成参数约束不对第三方执法。** `add.nudo.js` 里的
`fn({ x: positive.shift(1) })` 是 `lib.js:add4` 契约沿调用边推导出的
**该链假设**，不是 add2 作者的承诺。若按 error 执法：lib.js 契约收紧 →
`add.nudo.js` 生成段随之收紧 → **无关文件** main.js 里 `add2("a")` 的
CI 报错——报错点与因果链分离，上游一次重构可以让全仓第三方调用点红灯。
生成段参数约束与 §12 开放问题 2 的返回口径一致：事实 + drift。第三方调用点的
error 只由**手写**契约触发。

同一函数同时有手写契约与生成段时，`effectiveInterface` 以手写为准
（§11 Phase 1 第 0 步），生成段降为展示来源；两者语义冲突（手写 ≠
今日按链重推）→ `nudo:interface-drift`，不是 double report。

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
3. 同一 `g` 被多个上层调用时，**check 不 join**——每条 root 链独立推导。
   单调 join 是过逼近；join 后的域再往下推会把**仍成立**的上游契约误判
   为失败。反例：`add2` 多出一个调用者（实参域 `(-10, ∞)`）后，join 域
   推出的 `add4` 返回 `⊄ gt(4)`——`add4` 自己从未失效，被共享被调方的
   join 毒化的是**证明**，不只是精度。因此分轨：
   - **check**：沿每条 root 链逐条推导对账——等价于现有
     「entryReqs → 求值 body → `checkReturnConstraint`」路径，天然无 join；
   - **工件聚合**：落盘时才把多条链的参数约束取 join（接口是并集），
     结果只进 `*.nudo.js` 生成段与 dts/IDE 表面，**不回灌**任何一条链
     的 check。
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
- 分轨成本：每条 root 链独立推导是 O(roots × 下游链)；per-**(root, callee)**
  结果挂 `fnAnalysisCache` 键扩展 memo，共享被调方不重复求值。

### 4.5 隐式依赖边与缓存失效（Phase 1 硬前置）

自动绑定让 `foo.js` **隐式**依赖 `foo.nudo.js`，而现有失效机制全部建立在
**源码显式声明**的依赖边上——源码零注释 = 逐出图缺边 = 陈旧结果：

| 现有机制 | 现状 | 自动绑定下的缺口 |
|---|---|---|
| `nudoDepParents` 登记 | LSP 从源码 `@nudo:import` 扫描注册（`extractNudoImports`） | 源码不写指令 ⇒ `foo.nudo.js` 变更时没有任何 parent 被逐出 ⇒ 静默用旧契约 check |
| 整文件分析缓存 | `analyzeFile` 键 = `filePath + source + auxKey` | 侧车内容成为键外隐参数 |
| generalize memo | `refineDepsFingerprint` 把 refine 依赖**编进键里**（正确模式） | 同名侧车及其递归闭包需并入指纹 |
| root→derived 边 | 无此机制 | `lib.nudo.js`（根契约）变更 ⇒ `add.js` 的有效契约变了 ⇒ `add.js` 自身 check 必须失效；但 `add.js` 源码没有任何指向 `lib.nudo.js` 的指令 |

规则：

1. 分析 `foo.js` 时，把 `foo.nudo.js` 及其**递归依赖闭包**并入 dep 指纹
   （generalize 键）**并**登记 `nudoDepParents`（LSP / 宿主逐出）。
2. 下行 emit 产生的 root→derived 边同样登记：`lib.nudo.js` 进 `add.js`
   的依赖集。
3. 配对现有 evict 回归矩阵加「侧车变更 → parent 失效」用例：
   `session-cache-evict` / `nudo-dep-evict` / `fn-cache-evict`。仓库对
   陈旧缓存有专门测试矩阵，隐式边不登记就是同类 bug 的复活。

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

**多调用者不污染本链**（§4.2 分轨）：`check(add4)` 沿这条链独立推导——
即使 `add2` 另有调用者把落盘接口 join 宽了，`add4` 的对账仍用本链结果；
join 只影响 `add2` 的工件（生成段 / dts / IDE 展示）。

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
`add2.fn.params.x` 本身（不是另一个导出名），但结论**按契约来源分档**
（§3.3）：

| 检查 | 含义 |
|---|---|
| `42 ⊆ add2.fn.params.x` | ok（若契约为 `positive.shift(1)`） |
| `"a" ⊄` **手写** `add2.fn.params.x` | 按来源分流（§6）：**跨文件注入的域证据** → `nudo:interface-domain-exceeds`（error）；该调用写在**被分析的文件里** → 现行 `constraint-violated`（scan.ts 跨文件被调路径，语义不变） |
| `"a" ⊄` **生成段** `add2.fn.params.x` | `nudo:interface-drift`（warning，快照过期） |
| 无契约（仅隐式域） | 不报；域留在隐式 interface / 缓存 |

域**不**用 `export const add2_domain` 落盘——那会与「侧车导出 = 源码导出
绑定」规则打架（`add2_domain` 不是 `add.js` 的导出）。域要么留在隐式
interface / 缓存里，要么在 emit 时并入 `fn` 的见证字段（后续选项）。

---

## 6. 冲突与检查码

| code | severity | 触发 |
|---|---|---|
| `nudo:constraint-violated` | error | 推断返回/调用 ⊭ 手写契约（已有） |
| `nudo:case-inconsistency` | error | case 见证 ⊭ refine（已有） |
| `nudo:interface-domain-exceeds` | error | **跨文件注入的观察域** ⊄ **手写**契约（接口被用穿）。与 `constraint-violated` 按违例**来源分流**、不对同一违例竞争：分析文件内的调用点违例（含 scan.ts 跨文件被调路径）**维持 `constraint-violated` 原码原语义**；本码只用于跨文件 callsite 记录注入的域证据（该路径今天不查契约，是真增量），聚合层无去重负担 |
| `nudo:interface-drift` | warning | 固化的生成 interface ≠ 今日重算结果；**含**域 ⊄ 生成段（快照过期，§3.3） |
| `nudo:interface-name-clash` | error | 生成段与手写同名导出冲突（手写优先） |
| `nudo:interface-conflict` | error | 源码 `@nudo:refine`/`@nudo:interface` 与旁路同名绑定**矛盾**（合取不可满足，参数位与返回位同口径）；部分重叠取合取、不报（§2.1） |
| `nudo:interface-load` | error | 侧车加载/执行失败、非 fn() 绑定、default import、导出形式不识别（[已实施]） |
| `nudo:interface-cycle` | error | 相对 `.nudo.js`/`.nudo.ts` import 链成环（[已实施]） |
| `nudo:interface-underivable` | info | 上层约束传不下来（opaque / 循环 / native）。全新码：现仓无 `nudo:refine-underivable` 消费者，无 alias 负担。**Phase 2 引入（未实施）** |
| `nudo:interface-entry-only` | info | 导出无契约根且无调用域（含 §7.3 的「根在别处」）。全新码：现仓 `entryOnly` 是 JSON 字段 / CLI 标签而非诊断码，无 alias 负担。**Phase 2 引入（未实施）** |

`nudo check` 聚合上表；`nudo doctor --callsites` 将 drift 作 CI 门禁
（类比现有 `--emit-cases=update --exit-on-diff`）——**Phase 3**（现仓
doctor 只有 case drift，且不带 `--callsites`）。

**domain 检查的证据门槛。** bottom-up 域证据来自 `collectAbsCallRecords`，
该路径有截断收集器（`setAbsTruncationCollector`）、unknown 实参过滤、
mock/env 改道——部分证据下的域天然不稳定（截断、动态调用、测试专用分支
都会让「观察域 ⊄ 手写契约」误报）。规则：

- `nudo:interface-domain-exceeds` 只在证据 conf ∈ {exact, path} 且无截断
  标记时触发；否则降 info 或不报（drift 档同理）。
- 新诊断码必须进 `check-gold` 夹具与 real-package zero-FP 套件
  （recall = precision = 1.0 是 CI 门禁；domain-exceeds 正是最容易在
  真实包上 FP 的那类检查）。**gold 迁移口径只增不改**：`constraint-violated`
  码名与语义均不动，check-gold / check-recall-gold / real-packages 既有
  pin 零改动；`interface-*` 新码只增新夹具。
- 字符串域隶属是**新代码**：现有 case ⊭ refine 对账只查数字字面量
  （`checkCaseAgainstReqs` 对非 number 直接 continue），`"a" ⊄ 契约`
  无先例；字符串 / 其他 prim 的域隶属判定需另写。

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
| 路径 | `nudo interface --emit src/lib.js` | 该文件（及其 `*.nudo.js`）；若该文件是**根**，闭包内下游生成段按下方 root 驱动规则连带更新 |
| 导出名 | `nudo interface --emit src/lib.js --fn add2` | 仅这些名字——Phase 1 过滤的是**目标文件自身的导出**；root 推导闭包内的下游目标（含下游文件的导出）是 Phase 2 能力（见 §11 Phase 2 验收） |
| 已有契约文件 | `--emit`（默认） | 只更新已存在 `*.nudo.js` 中的生成段 |
| 项目配置 | `package.json` → `nudo.interface.emit: ["src/api/**"]` | 包级白名单（沿用现有 `pkg.nudo` 配置入口，不另设 `nudo.json`）。**Phase 2 引入**：Phase 1 的 InterfaceConfig 只含 `autoBind`（未接线的声明面不留） |
| 全量（显式） | `--emit --all` | 明确 opt-in；文档警告勿默认 |

无参数 `nudo interface` = usage error（`paths` 至少一个；已实施）——「只打印」
是带路径时的默认行为，不写盘。

**emit 永远 root 驱动，不建全局反向索引。** 下行推导的入口是根
（手写契约所在文件 / `--roots` / `--callsites` 观察文件）；「谁推导到
`add.js`」不做持久索引，按入参文件扮演的角色分两种行为：

| `--emit <path>` 时 `path` 的角色 | 行为 |
|---|---|
| 含契约根 | root 驱动下行推导；推导闭包内被点名的**下游生成段**（如 `add.nudo.js` 的 `add2`）随本次 emit 一并写/更新——这是根文件 emit 的副作用，受同一 `--fn` / 白名单过滤 |
| 无根（纯下游，如 `add.js`） | 只处理该文件侧车里**已存在**的生成段：读生成段头部的 `derived-from: lib.js:add4` 标注反查根文件重推（§5.3 的标注就是为此）；标注指向的根已删/改名 → `nudo:interface-drift`（断链），不静默删段 |
| 无根且无已存在生成段 | 打印「根在别处」提示（`nudo:interface-entry-only` 同源 info），不写盘、不报错 |

因此「`--emit src/add.js` 找不到 lib.js 的根」是显式模型而非缺陷：
下游生成段只能随其根的 emit 更新；会话内的 root→derived 反查信息
来自生成段自带的 `derived-from` 标注与 §4.5 登记的依赖边，无需新建索引。

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
- 契约变更（手写编辑或 emit 重写）→ 逐出依赖它的 L0/check。注意「已有
  机制」只覆盖**显式** `@nudo:import` 声明的边；自动绑定的隐式边须按
  §4.5 登记，否则逐出图缺边、命中陈旧结果。
- 源码变更 → 隐式 refine 与缓存失效；**不**自动改写已落盘契约（只报 drift）。

### 7.5 LSP：按导出粒度生成/更新

CLI filter 的同一套选择器应暴露给编辑器，粒度到 **单个 export**：

| 动作 | 命令 / UI | 参数 |
|---|---|---|
| 打印当前隐式 interface | `nudo.interface` | `{ file, functionName? }` |
| 固化单个导出 | `nudo.interface.emit` | `{ file, functionName, mode: "add"\|"update" }` |
| 固化当前文件全部导出 | 同上省略 `functionName` | 仍尊重 `package.json#nudo.interface` 白名单 |
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
| `nudo interface [paths…]` | **只打印**每导出有效 interface 与来源（handwritten / generated / implicit）；无路径 → usage error（已实施） |
| `nudo interface --emit [paths…]` | 按 filter 写盘（mode=update，幂等） |
| `--fn <name>`（可重复） | 仅这些名字（Phase 1：目标文件自身导出；root 推导闭包内下游目标为 Phase 2） |
| `--all` | 显式全量（文档警告） |
| `--callsites <paths…>` | 使用现场文件：跨文件调用记录注入域证据（域根导出 emit 的必需通道，已实施） |
| `--dry-run` / `--exit-on-diff` | diff / CI 门禁 |
| `--roots <export…>` | 限定下行契约根（Phase 2） |
| `nudo doctor` | interface drift（仅针对已落盘契约，Phase 3） |
| `nudo check` | §6 code；隐式契约参与判定，不要求已落盘 |

> 兼容：`nudo refine` 别名指向 `nudo interface`，一个大版本后可弃。

配置沿用现有 `package.json` → `nudo` 键（`config.ts` 的 `findProjectConfig`
已读 `{ env, mocks }`），扩展 `interface` 子键——不引入第二个配置文件：

```json
{
  "nudo": {
    "interface": {
      "autoBind": true
    }
  }
}
```

> Phase 2 再引入 `emit` / `ignore` 白名单键（见 §7.3）——Phase 1 的
> `InterfaceConfig` 只含 `autoBind`，不留未接线的声明面。

> CLI 已有顶层命令 `nudo emit`（= dts 导出）。本文的写盘动词是
> `nudo interface --emit`（子命令选项，非顶层命令），不冲突；help 文案
> 区分「emit dts」与「emit interface」。

`--emit-cases` **保留**（debug 固化），文档标注非接口主路径。

---

## 10. 与现有机制的映射

| 现状 | 新模型中的位置 |
|---|---|
| `@nudo:refine` + `*.nudo.js` | 手写契约；语法不扩内联；侧车同名绑定为主 |
| `generalize` entryReqs | 下行推导入口 Abs |
| call@ 合成 case | 域证据源；join 为隐式域 refine |
| `--emit-cases` | 可选 debug 固化；接口路径改为 `nudo interface --emit`（默认不写） |
| `nudo:case-inconsistency` | 保留：case ⊭ refine |
| `checkReturnConstraint` | 保留；**判定用契约 = 手写**（error 级）。生成段/隐式只进展示与 drift，不进义务判定（§3.3） |
| LSP `selectCase` | default/refine 档 + 按导出 `refine.emit` |
| L0 / check memo / `*.nudo.js` 逐出 | 隐式缓存 + 契约失效路径；显式 `@nudo:import` 边沿用现机制，自动绑定的隐式边按 §4.5 登记 |
| `.nudo/cache`（新） | 隐式 refine 跨会话缓存，非用户契约 |

Abs 代数本身**不需要新内核**：下行只是「在根入口约束下跑已有
`evalNode` / B-path，把实参/返回 Abs **投影回 NudoConstraint**」。

---

## 11. 分阶段实施

### Phase 1 — 表面与沉淀（可先落地）

0. **单点 `effectiveInterface(fn)`**（core）：手写 ∪ 侧车同名 ∪ 生成段的
   唯一读取口，含 dep 指纹与**来源标注**（handwritten / generated /
   implicit）——§3.3 分档执法依赖来源可见。现有 **7 个**提取点必须全部
   改走它：`check.ts` ×2（`refineToIndexedFull`@662 的 case 对账、
   `extractRefineReturnFromSource`@304 的返回契约）+ **`scan.ts` ×4**
   （`refineToIndexedFull`@1080 同文件被调前置执法 / @1095 wrapper→target
   形参转发 / @1129 跨文件被调 `checkExternalCall` / @1234 refine 优先于
   body 结构推断——调用点执法宿主，§3.3 分档的主战场；@1095 的
   `fwd.map` 转发必须保留，不能退化为「换个函数读约束」）+
   `generalize.ts` ×1（`extractRefinesFromSource`@633）——否则 check /
   generalize / case 对账 / hover 各自为政。[已实施]
1. `ConstraintBuilder` 增加 `shift` / `lit` / `union` / `fn`（core），**实现与 Abs
   代数共用**；`shift` 限数值标量链、`lit` 用 `eq` pred 编码、`union` 补三条
   实例化路径（§2.3）；首批 utility：`partial` / `pick` / `omit`（小写，
   对齐 `number()`/`shape()`）。[已实施]
2. Loader 升级（§2.2）：真 parser 做 import/export 改写；递归 `loadModule` +
   环检测；exec 缓存键并依赖闭包指纹；静默吞错与 `export function` 形式
   侧车导出改诊断；**执行边界落地**（`node_modules` 不自动加载 / `autoBind`
   可关并透传到 scan generalize 与同文件 eiOpts；「项目根内」仍属宿主层
   未实现，见 §2.2）。存量行为翻转（吞错 → 诊断、
   `export function` 导出 → 报错）需同步改写 refine-import / check-shape-gold
   等夹具的相关期望——「gold 只增不改」只约束 `constraint-violated` 旧码，
   loader 行为翻转不适用。[已实施；.nudo.ts 入口剥 TS 语法]
3. 隐式依赖边登记（§4.5）+ evict 回归用例。[已实施]
4. 隐式 interface 始终可算；`nudo interface` 默认只打印；`--emit` 必须带 filter
   （`paths` / `--fn` / 默认只刷新已有生成段），禁止无参全量写盘。[已实施]
5. `nudo:interface-domain-exceeds`（**T10b**；error 仅手写契约，§3.3；带 §6 证据
   门槛，含字符串域隶属新代码）/ `nudo:interface-drift`（**T10a**；含域 ⊄ 生成段）/
   `nudo:interface-name-clash`；drift / domain-exceeds 进 gold 夹具，
   name-clash 与其余新码进 zero-FP 套件。[已实施]
6. LSP CodeLens：`● interface / default` + case 副层；hover default 走 symbolic；
   `nudo.interface` / `nudo.interface.emit`（按 `functionName`）。[已实施]
7. 文档：directives / check / CLI；case 降为 debug 叙事。[已实施]

**验收（Phase 1）**：无 `*.nudo.js` 时隐式 refine 仍可打印；`--emit
<文件路径> --fn add2` 只写**该文件自身的导出**（跨文件 root-闭包 emit 是
Phase 2 能力，验收见下）；`add` 双调用点域 `union(lit(42), lit("a"))`；
手写 `positive` 时 `"a"` 报 domain-exceeds（跨文件注入证据路径；字符串域
隶属为 Phase 1 新代码）；侧车内容变更后 parent 检查结果随逐出更新
（§4.5 用例）。

### Phase 2 — 契约下行（推导图，不编译）

1. 调用图 + 实参 Abs → 被调参数约束投影（走 Abs，不另写一套）。[已实施]
2. **求值期维护推导图（derivation trace）**（边带调用位点 / `+k` / join）；
   emit 直接打印该图的组合式，**禁止**事后从 Abs 反编译链。不叫
   provenance：`setProvenanceTracking` 已被 evaluator 的 TypeValue origin
   map 占用（服务 unknown 诊断），避免同名混义。机制 = side-channel
   **derivation collector** + core ops 层 shift/join 打点
   （`setCallCollector` 先例），不进 Abs payload（§14.3#6）。[已实施：
   `core/algebra/derivation.ts` + `arithmetic.add` / `objects.joinAbs` 打点]
3. 同名 `*.nudo.js` 生成 `fn({…}, returns?)`，跨文件 `import` 上游再组合；
   源码零注释；**仅 emit 选中的导出落盘**。[已实施：
   `emitDerivedFromRoot` / `formatDerivedSection`]
4. 多调用者：check 按链独立、不 join（§4.2 分轨）；落盘工件聚合才 join
   （先 Abs join 再投影）；循环/截断 → `interface-underivable`。[已实施
   分轨与 underivable；join 组合式退回展开式]
5. 隐式结果接入 L0 / check memo；可选 `.nudo/cache` 跨会话（与契约文件分离）。
   [部分：L0/check memo 已有；`.nudo/cache` 未做]
6. 示例矩阵：`docs/examples` 增加 lib/add 分层夹具。[已实施：
   `docs/examples/interface-derivation/`]

**验收（Phase 2）**：§5 隐式结果带推导图；`--emit src/lib.js --fn add2`
只写该导出（`--fn` 过滤的是 root 推导闭包内的目标名——`add2` 是 lib.js
链上的**下游**导出，不必是 lib.js 本文件导出）；emit 打印
`const x = positive.shift(1); export const add2 = fn({ x }, x.shift(2))`；
`check` 回 `positive4`；未 emit 的导出不产生契约 diff；`add2` 增加第二个
调用者后 `check(add4)` 仍过（§4.2 分轨——join 只进工件，不回灌链上推导）。

### Phase 3 — 门禁与 IDE 打磨

1. `doctor` refine drift CI（只针对已落盘契约）。[已实施：
   doctor 对含 `@generated` 侧车的文件收 `nudo:interface-drift` 并破门禁]
2. LSP CodeLens `persist/update refine`；固化后 drift 提示。[已实施
   persist/update；drift 提示走 check 诊断通道]
3. `package.json#nudo.interface` emit 白名单；agent API：`nudo.interface` / emit；SKILL.md 更新。[已实施：`interface.emit` glob 白名单接
   emitInterface / emitDerivedFromRoot；agent API Phase 1 已有；
   agent-skill/SKILL.md 已补 interface 契约 / 白名单 / doctor drift]
4. `--emit-cases` 文档降级；迁移说明。[已实施：网站文档标注非接口主路径]

---

## 12. 开放问题

1. **join vs 分场景契约**：多上层契约不同时，接口并集可能过宽。**已定**
   （§4.2）：check 按链独立、不受 join 影响；join 只发生在落盘工件聚合，
   不回灌。「按调用方分契约名」（侧车里 `add2_from_add4`，不绑源码）保留
   为**工件精度**的后续选项，不再是 check 正确性的前置。
2. ~~**返回约束下行 vs 上行**~~ **已拍板（§3.3）**：手写 = 义务（error）；
   生成 = 事实快照 + drift，不反向当义务压回实现（避免循环责难）。
   **同一口径适用于生成的参数约束**：不对第三方调用执法——它来自某条
   推导链的假设，执法会造成「上游契约收紧 → 无关文件 CI 失败」的
   错位传播。
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
现有输出精度策略必须**平移**：参数位逆变 widen（`widenParamType` /
`widenTopLevel`——字面量放宽到基类型、嵌套精度保留）要在约束侧重写，
否则现有 dts 消费者看到的输出变化（breaking）。

**TypeValue 彻底移除是正确终态，但是多一步，不绑在 refine 下行上。**
本节写于 TypeValue 驱逐前；下表各「位」的现状（2026-09 驱逐后）：

| 位 | 当时评估 | 现状 |
|---|---|---|
| dts 源 | **能**（本设计）改走 refine / Abs 投影 | ✅ 已落地：主签名 Abs → TS；TypeValue 仅剩 `Case:` JSDoc 行与无 Abs 回退（`dts-generator.ts`） |
| LSP hover / inlay 外延显示 | 部分：B-path 已优先 Abs；`@nudo:case` 区走 TypeValue | 未变：B-path Abs；case 区仍 TypeValue + activeCases |
| `@nudo:case` 实参文法 | 否：`parseTypeValueExpr` / `T.*` 是指令表面 | 未变：`T.*` 仍是指令表面，保留 |
| TypeValue evaluator（非 capable 源） | 否：兜底求值 IR | ✅ 已删除：生产 Abs 原生（B-path transpile+exec，回退 ast-eval/evalProgramAbs） |
| `infer --json` / agent 序列化 | 可迁：schema 换 Abs/refine，属 breaking | 未迁：仍 TypeValue 投影（`infer-json.ts` 的 `ext_*` 字段；`abs_*` 字段已并存） |
| 调用点 `CallRecord.argTypes` | 可迁：现为 TypeValue | ✅ 已改 Abs：`CallRecord` 仅 `argAbs`/`resultAbs`/`throwsAbs` |
| env API 应用（`env-to-abs.ts`） | 后置：env 实现 TypeValue 原生 | 部分：内置 es/node/web 已 Abs 原生不经桥；path 型 env（harvester / 用户 defineEnv）仍经 `absToTypeValue` 过桥 `impl` |

**现状小结：** 评估 IR 与 CallRecord 已 Abs 化（「评估/序列化残余」中
「评估」一侧已清）。剩余 TypeValue 出口 = dts `Case:` 行 + 无 Abs 回退、
case 实参文法（`T.*`）、`infer --json` 的 `ext_*`、path 型 env 桥，以及
`TypeValue` 类型与 `absToTypeValue` 桥本身——删除前提是这些出口全部换宿主。
「彻底移除」写进路线图，不写进本设计的交付门槛。

---

## 13. 决策摘要

| 决策 | 选择 |
|---|---|
| refine 文法 | 不内联类型；`*.nudo.js` + `shift/lit/union/fn` + utility helpers |
| **命名** | 产品面 **interface**（CLI/IDE/诊断）；机制层 refinement；`@nudo:refine` 兼容别名 |
| **绑定** | **侧车同名导出自动绑定源码的本地导出**（ESM named / 本地 `export {x}` / **CJS 静态 module.exports** / **export default** 见 C4.3–C4.4；re-export 不参与）；私有不落盘；源码零注释（`@nudo:refine`/`@nudo:interface` 兼容） |
| **隐式 vs 落盘** | 推导**始终隐式存在**；`--emit` 默认必须 filter，禁止无参全量写盘 |
| 配置 | 沿用 `package.json#nudo` 键扩展 `interface` 子键，不引入 `nudo.json` |
| **缓存** | 隐式 interface 进 L0/check memo，可选 `.nudo/cache`；与用户契约文件分离；自动绑定的**隐式依赖边**并入 dep 指纹 + `nudoDepParents`（§4.5） |
| **执行边界** | 自动绑定仅项目根内、`node_modules` 永不自动加载、`autoBind` 可关；LSP 执行未保存 buffer 属信任前提（§2.2） |
| 生成物形态 | **组合式 + import**，依赖与源码同构；禁止展开成 `gt(n)` 字面量墙 |
| 运算实现 | `shift` / `union` / helpers **与 Abs 代数共用**，不另写一套 |
| 推导链数据 | 求值期**推导图（derivation trace）**，emit 是其投影；非事后反编译；不与 evaluator 的 provenance 混名 |
| 推导方向 | 顶层手写契约 top-down；调用点域 bottom-up；二者对账 |
| **执法分档** | 手写 = 义务（error）；生成段 = 事实快照（drift，参数位与返回位同口径）；域 = 永不执法（§3.3） |
| **check 与工件分轨** | check 沿 root 链独立推导，**不经 join**；join 只用于落盘工件聚合，不回灌任何链的 check（§4.2） |
| **emit 方向** | 永远 root 驱动，不做全局反向索引；纯下游文件靠生成段 `derived-from` 标注反查根（§7.3） |
| 生成位置 | 被调源文件同名 `*.nudo.js`，导出名 = 源码绑定名 |
| **`fn`** | **一等 `NudoConstraint`**（`fn.params` / `fn.returns`），可 import / 嵌 shape；**参数位 Phase 1 只展示不执法**（§3.3） |
| 手写物 | 永不覆盖；撞名 → 报错；侧车与源码注释部分重叠取**合取**、矛盾（合取不可满足）才报错（§2.1） |
| case | 保留为特例/debug；非接口主产物 |
| 冲突 | 契约违例 / 域超出 / drift / name-clash / 源码-旁路 conflict 分码**且分档**（§3.3：error 只挂手写） |
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
| 侧车同名绑定（仅本地 named export，§2.1） | 加载 `foo.nudo.js` + 名字匹配导出表；`isNudoConstraint` 已有 |
| 单点 `effectiveInterface(fn)` | 机械收口：`check.ts` ×2 + **`scan.ts` ×4** + `generalize.ts` ×1 共 7 处提取点全部改走一个读取口（清单见 §11；scan.ts 的 wrapper→target 转发保留），读出的来源标注直接服务 §3.3 分档 |
| `lit` / `union` | `lit` = `prim + eq(self, lit v)` pred（`eq`/`predEquals` 已有），不开新字段；`union` 加 `members` 并补三条实例化路径 |
| `shift(n)`（常数界） | 对 `gt/ge/lt/le` 的 lit 右端加 n；走 Pred 重写；构建期限数值标量链（§2.3），`length` 界 / shape / array 上 throw |
| emit filter / `--fn` / `package.json#nudo.interface` | 编排层，复用 `case-emitter` 的剥离/写盘思路 |
| 隐式不落盘、手写优先 | 纯策略；`name-clash` 在 emitter 写盘前判定 |
| LSP `nudo.interface(.emit)` | 薄封装 + 写盘器；粒度到 export |
| drift 门禁 | 重算有效契约做**语义相等**：instantiate 后的 entry Abs 上 `leqAbs(a,b) && leqAbs(b,a)`（复用现有 `leqAbs`，不新造 Pred 规范化器），不是比源码字符串 |
| case 保留、`@nudo:refine` 别名 | 兼容层 |

### 14.2 有条件可实现（须先补前置）

| 点 | 缺口 | 建议 |
|---|---|---|
| `*.nudo.js` **嵌套 import** | 现 `execNudoModule` 正则剥壳、只注入 `number/string/boolean/shape/array`；相对 import 被**静默删除**（自由变量 → ReferenceError → `catch { continue }` 静默丢约束） | Phase 1（§2.2）：真 parser 改写 + `loadModule` 递归 + 闭包指纹缓存 + 吞错改诊断，`@nudojs/core` 仍注入 |
| 自动绑定隐式依赖边 | 逐出图 / 缓存键只认源码显式 `@nudo:import` | §4.5：侧车闭包并入 dep 指纹 + `nudoDepParents`；root→derived 边同登记 |
| `fn` 一等约束 | 扩 `NudoConstraint.fn = { params, returns?, throws? }`；`isNudoConstraint` 收 `fn`；可嵌 shape / 被 import | Phase 1：类型 + `fn()` 构建器 + 属性读写；勿另建平行类型；**参数位 `fn` 不执法**（§3.3），完整 HOF 隶属判定（参数逆变 × 返回协变）后置 |
| Abs → 约束投影（下行第 1 步） | 有 `constraintToEntryAbs`；**反向** Abs→NudoConstraint 无 | 只投影可表达子集：prim / 常数界 / shape / 字面量 union；其余 conf=partial，不 emit |
| 多调用者 join | `joinAbs` 已有；投影后再 join 或 join 后再投影需定序 | 仅**工件聚合**：先 Abs join，再投影；check 按链独立不 join（§4.2，join 回灌会误杀仍成立的上游契约） |
| dts ← interface | `dts-generator` 现吃 TypeValue | 新路径 Constraint/Abs → TS AST；与旧路径并行直至切换 |

### 14.3 设计内部冲突 / 须改口径

| # | 问题 | 处理 |
|---|---|---|
| 1 | 「无 `*.nudo.js` 仍有 `positive.shift(1)` 链」不成立——`positive` 来自根契约 | 已改 §7.1：无根时隐式 = Abs/域，不是下行链 |
| 2 | `export const add2_domain` 违反「侧车导出 = 源码导出」 | 已改 §5.4：域不另起导出名 |
| 3 | 手写与生成同名 `export const add2` 在同一文件是 **JS 语法错误** | 口径改为：emitter 见已有绑定则**不写**；「并存」指策略冲突而非字面双导出 |
| 4 | `nudo.json` 键名 `refine.emit` vs `interface.emit` | 已统一为 `package.json#nudo.interface`（不引入 `nudo.json`，沿用现有配置入口） |
| 5 | §6 诊断码新旧混用（`refine-underivable` 等） | **已应用**：§6 统一 `nudo:interface-*`。二轮核验：现仓无 `nudo:refine-*` 诊断码消费者（`entryOnly` 是 JSON 字段非诊断码），**alias 取消**——全新码，无迁移负担 |
| 6 | 生成物 pretty `shift` 链 vs 语义等价 | drift 比语义；emit 的链式是**推导图标注**，不是从 Abs 反编译出来的唯一形式——emit 时需在求值期记调用边推导图，否则只能写出展开式（与 §2.3 冲突） |

**#6 是最大实现风险，且正确方法是推导图数据，不是反编译：**

设计原则：**尽量避免编译**。不把 Abs「编译」回 `shift` 链；链式不是
反编译产物，而是推导过程本身的数据结构。该数据结构叫**推导图
（derivation trace）**——不叫 provenance：`setProvenanceTracking` 已被
evaluator 的 TypeValue origin map（unknown 诊断）占用，避免同名混义。

1. 下行求值时显式携带**推导图**：节点 = 约束/Abs，边 =（调用位点、
   `+k`、body 步进、join）。`positive.shift(1).shift(2)` 是这张图的**投影打印**。
   机制 = side-channel **derivation collector** + core ops 层（term/pred 发生
   shift/join 变换的位置）打点——沿用 `setCallCollector` /
   `setAbsTruncationCollector` / `setMemberDiagCollector` 先例，**不进 Abs
   payload**：§13「不改 Abs 本体」由此成立；ast-eval 与 B-path 共用
   core ops，两条路径天然都覆盖。
2. emit 写出的是推导图的可读形式；语义相等 = instantiate 后 entry Abs 上
   `leqAbs(a,b) && leqAbs(b,a)`（复用现有 `leqAbs`，不新造 Pred 规范化器），
   不比字符串。
3. 无推导图（纯 call@ 域 join）时只 emit 域本身，不编造链。
4. **禁止**「跑完 Abs → 猜测/恢复 shift 链」的后处理编译器。

### 14.4 语义上仍开放（非缺陷，但要拍板）

| 点 | 风险 | 默认建议 |
|---|---|---|
| join 过宽（多上层契约） | join 域回灌 check 会把**仍成立**的上游契约误判为失败（§4.2 反例） | **已定**：check 按链独立；工件默认 join，分场景名后置 |
| 生成返回当义务 vs 事实 | 循环责难；参数位同理还有「错位执法」 | **已定**（§3.3 / §12 开放问题 2）：生成（参数位与返回位同口径）= 事实快照 + drift；仅手写是义务 |
| `readonly` | TS 可写、Nudo 难查 | Phase 1 可砍 |
| `exclude`/`extract` | 依赖尚未存在的 union 成员集 | 随 `union` 一起，勿提前 |
| 循环 `.nudo.js` import | `execNudoModule` 无环检测 | 与模块图同一套 cycle 策略 |
| 跨文件 emit 顺序 | `lib.nudo.js` import `add.nudo.js` | 先依赖后被依赖；或 emit 后不求值、只写文本 |
| 非 capable 源的下行 | B-path 不可用时约束从哪来 | 明确：下行仅 B-path / Abs；TypeValue 路径不产 interface emit |

### 14.5 完备性缺口（未写清但实现会撞上）

1. **参数名对齐**：`fn({ x })` 的 `x` 必须与源码形参名一致；重命名形参
   → drift/冲突规则？（建议：名字对不上 → `interface-conflict`，不静默
   错绑。注意现状 `refineToIndexedFull` 对名字对不上是**静默跳过**
   （`idx >= 0` 过滤）——该规则同时是修 bug 式行为变更。）
2. **默认参 / rest / 解构形参**：`fn` 文法未定义；Phase 2 至少 rest 用
   `args` 数组约束或降级 partial。
3. **class / 方法**：侧车约定只覆盖 binding；`C.prototype.m` 不在模型内。
4. **throws 域**：§4.3 提了 throws，`fn` 结构未带 throws；建议 `fn(params, returns, { throws })`。
5. **有效契约合并序**：手写 ∪ 生成 ∪ 隐式的优先级只散落文中；check 须
   单点函数 `effectiveInterface(fn)`，避免各处各比各的。合并序定为：
   **手写 > 生成段 > 隐式**（展示），来源随值返回供 §3.3 分档。**已升格为
   Phase 1 第 0 步**：现有 7 个提取点（`check.ts` ×2 + `scan.ts` ×4 +
   `generalize.ts` ×1，清单见 §11）必须全部收口。
6. **序列化 / agent JSON**：隐式 interface 如何出现在 `infer --json` 未定义。

### 14.6 结论

| 维度 | 判定 |
|---|---|
| 产品模型 | **一致**：interface=接口域，case=特例；隐式/显式/缓存三层清楚 |
| 与现有内核 | **兼容**：不改 Abs；但 **`.nudo.js` 嵌套 import** 与 **隐式依赖边登记**（§4.5）是硬前置 |
| 内部冲突 | 6 处已改；两个检查语义裁决已拍板（**执法分档** §3.3、**check/工件分轨** §4.2）；无根本性互斥 |
| 最大风险 | **隐式依赖边失效**（§4.5，陈旧缓存/误报）、**推导图链式 emit**（§2.3）与 **Abs→约束投影完备性**；domain 检查的**证据门槛**（§6）是 FP 主源 |
| Phase 1 可交付 | 是——`effectiveInterface` 单点 + 构建器 + loader 升级 + 隐式边登记 + print/emit filter + 检查码骨架 |
| Phase 2 | 须带推导图，否则只能展开式（与文风冲突，需降级验收） |

**建议修订优先级：** `effectiveInterface` 单点 → 嵌套 loader（真 parser
改写 / 闭包指纹 / 吞错改诊断）→ 隐式边登记（§4.5）→ `fn/shift/lit/union`
→ Abs 投影子集 → emit filter → 下行 + 推导图 → drift 语义相等。

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
