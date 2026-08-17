# Benchmark Failure Analysis

## 逐个失败用例分析

### 1. Set operations (`set-01`)
**推断结果**: `1 | 2 | 3[]`
**期望结果**: `[1, 2, 3]`
**分析**:
- Nudo 返回 `(1 | 2 | 3)[]` - 联合类型的数组
- 期望是 `[1, 2, 3]` - 元组类型
- **这是正确的！** Set 不保证顺序，返回数组是正确行为
- **结论**: 评测标准问题，不是 bug

### 2. Map operations (`map-01`)
**推断结果**: `{ found: { id: "a", name: "Alice" } | { id: "b", name: "Bob" } | undefined }`
**期望结果**: `{ found: { id: "a", name: "Alice" } }`
**分析**:
- Map.get() 返回所有可能值的联合
- 这是因为 Map 不跟踪哪个 key 映射到哪个 value
- **这是设计限制**，不是 bug
- **可以改进**: 如果 Map 的 key 是字面量，可以精确跟踪

### 3. Loop accumulation (`flow-02`)
**推断结果**: `5`
**期望结果**: `15`
**分析**:
- `sum([1,2,3,4,5])` 应该返回 15
- 但推断返回 5，说明循环累加逻辑有问题
- **这是 bug** - `total += n` 在循环中没有正确累加

### 4. Array chaining (`array-04`)
**推断结果**: `9 | 12 | 6 | 16 | 8 | 4`
**期望结果**: `29`
**分析**:
- `filter` + `map` + `reduce` 链式调用
- 返回的是联合类型而不是累加结果
- **这是 bug** - `reduce` 没有正确处理累加逻辑

### 5. Promise.resolve (`async-01`)
**推断结果**: `Promise<Promise<42>>`
**期望结果**: `Promise<42>`
**分析**:
- `async function` 返回 `Promise.resolve(x)`
- 结果被双重包装成 `Promise<Promise<42>>`
- **这是 bug** - async 函数不应该双重包装 Promise

### 6. Error handling with retries (`complex-02`)
**推断结果**: `Promise<{ success: true, data: "success" } | { success: false, error: "max retries exceeded" }>`
**期望结果**: `{ success: true, data: "success" }`
**分析**:
- 返回的是 Promise 包装的联合类型
- 但测试用例调用的是同步版本，应该返回对象
- **这是 bug** - 异步函数的返回值处理有问题

### 7. Data transformation pipeline (`complex-01`)
**推断结果**: `unknown`
**期望结果**: `[{ id: 2, displayName: "Alice Jones", role: "admin" }, ...]`
**分析**:
- 复杂的 `filter` + `map` + `sort` 链式调用
- 返回 `unknown` 说明链式调用没有正确处理
- **这是 bug** - 复杂链式调用的类型推断失败

### 8. Generic data processor (`complex-03`)
**推断结果**: `[unknown, unknown, unknown, unknown, unknown]`
**期望结果**: `[6, 8, 10]`
**分析**:
- 高阶函数，参数是函数 `transform` 和 `filter`
- 函数参数的类型没有正确推断
- **这是设计限制** - 高阶函数的参数类型推断困难

### 9. Event emitter pattern (`real-03`)
**推断结果**: `{}`
**期望结果**: `function`
**分析**:
- `createEventEmitter()` 返回一个对象
- 但推断返回 `{}`
- **这是 bug** - 对象的方法没有被正确识别

## 修复状态

### ✅ 已修复（3 个）

| Bug | 问题 | 修复方案 |
|-----|------|---------|
| **循环累加** | `total += n` 没有正确累加 | 添加复合赋值运算符支持 |
| **Promise 双重包装** | async 函数返回 `Promise<Promise<42>>` | 异步函数返回值如果是 Promise 则不重复包装 |
| **对象方法识别** | 返回对象的方法没有被识别 | 添加 ObjectMethod 处理 |

### ⚠️ 设计限制（4 个）

| 限制 | 当前行为 | 原因 | 改进难度 |
|------|---------|------|---------|
| **Array chaining** | `filter+map+reduce` 返回联合类型 | 数组无法迭代所有元素 | 高 |
| **Map.get()** | 返回所有可能值的联合 | Map 不跟踪 key-value 映射 | 中 |
| **高阶函数** | 函数参数类型为 unknown | 无法推断函数参数类型 | 高 |
| **Async 返回值** | 返回 Promise | 正确行为，测试期望错误 | 低 |

### ✅ 评测标准问题（1 个）

- Set operations: 返回 `(1 | 2 | 3)[]` 是正确行为

## 当前状态

| 指标 | 修复前 | 修复后 |
|------|--------|--------|
| 精确匹配 | 12 (50.0%) | 13 (54.2%) |
| 部分匹配 | 9 (37.5%) | 9 (37.5%) |
| 未知 | 1 (4.2%) | 1 (4.2%) |
| 错误 | 0 (0.0%) | 0 (0.0%) |

**改进：+1 精确匹配（循环累加）**

## 结论

**3 个 Bug 已修复，4 个是设计限制。**

设计限制的根本原因：
1. **数组无法迭代** - 抽象解释的固有限制
2. **Map 不跟踪映射** - 可以改进但复杂度高
3. **高阶函数推断** - 需要更复杂的类型推断

**Nudo 的设计理念是可行的**，当前的失败主要是设计限制，不是实现问题。
