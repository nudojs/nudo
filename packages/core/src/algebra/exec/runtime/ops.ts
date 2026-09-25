/**
 * 运算符重载面（transpile 目标）：$add/$sub/…、比较/位运算。
 */
import type { Abs } from "../../abs.ts";
import { abs, bool, boolLit, confJoin, litValue, numLit, unknown, type Confidence } from "../../abs.ts";
import { lit } from "../../term.ts";
import type { Phi } from "../../pred.ts";
import { pTrue, and, predEquals } from "../../pred.ts";
import { add, sub, mul, div, mod, cmp, falseConstraint } from "../../arithmetic.ts";
import {
  typeofAbs, negAbs, notAbs, strictEqAbs, looseEqAbs, bitandAbs, bitorAbs,
  bitxorAbs, bitnotAbs, shlAbs, shrAbs, ushrAbs, powAbs, toNumberAbs,
} from "../../surface.ts";
import { joinAbs } from "../../objects.ts";
import { asAbsVal, currentExecPhi, $lit, litTruth, isDefinitelyTrue, isDefinitelyFalse, noBody, undef, throwStrictWrite, NudoThrow } from "./state.ts";


export function $unknown(): Abs {
  return abs({ k: "unknown" }, undefined, undefined, "opaque");
}

/** `import.meta` → `{ url: string }`（宿主 URL 非字面量，不假精确） */
export function $importMeta(): Abs {
  return abs(
    {
      k: "obj",
      slots: {
        url: { value: abs({ k: "prim", type: "string" }, undefined, undefined, "path") },
      },
      open: true,
    },
    undefined,
    undefined,
    "path",
  );
}

/** `import(spec)` → Promise&lt;开放模块命名空间&gt;（动态模块图不静态解析） */
export function $dynamicImport(_spec: Abs): Abs {
  const ns = abs(
    { k: "obj", slots: {}, open: true },
    undefined,
    undefined,
    "path",
  );
  return abs({ k: "eff", eff: "promise", inner: ns }, undefined, undefined, "path");
}

export function $add(a: Abs, b: Abs): Abs {
  return add(a, b, currentExecPhi());
}
export function $sub(a: Abs, b: Abs): Abs {
  return sub(a, b, currentExecPhi());
}
export function $mul(a: Abs, b: Abs): Abs {
  return mul(a, b, currentExecPhi());
}
export function $div(a: Abs, b: Abs): Abs {
  return div(a, b, currentExecPhi());
}
export function $mod(a: Abs, b: Abs): Abs {
  return mod(a, b, currentExecPhi());
}
export function $bitand(a: Abs, b: Abs): Abs {
  return bitandAbs(a, b);
}
export function $bitor(a: Abs, b: Abs): Abs {
  return bitorAbs(a, b);
}
export function $bitxor(a: Abs, b: Abs): Abs {
  return bitxorAbs(a, b);
}
export function $bitnot(a: Abs): Abs {
  return bitnotAbs(a);
}
export function $shl(a: Abs, b: Abs): Abs {
  return shlAbs(a, b);
}
export function $shr(a: Abs, b: Abs): Abs {
  return shrAbs(a, b);
}
export function $ushr(a: Abs, b: Abs): Abs {
  return ushrAbs(a, b);
}
export function $pow(a: Abs, b: Abs): Abs {
  return powAbs(a, b);
}

export function $toNumber(a: Abs): Abs {
  return toNumberAbs(a);
}

export function $neg(a: Abs): Abs {
  return negAbs(a);
}
export function $typeof(a: Abs): Abs {
  return typeofAbs(a);
}
export function $not(a: Abs): Abs {
  return notAbs(a);
}
export function $eq(a: Abs, b: Abs): Abs {
  const r = strictEqAbs(a, b);
  return r === undefined ? bool() : boolLit(r);
}
export function $ne(a: Abs, b: Abs): Abs {
  const r = strictEqAbs(a, b);
  return r === undefined ? bool() : boolLit(!r);
}
/** `==` / `!=`（C2.3）：双字面量 Abstract Equality，否则回落严格判定 */
export function $eqLoose(a: Abs, b: Abs): Abs {
  const r = looseEqAbs(a, b);
  return r === undefined ? bool() : boolLit(r);
}
export function $neLoose(a: Abs, b: Abs): Abs {
  const r = looseEqAbs(a, b);
  return r === undefined ? bool() : boolLit(!r);
}
export function $lt(a: Abs, b: Abs): Abs {
  return cmp("lt", a, b, currentExecPhi());
}
export function $le(a: Abs, b: Abs): Abs {
  return cmp("le", a, b, currentExecPhi());
}
export function $gt(a: Abs, b: Abs): Abs {
  return cmp("gt", a, b, currentExecPhi());
}
export function $ge(a: Abs, b: Abs): Abs {
  return cmp("ge", a, b, currentExecPhi());
}
export function $join(a: Abs, b: Abs): Abs {
  return joinAbs(asAbsVal(a), asAbsVal(b));
}
