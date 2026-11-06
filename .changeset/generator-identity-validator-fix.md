---
"@nudojs/service": patch
---

**Bug 修复（非 breaking）**：导出的运行时校验器没有执行 `.d.ts` 已经声明的生成器类型。`zod` / `standard` / `guard` 三个面此前只判「是个对象」，于是把 `{}`、`{ next(){} }` 当成合法的 `Generator<T>` 返回值放行。现在按 `Abs.facets.brand` 投影身份，三面同时收紧：真同步 / 异步生成器放行，普通对象拒绝。声明面、公共 API 形状、`SchemaNode` 既有成员都没变（只新增一个联合成员），变的是校验器有没有真正执行既有契约 ⇒ 按 soundness patch 发布，**不写 BREAKING / Migration 标注**（与全批口径一致）。该 changeset 自身不抬级；与同批 minor changeset 合并发布时，包版本取最高的 minor。

- 判据单一真源 `service/src/emit/generator-identity.ts`：只认随值携带的 `Generator` / `AsyncGenerator` 两个 brand；无 brand 的旧 Abs / 手工构造逐字不变 ⇒ 既有产物不需要迁移。**2026-11-06 补齐递归**：生成器作为对象字段 / 数组元素 / union 臂时同样收紧，由 core `denoteGuardB` 的递归身份子句与 `schema-generator.ts::syncGeneratorTags`（约束投影通道丢 facets 后按原始 Abs 树同步）共同保证，四面不再相反裁决。
- zod 面内联 `z.custom((v) => Object.prototype.toString.call(v) === "[object Generator]")`；standard 面库版 `checkNode` 与产物内联 `__nudoCheck` 两份实现同口径；guard 面的身份子句由 core `denoteGuardB` 递归入口生成（2026-11-06 从顶层前置改为递归，service 不再重复注入）。**core 展示面 `format.ts` 始终未改**（避免 A11 曾致 4 条回归的展示面路径）；`Shape` 判别联合、`projection.ts` 约束面也未动。
- 已知边界：`Symbol.toStringTag` 可伪造（换取跨 realm 可判，与 `z.instanceof(Date)` 可改原型伪造同类）。2026-11-06 用 `node:vm` 实测对比原型链判据：后者不可伪造，但会误拒跨 realm 的真生成器 ⇒ **结论保留 toStringTag 口径**。`z.instanceof` 路线仍不可行（无全局 `GeneratorFunction`）。
- 回归：`emit-generator-identity-poc.test.ts` 由决策 PoC 升级为 16 例生产接线回归（四面逐值同裁决、真跑、`tsc --noEmit --strict`、伪造边界、嵌套递归、跨 realm 判据实测）；emit 族 502 例全绿，全仓 0 新增失败。

依据：`docs/versioning.md` 的「判例（2026-11-05）」与 `docs/design/architecture-debt.md` 的「schema / guard / standard 生成器身份投影 · 实施记录」。
