---
"@nudojs/core": patch
"@nudojs/service": patch
---

Fix bug-report category 04 (core builtins / collections) — 17 of 26 defects.

- BUG-007: a primitive's prototype method dispatches correctly instead of being
  reported as absent.
- BUG-008: `Object.getOwnPropertyDescriptor(fn, ...)` models a function's own
  `name` / `length` / `prototype` slots.
- BUG-009: a regexp literal's flags are canonicalised, so `/a/gi` and `/a/ig` agree.
- BUG-132: a boxed primitive's internal slot is modelled.
- BUG-157: `URLSearchParams` `entries()`/`keys()`/`values()` are no longer reported as
  carrying an internal slot.
- BUG-164: the `Object.prototype` legacy accessor allowlist and the descriptor table are
  now the same source of truth.
- BUG-176: `Reflect.construct` on a user class is no longer reported as may-throw.
- BUG-181: `Reflect.set` with a primitive receiver is a definite `TypeError`, not a false
  red.
- BUG-182: a host function's constructibility facet is decided by IsConstructor, not by
  the presence of a `prototype` property.
- BUG-230 / BUG-260: `Set` / `Map` cardinality from an abstract iterable is no longer a
  definite value, and `MapTable` carries insertion order so key iteration matches the
  host and `new Set(xs).size` agrees with `Array.from(new Set(xs)).length`.
- BUG-276: class-instance enumerable flags are correct, so `getOwnPropertyDescriptor` /
  `Object.keys` agree with the host.
- BUG-277: a builtin brand's user-defined keys are enumerated (`entries` /
  `getOwnPropertyNames` / `getOwnPropertyDescriptors` / `JSON.stringify`).
- BUG-278: an `Error` subclass's inherited `name` ordering matches the host.
- BUG-281: `getOwnPropertyDescriptors` on a brand instance matches `keys`/`values`.
- BUG-282: a nested same-name `@nudo:case` scope resolves to the nearest binding, and
  shape contracts fall back to a prototype-chain `HasProperty` check.

Regression tests: `core-bug-{007,008,009,132,157,164,176,181,182,230,260,276,277,278,281,
282}-*` (16 files / 106 tests).

Known follow-ups NOT covered here (root cause outside this category's file set):
BUG-058, BUG-130, BUG-131, BUG-160, BUG-165, BUG-167, BUG-174, BUG-258, BUG-275; and
BUG-163's `toJSON` half (needs `exec/runtime/members.ts` `BUILTIN_BRAND_METHODS.URL` —
its `host` half is fixed and tested).

### 追加：本轮内建面修复

已修复（带新回归测试）：

- **BUG-163（`toJSON` 半边，至此完整）**：`BUILTIN_BRAND_METHODS.URL` 增加
  `toString` / `toJSON`，`BUILTIN_BRAND_ACCESSORS.URL` 补组件访问器 ⇒
  `urlToJsonIsUndef() => false`、`urlToJsonIn() => true`（修复前 `true` / `false`）。
  测试：`core-bug-163-url-tojson-brand-face.test.ts`。
- **BUG-174**：`TextDecoder` 构造参数按宿主顺序校验（label 的 ToString → options 字典
  → label 查找），抽象 prim / 全 prim 联合的 options 确定抛 `TypeError`，`any` 只记
  may-throw。测试：`core-bug-174-textdecoder-options.test.ts`。
- **BUG-183**：`btoa` / `atob` 缺参确定抛 `TypeError`（其余 6 个全局函数保持把缺参当
  `undefined`）。测试：`core-bug-183-btoa-atob-missing-arg.test.ts`；
  `tmp/verify-bug.sh BUG-183` → exit 1。
- **BUG-275**：`Object.create(proto)` 的基对象镜像 proto 自有槽为 `Slot.inherited`
  （只表示存在性，值为 `unknown`），自有键视图（`Object.keys/values/entries`、for-in、
  spread、JSON）排除 `inherited` ⇒ 与原生一致。测试：
  `core-bug-275-object-create-inherited-slot.test.ts`；`verify-bug.sh BUG-275` → exit 1。

### 追加：BUG-167 已修（构造点对齐 facet + 投影面读域判定）

- **BUG-167**：两个 `$fnVal` 构造点（`ObjectMethod` 简写与方法型 `FunctionExpression`）改为发
  `effectFree` / `closed` facet（`getFnFacets` 静态保守判定，与 `expr/function.ts:366-373` 同口径）
  ⇒ 同一函数体写成方法 vs 写成函数字面量，在 sort 比较器闸门、promise 回调、访问器纯度判定上
  不再得出相反结论。叠加的第二处根因：`Object.defineProperty(o,k,{get})` 装的访问器占位槽是
  `unknown`，而三个投影面（`format.ts`、`denote.ts`、`service/emit/dts-generator.ts#slotAbsOf`）
  会**无条件执行用户 getter**，把分析期末次读值冻结进签名与 guard ⇒ 签名自信错值、
  `data.b === <literal>` 恒假。修法：投影面加**读域不可判**判定（占位槽**无 term** ⇒ 不执行
  getter，presence-only）。判据必须用 `term === undefined` 而**不是** `shape.k === "unknown"`
  —— `$lit(void 0)` 的 `shape.k` 也是 `"unknown"`，按 shape 判会把所有访问器判死（首版即此错）。
  回归 `core-bug-167-side-effect-getter-not-frozen.test.ts`（10 例，含 Bug 191 / 152 的负控制）；
  验收组 11 文件 / 148 例全绿（含 `eval-call-position`、`eval-match-json-view`、
  `exec-join-accessors`、`exec-define-property-accessor`）。
  残留（如实记录）：**对象字面量** `get` 访问器的占位槽必须是 `$lit(void 0)`（Bug 191 的读域投影
  与 Bug 152 的调用点求值序钉住它，换 `$unknown()` 会同时打红两处），彻底修法需在 slot 上引入
  显式「读域不可判」标记（`abs.ts` slot 类型 + `exec/runtime/state.ts` 的 `$set` 选项 +
  `descriptor.ts` 写入）；`projection.ts`（zod / standard-schema 经 `absToConstraint` 取读域）
  同样仍是执行 getter 的老路。BUG-167 section 的验收 repro 是 `Object.defineProperty` 形态，
  本修复已覆盖。
- **BUG-258（facet 已落地，投影面见 cat-05）**：数组视图信息原先由 `builtins/regexp.ts` 的
  `WeakSet` 侧表（按 Abs 身份）承载，只有 `Array.isArray` / JSON 序列化 / 数组方法派发消费，类型面
  看不见。修：`abs.ts` 的 `{k:"obj"}` 形状增加 `view?: "array"` facet +
  `markArrayView` / `isArrayView`（不导出到公开面 ⇒ 快照零变化；`markArrayView` 是**替换** shape 而
  非就地改共享 shape），`regexp.ts` 删除侧表、`markMatchArrayView` / `isMatchArrayView` 降为薄包装，
  消费面（`array.ts` / `json.ts` / `member.ts` 派发）只读 facet；运行形状仍是 `k:"obj"`（未改 tuple）
  ⇒ `eval-call-position.test.ts:344-350` 的渲染钉不变。回归
  `core-bug-258-array-view-facet.test.ts`。未完成：dts / zod / standard / guard 四个**产物面**尚未按
  `shape.view === "array"` 分支；多 case join 时 `joinObjects` 重建 shape 不带 `view`（需一侧传递）。
