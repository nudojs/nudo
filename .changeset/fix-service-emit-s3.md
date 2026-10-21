---
"@nudojs/service": patch
---

dts 投影面：Abs → TS 类型渲染与导出绑定名清洗的 6 处修正

- **520**：手写契约的返回域保形——`lit(42)` 渲染成 `42`（与 zod / standard /
  `nudo check` 三面同口径）；旧口径把契约返回 widen 成 `number`（字面量住在
  Abs 的 **pred** 里、不在 term 里，widen 路径看不到它）。
- **521**：内建**泛型** brand 补类型实参——`Map<unknown, unknown>` /
  `Set<unknown>` / `WeakMap<object, unknown>` / `WeakSet<object>`；旧口径直出
  裸名 ⇒ 产出的 `.d.ts` 吃 **TS2314**、编译不过。
- **544**：Abs 的 `any`（未受约束）与 `unknown`（推断失败）**分面**——前者渲染
  成 TS `any`、后者才是 `unknown`（`abs.md:100` 明文规则）；旧口径两者合并成
  `unknown` ⇒ 消费方吃 **TS2571** 假红，而 zod / standard / guard 三面都宽松。
- **552**：导出绑定名过保留字清洗（core 的 `toJsBindingIdent` 口径，`default` /
  `class` 等加 `_` 前缀）；旧口径直出 ⇒ 整份 `.d.ts` 吃 **TS1359 + TS1005**。
- **554**：生成器 / 迭代器形态识别——带 `next` 槽的对象渲染成 `Generator<T>` /
  `AsyncGenerator<T>` / `IterableIterator<T>`（元素类型取数字下标元素槽），
  内部槽不进结构字段；旧口径把内部协议槽当普通字段直出 ⇒ 返回类型里没有
  `[Symbol.iterator]()` ⇒ 消费方 `for…of` 吃 **TS2488**。
- **565**：零成员对象渲染成 `Record<string, never>`（不是 TS 的 `{}`＝任意非
  nullish 值）——属性读不再吃 **TS2339** 假红，且在联合类型里不再吸收
  `{ a: number }`（契约义务不再被静默作废）。
