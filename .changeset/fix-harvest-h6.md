---
"@nudojs/harvester": patch
---

族 27 修复 H6：Bug 795 · Bug 828 · Bug 836 —— 落盘面保留 `bigint` / `symbol`
原语（不再降级 `unknown`）+ 导出表 / 模块记录表改用**无原型字典**（撞
`Object.prototype` 成员的导出不再整条丢失、`declare module "__proto__"` 不再
污染 `Object.prototype`）。

**Bug 795** — `emitEnvModule` 只认 `number` / `string` / `boolean` 三个原语，
`bigint` / `symbol` **一律降级成 `unknown`** ⇒ **同一份 `.d.ts`，内存收割与
落盘产物给出不同答案**（内存面是 `(bigint) => bigint`，落盘面是
`(unknown) => unknown`）。

- `harvest-dts.ts` 的 `emitAbs`（落盘渲染）补 `bigint` / `symbol` 分支 ⇒ 与
  内存面（`mapType` → `absPrim`）同口径；磁盘投影（`harvest-json.ts`）本来就
  带这两个原语 ⇒ 这次补的是**发射器**与**磁盘格式**之间的能力缺口。
- `harvest-json.ts` 的 `harvestSigToAbs` 去掉骗人的
  `sig.type as "number" | "string" | "boolean" | "bigint"` 硬转：改成白名单
  校验（`bigint` / `symbol` 都保留，未知原语标签诚实降级成 `unknown`）。

**Bug 828** — 导出表 / 成员表用**普通对象 + 原型链裸读裸写** ⇒ 名字撞
`Object.prototype` 成员的导出（`toString` / `valueOf` / `hasOwnProperty` /
`constructor` / `__proto__`）**整条静默丢失**，而 `stats.skipped` 仍是 0 ⇒
端到端 L2 假红（`tsc --strict` exit 0 的代码报 may-throw + unknown-inference）。

- `harvest-dts.ts` 的 `recordFor`：`globals` / 模块记录表改用
  `Object.create(null)`（**无原型** ⇒ 只有自有键可见，`__proto__` 只是普通
  数据键），并用 `Object.hasOwn` 判定「已有记录」⇒ 去重裸读不再命中原型成员。
- `harvest-json.ts` 的序列化 / 回放路径同样改用无原型表（模块名 / 导出名 /
  对象槽名撞原型成员时不再被吞）。

**Bug 836** — `declare module "__proto__"` 让收割器把导出**直接写到
`Object.prototype`** 上 ⇒ **进程级原型污染**（分析进程里每个普通对象都多出
该成员）+ 该模块记录从表里**消失**。

- `harvest-dts.ts` 的 `recordFor`：模块记录表无原型 + own-property 判定 ⇒
  模块名 `__proto__` / `constructor` 读到的是**自己的记录**而不是
  `Object.prototype` / `Object` ⇒ 不再写穿原型链，模块记录也不再消失。
- `harvest-dts.ts` 的 `emitKey`：`__proto__` 改用**计算属性名**
  （`["__proto__"]`）——对象字面量里的 `__proto__: v`（即便带引号）也会触发
  `[[SetPrototypeOf]]` ⇒ 成员丢失 + 字面量原型被改写。
