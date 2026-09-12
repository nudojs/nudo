/**
 * env TypeValue → Abs：保留 fnSig impl，使 Promise.resolve / URL 等
 * 在 B 路径也能产出精确字面量。
 */

import {
  type TypeValue,
  type Abs,
  typeValueToAbs,
  absToTypeValue,
  getFnSig,
  absFunction,
  objOf,
} from "@nudojs/core";

export function envValueToAbs(tv: TypeValue): Abs {
  if (!tv) return typeValueToAbs({ kind: "unknown" });

  if (tv.kind === "function") {
    const sig = getFnSig(tv);
    if (sig?.impl) {
      const params =
        tv.kind === "function" && tv.params?.length
          ? tv.params
          : sig.paramTypes.map((_, i) => `_arg${i}`);
      const dummyBody = {
        type: "BlockStatement",
        body: [],
        directives: [],
      } as never;
      const impl = sig.impl;
      return absFunction(params, {
        body: dummyBody,
        apply: (args: Abs[]): Abs => {
          const tvArgs = args.map((a) => absToTypeValue(a));
          try {
            const r = impl(tvArgs);
            if (!r) return typeValueToAbs(sig.returnType);
            return envValueToAbs(r);
          } catch {
            return typeValueToAbs(sig.returnType);
          }
        },
      });
    }
  }

  if (tv.kind === "object") {
    const slots: Record<string, { value: Abs }> = {};
    for (const [k, v] of Object.entries(tv.properties)) {
      slots[k] = { value: envValueToAbs(v) };
    }
    return objOf(slots);
  }

  return typeValueToAbs(tv);
}
