# Nudo 设计限制与待解决问题

> 本文档列出 Nudo 当前的设计限制，是下一步改进的路线图。

---

## 一、集合类型推断限制

### 1.1 数组无法迭代元素

**问题描述：**
Nudo 将数组视为抽象的整体，无法逐个访问元素。当数组参与 `reduce`、`forEach` 等需要逐元素操作的方法时，返回值无法精确推断。

**失败示例：**
```javascript
// @nudo:case "reduce" ([1, 2, 3, 4, 5])
function sum(arr) {
  return arr.reduce((a, b) => a + b, 0);
}
// 期望: 15
// 实际: unknown
```

**根本原因：**
- 抽象解释中数组是 `T.array(elementType)`，不存储具体元素
- `reduce` 的累加逻辑依赖遍历每个元素，但抽象解释无法展开循环
- `filter` + `map` + `reduce` 链式调用时，每一步都丢失信息

**影响范围：**
- `Array.reduce()` / `Array.reduceRight()`
- `Array.forEach()` 的副作用推断
- `Array.some()` / `Array.every()` 的返回值
- 任何依赖数组元素遍历的链式调用

**可能的解决方案：**
1. **有限展开**：对小数组（元素数 ≤ N）展开为元组处理
2. **累加器追踪**：在 `reduce` 中维护累加器的类型状态
3. **符号执行**：用符号值代表数组元素，跟踪符号变换

**难度：** 高

---

### 1.2 Map 不跟踪 key-value 映射关系

**问题描述：**
`Map.get(key)` 返回所有可能 value 类型的联合，而非特定 key 对应的 value。

**失败示例：**
```javascript
// @nudo:case "map-get" ()
function test() {
  const map = new Map();
  map.set("a", { id: "a", name: "Alice" });
  map.set("b", { id: "b", name: "Bob" });
  return map.get("a");
}
// 期望: { id: "a", name: "Alice" }
// 实际: { id: "a", name: "Alice" } | { id: "b", name: "Bob" } | undefined
```

**根本原因：**
- Map 的 `_typeArgs` 只记录 `K` 和 `V` 的整体类型
- 不维护 `key → value` 的具体映射关系
- `get()` 返回 `V | undefined`，即所有 value 类型的联合

**影响范围：**
- `Map.get()` 返回值精度
- `Map.has()` 的类型收窄
- 基于 Map 的查找表模式

**可能的解决方案：**
1. **字面量 key 追踪**：当 key 是字符串/数字字面量时，维护精确映射
2. **Record 类型**：对字面量 key 的 Map 降级为对象类型处理

**难度：** 中

---

### 1.3 Set 操作返回值精度

**问题描述：**
`Array.from(Set)` 返回元素类型的联合数组，无法去重具体值。

**当前行为：**
```javascript
// @nudo:case "set-dedup" ([1, 2, 2, 3, 3, 3])
function unique(arr) {
  return Array.from(new Set(arr));
}
// 期望: [1, 2, 3]
// 实际: (1 | 2 | 3)[]
```

**分析：**
- 这其实是**正确行为**——Set 不保证顺序，返回数组而非元组是合理的
- 但丢失了"去重"的语义信息

**难度：** 低（当前行为可接受）

---

## 二、高阶函数推断限制

### 2.1 函数参数类型无法推断

**问题描述：**
当函数作为参数传递时，Nudo 无法推断回调函数的参数类型。

**失败示例：**
```javascript
// @nudo:case "higher-order" ([1, 2, 3])
function processItems(items, transform, filter) {
  return items.filter(filter).map(transform);
}
// transform 和 filter 的参数类型为 unknown
```

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
// @nudo:case "closure" ()
function createCounter() {
  let count = 0;
  return {
    increment() { return ++count; },
    getCount() { return count; }
  };
}
// 返回对象的方法类型正确，但闭包变量 count 的追踪有限
```

**分析：**
- 对象方法的返回值可以正确推断
- 但闭包变量的多次修改后的状态追踪不完整

**难度：** 中

---

## 三、类型系统限制

### 3.0 构造函数 `this` 语义（已解决）

~~类/构造函数体内的 `this` 求值为 undefined，`this.push(...)` 报 no-method
误报。~~ 已实现：`obj.f()` 调用把 receiver 作为 thisVal 注入（含
`f.call(thisArg)`/`f.apply`）；`new C()` 创建 fresh instance 绑定 `this`；
未绑定 this 兜底 T.unknown（this-风格函数降级 warning 而非 error）；
`Object.prototype` 方法表 + 原始值自动装箱（`'x'.constructor`）。
json-ext 试炼 41 error → 0。

### 3.1 全局标识符未解析

**问题描述：**
JavaScript 内置全局标识符（`Infinity`、`NaN`、`undefined`）和静态属性（`Number.MAX_SAFE_INTEGER`）未解析。

**失败示例：**
```javascript
function getInf() { return Infinity; }      // 返回 undefined
function getNaN() { return NaN; }           // 返回 undefined
function getMax() { return Number.MAX_SAFE_INTEGER; } // 返回 undefined
```

**根本原因：**
- Nudo 只追踪局部变量绑定
- 全局标识符不在 Environment 中
- `Number.MAX_SAFE_INTEGER` 是 MemberExpression，需要特殊处理

**影响范围：**
- 所有使用全局常量的代码
- `Math.PI`、`Number.MAX_VALUE` 等静态属性

**可能的解决方案：**
1. **预置全局环境**：在 Environment 初始化时绑定全局常量
2. **内置对象支持**：为 `Number`、`Math`、`JSON` 等内置对象添加特殊处理

**难度：** 低

---

### 3.2 `==` 宽松相等未实现

**问题描述：**
`==` 运算符返回 `unknown`，只有 `===` 和 `!==` 正确实现。

**失败示例：**
```javascript
function compare(a, b) {
  return a == b;  // 返回 unknown
}
```

**根本原因：**
- `dispatchBinaryOp` 中 `==` 和 `!=` 未实现
- 宽松相等涉及类型强制转换，规则复杂

**影响范围：**
- 使用 `==` 的代码
- 与 `null` 的比较（`val == null` 常见模式）

**可能的解决方案：**
1. **简单实现**：`==` 返回 `T.boolean`（不精确但安全）
2. **完整实现**：实现 ECMAScript 的 Abstract Equality Comparison 算法

**难度：** 低-中

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

### 4.1 循环后的类型收窄

**问题描述：**
循环中的条件返回后，循环外的变量类型无法精确收窄。

**失败示例：**
```javascript
// @nudo:case "break-loop" ([1, 2, 3, 4, 5])
function findFirst(arr) {
  for (const item of arr) {
    if (item > 3) return item;
  }
  return undefined;
}
// 返回: number (>= 4) | undefined
// 期望: 4 | undefined（如果能精确推断）
```

**分析：**
- 返回 `number (>= 4)` 是**正确的细化类型**
- 无法精确到 `4` 是因为抽象解释不跟踪具体值
- 这是设计选择，不是 bug

**难度：** 设计层面

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

| 限制 | 影响 | 方案 |
|------|------|------|
| 全局标识符未解析 | 常见代码模式 | 预置全局环境 |
| `==` 宽松相等 | 常见语法 | 简单实现返回 boolean |
| Map 字面量 key 追踪 | 精度提升 | 字面量 key 特殊处理 |

### P1 - 高影响，复杂

| 限制 | 影响 | 方案 |
|------|------|------|
| 高阶函数参数推断 | 大量代码模式 | 调用点推断 / 泛型 |
| 数组 reduce 累加 | 链式调用 | 累加器追踪 |

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
- [ ] 预置全局环境（`Infinity`、`NaN`、`undefined`）
- [ ] 实现 `Number`、`Math`、`JSON` 等内置对象的静态属性
- [ ] 简单实现 `==` / `!=` 返回 `T.boolean`

### 阶段 2：精度提升（2-4 周）
- [ ] Map 字面量 key 追踪
- [ ] 高阶函数调用点推断
- [ ] 数组 `reduce` 累加器追踪

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

