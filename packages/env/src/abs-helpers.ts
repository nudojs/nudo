/**
 * Abs 构造助手：env 模块声明专用。
 * relationFn / absFunction 的薄封装 + 常用 shape 工厂。
 */

import {
  type Abs,
  type AbsSigImpl,
  type Confidence,
  type Slot,
  abs as makeAbs,
  lit as termLit,
  absFunction,
  relationFn,
  relationFingerprint,
  objOf,
  num,
  str,
  strLit,
  bool,
  never,
  unknown,
} from "@nudojs/core";

export type { Slot };

const dummyBody = {
  type: "BlockStatement",
  body: [],
  directives: [],
} as never;

export function undef(): Abs {
  return makeAbs({ k: "unknown" }, termLit(undefined), undefined, "exact");
}

export function nullLit(): Abs {
  return makeAbs({ k: "unknown" }, termLit(null), undefined, "exact");
}

export function anyAbs(): Abs {
  return makeAbs({ k: "any" }, undefined, undefined, "path");
}

export function arrOf(element: Abs): Abs {
  return makeAbs({ k: "arr", element }, undefined, undefined, "exact");
}

export function tupleOf(elements: Abs[], rest?: Abs): Abs {
  const shape = rest
    ? { k: "tuple" as const, elements, rest }
    : { k: "tuple" as const, elements };
  return makeAbs(shape, undefined, undefined, "exact");
}

/** 原始 sum（保 lit 成员，不走 joinValues） */
export function unionOf(...members: Abs[]): Abs {
  if (members.length === 0) return never;
  if (members.length === 1) return members[0]!;
  return makeAbs({ k: "sum", members }, undefined, undefined, "exact");
}

export function promiseOf(inner: Abs): Abs {
  return makeAbs({ k: "eff", eff: "promise", inner }, undefined, undefined, "exact");
}

export function brandOf(name: string, shape: Abs = unknown): Abs {
  return makeAbs({ k: "brand", name, shape }, undefined, undefined, "path");
}

/** Error 家族 brand：shape 带 name/message（catch 形参成员可解） */
export function errorBrandOf(name: string): Abs {
  return makeAbs(
    {
      k: "brand",
      name,
      shape: objOf({
        name: { value: strLit(name) },
        message: { value: str() },
      }),
    },
    undefined,
    undefined,
    "path",
  );
}

/**
 * env 声明函数：无 apply 时 relationFn；有 apply 时 absFunction + shape 签名槽。
 * shape.paramTypes/returnType 同步写入（format/leq 读这里）。
 *
 * `opts.params` labels:
 * - `...name` — rest slot; formatShape renders `...name: <last/typed slot>`
 * - `name?`  — optional slot; formatShape renders `name?: <type>`
 * Keep `params.length === paramTypes.length` when paramTypes is present
 * (relation fingerprint / isRelFn alignment).
 */
export function envFn(
  paramTypes: Abs[],
  returnType: Abs,
  apply?: AbsSigImpl,
  opts?: {
    params?: string[];
    conf?: Confidence;
    /** 仅声明、无 relation 应用时的 fingerprint 后缀 */
    name?: string;
  },
): Abs {
  const params =
    opts?.params ?? paramTypes.map((_, i) => (paramTypes.length === 1 && i === 0 ? "x" : `x${i}`));
  if (!apply) {
    return relationFn(paramTypes, returnType, {
      params,
      conf: opts?.conf ?? "exact",
      fingerprint: opts?.name
        ? `${opts.name}|${relationFingerprint(paramTypes, returnType)}`
        : undefined,
    });
  }
  const implApply = apply;
  const a = absFunction(params, {
    body: dummyBody,
    apply: (args: Abs[]): Abs => {
      try {
        const r = implApply(args);
        return r ?? returnType;
      } catch {
        return returnType;
      }
    },
  });
  a.shape = {
    k: "fn",
    params,
    paramTypes,
    returnType,
    ...(opts?.name ? { name: opts.name } : {}),
  };
  if (opts?.conf && opts.conf !== "exact") a.conf = opts.conf;
  return a;
}

/**
 * Variadic env fn (path.join / util.format / stream.pipeline).
 * `restType` is the element type of the trailing rest slot; optional
 * `required` prefix params stay required. formatShape shows `...restName`.
 */
export function envFnVariadic(
  restType: Abs,
  returnType: Abs,
  opts?: {
    apply?: AbsSigImpl;
    required?: Abs[];
    restName?: string;
    name?: string;
  },
): Abs {
  const required = opts?.required ?? [];
  const restName = opts?.restName ?? "...rest";
  const paramTypes = [...required, restType];
  const params = [
    ...required.map((_, i) => `x${i}`),
    restName,
  ];
  return envFn(paramTypes, returnType, opts?.apply, {
    params,
    ...(opts?.name ? { name: opts.name } : {}),
  });
}

export function slotsOf(
  entries: Record<string, Abs | Slot>,
): Record<string, Slot> {
  const out: Record<string, Slot> = {};
  for (const [k, v] of Object.entries(entries)) {
    out[k] = v && typeof v === "object" && "value" in v && !("shape" in v)
      ? (v as Slot)
      : { value: v as Abs };
  }
  return out;
}

export function objAbs(entries: Record<string, Abs | Slot>): Abs {
  return objOf(slotsOf(entries));
}

/** 统一 prim/特殊 shape：num/str/bool/undef/nullLit 为工厂，unknown/never 为常量 */
export const prim = {
  num,
  str,
  bool,
  never,
  unknown,
  undef,
  nullLit,
  any: anyAbs,
};
