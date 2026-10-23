---
"@nudojs/service": patch
---

fix(service): 产物面（dts / schema / standard）2 条——internal 槽不再外泄，用户类 brand 不再产出未声明的类型名（族 55 · W5）

产物面有**两面**：dts（类型声明）与 schema / standard（运行时校验器）。本次两条
都落在**同一个语义缺口**上——产物把 **Abs 内部实现细节**当**用户可见的公开面**
直出。

**1) Bug 240：产物面仍发布 internal 槽**

internal 槽（`Slot.internal`）不是自有可枚举属性——私有字段（`#x`）与生成器协议
槽（`next` / `return` / `throw` / `constructor` / `@@iterator`）都属此类。core 侧
早已统一判据（`format.ts` 投影面 / `projection.ts` 约束面 / `denote.ts` guard 面
同款 `isHiddenInternalSlot`：`internal` 且键**不是**规范数组下标 ⇒ 该槽对属性
introspection 不可见 ⇒ 不进产物），但 service 的产物面没跟上：

- **dts 形参位**：`widenParamAbs` 造新槽时丢了 `internal` / `symbolKey` 标记 ⇒
  内部槽被"提权"成用户可见字段——改前
  `export declare function f(x: { a: number; "#priv": number; "@@iterator": number }): number;`
  （私有字段与 **symbol 键**协议槽按字符串键直出）。
- **dts 类体**：私有字段进 `declare class` 的字段列表。
- **schema 形状兜底路径**（约束不可表达时，如 open 对象）：内部槽进 zod / standard
  产物。

现在 service 产物面**复用 core 的同一判据**（`packages/service/src/emit/internal-slot.ts`
的 `isHiddenInternalSlot`，判据逐字同款，不另造）：内部槽不进 dts / schema /
standard 产物。**规范数组下标槽是例外**（族 01 口径：生成器的数字下标槽承载
**元素域**，不是内部实现细节）——该例外与 core 三面、约束面、schema 面前后一致。

**2) Bug 233：dts 面把用户类 brand 渲染成从未声明的类型名**

`absToTSType(brand("Counter"))` = `Counter` ⇒ 产物里那个类名**从未声明** ⇒ 消费方
tsc 报 **TS2304**（"Cannot find name 'Counter'"）。修法按**模块面**口径（产物是
一个**模块**，类名必须在模块里可解析）：

- **本地声明**的类 ⇒ 保留类名 + `declare class`（Bug 517 既有口径**逐字不变**）；
- **import 进来**的类 ⇒ 保留类名 + 补 `import type { C } from "…";`——族 15 S11 的
  zod 白名单口径「**补 import 的类名不能被误杀**」：不能把未声明的类型名一律降级，
  已 import 的类名要保留（模块面新增导入面扫描：`DtsModuleSurface.imports`）；
- **两边都没有**的类名 ⇒ **降级为 `unknown`**（不再产出未声明的类型名 ⇒ 不再
  TS2304），并在产物头部留**降级台账**（`// nudo:unresolved-class …`）⇒ 降级
  **可诊断**（台账点名被降级的类名）。
- **TS 全局类型名**（Date / RegExp / Error / URL …）与 **zod 白名单同名单**
  （`RUNTIME_GLOBAL_CTOR_NAMES`，族 15 S11 同源）⇒ 原样保留，无需声明。

纯投影面（`absToTSType` 单值投影，无模块面 ⇒ 无声明面可判）保持既有口径**逐字
不变**（`absToTSType(brand("User"))` 仍是 `"User"`，见既有钉 `emit-bug-521`）。

**四面口径**：dts / schema / standard / guard 对 **internal 槽**现已同款（guard /
约束面此前已由 core 修好，本次补齐 service 侧）；对 **brand 类名**，schema /
standard 仍按族 15 S11 的 zod 白名单口径（用户类降级 `z.unknown()` + dropped
台账——zod 产物只 import zod，不能引用用户类），dts 面则因**类型面**可以补
`import type` 而保留已 import 的类名——这是**产物形态的固有差异**，不是口径分叉。
