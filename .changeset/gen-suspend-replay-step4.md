---
"@nudojs/core": minor
---

**A1 步骤 4 落地：生成器挂起点绑定回放（Bug 212 c3/c4 逐点精确）**（`docs/design/generator-laziness.md` 文末「步骤 4 实施记录」）。步骤 3 把体延到首个消费点后，体仍一次跑到底 ⇒ 首个 `yield` 之后的写会在首次 `next()` 时提前落地（native `1` / `"a"`，引擎 `0 | 5` / `"" | "ab"`）。本步把 native 的挂起点语义在**外层自由写绑定的值面**精确复现。

- **机制**：四个 `$gen` 发射点在自由写名集非空时追加**可选第三实参** `{ capture, restore }`；`capture` 用 `$copy` + 共享 memo 读快照（容器深拷贝、const 别名组身份不分裂），`restore` 用 `$rebindable` 守卫写回。`$yield` / `$yieldStar` 在每个挂起点把快照推进帧的 `timeline`；`next()` 交付第 k 个 yield 后回放到 `timeline[k-1]`；`next()` 耗尽与迭代 drain 推进到**终态格**（体跑完、步骤 1 的 join 已折回）⇒ 最后一个 yield 之后的写不被抹成 wrong-exact。回放**单调**（`lastApplied`）⇒ 耗尽后的 `next()` 不回卷。`collectGenBody` 每次调用都压帧（无钩子时压 `undefined` 哨兵）⇒ 嵌在外层体里的内层生成器不会污染外层时间轴。名集为空时零发射 ⇒ 绝大多数生成器的转译产物逐字不变。
- **值面收益**：c3 `1  #exact`、c4 `"a"  #exact`；连续两次 `next()` 得 `5` / `"ab"`；分段读取 `"1:1:2:5"`；与步骤 3 的消费期活绑定叠加得 `"9:9:5"`；迭代整体 drain 得 `"5:2"`。§1.6 四行 native 值全部精确。
- **sound 守卫**：路径敏感（fork 臂序列是 join 而非线性时间轴）、体内延迟异常、`yield*` 委托三类形态整帧禁用回退，严格保留步骤 1 的 `join(事前, 事后)` 过近似；未启动生成器上的 `.return()` / `.throw()` **不推进**时间轴（原生体根本不跑，推进会产 wrong-exact）。三类实测均 `0 | 5  #exact`，无「自信的错值」。
- **不变量**：体仍只跑一次、只捕获一次序列（步骤 3 的幂等 + 缓存不动）；元素面 / `genElements` / `.d.ts` 投影与改前一致；`$gen` 只新增可选形参，公共导出形状未变，无新增导出符号。

**已知边界（诚实台账）**：这是**绑定值面**的挂起点精确化，不是把体降成真 JS generator。转译产物的分支/循环臂是宿主箭头（真 `yield` 进去即 SyntaxError），抽象 fork 一次跑完双臂又无法只挂一臂 ⇒ 字面方案要求 `$fork` / `$whileSeq` / `$for` / `$switch` / `$try*` 全改 generator 变体并跨 `next()` 续接 ALS 帧，属求值模型 CPS 级改造。故宿主调用、may-throw 收集、容器外部引用等**非自由写绑定类副作用**的时序仍整体落在首次消费点。求值隔离按约定搁置。

回归：新增 `exec/__tests__/gen-suspend-replay.test.ts`（8 例机制钉，含嵌套帧隔离与终态格）；`eval-bug-212-generator-body-eager.test.ts` c3/c4 断言重订 + 2 例推进用例（14 例全绿）；`eval-generator-cross-function-consume.test.ts` 的步骤 4 `it.todo` 升级为 5 例验收（9 例全绿）。按整批裁决发 **minor**，不写 BREAKING / Migration 标注。
