<!-- CLI semantics: docs/design-cli-semantics.md — L1 explicit contracts + L2 entry may-throw.
     C0 body-slot prohibition remains; entry unconstrained params = any; observation via check/test. -->
# Nudo 设计限制与待解决问题

> 本文档列出 Nudo 当前的设计限制，是下一步改进的路线图。
> **状态约定**：每项只保留一个状态。实现已落地写「已解决」并给锚点；
> 部分落地写「部分」并点名剩余门禁；未开工写「未解决」。与
> [`superpowers/plans/2026-05-28-close-ts-dx-gaps.md`](superpowers/plans/2026-05-28-close-ts-dx-gaps.md)
> 冲突时以路线图任务表为准，并回来改本文。

---

## 一、集合类型推断限制

### 1.0 默认 / rest / 解构形参契约面（已解决·C4.1）

**已解决**：`param-surface.ts` 统一形参表面——
- 默认参 `f(x=1)` 契约名 = `x`
- rest `f(...nums)` 契约名 = `nums` / `...nums`
- 解构 `f({x,y})` 契约名 = 顶层绑定名 `x`/`y`（求值占位 `_p0`）
- generalize `g.params` 与 analyzer 对齐；`g.formals` 供 check/侧车匹配
- 错名仍报 `nudo:interface-param-mismatch`；嵌套 pattern 绑定名不进契约面（降级）
- effectiveInterface 可绑默认/rest/解构顶层名（测试 `param-surface.test.ts`）
- **调用点执法**：scan `interfaceToIndexed` 经 `locateContractParam` 把解构契约名
  映射到 `{index, field}`，`checkReqs`/`checkShapeReqs` 对字段投影后再判约束
  （金样例 `c41-destructure-enforce.test.ts`）

**已删除**：`formalParamsFromSource` 恒 `undefined` 的死导出（仅测试可用的
AST 路径走 `formalParamsFromNodes`）。

---

### 1.1 数组方法精度：reduce / forEach / some / 手写循环 push（已解决）

**当前行为：**
`reduce` 已在两条路径上精确：字面量数组逐元素累加、符号数组单次应用回调
（`init + element`）；
`filter → map → reduce` 链式调用不再逐级丢信息。`forEach` 回调副作用写回、
`some`/`every` 返回 boolean 也已建模。**C1.4**：for-of / for-i 内
`out.push(v)` 对标识符接收者重绑（push 返回新 tuple/arr），累加与收集均精确。

**实测示例：**
```javascript
/**
 * @nudo:case "reduce" ([1, 2, 3, 4, 5])
 */
function sum(arr) {
  return arr.reduce((a, b) => a + b, 0);
}
// Case "reduce": ([1, 2, 3, 4, 5]) => 15
//   abs: 15  #exact
```

```javascript
/**
 * @nudo:case "forof-push" ([1, 2, 3])
 */
function doubleAll(arr) {
  const out = [];
  for (const x of arr) out.push(x * 2);
  return out;
}
// Case "forof-push": ([1, 2, 3]) => [2, 4, 6]  #exact
```

已建模 / 未建模的边界已固化进示例门禁：
[`docs/examples/algebra/h-array-boundary.js`](examples/algebra/h-array-boundary.js)
（CI 钉住：`reduce` → `15 #exact`、`forEach` 副作用 → `15`、`some` → `boolean`）。

**剩余限制：** 无（动态 key 见 §1.4 / e-index-proj：槽位并集）。

**难度：** 低

---

### 1.2 Map 字面量 key 追踪（已解决·C1.1）

~~`Map.get(key)` 无法回查字面量 key 的精确映射。~~

**已实现**：`new Map()` 起条目表（按 Abs 身份 WeakMap）；`set(k, v)` 原地
更新；字面量 `get`/`has` 精确；非字面量 key → 已知 value 并集。

```javascript
function lookup(key) {
  const m = new Map();
  m.set("alice", { id: "alice", name: "Alice" });
  return m.get(key);
}
lookup("alice");
// → { id: "alice", name: "Alice" }  #exact
```

实现：`collections.ts`（`makeMapAbs` / `mapSetEntry` / `mapGetEntry`）+
`$new(Map)` / `$invoke` / ast-eval `evalBuiltinNew`。
测试：`collections.test.ts`。示例：`i-map-set.js`。

---

### 1.3 Set 元素联合（已解决·C1.2）

~~`Array.from(Set)` / Set for-of 元素 unknown。~~

**已实现**：`new Set(arr)` 从 tuple/arr 填元素表并按 JS 语义对字面量元素去重；
`Array.from` / for-of / `$elems` 取到元素联合或逐元素。

```javascript
function dedup(arr) {
  const out = [];
  for (const v of new Set(arr)) out.push(v);
  return out;
}
dedup([1, 2, 2, 3]);
// → [1, 2, 3]  #exact（Set 字面量元素去重）
```

---

### 1.4 动态 key 索引投影（已解决·C1.3 保守并集）

~~`obj[unknownKey]` → `unknown`。~~

**已实现**：闭包对象（closed shape）上非字面量 key → **所有槽位并集**
（open shape 仍并上 unknown）。字面量 key 仍精确。

```javascript
function pickDynamic(obj, key) {
  return obj[key];
}
pickDynamic({ a: 1, b: "x" }, "c");
// → 1 | "x"  #exact（miss 时并集；命中槽仍精确）
```

实现：`$idx` 对 obj/brand-obj 的并集分支。
示例：`e-index-proj.js`。

**剩余**：符号 key 与分支字面量 key 的更细拆分未做（当前并集即可）；
未单独加「unknown key 不报 FP」的扩展 gold 时，以 zero-FP 真实包套件为准。

---

## 二、高阶函数推断限制

### 2.0 HOF promote（body 用量提升）与 C0 契约模型（诚实边界）

**契约模型（C0 / design-cli-semantics §3）**：check 义务分两层——

- **L1** 显式契约：`*.nudo.js` / `@nudo:refine` / harvest `relationFn`。
  **不**从 body AST 预扫描发明必填 slot（C0 仍成立）。
- **L2** 入口 may-throw：export/entry 函数上未消化的 throws → 默认 **error**
  （`nudo:entry-may-throw`；`--ignore-throws` / `package.json#nudo.check.ignoreThrows` 可滤）。
  这是 JS 运行时边界语义，不是 shape 必填义务。

入口无约束参数显示为 **`any`**；`unknown` 表示推导失败，不与 any 混用。

**现状（需与 C0 一并阅读）**：generalize 在无 refine 时仍会从 body 用量
**promote** 出 `fnRels`（`RelSource === "promote"`，参数被当回调使用 →
fn/arity 形状）。`checkHofFnRelArgs`（`scan.ts` ~1342–1387）消费这些关系时：

| `fnRels` 来源 | 行为 | 语义 |
|---|---|---|
| `promote`（body 用量提升） | **`nudo:arg-structure` warning** | **建议/提示**，不是 check 义务 |
| `refine` / `relationFn`（显式契约） | error（refine 表达 fn 后才可测） | 真正的检查义务 |

因此：**body-usage promote = suggestion/warning only**。它**不**构成
L1 义务的反例执法——默认门禁不会因 promote 升 exit code。
文档/对比表不得把 promote warning 写成「零注解 body 推出的 check 错误」。
（与之相对，L2 入口 may-throw **会**升 exit code，但是运行时效果门禁，不是 promote。）
实现锚点：`scan.ts` `const isPromote = rel.source === "promote"`；
设计细节见 [`design-hof-relations.md`](design-hof-relations.md) §6.3 与
[`design-cli-semantics.md`](design-cli-semantics.md) §3。

---

### 2.1 具名回调形参：关系归纳 + concrete 消费（已解决·C3.1）

~~concrete case 把无 impl 回调绑成 unknown，首级 HOF 链式断裂。~~

**已实现**：
1. 调用点实参若是宿主 JS 函数（transpile 导出），`safeAbsOrUnknown` 包成可调用 Abs。
2. B-hosted 文件顶层 call 记录优先于 Abs 路径。

```javascript
processItems([1, 2, 3], double, isPositive);
// → number[]  #partial（回调实参 (arg0) => ?，不再 unknown）
```

测试：`c3-hof-closure.test.ts`。内联箭头回调本就精确（`b-hof-map.js`）。

**难度：** 中（已落地）

---

### 2.2 闭包变量追踪 / 返回对象方法槽（C3.2 方法槽已解决）

返回对象的**方法槽**已进 shape；闭包多次修改后的跨调用状态合流仍有限。

```javascript
createCounter();
// → { increment: () => ?, getCount: () => ? }  #exact
```

实现：B 路径 ObjectMethod → `$fnVal`；ast-eval ObjectMethod → absFunction。
测试：`c3-hof-closure.test.ts`。

**剩余：** `c.increment(); c.getCount()` 跨调用联动未建模。

**难度：** 中

---

### 2.3 HOF dts 投影（已解决·C3.3 / P5）

`fn.hof` 快照 → dts 泛型投影（`<A1,B_transform>`；有精确 case 时让位
case-widen）。路线图 C3.3 = `[x]`。本文旧文「P5 待做」已过期。

---

## 三、类型系统限制

### 3.0 构造函数 `this` 语义（已解决）

~~类/构造函数体内的 `this` 求值为 undefined，`this.push(...)` 报 no-method
误报。~~ 已解决（Abs 原生）：B 路径成员分派（`$invoke`/`$get`）把 receiver 作为
thisVal 注入；`new C()` 创建 fresh instance 绑定 `this`；未绑定 this 兜底 unknown。
json-ext 试炼 41 error → 0。

CLI 主路径（B-hosted）的可见行为（2026-09 实测）：
- `obj.f()` receiver 注入已生效：函数体内的成员调用在**调用点与指令两条路径**都精确（`compute(5)` 内 `circle.area()` → `25 #exact`）
- **顶层裸成员调用**（`circle.area()` 作语句）不被采集为调用点（无 `call@` case）——采集缺口，非求值缺口（见 semantics.md「Method Calls and this」）
- `f.call(thisArg)` / `f.apply` **不产生 call@ 记录**（仅 entry@ 兜底）
- 原始值自动装箱未建模：`"nudo".constructor` → `unknown`（见 semantics.md）

### 3.1 全局标识符未解析（已解决）

~~JavaScript 内置全局标识符（`Infinity`、`NaN`、`undefined`）和静态属性（`Number.MAX_SAFE_INTEGER`）未解析。~~ 已实现：内置全局常量收进 env 模块 `packages/env/src/es.ts` 的 `defineEnv()`——顶层 `Infinity`/`NaN`（`number`）与 `undefined`（`undef()`），`Math` 对象 8 个常量（`PI`/`E`/`LN2`/`LN10`/`LOG2E`/`LOG10E`/`SQRT2`/`SQRT1_2`）、`Number` 对象 8 个常量（`MAX_SAFE_INTEGER`/`MIN_SAFE_INTEGER`/`MAX_VALUE`/`MIN_VALUE`/`POSITIVE_INFINITY`/`NEGATIVE_INFINITY`/`NaN`/`EPSILON`），数值常量均解析为 `number` 且不再触发 `unknown-global`/`builtin-unknown` 诊断；`@nudo:env` 指令存在时 `loadEnvs` 绑定仍优先。测试：`service/src/__tests__/bpath-env.test.ts`（env globals 经 B-path）。

---

### 3.2 `==` / `!=` 宽松相等（已解决·字面量折叠 2026-05）

~~`==` / `!=` 不折叠——即使两操作数均为字面量也恒为 `unknown`。~~
**已实现**：双字面量走 JS Abstract Equality（ToNumber 强转、`null == undefined`、
`NaN != NaN`）；非字面量回落严格相等判定（`strictEqAbs`）。

```javascript
function f() {
  return [5 == 5, 5 == "5", 0 == false, null == undefined, 0 == "x"];
}
f();
// Case "call@…": () => [true, true, true, true, false]
```

实现：`looseEqAbs`（`surface.ts`）+ `$eqLoose`/`$neLoose`（B 路径）+ ast-eval
`==`/`!=` 分支。测试：`surface.test.ts`、`loose-eq-fold.test.ts`。
**测试状态**：已覆盖（本文旧表「TypeValue 删除后回归 unknown / 未覆盖」已过期）。

---

### 3.3 三元条件表达式分叉（已解决·确定条件）

~~`cond ? a : b` 的条件在两条路径上都不求值分叉——即使实参是布尔字面量或
可判定的比较，整个三元表达式恒为 `unknown`。~~ 已修复（2026-09 实测复验）：
**确定条件**（布尔字面量、可折叠的 `===` 比较）在调用点与指令两条路径上
都静态选支，得到精确字面量：

```javascript
function eq5(x) {
  return x === 5 ? "five" : "other";
}
eq5(5);
// Case "call@…": (5) => "five"        ← === 比较在三元条件里折叠，选真支

function pick(b) {
  return b ? "a" : "b";
}
pick(true);
// Case "call@…": (true) => "a"        ← 布尔字面量分叉
```

实现位置：B 路径 `core/src/algebra/exec/transpile.ts` 把三元编译为 `$fork`，
`runtime.ts` 按 `isDefinitelyTrue` / `isDefinitelyFalse` 选支。

**剩余限制：** 条件求值为 `unknown`（符号参数无具体绑定）时不分叉，
两支合并（形态依路径而异）：

```javascript
function opaque() { return JSON.parse("1"); }
function t2(x) { return x ? "a" : "b"; }
t2(opaque());
// Case "call@…": (unknown) => string      #path（"a" | "b" 拓宽合并）
// 指令 case 无实参（参数 unknown）：() => unknown  #partial
```

这与 `if` 守卫面对 unknown 条件的行为一致（两支 join），属保守正确，
非精度缺口。**C2.4 已补可解释度**：`joinAbs` 对异形两支挂 `pathNote`
（如 `join(number | string)`），`formatAbs` / hover / `--verbose` 可见
分支来源；`formatShape` / dts 投影面保持干净。
与 3.2 的宽松相等同属「条件折叠」家族——**双字面量 `==`/`!=` 已折叠**
（§3.2）；符号操作数仍走严格相等回落。

---

## 四、控制流推断限制

### 4.1 循环中的条件返回（已解决·C2.1）

~~循环内 `return item` 的命中值未折叠进 Abs 结果：两条路径的 `abs` 均退化为
`unknown #exact`。~~

**已实现**：循环体内的 `return` transpile 为 `$loopReturn`（NudoReturn 信号），
`$forOf` / `$whileSeq` / `$for` 冒泡到函数调用方，`callTranspiledExportFull`
把它当作函数返回值。`inLoop` 对 for-of / while / for-i 递增；**嵌套函数 /
方法体将 `inLoop` 归零**（避免 return 泄漏成 `$loopReturn`）。

```javascript
/**
 * @nudo:case "break-loop" ([1, 2, 3, 4, 5])
 */
function findFirst(arr) {
  for (const item of arr) {
    if (item > 3) return item;
  }
  return undefined;
}
// Case "break-loop": ([1, 2, 3, 4, 5]) => 4
// abs: 4  #exact
```

**测试**：
- `service/src/__tests__/loop-return-fold.test.ts` — for-of 条件 return 折叠
- `core/src/algebra/__tests__/loop-return-and-presence.test.ts` — for-i / while /
  嵌套回调 return 不误绑为外层结果

路线图 C2.1 = `[x]`。

---

### 4.2 try-catch：确定性 return 与 catch 形参绑定（已解决·C2.2）

**当前行为（2026-05 实测）：**
try 体是确定性 `return`（无抛点）时静态选支精确——嵌套 try-catch 折叠为
`"inner" #exact`（catch 分支不可达，不产生路径联合）：

```javascript
function nested() {
  try {
    try {
      return "inner";
    } catch (e) {
      return "inner-catch";
    }
  } catch (e) {
    return "outer-catch";
  }
}
nested();
// Case "call@L12": () => "inner"
// abs: "inner"  #exact
```

**catch 形参（C2.2 已实现）：** `catch (err)` 绑定 thrown 值 Abs。
`new Error` / `TypeError` 等 Error 家族携带 `name` / `message` 槽
（字面量 message 保精确）；非 Error 抛出值原样绑定。catch 形参
是局部绑定，不再报 `nudo:builtin-unknown`。

```javascript
function caught() {
  try {
    throw new Error("boom");
  } catch (err) {
    return err.message;
  }
}
caught();
// Case "call@L…": () => "boom"
// abs: "boom"  #exact
```

已固化为示例门禁：
[`docs/examples/algebra/k-try-catch.js`](examples/algebra/k-try-catch.js)
（CI 钉住：`"inner" #exact`、`caught` → `"boom" #exact`）。

实现：`errorBrandAbs`（`builtins.ts`，B `$new` 与 ast-eval `evalBuiltinNew`
共用）、`$catchVal`（宿主 Error 补槽）、`collectDeclared` 收 CatchClause 形参。
测试：`catch-binding.test.ts`、`catch-param-declared.test.ts`、`exec-trycatch.test.ts`。

---

### 4.3 CLI 崩溃：class 声明 × 顶层调用点（已解决·2026-09 复测）

~~文件同时包含 class 声明与特定形态的顶层调用点时，CLI 分析
以裸 `Maximum call stack size exceeded` 崩溃（exit 1，无文件/行号诊断），
与声明顺序无关，class 不必被实例化。~~ 已修复：2026-09 复测两个原触发
变体与合体文件均 exit 0，调用点逐位精确。今日验证命令：`nudo test` /
`nudo check`（旧动词 `infer` 已 deprecated）。

```javascript
// 原触发形态 A：顶层调用 Object.keys(具体形状) —— 现已正常
function keysOf() { return Object.keys({ port: 3000, host: "x" }); }
keysOf();

class Circle {
  constructor(r) { this.radius = r; }
  area() { return this.radius * this.radius; }
}
// Case "call@…": () => ["port", "host"]  #exact
```

```javascript
// 原触发形态 B：顶层调用递归函数 —— 现已正常
function walk(n) {
  if (n <= 0) return 0;
  return n + walk(n - 1);
}
walk(2);

class Circle { /* 同上 */ }
// Case "call@…": (2) => 3  #exact
//   （递归逐层展开为独立 call@ case：walk(0)→0、walk(1)→1、walk(2)→3，
//     Combined: 0 | 1 | 3）
```

四片段合体（class + `compute(5)` + `keysOf()` + `walk(2)` 同文件）同样
exit 0，全部 case 精确（`compute` → `25 #exact`）。网站
`guides/semantics.md` 的「勿拼页」警示已同步移除。

---

## 五、优先级排序（与正文单一状态对齐）

### P0 - 高影响，可实现

| 限制 | 影响 | 状态 |
|------|------|------|
| 全局标识符未解析 | 常见代码模式 | ✅ 已解决（见 3.1） |
| `this` 绑定语义 | 方法调用 | ✅ 已解决（见 3.0） |
| 数组 `reduce` 累加 | 链式调用 | ✅ 已解决（见 1.1） |
| CLI class × 顶层调用点裸栈溢出 | 崩溃：目录扫描整体失败 | ✅ 已解决（见 4.3） |

### P1 - 高影响，复杂

| 限制 | 影响 | 状态 |
|------|------|------|
| 高阶函数参数推断 | 大量代码模式 | ✅ 关系型 Abs 消费/归纳/dts 已落地（§2.1、§2.3）；promote warning 语义见 §2.0 |
| Map 字面量 key 追踪 | 查找表模式 | ✅ 已解决（见 1.2） |
| 数组动态 key 投影 / 手写循环 fn(item) | 常见代码模式 | ✅ 已解决（见 1.1、1.4） |

### P2 - 中等影响

| 限制 | 影响 | 状态 |
|------|------|------|
| 闭包变量追踪 | 状态管理模式 | ⚠️ 部分（方法槽 ✅；跨调用状态合流未做，见 2.2） |
| catch 形参绑定（thrown 值类型） | 错误处理 | ✅ 已解决（见 4.2） |

### P3 - 低影响 / 设计选择

| 限制 | 影响 | 状态 |
|------|------|------|
| Set 去重语义 | 信息丢失 | ✅ 已建模（字面 key 条目表；见 collections.ts / i-map-set） |
| 循环 return 回归测试完备性 | 门禁 | ✅ 已解决（for-of / for-i / while / nested 均有测试，见 4.1） |

---

## 六、测试覆盖情况

每个限制类别对应的测试文件（按当前 Abs 原生测试命名）：

| 限制类别 | 测试文件 | 状态 |
|---------|---------|------|
| 集合类型（map/reduce/forEach/some） | `core/src/algebra/__tests__/hof.test.ts`、`collections.test.ts` | ✅ 已覆盖 |
| 高阶函数 | `hof.test.ts`、`hof-relation*.test.ts`、`hof-p2-generalize.test.ts`、`hof-p4-check.test.ts` | ✅ 已覆盖 |
| 全局标识符 | `service/src/__tests__/bpath-env.test.ts` | ✅ 已覆盖 |
| 宽松相等 `==`/`!=` | `core/src/algebra/__tests__/surface.test.ts`、`loose-eq-fold.test.ts` | ✅ 已覆盖（已实现，非未覆盖） |
| 循环推断 | `exec-bpath.test.ts`、`exec-spread-forof.test.ts`、`loop-return-fold.test.ts`、`loop-return-and-presence.test.ts` | ✅ 已覆盖（for-of / for-i / while / nested boundary） |
| 形参表面 C4.1 | `core/src/algebra/__tests__/param-surface.test.ts`、`c41-destructure-enforce.test.ts` | ✅ 已覆盖（surface/绑定 + 调用点解构执法） |

---

## 七、改进路线图（与正文对齐）

### 阶段 1：快速胜利
- [x] 预置全局环境（`Infinity`、`NaN`、`undefined`）——见 3.1
- [x] 实现 `Number`、`Math`、`JSON` 等内置对象的静态属性——见 3.1
- [x] 简单实现 `==` / `!=` 折叠（C2.3：`looseEqAbs`）——见 3.2

### 阶段 2：精度提升
- [x] 数组 `reduce` 累加器追踪（字面量逐元素 + 符号单 pass，见 1.1）
- [x] Map 字面量 key 追踪（见 1.2；**已实现**，非「仍 unknown」）
- [x] 高阶函数：关系型 Abs P1 消费 + P2 归纳 + P4 检查 + P5 dts（见 2.1/2.3）；promote 仅 warning（§2.0）

### 阶段 3：深度改进
- [ ] 闭包变量状态追踪（跨调用合流；方法槽已完成，见 2.2）
- [x] catch 形参绑定（见 4.2；**已实现**）
- [x] C4.1 调用点解构侧车字段执法（见 1.0；`locateContractParam` 已接入 scan）
- [ ] ~~泛型函数支持~~ → 由关系型 Abs / PolyFn.fnRels 承担（非 TS 泛型语法）
- [x] C2.1 循环 return 回归（for-i + nested fn，见 4.1 / `loop-return-and-presence.test.ts`）
- [x] C4.1 调用点解构侧车字段执法（见 1.0；`locateContractParam` 已接入 scan）

## 八、调用点发现的已知边界（P7 实测，2026-08）

调用点注入（`nudo test/check --from`，原 `infer --callsites`）在 hoek 98.6% / json-ext 91.8% 后的
诚实天花板项（阶段 3 循环/闭包语义波已落地：for-of union 分发、
break/continue 信号、let 每轮绑定、Promise resolve 静态位点扫描、
递归截断观测回退、usage-site 执行泄漏标记）：

- **symbolic 剩余 unknown 叶子**：flatten/keys/escape 等已在循环语义波
  与收集侧精度波修复；isDeepEqual 的 symbolic 仍有零散 unknown 叶子
  （异构 union 下的对象除法/toString 形态），顶层同构探针全通过，
  需现场插桩定位，收益 1 case。
- **运行时机制驱动的内部函数**：json-ext stringify-stream 的
  push/processObjectEntry/processArrayItem 由 Node Transform 流机器
  （native 内部）回调，测试只触达工厂函数——无调用记录可收集，
  entry@ 是诚实结果。需流语义模拟才能突破，超出静态求值范围。
- **无使用现场的函数**：entry@ 兜底（applyToDefaults.reachCopy 等
  测试未直接触达的内部函数），属覆盖问题非推断问题。
- **嵌套函数不归因**：函数内定义的函数（json-ext 的 `walk`）在函数
  执行时创建，模块栈空、无定义位点 tag；其外部记录被归因门正确拒收
  （靠本地求值的记录覆盖）。
- **双入口包变体**：browser/node 双变体同签名函数，变体 A 的执行记录
  不注入变体 B 的分析（归因门按文件判定——正确性优先）。

### 仍建议 mock 的类别（与 website semantics 对齐）

以下类别与本节天花板一致，**env 覆盖 / harvest 不能替代 mock**；详见
website `guides/semantics.md`「Mock boundary」与 `api/harvester.md`
「Mock boundary（诚实）」：

| 类别 | 说明 |
|------|------|
| Native bindings | `child_process.spawn`、原生 addon —— env 可有签名，无副作用模拟 |
| 动态 `require` | 计算模块图无法静态解析 |
| 流机器回调 | Node Transform 运行时回调（本节 json-ext stringify-stream） |
| 双入口 browser/node | 调用点记录不跨文件 |
| 无调用现场函数 | `entry@` 兜底是诚实结果 |

覆盖报告（`docs/reports/env-coverage-baseline.md`）的解析率**不是**完备性承诺。
