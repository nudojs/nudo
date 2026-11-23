/**
 * brand 容器的精确元素序列：boxed String 与 TypedArray。
 *
 * 从 iterate.ts 抽出；只读品牌内层索引槽，不参与用户迭代器 / 侧表消费。
 */
import type { Abs } from "../../../abs.ts";
import { litValue, unknown } from "../../../abs.ts";
import { getSlot } from "../../../objects.ts";
import { typedArrayEnumKeyView } from "../../../builtins/object/enum-entries.ts";
import { TYPED_ARRAY_ELEMENT } from "../../../builtins/shared.ts";

export function boxedStringChars(a: Abs): Abs[] | undefined {
  if (a.shape.k !== "brand" || a.shape.name !== "String") return undefined;
  const inner = a.shape.shape;
  if (!inner || inner.shape.k !== "obj") return undefined;
  const slots = inner.shape.slots;
  const lenR = litValue(getSlot(slots, "length")?.value ?? unknown);
  if (!lenR.ok || typeof lenR.value !== "number") return undefined;
  const out: Abs[] = [];
  for (let i = 0; i < lenR.value; i++) {
    const sl = getSlot(slots, String(i));
    if (!sl) return undefined; // 槽缺 → 不可判（不得折确定长度）
    out.push(sl.value);
  }
  return out;
}

/** Bug 236：boxed String 品牌的长度（原生 String 包装对象 length 自有槽） */
export function boxedStringLength(a: Abs): number | undefined {
  if (a.shape.k !== "brand" || a.shape.name !== "String") return undefined;
  const inner = a.shape.shape;
  if (!inner || inner.shape.k !== "obj") return undefined;
  const lenR = litValue(getSlot(inner.shape.slots, "length")?.value ?? unknown);
  return lenR.ok && typeof lenR.value === "number" ? lenR.value : undefined;
}

export function typedArrayIterElems(x: Abs): Abs[] | undefined {
  if (x.shape.k !== "brand") return undefined;
  if (TYPED_ARRAY_ELEMENT[(x.shape as { name?: string }).name ?? ""] === undefined) {
    return undefined;
  }
  const view = typedArrayEnumKeyView(x);
  const inner = (x.shape as { shape?: Abs }).shape;
  if (view?.k !== "exact" || !inner || inner.shape.k !== "obj") return undefined;
  const slots = (inner.shape as unknown as { slots: Record<string, { value: Abs }> }).slots;
  const out: Abs[] = [];
  for (let i = 0; i < view.count; i++) {
    const s = getSlot(slots, String(i));
    if (!s) return undefined;
    out.push(s.value);
  }
  return out;
}
