# Nudo 设计限制与待解决问题

> 本文档列出 Nudo 当前的设计限制，是下一步改进的路线图。

---

## 一、集合类型推断限制

### 1.1 数组方法精度不齐：reduce 已精确，forEach 副作用 / some / every 仍 unknown

**当前行为（2026-09 实测）：**
`reduce` 已在两条路径上精确：字面量数组逐元素累加、符号数组走累加器不动点；
`filter → map → reduce` 链式调用不再逐级丢信息。仍未建模的是 `forEach` 的副作用
写回、`some`/`every` 的返回值。

**实测示例：**
```javascript
/**
 * @nudo:case "reduce" ([1, 2, 3, 4, 5])
 */
function sum(arr) {
  return arr.reduce((a, b) => a + b, 0);
}
// Case "reduce": ([1, 2, 3, 4, 5]) => 15  #exact
```

```javascript
/**
 * @nudo:case "t" ([1, 2, 3, 4, 5])
 */
function forEachSum(arr) {
  let s = 0;
  arr.forEach((x) => { s = s + x; });
  return s;
}
// Case "t": ([1, 2, 3, 4, 5]) => 0 —— forEach 回调副作用不写回（s 恒 0）

/**
 * @nudo:case "t" ([1, 2, 3, 4, 5])
 */
function someBig(arr) {
  return arr.some((x) => x > 3);
}
// Case "t": ([1, 2, 3, 4, 5]) => unknown —— some/every 未建模
```

**影响范围（剩余）：**
- `Array.forEach()` 的副作用推断（回调内的赋值/写回不传播）
- `Array.some()` / `Array.every()` 的返回值
- 回调形态的集合迭代（手写 for-of / for-i 循环里 `fn(item)` 的返回值不进 push）

**已解决部分：**
- `Array.reduce()`：字面量路径逐元素求值；符号路径 `acc ⊔ (acc+A)` 收敛（`#widened`）
- `filter` + `map` + `reduce` 链式调用：每级保留字面量精度
- `arr.map(cb)` 回调传播：调用点逐位实例化（`[2,4,6]`）

**可能的解决方案（剩余部分）：**
1. **副作用建模**：把回调执行的环境写回绑定表
2. **集合谓词**：`some`/`every` 按元素分发求值

**难度：** 中（reduce 部分已实现）

---

### 1.2 Map 不跟踪 key-value 映射关系

**问题描述：**
`Map.get(key)` 无法回查字面量 key 的精确映射；即使 `m.set("k", v)` 字面量成对出现，
`m.get("k")` 目前仍求值为 `unknown`（指令路径与调用点路径一致）。

**失败示例：**
```javascript
/**
 * @nudo:case "map-get" ()
 */
function test() {
  const map = new Map();
  map.set("a", { id: "a", name: "Alice" });
  map.set("b", { id: "b", name: "Bob" });
  return map.get("a");
}
// 期望: { id: "a", name: "Alice" }
// 实际: unknown
```

**根本原因：**
- Map 只记录 `K` / `V` 的整体类型，不维护 `key → value` 的具体映射
- `get()` 无字面量回查表，字面量 key 直接吸收为 `unknown`
- `Map`/`Set` 的 for-of 迭代同样未建模（元素求值为 `unknown`）

**影响范围：**
- `Map.get()` 返回值精度
- `Map.has()` 的类型收窄
- 基于 Map 的查找表模式

**可能的解决方案：**
1. **字面量 key 追踪**：当 key 是字符串/数字字面量时，维护精确映射
2. **Record 类型**：对字面量 key 的 Map 降级为对象类型处理（对象字面量的索引投影已精确，见 `docs/examples/algebra/e-index-proj.js`）

**难度：** 中

---

### 1.3 Set 操作返回值精度

**问题描述：**
`Array.from(Set)` 当前求值为 `unknown`（Set 的迭代器未建模），无法得到元素联合数组。

**当前行为：**
```javascript
/**
 * @nudo:case "set-dedup" ([1, 2, 2, 3, 3, 3])
 */
function unique(arr) {
  return Array.from(new Set(arr));
}
// 期望: [1, 2, 3]（或 (1 | 2 | 3)[]）
// 实际: unknown
```

**分析：**
- Set 不保证顺序，返回数组而非元组是合理形态
- 但当前连元素联合都拿不到——`Set` 构造/迭代整体未建模，直接 `unknown`

**难度：** 低（先建模 Set 元素类型，再考虑去重语义）

---

## 二、高阶函数推断限制

### 2.1 函数参数类型无法推断

**问题描述：**
当函数作为参数传递时，Nudo 无法推断回调函数的参数类型。

**失败示例：**
```javascript
/**
 * @nudo:case "higher-order" ([1, 2, 3])
 */
function processItems(items, transform, filter) {
  return items.filter(filter).map(transform);
}
// Case "higher-order": ([1, 2, 3]) => unknown
//   [warning] Cannot resolve 'map' on unknown value (nudo:unknown-recv)
// transform 和 filter 的参数类型为 unknown，且 filter(filter) 结果 unknown，
// 后续 .map 链直接断掉
```

**边界（已精确的相邻形态）：**
- 调用点**内联箭头回调**（`items.map((x) => x * 2)` 字面量传入）逐位实例化
  —— 见 `docs/examples/algebra/b-hof-map.js`（`[2,4,6]` / `["A","B"]`）
- 缺口在于「具名函数参数当回调用」：回调参数类型未知，且首级方法返回 unknown 后链式断裂

**根本原因：**
- 函数参数在调用时才绑定类型
- 高阶函数的回调参数类型依赖调用上下文
- Nudo 没有"泛型函数"的概念来表达 `fn: (T) => U`

**影响范围：**
- 所有接受回调的高阶函数
- `Array.map/filter/reduce` 的回调参数
- 事件处理器、中间件等模式

**可能的解决方案：**
1. **调用点推断**：在函数被调用时，从实参推断回调的参数类型
2. **泛型支持**：引入类型变量，表达 `fn<T, U>(items: T[], transform: (T) => U): U[]`
3. **上下文传播**：将数组元素类型传播到回调参数

**难度：** 高

---

### 2.2 闭包变量追踪

**问题描述：**
闭包捕获的变量在返回后无法正确追踪其类型变化。

**当前行为：**
```javascript
/**
 * @nudo:case "closure" ()
 */
function createCounter() {
  let count = 0;
  return {
    increment() { return ++count; },
    getCount() { return count; }
  };
}
// Case "closure": () => {} —— 返回对象形状为空：方法槽未写入形状，
// 更不用说闭包变量 count 的状态追踪
```

**分析：**
- 返回对象的**方法槽**当前丢失（形状为空 `{ }`）
- 闭包变量的多次修改后的状态追踪也不完整

**难度：** 中

---

## 三、类型系统限制

### 3.0 构造函数 `this` 语义（已解决·TypeValue 路径）

~~类/构造函数体内的 `this` 求值为 undefined，`this.push(...)` 报 no-method
误报。~~ TypeValue 求值器路径已实现：`obj.f()` 调用把 receiver 作为 thisVal
注入（含 `f.call(thisArg)`/`f.apply`）；`new C()` 创建 fresh instance 绑定 `this`；
未绑定 this 兜底 T.unknown（this-风格函数降级 warning 而非 error）；
`Object.prototype` 方法表 + 原始值自动装箱。json-ext 试炼 41 error → 0。

CLI 主路径（B-hosted）的可见行为（2026-09 实测）：
- `obj.f()` receiver 注入已生效（`circle.area()` → `25`）
- `f.call(thisArg)` / `f.apply` **不产生 call@ 记录**（仅 entry@ 兜底）
- 原始值自动装箱未建模：`"nudo".constructor` → `unknown`（见 semantics.md）

### 3.1 全局标识符未解析（已解决）

~~JavaScript 内置全局标识符（`Infinity`、`NaN`、`undefined`）和静态属性（`Number.MAX_SAFE_INTEGER`）未解析。~~ 已实现：`BUILTIN_STATIC_METHODS` 预置全部数值常量——顶层 `Infinity`/`NaN`、`Math.PI`/`Math.E` 等 8 个、`Number.MAX_SAFE_INTEGER`/`EPSILON` 等 10 个，均解析为 `number` 且不再触发 `unknown-global`/`builtin-unknown` 诊断；`@nudo:env` 指令存在时 `loadEnvs` 绑定仍优先。测试：`edge-cases.test.ts`、`builtin-functions.test.ts`。

---

### 3.2 `==` 宽松相等未实现（CLI 主路径）

**当前行为（2026-09 实测）：** `nudo infer` / `nudo check` 主路径（B-hosted）下
`==` / `!=` 不折叠——即使两操作数均为字面量（`5 == 5`、`"5" == 5`、`null == undefined`）
也恒为 `unknown`，指令 case 与调用点 case 一致。

TypeValue 求值器路径（`evaluateFunctionFull`，测试 harness / `nudo test` 内部）
已实现字面量折叠（ToNumber 强转、`NaN != NaN`、`"5" == 5 为 true`，非字面量回落
`T.boolean`，测试：`edge-cases.test.ts`）——两路径精度不对称，文档示例与
`packages/website/docs/guides/semantics.md` 的「Not Modeled Yet」表按 CLI 可见行为记录。

---

### 3.3 `typeof` 返回值为字面量

**问题描述：**
`typeof x === "number"` 正确返回 `true`/`false`，但 `typeof x` 本身返回字面量字符串而非类型。

**当前行为：**
```javascript
function check(x) {
  return typeof x;  // 当 x 是 number 时返回 "number"（字面量）
}
```

**分析：**
- 这其实是**正确行为**——Nudo 能精确推断 `typeof` 的结果
- 但可能导致某些比较场景的精度问题

**难度：** 无需修改

---

## 四、控制流推断限制

### 4.1 循环中的条件返回

**问题描述：**
循环中的条件返回精度依赖求值路径：调用点路径逐元素分叉、精确命中；
指令 case 路径（`@nudo:case`）退化为 `unknown`。

**失败示例（指令路径）：**
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
// Case "break-loop": ([1, 2, 3, 4, 5]) => unknown
```

**对照（调用点路径）：**
```javascript
function findFirst(arr) { /* 同上 */ }
findFirst([1, 2, 3, 4, 5]);
// Case "call@L7": ([1, 2, 3, 4, 5]) => 4
```

**分析：**
- 调用点路径已精确（for-of 逐元素 + 条件返回命中 `4`）
- 指令 case 路径的 for-of 条件返回仍 unknown（两路径精度不对称）

**难度：** 低（指令路径接入 for-of 元素分发即可）

---

### 4.2 嵌套 try-catch 路径联合

**问题描述：**
嵌套的 try-catch 返回所有可能路径的联合，而非最可能的路径。

**当前行为：**
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
// 返回: "inner" | "inner-catch" | "outer-catch"
// 期望: "inner"（如果能证明内层不会抛异常）
```

**分析：**
- 静态分析无法证明内层 `try` 不会抛异常
- 返回联合类型是**保守但正确的**行为

**难度：** 高（需要更精确的异常分析）

---

## 五、优先级排序

### P0 - 高影响，可实现

| 限制 | 影响 | 状态 |
|------|------|------|
| 全局标识符未解析 | 常见代码模式 | ✅ 已解决（见 3.1） |
| `this` 绑定语义 | 方法调用 | ✅ 已解决（见 3.0） |
| 数组 `reduce` 累加 | 链式调用 | ✅ 已解决（见 1.1） |

### P1 - 高影响，复杂

| 限制 | 影响 | 方案 |
|------|------|------|
| 高阶函数参数推断 | 大量代码模式 | 调用点推断 / 泛型 |
| Map 字面量 key 追踪 | 查找表模式 | 字面量 key 精确映射（见 1.2） |
| 数组 forEach 副作用 / some / every | 常见代码模式 | 副作用建模 / 元素分发（见 1.1） |

### P2 - 中等影响

| 限制 | 影响 | 方案 |
|------|------|------|
| 闭包变量追踪 | 状态管理模式 | 闭包环境扩展 |
| 嵌套 try-catch 精度 | 错误处理 | 异常分析 |

### P3 - 低影响 / 设计选择

| 限制 | 影响 | 方案 |
|------|------|------|
| Set 去重语义 | 信息丢失 | 可接受 |
| 循环细化类型 | 精度 | 可接受 |
| typeof 返回字面量 | 无 | 正确行为 |

---

## 六、测试覆盖情况

每个限制类别对应的测试文件：

| 限制类别 | 测试文件 | 状态 |
|---------|---------|------|
| 集合类型 | `edge-cases.test.ts` | ✅ 已覆盖（记录当前行为） |
| 高阶函数 | `combination-scenarios.test.ts` | ✅ 已覆盖 |
| 全局标识符 | `edge-cases.test.ts` | ✅ 已覆盖 |
| 宽松相等 | `edge-cases.test.ts` | ✅ 已覆盖 |
| 循环推断 | `syntax-sugar.test.ts` | ✅ 已覆盖 |

---

## 七、改进路线图

### 阶段 1：快速胜利（1-2 周）
- [x] 预置全局环境（`Infinity`、`NaN`、`undefined`）
- [x] 实现 `Number`、`Math`、`JSON` 等内置对象的静态属性
- [x] 简单实现 `==` / `!=` 返回 `T.boolean`

### 阶段 2：精度提升（2-4 周）
- [x] 数组 `reduce` 累加器追踪（字面量逐元素 + 符号不动点，见 1.1）
- [ ] Map 字面量 key 追踪（`m.get("k")` 仍 unknown，见 1.2）
- [ ] 高阶函数调用点推断

### 阶段 3：深度改进（1-2 月）
- [ ] 闭包变量状态追踪
- [ ] 嵌套异常路径分析
- [ ] 泛型函数支持

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

