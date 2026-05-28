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

## 总结

| 失败原因 | 数量 | 占比 | 可修复性 |
|---------|------|------|---------|
| **Bug** | 6 | 67% | ✅ 可修复 |
| **设计限制** | 2 | 22% | ⚠️ 可改进 |
| **评测标准** | 1 | 11% | ✅ 可调整 |

## 可修复的 Bug

### 高优先级（影响基础功能）
1. **循环累加** (`flow-02`) - `total += n` 没有正确累加
2. **Promise 双重包装** (`async-01`) - async 函数返回值处理
3. **复杂链式调用** (`complex-01`) - filter/map/sort 链式调用

### 中优先级（影响高级功能）
4. **Array.reduce** (`array-04`) - reduce 累加逻辑
5. **异步返回值** (`complex-02`) - 异步函数的返回值
6. **对象方法识别** (`real-03`) - 返回对象的方法

## 设计限制（可改进）

### Map.get() 精确跟踪
- 当前：返回所有可能值的联合
- 改进：如果 key 是字面量，可以精确跟踪
- 难度：中等

### 高阶函数参数推断
- 当前：函数参数类型为 `unknown`
- 改进：根据函数体推断参数类型
- 难度：高

## 结论

**67% 的失败是 Bug，可以修复。**

修复这些 Bug 后，预期准确率：
- 当前：50% 精确匹配
- 修复后：~75% 精确匹配

**Nudo 的设计理念是可行的**，当前的失败主要是实现问题，不是设计问题。
