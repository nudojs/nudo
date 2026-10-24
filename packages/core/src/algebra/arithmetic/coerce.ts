/**
 * ToPrimitive/ToNumeric 强转域（叶子模块）：内建 brand 解箱
 * （builtinBrandToPrimitive，Bug 25）、强转 may-throw 打点（Bug 8/31）、
 * bigint 二元字面量折叠（混型 TypeError / RangeError 硬抛）。
 *
 * 依赖方向不变量：叶子——不得 import arithmetic/ 内兄弟模块。
 */

import type { Abs } from "../abs.ts";
import { isStrPrim, isBigPrim, bigintLit, litValue, num, numLit, str, strLit } from "../abs.ts";
import { getSlot } from "../objects.ts";
import { NudoThrow } from "../nudo-throw.ts";
import { errorTypeAbs, recordMayThrow } from "../may-throw.ts";
import { boxedPrimitiveValue, isErrorCtorName } from "../builtins/error.ts";

/**
 * 抽象加法：eval(a + b) —— 跟真实 JS，不无根据地假定 number。
 * 1. 双方字面量 → 直接求值
 * 2. 双方 number prim → term + 单调性 pred，shape=number
 * 3. 含 string/template → 拼接
 * 4. any / type-var 参与 → 按 JS + 的可能结果取并集：number | string
 *    （bool/null 走 ToNumber→number；object 默认 ToPrimitive→string；
 *      bigint/symbol 边角不在默认并集里，由调用点实例化再收窄）
 *    无契约的 score(x){return x+1}：score("x") 合法，不得钉成 number。
 */
/**
 * Bug 25：内建 brand 的 ToPrimitive 强转（算术算子前置）。引擎已知的内建
 * brand（Date/RegExp/Map/Set/WeakMap/WeakSet/Error 家族/URL/ArrayBuffer/
 * SharedArrayBuffer/DataView/装箱）原型方法表固定——valueOf/toString 恒
 * total 且永不产 Symbol/bigint；用户 brand / Proxy / 未知名不折（返回
 * undefined，调用方保持既有保守 may-throw 臂）。
 * - hint "number"（- * / % ** 一元- < > Number()）：Date → valueOf →
 *   time value（tv 槽精确 / number 域）；装箱 → [[PrimitiveValue]]；
 *   其余 → toString → string 面（ToNumber(string) 由数值算子既有折叠接管，
 *   "/a/" → NaN、numeric string → 精确值）
 * - hint "default"（+）：Date 的 @@toPrimitive 把 default 视作 string
 *   （ES 特判：`date + 1` 恒 string）→ string 域（宿主本地化串不折字面量，
 *   保分析确定性）；其余与 number hint 同面（toString → string）
 */
export function builtinBrandToPrimitive(
  a: Abs,
  hint: "number" | "default",
): Abs | undefined {
  if (a.shape.k !== "brand") return undefined;
  const name = a.shape.name;
  // 装箱 brand（new Number(5) / new String("ab") / new Boolean(true)）：
  // valueOf → [[PrimitiveValue]]（T2 槽，prim 直取）
  const boxed = boxedPrimitiveValue(a);
  if (boxed !== undefined) return boxed;
  if (name === "Date") {
    if (hint === "number") {
      const tv = (a.shape as { tv?: number }).tv;
      return tv !== undefined ? numLit(tv) : num();
    }
    return str(); // default hint → toString（本地化串，域 string）
  }
  if (name === "RegExp") {
    // toString ≡ `/${source}/${flags}`（槽可精确则精确折叠）
    const inner = a.shape.shape;
    if (inner && inner.shape.k === "obj") {
      const src = getSlot((inner.shape as { slots: Record<string, { value: Abs }> }).slots, "source")?.value;
      const flg = getSlot((inner.shape as { slots: Record<string, { value: Abs }> }).slots, "flags")?.value;
      const sR = src ? litValue(src) : undefined;
      const fR = flg ? litValue(flg) : undefined;
      if (sR?.ok && typeof sR.value === "string" && fR?.ok && typeof fR.value === "string") {
        return strLit(`/${sR.value}/${fR.value}`);
      }
    }
    return str();
  }
  if (
    name === "URL" ||
    name === "Map" ||
    name === "Set" ||
    name === "WeakMap" ||
    name === "WeakSet" ||
    name === "ArrayBuffer" ||
    name === "SharedArrayBuffer" ||
    name === "DataView" ||
    isErrorCtorName(name)
  ) {
    return str(); // toString 域 string（组件槽不折——Map 条目/URL 查询序不确定面）
  }
  return undefined;
}

/**
 * 已知不是 bigint 的操作数面：number/bool/null/undefined 字面量或 prim。
 * 与 bigint 做算术/位运算时 ToNumeric 后是 number，混型恒 TypeError。
 * string 不在此列——`+` 的 string 臂走拼接，其余算子在调用点单独判。
 */
function isKnownNonBigintNumeric(a: Abs): boolean {
  const r = litValue(a);
  if (r.ok && (typeof r.value === "number" || typeof r.value === "boolean" || r.value === null)) return true;
  if (r.ok && r.value === undefined) return true;
  return a.shape.k === "prim" && (a.shape.type === "number" || a.shape.type === "boolean");
}

/**
 * lit(null)/lit(undefined) 操作数：字面量项携带 nullish 值（shape 恒
 * k:"unknown"——null/undefined 无 prim 名可配，见 absShapeKey-null-unknown）。
 * 与 builtins/shared.ts mayCoerceThrowOperand 的「lit 项恒 total」同原则，
 * 但只排 nullish 字面量（see isMaybeBigintOperand，issue #119）。
 */
function isNullishLitOperand(a: Abs): boolean {
  const r = litValue(a);
  return r.ok && (r.value === null || r.value === undefined);
}

/**
 * **不得按「确定的非 bigint 数值面」处理**的操作数（any/unknown/obj/fn/brand/
 * sum，以及数组/元组）。
 * `1n + x`（x:any）在 x 实为 2n 时得 3n、x 为 "s" 时得 "1s"、x 为 1 时才 TypeError——
 * 不得硬抛成 never。
 *
 * Bug 946：数组/元组补进清单 —— `1n + []` 原生走 ToPrimitive（数组侧恒
 * join(",") ⇒ string）得 "1"、**从不抛**；bigint ⊗ 数组不得被当成「已知的
 * 非 bigint 面」而误折。算术面（`-` / `*` / `/` / `%` 无字符串分支）经
 * ToNumber(string) → number ⇒ 混型 TypeError **确定**（node 实测 `1n - []`
 * 恒抛）⇒ foldBigintBinOp 里走**硬抛**分支（可被 catch 吸收），不走软
 * may-throw 通道（软通道让求值继续 ⇒ catch 分支变死代码）。
 *
 * 注意：本清单判的是「不得按确定的非 bigint 数值面处理」，**不是**「ToPrimitive
 * 可能产 bigint」——数组的 ToPrimitive 恒是字符串，永不产 bigint。ToString/
 * ToNumber 强转的 may-throw 判据见 isMaybeCoercionThrowOperand（数组/元组被
 * 排除：它们的 ToPrimitive 恒 string ⇒ 既不会成 bigint 也不会成 Symbol ⇒
 * `1 + []` / `[] < 1` 原生从不抛，不得记假 may-throw）。
 */
function isMaybeBigintOperand(a: Abs): boolean {
  // issue #119：lit(null)/lit(undefined)（shape k:"unknown" 携带字面量项）
  // 在一切隐式强转下 total（ToString→"null"/"undefined"、ToNumber→0/NaN），
  // 绝不可能是 bigint/Symbol。optional()/nullable() 槽读出
  // joinAbs(slot, undef)——其 nullish 字面量成员不得连坐 may-throw
  // （`${f.file}` 契约 string|undefined 曾记假 Symbol 强转）。只排 nullish
  // 字面量：bigint 字面量保持原判定（ToNumeric 混型 TypeError 真实可能）。
  if (isNullishLitOperand(a)) return false;
  const k = a.shape.k;
  if (k === "sum") {
    // Bug 25：sum 成员感知——prim 成员（number|string union）绝不可能是
    // bigint/Symbol，不得随 obj/fn/brand/any 成员连坐（否则 `v > "a"`、
    // `v + "!"` 对纯 prim union 记假 may-throw）。obj/fn/brand/any 成员
    // 保持原子（对象经 @@toPrimitive 确可返 Symbol/bigint）。空 sum 无
    // 成员可判（DEC-006 无单位元口径）→ 保守真。
    const members = (a.shape as { members: Abs[] }).members;
    return members.length === 0 || members.some((m) => isMaybeBigintOperand(m));
  }
  return (
    k === "any" ||
    k === "unknown" ||
    k === "obj" ||
    k === "fn" ||
    k === "brand" ||
    // Bug 946：数组/元组 —— ToPrimitive 恒 join(",") ⇒ string（不是「可能
    // 产 bigint」，但也不是「已知的非 bigint 数值面」）⇒ 进清单由
    // foldBigintBinOp 的数组分支显式分流（硬抛，见该处注释）。
    k === "arr" ||
    k === "tuple"
  );
}

/**
 * 抽象操作数经 ToPrimitive/ToNumeric 可能成 bigint / Symbol —— 与数值面
 * 协同可能原生 TypeError（`x + 1`，x=1n / Symbol()，node 实测）。只补
 * throws 效果，值域不变。unknown 是引擎 fail-closed 令牌，不在此列
 * （wave 1 口径：may-tier 对 any 记、对 unknown 不记，不把引擎债放大成
 * L2 假报）。
 *
 * Bug 946：数组/元组**不在**本通道 —— 它们的 ToPrimitive 恒为字符串
 * （join），既不会成 bigint 也不会成 Symbol ⇒ `1 + []` / `[] < 1` 原生
 * 从不抛，不得记假 may-throw（该判据与 isMaybeBigintOperand 的清单
 * 有意分叉：后者是「不得按确定的非 bigint 数值面处理」的算子侧判据）。
 */
export function isMaybeCoercionThrowOperand(a: Abs): boolean {
  if (a.shape.k === "arr" || a.shape.k === "tuple") return false;
  return isMaybeBigintOperand(a) && a.shape.k !== "unknown";
}

/** Bug 8 打点：抽象操作数协同可能原生 TypeError（bigint 混型 / Symbol 强转） */
export function noteCoercionMayThrow(a: Abs, b: Abs, cause: string): void {
  if (isMaybeCoercionThrowOperand(a) || isMaybeCoercionThrowOperand(b)) {
    recordMayThrow({ kind: "TypeError", cause });
  }
}

/**
 * Bug 8 算术抽象臂统一打点（add/sub/mul/div/mod 的 any 臂与混合回退臂）。
 * bigint 字面量面 ⊗ 抽象对面的 may-throw 已由 foldBigintBinOp 记过
 * （`1n + x` 控制组），此处不重复。
 */
export function noteAbstractArithMayThrow(a: Abs, b: Abs): void {
  const ra = litValue(a);
  const rb = litValue(b);
  if ((ra.ok && typeof ra.value === "bigint") || (rb.ok && typeof rb.value === "bigint")) {
    return;
  }
  noteCoercionMayThrow(a, b, "ToNumeric/ToNumber coercion of abstract operand");
}

/** 双方 bigint 字面量折叠；÷0n / 负指数等原生 RangeError、确定混型原生 TypeError——硬抛（catch 可吸收），不得静默 unknown */
export function foldBigintBinOp(
  a: Abs,
  b: Abs,
  op: (x: bigint, y: bigint) => bigint,
): Abs | undefined {
  const ra = litValue(a);
  const rb = litValue(b);
  const va = ra.ok ? ra.value : undefined;
  const vb = rb.ok ? rb.value : undefined;
  // Bug 106：bigint-ness 双侧判定 = 字面量 ∪ isBigPrim（抽象 bigint prim
  // ——BigInt(Date.now()) 等非字面量 bigint 也是**确定** bigint，此前仅凭
  // 字面量识别，b+1 落通用臂折 number|string 漏定抛 TypeError）
  const aBig = typeof va === "bigint" || isBigPrim(a);
  const bBig = typeof vb === "bigint" || isBigPrim(b);
  if (!aBig && !bBig) return undefined;
  if (typeof va === "bigint" && typeof vb === "bigint") {
    try {
      return bigintLit(op(va, vb));
    } catch (e) {
      if (e instanceof RangeError) throw new NudoThrow(errorTypeAbs("RangeError"));
      throw new NudoThrow(errorTypeAbs("TypeError"));
    }
  }
  if (aBig && bBig) {
    // 两侧均 bigint、至少一侧抽象：不可数值折叠。字面量 0n 除数（div/mod）
    // / 字面量负指数（pow）的定抛 RangeError 由调用点在返回抽象 bigint 前
    // 检查（coerce 是叶子模块，不带算子种类）；此处交回上层分流。
    return undefined;
  }
  // 恰一侧 bigint（字面量或抽象 prim），另一侧确定非 bigint：
  const other = aBig ? b : a;
  // 已知非 bigint 数值面（number/bool/null/undefined）：混型恒 TypeError
  if (isKnownNonBigintNumeric(other)) {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  // string prim：非 `+` 的算术/位运算 ToNumber 后混型恒 TypeError；
  // `+` 的 string 臂已在 add() 上游分流，到这里即算术算子。
  if (isStrPrim(other)) {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  // any/unknown/obj/…：可能 ToPrimitive 成 bigint（成功）或 number（TypeError）——
  // 记 soft may-throw，交回上层分流，不得硬抛成 never
  if (isMaybeBigintOperand(other)) {
    // Bug 946：数组/元组 —— ToPrimitive 恒 join(",") ⇒ string ⇒ ToNumber ⇒
    // number ⇒ 与 bigint 混型 TypeError **确定**（node 实测 `1n - []` 恒抛）
    // 且**可被 catch 吸收** ⇒ 硬抛。
    //
    // **不得**走下面的软 may-throw 通道：软通道让求值继续（catch 分支变死
    // 代码）—— 实测 `try { 1n - [] } catch (e) { return 'caught'; }` 原生进
    // catch（"caught"），软通道下落到 catch 之后（"missed"）⇒ 语义反了。
    // `+` 的字符串分支在 add() 上游分流（数组臂先于 bigint 臂），到这里即
    // 算术算子 ⇒ 混型 TypeError 恒定。
    if (other.shape.k === "arr" || other.shape.k === "tuple") {
      throw new NudoThrow(errorTypeAbs("TypeError"));
    }
    recordMayThrow({
      kind: "TypeError",
      cause: "mixed bigint ⊗ abstract operand",
    });
    return undefined;
  }
  throw new NudoThrow(errorTypeAbs("TypeError"));
}

