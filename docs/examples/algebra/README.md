# Algebra — 类型即计算

定义性示例：Abs 上的算术、结构与控制流。  
与 `constraints/` 的精化互补——这里看 **推断本身**，不是门禁。

| 文件 | 考察点 |
|------|--------|
| [`0-add-intensional.js`](./0-add-intensional.js) | 类型即计算：infer 看字面量 `#exact`，check 看内包式签名（term/pred 参与代数，`(x+1)>1`） |
| [`a-spread-optional.js`](./a-spread-optional.js) | 多态 call-site 保留字面量；Combined 是逐调用点结果的字面量并（`--dts` 生成单一签名不产重载：参数形状拓宽、返回保留字面量并 + JSDoc Case 行——矩阵里的 `a-spread-optional.js --dts` 行把生成的 `.d.ts` 钉进 CI） |
| [`b-hof-map.js`](./b-hof-map.js) | HOF：回调经 `.map` 传播，调用点逐位实例化（`[2,4,6]` / `["A","B"]`） |
| [`c-reduce-sum.js`](./c-reduce-sum.js) | reduce 累加器单 pass：字面量逐元素累加 → `15`（`#exact`）；符号路径对 element 一次应用 → `number`（`#widened`） |
| [`d-mixin-meet.js`](./d-mixin-meet.js) | spread 形状 meet：右值覆盖同槽，其余并集，调用点保留字面量 |
| [`e-index-proj.js`](./e-index-proj.js) | 索引投影：字面量 key 精确取槽（`1` / `"x"` / `"/usr/bin"`）；动态 key → 保守并集所有槽（`1 \| "x"`） |
| [`f-async-eff.js`](./f-async-eff.js) | async / Promise eff × `@nudo:mock` 替换内置 fetch（mock 必填：无 mock 时 B 路径泄漏真实 fetch，`ERR_INVALID_URL` 崩溃） |
| [`g-narrow-subtract.js`](./g-narrow-subtract.js) | 守卫窄化：调用点逐位收窄（`3 \| 2 \| -1`） |
| [`h-array-boundary.js`](./h-array-boundary.js) | 数组方法精度边界：`reduce` / `forEach` 副作用 / `some` 均精确（`15` / `15` / `boolean`） |
| [`i-map-set.js`](./i-map-set.js) | Map / Set 字面量条目：`m.set`→`m.get` 精确回查；Set for-of 保元素 |
| [`j-this-binding.js`](./j-this-binding.js) | this 绑定：成员调用把 receiver 注入 thisVal，`compute(5)` → `25 #exact`；顶层裸成员调用不采集为 call@ case |
| [`k-try-catch.js`](./k-try-catch.js) | try/catch：try 体确定性 return 折叠（`"inner" #exact`）；catch 形参绑定 thrown Abs，Error 家族 `err.message` → `"boom" #exact` |
| [`l-primitive-conversion.js`](./l-primitive-conversion.js) | 原始值包装构造与全局数值解析：`String` / `Number` / `Boolean` / `parseInt` / `parseFloat` 在字面量实参上折叠精确（`"5"` / `true` / `42` / `3.14`）；符号实参拓宽目标原语 |
| [`sample.js`](./sample.js) | 最小合集：无调用点 → 全部 `entry@` 回退签名（参数 `unknown`，intension 是 unknown 形参的泛化签名） |

运行命令与期望退出码见 [../README.md](./README.md) 的命令矩阵；`pnpm run verify:examples` 一次验证全部。

无契约时 `+` 跟真实 JS：`number | string`；有 `@nudo:refine` 才走数值路径。
