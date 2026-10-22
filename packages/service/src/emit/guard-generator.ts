/**
 * Abs 指称守卫（设计 §2.7）：保留 pred。
 *
 * Bug 512：产物落盘为 `<stem>.nudo.guard.ts`——**是 TypeScript 文件**，在
 * strict 工程里必须能过 `tsc --noEmit --strict`。故守卫签名补齐类型标注：
 * 入参 `data: unknown`（守卫接受任意值——这正是「类型守卫」的语义）、
 * 返回 `boolean`。
 *
 * 守卫体是**运行时谓词**（对被检查值做成员读 / 比较 / instanceof），
 * TS 无法静态验证这些动态访问，故体内用一个**按 Abs 形态选出的最窄类型**
 * 承接被检查值：
 * - prim / lit → 该原始类型（精确；顺带让 `data > 5` 这类关系谓词可编译——
 *   关系运算符只接受数值类型，`unknown` / 对象类型都会报 TS2365）；
 * - 结构形态（obj / arr / tuple / brand / eff）→ `Record<string, any>`：
 *   守卫要读**嵌套**成员（`data.inner.k`），槽位的静态类型未跟踪 ⇒ 槽位取
 *   `any`（取 `unknown` 会让 `data.inner.k` 报 TS18046 / TS2339——见
 *   `absToSchemaShape` 的 obj 分支为何要产出成员访问）；
 * - sum → 各成员类型的并集（结构成员在场时并入原始类型并集，否则顶层的
 *   `data === "x"` 报 TS2367「无可比较的重叠」）。
 *
 * 不变量：产物里出现的每个类型名都是 **TS 内建类型名**（不引用用户类名
 * ⇒ 不会 TS2304）；产物**必可编译**（strict）。
 */

import type { Abs } from "@nudojs/core";
import { denoteGuard } from "@nudojs/core/internal";
import { safeExportIdent, widenUncertainLiteral } from "./schema-generator.ts";

/** 结构形态的动态对象形状（守卫读嵌套成员 ⇒ 槽位取 any）。 */
const DYNAMIC_OBJECT_TYPE = "Record<string, any>";

/** 原始类型并集（sum 里结构成员在场时并入，保证顶层比较可比）。 */
const PRIMITIVE_UNION = "string | number | boolean | bigint | null | undefined";

/** 结构形态判定（守卫体在这些形态上做成员读 / instanceof）。 */
function isStructuralShape(a: Abs): boolean {
  const k = a.shape.k;
  return k === "obj" || k === "arr" || k === "tuple" || k === "brand" || k === "eff";
}

/** 被检查值的 TS 类型（按 Abs 形态取；只出 TS 内建类型名）。 */
function guardValueType(a: Abs): string {
  // lit term 优先：字面量的类型比 shape 更具体（lit(null) 的 shape 是 unknown）
  const t = a.term;
  if (t?.op === "lit") {
    const v = t.value;
    if (v === null) return "null";
    if (v === undefined) return "undefined";
    if (typeof v === "number") return "number";
    if (typeof v === "string") return "string";
    if (typeof v === "boolean") return "boolean";
    if (typeof v === "bigint") return "bigint";
  }
  const s = a.shape;
  switch (s.k) {
    case "prim":
      switch (s.type) {
        case "number":
          return "number";
        case "string":
          return "string";
        case "boolean":
          return "boolean";
        case "bigint":
          return "bigint";
        case "symbol":
          return "symbol";
        default:
          return "unknown";
      }
    case "obj":
    case "arr":
    case "tuple":
    case "brand":
    case "eff":
      return DYNAMIC_OBJECT_TYPE;
    case "sum": {
      const parts: string[] = [];
      let structural = false;
      for (const m of s.members) {
        const mt = guardValueType(m);
        if (!parts.includes(mt)) parts.push(mt);
        if (isStructuralShape(m)) structural = true;
      }
      if (structural && !parts.includes(PRIMITIVE_UNION)) parts.push(PRIMITIVE_UNION);
      return parts.length > 0 ? parts.join(" | ") : "unknown";
    }
    case "never":
      return "never";
    case "any":
    case "unknown":
    default:
      return "unknown";
  }
}

/**
 * 守卫源码：`export function <name>(value: unknown): boolean { … }`。
 *
 * 被检查值在体内以 `data` 承接（`const data = value as <T>`）——`data` 这个
 * 名字是守卫体的既有约定（成员访问 / 比较都落在它上面）。
 *
 * `used`（可选）：**模块内去重集合**——与 zod 面 `safeExportIdent(name, used)`
 * 同一套口径（`isA_bOutput` / `isA_bOutput_2`）。
 *
 * Bug 608：守卫名只过字符清洗（`A.b` → `isA_bOutput`）⇒ **两个不同的源函数
 * 清洗后同名** ⇒ 同一个守卫模块里出现两个 `export function isA_bOutput`
 * （node 下 `SyntaxError: Identifier 'isA_bOutput' has already been declared`、
 * tsc 下 TS2323 / TS2393）。调用方**按模块**（一份守卫产物 = 一个源文件）
 * 传同一个 `used` 集合即可消歧——集合由本函数写入（`safeExportIdent` 的语义）。
 *
 * 不传 `used` 时行为与旧版一致（只清洗、不去重）。
 */
export function generateGuardFunctionFromAbs(name: string, abs: Abs, used?: Set<string>): string {
  // Bug 1008：不确切置信度的字面量观测**不是**出口域 ⇒ 放宽到基类型
  // （否则守卫写成 `data === 1`，把「一次兜底观测」钉成出口域）。
  const widened = widenUncertainLiteral(abs);
  const src = widened ?? abs;
  const body = denoteGuard(src, "data");
  const valueType = guardValueType(src);
  return `export function ${safeExportIdent(name, used)}(value: unknown): boolean {\n  const data = value as ${valueType};\n  return ${body};\n}`;
}

/** 兼容别名：Abs 路径唯一（`used` 语义同上）。 */
export function generateGuardFunction(name: string, abs: Abs, used?: Set<string>): string {
  return generateGuardFunctionFromAbs(name, abs, used);
}
