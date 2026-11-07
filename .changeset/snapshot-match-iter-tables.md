---
"@nudojs/core": patch
---

**Bug 修复（非 breaking）**：`snapshotAbs` 重建 Abs 时只搬了 fn impl 侧表，漏掉
`exec/match-iter.ts` 的身份侧表 ⇒ 生成器 / 模板标签 / matchAll 迭代器 / 用户
迭代器 / Proxy 的**迭代元素、drain 视图、延迟异常**在快照副本上整体丢失：
副本消费点查不到条目，元素面折空、definite 体异常被静默丢弃（L2 假阴）。
`$copy`（fork / switch 臂重绑）早有 `copyMatchIterTables`，本次把同一迁移补到
`snapshotAbs`（A7「重建不得静默抹掉侧表面」纪律的同口径延伸）。

- `algebra/hof.ts` 末尾调 `copyMatchIterTables(a, out)`；`match-iter.ts` 只依赖
  algebra 顶层叶子（abs / objects / may-throw）、不依赖 `hof.ts` ⇒ 无环。
- 与 `$copy` 同口径**共享视图引用**，不是深拷贝 ⇒ 副本消费会推进原对象状态
  （生成器是「一次消费」的有状态值，副本代表同一次创建事件；负控钉已固定该行为）。
- 公共 API 形状不变、不新增导出；无 BREAKING / Migration 标注。

回归：`snapshot-match-iter-tables.test.ts`（6 例：元素面 / drain / 延迟异常 /
手工登记 / 共享视图负控 / 非生成器零开销）；全仓 `1656 入口`，`20 失败 =
基线 20`，**0 新增 / 0 消失**。

> 备注：本次修的是 **WeakMap 侧表迁移**，不等于 A1 步骤 3 的「首消费点补写
> `shape.slots` 对快照副本失效」——`snapshotAbs` 对 obj 槽仍是深拷贝，后者
> 仍是架构债（见 `docs/design/generator-laziness.md` 的 2026-11-06 前置复核）。
