import type { Abs } from "@nudojs/core";
import { litValue } from "@nudojs/core";

/** Abs → zod schema 源码。有损：pred / 非 lit term 落到 shape 基类型。 */
export function absToZodSchema(a: Abs): string {
  if (a.term?.op === "lit") {
    const v = a.term.value;
    if (v === null) return "z.null()";
    if (v === undefined) return "z.undefined()";
    if (typeof v === "string") return `z.literal(${JSON.stringify(v)})`;
    if (typeof v === "boolean") return `z.literal(${v})`;
    if (typeof v === "number") return `z.literal(${v})`;
    if (typeof v === "bigint") return `z.literal(${v}n)`;
  }

  switch (a.shape.k) {
    case "prim":
      return `z.${a.shape.type}()`;
    case "obj": {
      const entries = Object.entries(a.shape.slots)
        .map(([k, slot]) => `${k}: ${absToZodSchema(slot.value)}`)
        .join(", ");
      return `z.object({ ${entries} })`;
    }
    case "arr":
      return `z.array(${absToZodSchema(a.shape.element)})`;
    case "tuple": {
      const inner = a.shape.elements.map(absToZodSchema).join(", ");
      return `z.tuple([${inner}])`;
    }
    case "fn":
      return "z.function()";
    case "eff":
      if (a.shape.eff === "promise") return `z.promise(${absToZodSchema(a.shape.inner)})`;
      return absToZodSchema(a.shape.inner);
    case "brand":
      return `z.instanceof(${a.shape.name})`;
    case "sum": {
      const members = a.shape.members.map(absToZodSchema).join(", ");
      return `z.union([${members}])`;
    }
    case "never":
      return "z.never()";
    case "unknown":
    case "any":
    default:
      return "z.unknown()";
  }
}
