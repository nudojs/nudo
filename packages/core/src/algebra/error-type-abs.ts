/**
 * throws 类型名 → brand Error Abs（内核叶子模块）。
 * 从 may-throw.ts 抽出（第三轮重复逻辑收敛 #9）：exec 侧 class 面
 * （super-access.ts 的 BUG-173 ReferenceError 载荷）此前**不可** import
 * may-throw——它 import exec/class-registry（isErrorFamilyKind）⇒ 反向环
 * ⇒ 只能手抄同形副本。抽成真叶子后两侧单源。
 * 依赖面：仅 ./abs.ts（prim 构造器）与 ./builtins/invariants.ts（枚举
 * 侧表叶子，仅 type Abs 依赖）——不得引入 may-throw / exec 任何面。
 */
import type { Abs } from "./abs.ts";
import { abs, str, strLit } from "./abs.ts";
import { setPropFlags } from "./builtins/invariants.ts";

/** throws 类型名 → Abs（brand Error 形态，formatShape 打出名字）。
 *  内层 obj 带 name/message 槽（Bug 6）：catch 形参 `e.name`/`e.message`
 *  经 $get brand→inner 槽读取折精确值——name 是品牌名（静态可知），
 *  message 内容宿主特定 → 保守 string 域（与 builtins/error.ts
 *  errorBrandAbs 同口径）。 */
export function errorTypeAbs(name: string): Abs {
  // Bug 66：与 errorBrandAbs 同口径——name 打 Slot.inherited（原生经
  // X.prototype.name 原型链解析，非自有：catch 形参 e.hasOwnProperty("name")
  // 折 false）；message 自有但不可枚举（enumerable:false 侧表）。
  // R4a 补：stack 槽与 errorBrandAbs 同款（Bug 59——原生 throw 载荷也带
  // 自有 stack，node 实测 gOPN(caught e) → ["stack","message"]；槽插入序
  // 同 errorBrandAbs），否则 catch 形参 e.stack 闭槽 miss 假折 undefined、
  // hasOwn/gOPD 自有面折 false/undefined 均为 wrong-definite。
  const inner = abs(
    {
      k: "obj",
      slots: {
        stack: { value: str() },
        name: { value: strLit(name), inherited: true },
        message: { value: str() },
      },
    },
    undefined,
    undefined,
    "exact",
  );
  setPropFlags(inner, "stack", { enumerable: false });
  setPropFlags(inner, "message", { enumerable: false });
  setPropFlags(inner, "name", { enumerable: false });
  return abs(
    {
      k: "brand",
      name,
      shape: inner,
    },
    undefined,
    undefined,
    "exact",
  );
}
