---
"@nudojs/service": patch
---

**Bug 修复（非 breaking）**：导出的运行时校验器没有执行 `.d.ts` 已经声明的生成器类型。`zod` / `standard` / `guard` 三个面此前只判「是个对象」，于是把 `{}`、`{ next(){} }` 当成合法的 `Generator<T>` 返回值放行。现在按 `Abs.facets.brand` 投影身份，三面同时收紧：真同步 / 异步生成器放行，普通对象拒绝。声明面、公共 API 形状、`SchemaNode` 既有成员都没变（只新增一个联合成员），变的是校验器有没有真正执行既有契约 ⇒ 按 soundness patch 发布，**不写 BREAKING / Migration 标注**（与全批口径一致）。该 changeset 自身不抬级；与同批 minor changeset 合并发布时，包版本取最高的 minor。

- 判据单一真源 `service/src/emit/generator-identity.ts`：只认随值携带的 `Generator` / `AsyncGenerator` 两个 brand；无 brand 的旧 Abs / 手工构造 / 嵌套槽值逐字不变 ⇒ 既有产物不需要迁移。
- zod 面内联 `z.custom((v) => Object.prototype.toString.call(v) === "[object Generator]")`；standard 面库版 `checkNode` 与产物内联 `__nudoCheck` 两份实现同口径；guard 面在 `denoteGuard` 结构句子前前置身份子句。core 展示面 / 守卫面**未改**（避免 A11 曾致 4 条回归的展示面路径）。
- 已知边界：`Symbol.toStringTag` 可伪造（换取跨 realm 可判，与 `z.instanceof(Date)` 可改原型伪造同类）；身份投影只在导出校验器的**顶层值**生效，嵌套字段仍走结构面且三面一致；`z.instanceof` 路线仍不可行（无全局 `GeneratorFunction`）。
- 回归：`emit-generator-identity-poc.test.ts` 由决策 PoC 升级为 12 例生产接线回归（四面逐值同裁决、真跑、`tsc --noEmit --strict`、伪造边界、嵌套负控制）；emit 族 502 例全绿。

依据：`docs/versioning.md` 的「判例（2026-11-05）」与 `docs/design/architecture-debt.md` 的「schema / guard / standard 生成器身份投影 · 实施记录」。
