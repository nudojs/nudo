---
"@nudojs/harvester": patch
---

fix(harvester): 草稿面（`nudo contract --from-dts`）8 条与收割面**同源**（族 51）

harvester 有两面：**收割面**（`harvest-dts.ts` → Abs）与**草稿面**
（`dts-contract-draft.ts` → `*.nudo.js` 草稿）。台账族 27 记了 8 条**草稿面**的
纯缺口（收割面已修、草稿面没跟上）⇒ 同一份 `.d.ts`，收割面说得准、草稿面说不了
（草稿比 TS **松**，**不是假红**，但用户拿到的是残缺草稿）；共同症状是
**静默降级**成 `any()` / 丢成员，而**汇总行不说谎** ⇒ 用户看不出草稿缺了什么。

本次只改草稿面（`packages/harvester/src/dts-contract-draft.ts`），逐条照搬收割面
（`harvest-dts.ts`）的既有正确处理：

1. **条件类型**：新增 `ConditionalTypeNode` 分支 ⇒ 判不出时取**两支并集**
   （收割面 `mapConditionalType` 同口径），`extends unknown` 的恒真形态只取真支；
   不再整条降级 `any()`，且降级**明确可见**（note ⇒ 计入 `skipped`）。
2. **计算成员名**：`memberKey` 按收割面 `computedMemberName` 同口径认
   `Symbol.iterator` → `@@iterator` / `Symbol.asyncIterator` → `@@asyncIterator` /
   计算键的字符串字面量 ⇒ **不再整条丢弃**；不可静态判定者留 note
   ⇒ **部分**丢失时汇总行也看得见（此前只在「全部成员被丢」时才发 note）。
3. **`extends` 基接口成员**：`collectSymbols` 按**限定名**登记（命名空间内的
   interface 登记为 `A.Opts`），`interfaceMembers` 按限定名解析基类
   ⇒ 基接口成员**进草稿**，且 `A.Base` 与 `B.Base` 不互相并入。
4. **命名空间限定名**：`A.Opts` 能解析（此前只有短名桶 ⇒ 降级 `any()`）。
5. **class 构造器签名**：投影为类值的构造器 fn（收割面同款：类值 = 构造器）
   ⇒ `new Thing(…)` 不再零义务；该条**计入 `skipped`**（契约 DSL 无 `new` 语义 ⇒
   需人工审阅），汇总行不再说谎。
6. **ambient module 体**：`declare module "x" { … }` / `declare global { … }`
   的**体**被遍历 ⇒ 内部导出**进草稿**且**计数**（此前整块不可见也不计数）。
7. **重载 arity**：元数**相同** ⇒ 形参**按位合并**（并集，不比 TS 更严，
   收割面 Bug 827 同口径）；元数**不同** ⇒ 仍取首个 overload（改成最宽会让
   `f("a")` 变成「参数不够」⇒ 假红）但**明确标注窄口径**（note 写明 arity 与
   「多参调用不在覆盖内」）。
8. **跨文件再导出 / 跨文件导入的类型**：名字**可见**、降级**可见**且**计入
   `skipped`**（类型需模块解析器 ⇒ 本片无法闭合，已如实标注为剩余缺口）。

草稿面**不比 TS 更严**（新投影只会更宽：并集 / 可见降级），负控形态（与族 51 无关的
声明）的草稿输出**逐字不变**；既有金标全绿（`packages/harvester` 72 个测试文件
/ 344 例）。
