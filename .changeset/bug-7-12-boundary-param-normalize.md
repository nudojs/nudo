---
"nudojs": patch
---

fix(core): 函数边界缺参归一——省略尾实参不再以宿主 undefined 流入（Bug 7 / Bug 12）

- **Bug 7（部分传参，假阳性）**：`two(s)` 对 `two(a, b)` 把宿主 `undefined` 送进 `$add` 等算子（读 `.shape` 崩溃被收成假 may-throw），或经 return 通道泄漏裸值。修复：宿主绑定元数内省略槽位按「显式传 undefined」归一为 `lit(undefined)`——函数声明/类方法在转译 prologue 收形（`p = $absVal(p)`），函数表达式/对象方法在 `$fnVal` apply 钩子按 `impl.length` 补齐（读宿主 `arguments` 的 function 包装走 `padArgs: false` + 体内归一，`arguments.length` 不膨胀）。
- **Bug 12（零参调用，假阴性）**：`f(a){return a.b}` 零参原折 `unknown` 无 throws（确定抛被折成保证不抛）。归一后 `$get`/解构守卫走 nullish 硬抛——`throws TypeError` 与原生一致；wave-1 的 unknown 接收者政策不变。
- `+` 代数不设 `lit(undefined) ⊗ any` 专用零抛臂：`undefined + any` 落既有 anyLike 臂（值域 `number | string`，any 侧可为 Symbol → 原生 may TypeError，与 `any + 1` / `any ⊕ any` 同口径记 may-throw——省略归一只消除宿主裸值崩溃/泄漏，不放宽 any 的投射面）；`s + 1` 的 policy 不变。
- 红线保持：默认参照常取默认、rest 收 `[]` 不补、`typeof` 折 `"undefined"`、显式 `undefined` 实参语义不变、数组解构零参迭代守卫硬抛、checkSource 入口 any 路径不变。
