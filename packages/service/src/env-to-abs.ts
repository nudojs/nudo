/**
 * env TypeValue → Abs：
 * - fnSig 带 impl（Promise.resolve / URL / path.join…）→ apply 路径，保留精确字面量
 * - fnSig 仅有声明（readFileSync…）→ relationFn，调用产出声明返回类型而非 unknown
 */

import {
  type TypeValue,
  type Abs,
  typeValueToAbs,
  absToTypeValue,
  getFnSig,
  absFunction,
  relationFn,
  objOf,
} from "@nudojs/core";

export function envValueToAbs(tv: TypeValue): Abs {
  if (!tv) return typeValueToAbs({ kind: "unknown" });

  if (tv.kind === "function") {
    const sig = getFnSig(tv);
    if (sig) {
      const paramTypes = sig.paramTypes.map(typeValueToAbs);
      const returnType = typeValueToAbs(sig.returnType);
      if (sig.impl) {
        const params = tv.params?.length ? tv.params : sig.paramTypes.map((_, i) => `_arg${i}`);
        const dummyBody = {
          type: "BlockStatement",
          body: [],
          directives: [],
        } as never;
        const impl = sig.impl;
        // apply 优先于 relation；impl 失败/无返回时回落声明返回类型
        return absFunction(params, {
          body: dummyBody,
          apply: (args: Abs[]): Abs => {
            const tvArgs = args.map((a) => absToTypeValue(a));
            try {
              const r = impl(tvArgs);
              if (!r) return returnType;
              return envValueToAbs(r);
            } catch {
              return returnType;
            }
          },
        });
      }
      return relationFn(paramTypes, returnType, {
        params: tv.params?.length ? tv.params : undefined,
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
