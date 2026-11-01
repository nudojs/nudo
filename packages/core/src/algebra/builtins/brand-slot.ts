/**
 * brand 接收者的内层 obj 槽读取链单源（第三轮重复逻辑收敛 #10）：
 * `brand → inner obj → getSlot`。此前四份同构拷贝：error/dispatch.ts
 * （URL.toJSON 的 href、Error toString/toLocaleString 的 name/message）
 * 与 json.ts（jsonBrandFold / jsonBrandToJsonAbs 的 URL href 臂）。
 * litValue 精确性判断（折叠 vs 保守域）留消费方——本模块只做读取链。
 *
 * 依赖面：仅 ../abs.ts（type Abs）与 ../objects.ts（getSlot）。
 */
import type { Abs } from "../abs.ts";
import { getSlot } from "../objects.ts";

/**
 * 读 brand 内层 obj 的自有槽值；非 brand / 内层非 obj / 槽不存在 →
 * undefined（消费方回退保守域，如 str("path")）。
 */
export function readBrandObjSlot(recv: Abs, slot: string): Abs | undefined {
  if (recv.shape.k !== "brand") return undefined;
  const inner = recv.shape.shape;
  if (!inner || inner.shape.k !== "obj") return undefined;
  return getSlot((inner.shape as { slots: Record<string, { value: Abs }> }).slots, slot)?.value;
}
