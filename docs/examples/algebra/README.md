# Algebra — 类型即计算

定义性示例：Abs 上的算术、结构与控制流。  
与 `constraints/` 的精化互补——这里看 **推断本身**，不是门禁。

| 文件 | 考察点 | 命令 |
|------|--------|------|
| [`0-add-intensional.js`](./0-add-intensional.js) | 类型即计算：infer 看字面量 `#exact`，check 看内包式签名（term/pred 参与代数，`(x+1)>1`） | `pnpm run infer docs/examples/algebra/0-add-intensional.js` / `pnpm run check docs/examples/algebra/0-add-intensional.js` |
| [`a-spread-optional.js`](./a-spread-optional.js) | 多态 call-site 保留字面量；Combined 是逐调用点结果的字面量并（`--dts` 投影为单一拓宽签名，不产重载） | `pnpm run infer docs/examples/algebra/a-spread-optional.js` |
| [`b-hof-map.js`](./b-hof-map.js) | HOF：回调经 `.map` 传播，调用点逐位实例化（`[2,4,6]` / `["A","B"]`） | `pnpm run infer docs/examples/algebra/b-hof-map.js` |
| [`c-reduce-sum.js`](./c-reduce-sum.js) | reduce 累加器不动点：字面量逐元素累加 → `15`（`#exact`）；符号路径 `acc ⊔ (acc+A)` 收敛 → `number`（`#widened`） | `pnpm run infer docs/examples/algebra/c-reduce-sum.js` |
| [`d-mixin-meet.js`](./d-mixin-meet.js) | spread 形状 meet：右值覆盖同槽，其余并集，调用点保留字面量 | `pnpm run infer docs/examples/algebra/d-mixin-meet.js` |
| [`e-index-proj.js`](./e-index-proj.js) | 索引投影：字面量 key 精确取槽（`1` / `"x"` / `"/usr/bin"`）；动态 key 吸收为 `unknown` | `pnpm run infer docs/examples/algebra/e-index-proj.js` |
| [`f-async-eff.js`](./f-async-eff.js) | async / Promise eff × `@nudo:mock` 替换内置 fetch（mock 必填：无 mock 时 B 路径泄漏真实 fetch，`ERR_INVALID_URL` 崩溃） | `pnpm run infer docs/examples/algebra/f-async-eff.js` |
| [`g-narrow-subtract.js`](./g-narrow-subtract.js) | 守卫窄化：调用点逐位收窄（`3 \| 2 \| -1`） | `pnpm run infer docs/examples/algebra/g-narrow-subtract.js` |
| [`sample.js`](./sample.js) | 最小合集：无调用点 → 全部 `entry@` 回退签名（参数 `unknown`） | `pnpm run infer docs/examples/algebra/sample.js` |

无契约时 `+` 跟真实 JS：`number | string`；有 `@nudo:refine` 才走数值路径。
