import type { TypeValue } from "@nudojs/core";

export function typeValueToZodSchema(tv: TypeValue): string {
  switch (tv.kind) {
    case "literal": {
      if (tv.value === null) return "z.null()";
      if (tv.value === undefined) return "z.undefined()";
      if (typeof tv.value === "string") return `z.literal(${JSON.stringify(tv.value)})`;
      if (typeof tv.value === "boolean") return `z.literal(${tv.value})`;
      return `z.literal(${tv.value})`;
    }
    case "primitive":
      return `z.${tv.type}()`;
    case "refined":
      return typeValueToZodSchema(tv.base);
    case "object": {
      const entries = Object.entries(tv.properties)
        .map(([k, v]) => `${k}: ${typeValueToZodSchema(v)}`)
        .join(", ");
      return `z.object({ ${entries} })`;
    }
    case "array":
      return `z.array(${typeValueToZodSchema(tv.element)})`;
    case "tuple": {
      const inner = tv.elements.map(typeValueToZodSchema).join(", ");
      return `z.tuple([${inner}])`;
    }
    case "function":
      return "z.function()";
    case "promise":
      return `z.promise(${typeValueToZodSchema(tv.value)})`;
    case "instance":
      return `z.instanceof(${tv.className})`;
    case "union": {
      const members = tv.members.map(typeValueToZodSchema).join(", ");
      return `z.union([${members}])`;
    }
    case "never":
      return "z.never()";
    case "unknown":
      return "z.unknown()";
  }
}
