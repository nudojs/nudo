# Nudo 设计限制与待解决问题

> 本文档列出 Nudo 当前的设计限制，是下一步改进的路线图。

---

## 一、集合类型推断限制

### 1.0 默认 / rest / 解构形参契约面（已解决·C4.1）

**已实现**：`param-surface.ts` 统一形参表面——
- 默认参 `f(x=1)` 契约名 = `x`
- rest `f(...nums)` 契约名 = `nums` / `...nums`
- 解构 `f({x,y})` 契约名 = 顶层绑定名 `x`/`y`（求值占位 `_p0`）
- generalize `g.params` 与 analyzer 对齐；`g.formals` 供 check/侧车匹配
- 错名仍报 `nudo:interface-param-mismatch`；嵌套 pattern 绑定名不进契约面（降级）

测试：`param-surface.test.ts`。

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

**已实现**：`new Set(arr)` 从 tuple/arr 填元素表；`Array.from` / for-of /
`$elems` 取到元素联合或逐元素。去重语义未建模（保多副本元素）。

```javascript
function dedup(arr) {
  const out = [];
  for (const v of new Set(arr)) out.push(v);
  return out;
}
dedup([1, 2, 2, 3]);
// → [1, 2, 2, 3]  #exact（元素来自构造实参）
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

---

## 二、高阶函数推断限制

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
与 3.2 的宽松相等同属「条件折叠」家族——`==`/`!=` 运算符
仍不折叠，三元条件侧已折叠。

---

## 四、控制流推断限制

### 4.1 循环中的条件返回（已解决·C2.1）

~~循环内 `return item` 的命中值未折叠进 Abs 结果：两条路径的 `abs` 均退化为
`unknown #exact`。~~

**已实现**：循环体内的 `return` transpile 为 `$loopReturn`（NudoReturn 信号），
`$forOf` / `$whileSeq` / `$for` 冒泡到函数调用方，`callTranspiledExportFull`
把它当作函数返回值。

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

### 4.3 `infer` 崩溃：class 声明 × 顶层调用点（已解决·2026-09 复测）

~~文件同时包含 class 声明与特定形态的顶层调用点时，`nudo infer`
以裸 `Maximum call stack size exceeded` 崩溃（exit 1，无文件/行号诊断），
与声明顺序无关，class 不必被实例化。~~ 已修复：2026-09 复测两个原触发
变体与合体文件均 exit 0，调用点逐位精确。

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

## 五、优先级排序

### P0 - 高影响，可实现

| 限制 | 影响 | 状态 |
|------|------|------|
| 全局标识符未解析 | 常见代码模式 | ✅ 已解决（见 3.1） |
| `this` 绑定语义 | 方法调用 | ✅ 已解决（见 3.0） |
| 数组 `reduce` 累加 | 链式调用 | ✅ 已解决（见 1.1） |
| `infer` class × 顶层调用点裸栈溢出 | 崩溃：目录扫描整体失败 | ✅ 已解决（见 4.3） |

### P1 - 高影响，复杂

| 限制 | 影响 | 方案 |
|------|------|------|
| 高阶函数参数推断 | 大量代码模式 | 关系型 Abs（见 `design-hof-relations.md`）+ 调用点推断 |
| Map 字面量 key 追踪 | 查找表模式 | 字面量 key 精确映射（见 1.2） |
| 数组动态 key 投影 / 手写循环 fn(item) | 常见代码模式 | key 分发 / 元素分发（见 1.1） |

### P2 - 中等影响

| 限制 | 影响 | 方案 |
|------|------|------|
| 闭包变量追踪 | 状态管理模式 | 闭包环境扩展 |
| catch 形参绑定（thrown 值类型） | 错误处理 | 异常分析 |

### P3 - 低影响 / 设计选择

| 限制 | 影响 | 方案 |
|------|------|------|
| Set 去重语义 | 信息丢失 | 可接受 |
| 循环细化类型 | 精度 | 可接受 |

---

## 六、测试覆盖情况

每个限制类别对应的测试文件（TypeValue 求值器删除后旧测试文件已移除，下表按当前 Abs 原生测试命名）：

| 限制类别 | 测试文件 | 状态 |
|---------|---------|------|
| 集合类型（map/reduce/forEach/some） | `core/src/algebra/__tests__/hof.test.ts` | ✅ 已覆盖（记录当前行为） |
| 高阶函数 | `core/src/algebra/__tests__/hof.test.ts`、`hof-relation*.test.ts`、`hof-p2-generalize.test.ts`、`hof-p4-check.test.ts` | ✅ 已覆盖 |
| 全局标识符 | `service/src/__tests__/bpath-env.test.ts`（env globals 经 B-path） | ✅ 已覆盖 |
| 宽松相等 | ——（TypeValue 求值器删除后 `==`/`!=` 折叠回归为 `unknown`，见 3.2，无专门测试） | ⚠️ 未覆盖 |
| 循环推断 | `core/src/algebra/__tests__/exec-bpath.test.ts`、`exec-spread-forof.test.ts` | ✅ 已覆盖 |

---

## 七、改进路线图

### 阶段 1：快速胜利（1-2 周）
- [x] 预置全局环境（`Infinity`、`NaN`、`undefined`）
- [x] 实现 `Number`、`Math`、`JSON` 等内置对象的静态属性
- [x] 简单实现 `==` / `!=` 折叠（C2.3：`looseEqAbs`）

### 阶段 2：精度提升（2-4 周）
- [x] 数组 `reduce` 累加器追踪（字面量逐元素 + 符号单 pass，见 1.1）
- [ ] Map 字面量 key 追踪（`m.get("k")` 仍 unknown，见 1.2）
- [ ] 高阶函数：关系型 Abs（P1 消费 + P2 归纳 + P4 检查已落地；P5 dts 投影待做；见 `design-hof-relations.md`）

### 阶段 3：深度改进（1-2 月）
- [ ] 闭包变量状态追踪
- [ ] catch 形参绑定（thrown 值类型，见 4.2）
- [ ] ~~泛型函数支持~~ → 由关系型 Abs / PolyFn.fnRels 承担（非 TS 泛型语法）

## 八、调用点发现的已知边界（P7 实测，2026-08）

调用点注入（`infer --callsites`）在 hoek 98.6% / json-ext 91.8% 后的
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

