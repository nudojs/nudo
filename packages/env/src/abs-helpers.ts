/**
 * Abs 构造助手：env 模块声明专用。
 * relationFn / absFunction 的薄封装 + 常用 shape 工厂。
 */

import {
  type Abs,
  type AbsApplyResult,
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
  isAbsApplyResult,
  leqAbs,
  makeAbsApplyResult,
  never,
  unknown,
} from "@nudojs/core";
import { errorTypeAbs } from "@nudojs/core/internal";

export type { Slot };

/**
 * env 声明的 apply 实现签名（族 29 S0 机制层契约）。
 *
 * - 裸 `Abs` / `undefined` ⇒ **不抛**（无 throws 面）。
 * - `AbsApplyResult` ⇒ 调用方自带 throws 面（core `$call` 统一路由：
 *   `abs ≠ never` → may-throw；`abs === never` → always-throw）。
 *
 * 比 core 的 `AbsSigImpl` 宽一档：允许实现方显式声明 throws 面。
 */
export type EnvApplyImpl = (
  args: Abs[],
  thisVal?: Abs,
) => Abs | undefined | AbsApplyResult;

/**
 * 错误品牌 Abs（core `errorTypeAbs` 的 env 侧便捷包装）。
 * 声明侧用它给 `opts.throws` 标定错误品牌（如 `errBrand("TypeError")`）。
 */
export function errBrand(name: string): Abs {
  return errorTypeAbs(name);
}

const dummyBody = {
  type: "BlockStatement",
  body: [],
  directives: [],
} as never;

export function undef(): Abs {
  return makeAbs({ k: "unknown" }, termLit(undefined), undefined, "exact");
}

/**
 * null 叶子：formatShape 对 `{k:"unknown"} + lit null` 会渲染 `unknown`
 * （只特判 undefined）。用 brand `"null"` 让外延显示保持 `string | null`
 * 而不是 `string | unknown` — 不假精确，也不把推导失败当成 null。
 */
export function nullLit(): Abs {
  return makeAbs(
    { k: "brand", name: "null", shape: makeAbs({ k: "unknown" }, termLit(null), undefined, "exact") },
    termLit(null),
    undefined,
    "exact",
  );
}

export function anyAbs(): Abs {
  return makeAbs({ k: "any" }, undefined, undefined, "path");
}

/** Date/时刻叶子：stats 时间戳等。shape 带 getTime，format 只显示 `Date`。 */
export function dateAbs(): Abs {
  return brandOf("Date", objAbs({
    getTime: envFn([], num()),
    valueOf: envFn([], num()),
    toISOString: envFn([], str()),
  }));
}

/**
 * 开放对象（动态键映射，如 `process.env`）。
 * formatShape 只渲染 slots，空 slots 会显示 `{  }`；外层套 brand 让
 * leaf-clean 口径看见真实语义名，内部仍保留 open + index 值域。
 */
export function openObjBrand(
  name: string,
  index: { key: Abs; value: Abs },
  entries: Record<string, Abs | Slot> = {},
): Abs {
  const shape = {
    k: "obj" as const,
    slots: slotsOf(entries),
    open: true,
    index,
  };
  return makeAbs({ k: "brand", name, shape: makeAbs(shape, undefined, undefined, "exact") }, undefined, undefined, "path");
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

/**
 * env 造的 promise —— **带 rejected 通道**（族 29 · Bug 890）。
 *
 * 现象：env 声明的 promise **全部可以 reject**（`fs/promises.*` 的
 * ENOENT/EACCES、`fetch` 的网络错误、`crypto.subtle` 的 OperationError、
 * `navigator.clipboard` 的 NotAllowedError、`stream.pipeline` 的流错误、
 * `events.once` 的 error 事件…）。但旧实现造出的 promise **既无 `rejected`
 * 也无 `unsettled`** ⇒ core 的 `settledFulfilledOf`
 * （`packages/core/src/algebra/builtins/promise.ts`）读成「**确定 fulfilled**」
 * ⇒ `$await` 永不抛 ⇒ `try { … } catch (e) { … }` 的 **catch 臂被当成死代码**
 * ⇒ 引擎只折出 try 臂的返回值，给出**确定的错值**（原生走 catch 臂）。
 *
 * 修法：给 promise 带上 `rejected` 通道。**拒绝 reason 不可知** ⇒ 用
 * `unknown`（两臂均可能；core 的 `$await` 见
 * `packages/core/src/algebra/exec/runtime/async.ts`：拒绝臂进 throw 通道 ⇒
 * try/catch 可吸收 ⇒ catch 臂可达）。core 侧零改动。
 *
 * `rejected` 是**态信息**，不进 leq / 指纹 / check 等价。
 */
export function promiseOf(inner: Abs): Abs {
  return makeAbs(
    { k: "eff", eff: "promise", inner, rejected: unknown },
    undefined,
    undefined,
    "exact",
  );
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
 * - `...name` — rest slot; formatShape renders `...name: <type>`
 * - `name?`  — optional slot; formatShape renders `name?: <type>`
 *
 * Prefer `params.length === paramTypes.length` when paramTypes is present:
 * optional/rest slots still carry a type (unknown if needed) so hover shows
 * `ext?: string` rather than a bare `ext?`. Required arity is label-driven
 * (`requiredFnArity` skips `...` / `?`); `isRelFn` accepts equal lengths or
 * `paramTypes.length === required` when labels trail with markers.
 *
 * 族 29 S0：**apply 包装不再静默吞掉原生异常**——改走 core 既有的 throws
 * 通道（`makeAbsApplyResult`）。旧实现 `catch { return returnType }` 把
 * 「原生必抛」抹成「不抛」（假绿），是族 29 里 877/879/880/881/883/885 的
 * 共同根因。语义（core `routeApplyThrows`）：
 * - apply 返回裸 `Abs` / `undefined` ⇒ **不抛**。
 * - apply 返回 `AbsApplyResult` ⇒ 原样透传（保留声明方给的 throws 面）。
 * - apply **抛异常** ⇒ **may-throw**（`opts.throws` 优先，否则按 `e.name` 推）。
 */
export function envFn(
  paramTypes: Abs[],
  returnType: Abs,
  apply?: EnvApplyImpl,
  opts?: {
    params?: string[];
    conf?: Confidence;
    /** 仅声明、无 relation 应用时的 fingerprint 后缀 */
    name?: string;
    /** dual-facet 静态槽（Number.isFinite / Array.isArray） */
    slots?: Record<string, Abs | Slot>;
    /**
     * 构造器标记（issue #106）：JS 内建构造器（Error 族 / URL / EventEmitter /
     * stream 族…）声明为 true——`new X()` 不再记 unknown-constructibility
     * 假 may-throw，`class X extends EnvCtor` 定义期合法；非构造器全局
     * （parseInt 等）不设——`new parseInt()` 仍按不可构造执法。
     */
    ctor?: boolean;
    /**
     * throws 面（错误品牌 Abs，如 `errBrand("TypeError")`）。
     * apply 内原生抛异常时按此记 may-throw；缺省时按异常名推
     * `errBrand(e.name)`（非 Error ⇒ `errBrand("Error")`）。
     *
     * `DOMException` 的 `name` 是 `"InvalidCharacterError"`——**不是**标准
     * Error 名，故 `atob` / `btoa` 这类必须由声明侧显式传 `opts.throws`。
     *
     * 只在 **apply 分支**生效：无 apply 的 relation 面（core `relationFn`
     * 不带 throws 字段）没有 throws 通道——「宿主会抛但声明无 apply」的
     * 情形仍需 core 侧支持。
     */
    throws?: Abs;
    /**
     * 实参类型执法（opt-in，默认关）：实参与 `paramTypes[i]` 确定不符 ⇒
     * **必抛** TypeError；实参抽象（unknown / any / 非 exact）⇒ **may-throw**
     * TypeError。执法在调用 apply **之前**逐位进行。
     *
     * 判定用 `leqAbs(arg, paramType).ok`（「arg 可赋给 paramType」）。
     * `paramTypes[i] === prim.unknown` 时该判定恒 ok（「任何实参都符合」），
     * 但**抽象实参仍会记 may-throw** ⇒ 声明侧不应在 unknown 形参位上开
     * `enforceArgs`。
     */
    enforceArgs?: boolean;
    /**
     * `enforceArgs` 生效的最大形参位（**内部用**：变长参数只查 `required`
     * 段）。缺省 = 查满 `paramTypes`。
     */
    enforceArgsUpTo?: number;
  },
): Abs {
  const params =
    opts?.params ?? paramTypes.map((_, i) => (paramTypes.length === 1 && i === 0 ? "x" : `x${i}`));
  const staticSlots = opts?.slots ? slotsOf(opts.slots) : undefined;
  if (!apply) {
    const a = relationFn(paramTypes, returnType, {
      params,
      conf: opts?.conf ?? "exact",
      fingerprint: opts?.name
        ? `${opts.name}|${relationFingerprint(paramTypes, returnType)}`
        : undefined,
    });
    if (staticSlots) {
      a.shape = { ...(a.shape as { k: "fn"; params: string[] }), slots: staticSlots };
    }
    // relationFn 不承接 name——$new 的按名派发（evalBuiltinNew）与 $class
    // 的 super 链键都读 shape.name，此处补盖章（issue #106）
    if (opts?.name) {
      a.shape = { ...(a.shape as { k: "fn"; params: string[] }), name: opts.name };
    }
    if (opts?.ctor !== undefined) {
      a.shape = { ...(a.shape as { k: "fn"; params: string[] }), ctor: opts.ctor };
    }
    return a;
  }
  const implApply = apply;
  const declaredThrows = opts?.throws;
  const a = absFunction(params, {
    body: dummyBody,
    apply: (args: Abs[], thisVal?: Abs): Abs | AbsApplyResult => {
      // 实参类型执法（opt-in）：在调用 apply **之前**逐位判定。
      if (opts?.enforceArgs) {
        const guard = checkArgs(args, paramTypes, returnType, opts.enforceArgsUpTo);
        if (guard) return guard;
      }
      try {
        const r = implApply(args, thisVal);
        // undefined ⇒ 兜底 returnType（不抛）。
        if (r === undefined) return returnType;
        // 调用方自带 throws 面 ⇒ 原样透传（abs 面不被吞）。
        if (isAbsApplyResult(r)) return r;
        // 裸 Abs ⇒ 不抛。
        return r;
      } catch (e) {
        // 原生异常 ⇒ 记 may-throw（不再静默吞掉）。opts.throws 优先。
        return makeAbsApplyResult(returnType, declaredThrows ?? errBrand(errNameOf(e)));
      }
    },
  });
  a.shape = {
    k: "fn",
    params,
    paramTypes,
    returnType,
    ...(opts?.name ? { name: opts.name } : {}),
    ...(staticSlots ? { slots: staticSlots } : {}),
    ...(opts?.ctor !== undefined ? { ctor: opts.ctor } : {}),
  };
  if (opts?.conf && opts.conf !== "exact") a.conf = opts.conf;
  return a;
}

/**
 * 原生异常名（throws 面推断用）。
 * `DOMException` 的 `name` 是 `"InvalidCharacterError"`——**不是**标准 Error 名，
 * 故 `atob` / `btoa` 这类必须由声明侧显式传 `opts.throws`。
 */
function errNameOf(e: unknown): string {
  if (e instanceof Error && typeof e.name === "string" && e.name) return e.name;
  return "Error";
}

/**
 * 实参是否**抽象**（静态判不出类型 ⇒ 只能说「可能不符」）：
 * `unknown`（分析无信息）/ `any`（无约束值）/ 非 `exact` 置信度。
 */
function isAbstractArg(arg: Abs): boolean {
  return arg.shape.k === "unknown" || arg.shape.k === "any" || arg.conf !== "exact";
}

/**
 * 实参与形参声明的**不兼容程度**（族 29 主 agent 收口 · S3 越界发现的过严修正）：
 *
 * - `"none"`：全部兼容 ⇒ 不抛。
 * - `"some"`：**部分**分支不兼容 ⇒ 原生只在那些分支抛 ⇒ **may-throw**。
 * - `"all"`：全部分支都不兼容 ⇒ 原生**必定**抛 ⇒ **必抛**。
 *
 * 为什么需要逐成员（而不是直接 `leqAbs(arg, pt)`）：**并集实参**（如
 * `string | undefined`）整体 `leqAbs` 判 false（并集不是 string 的子类型），
 * 若据此判「确定不符 ⇒ 必抛」就是**偏严**（可能假红）——原生只在 undefined
 * 分支抛（如 `path.join(x)`，x 的类型是 `string | undefined`）⇒ 应是 may-throw。
 *
 * 逐成员判定让「必抛」只在**每个**分支都不兼容时成立 ⇒ 与原生同口径。
 */
function argIncompatibility(arg: Abs, pt: Abs): "none" | "some" | "all" {
  const members = arg.shape.k === "sum" ? arg.shape.members : [arg];
  if (members.length === 0) return "none";
  let bad = 0;
  for (const m of members) {
    if (!leqAbs(m, pt).ok) bad++;
  }
  if (bad === 0) return "none";
  return bad === members.length ? "all" : "some";
}

/**
 * 实参类型执法（`enforceArgs`）。
 *
 * **leqAbs 方向**：`leqAbs(src, tgt)` 判的是「**src 可赋给 tgt**」（src ≤ tgt，
 * 见 `packages/core/src/algebra/leq.ts` 头注释「src 可赋给 tgt」）。故
 * 「实参是否符合形参声明」= `leqAbs(arg, paramType).ok`。
 *
 * 判定顺序（先抽象、后确定不符——`leqAbs(unknown, string)` 判 **false**，
 * 若先判不符会把「判不出」误报成「确定不符」）：
 * 1. 实参缺失（少传参）⇒ 不判不符（原生多为 `undefined` 语义）。
 * 2. 实参抽象 ⇒ may-throw TypeError。
 * 3. 实参与 `paramTypes[i]` **全部**分支都不兼容 ⇒ **必抛** TypeError（abs 面 = never）。
 * 4. 实参**部分**分支不兼容（并集实参）⇒ may-throw TypeError。
 *
 * 3 优先于 2：只要有一位**确定**不符，原生调用就**必定**抛 TypeError
 * （与其它位是否抽象无关）⇒ always-throw 比 may-throw 更精确。
 *
 * `paramTypes[i] === prim.unknown` 时 `leqAbs(arg, unknown)` 恒 ok ⇒ 规则 3
 * 恒不触发（「任何实参都符合」）；但规则 2 仍按契约触发——`enforceArgs`
 * 是 opt-in 开关，声明侧不应在 unknown 形参位上开启它。
 *
 * @param upTo 最多检查前几段（变长参数只查 `required` 段；缺省查满）。
 * @returns undefined = 通过；否则返回带 throws 面的 AbsApplyResult。
 */
function checkArgs(
  args: Abs[],
  paramTypes: Abs[],
  returnType: Abs,
  upTo?: number,
): AbsApplyResult | undefined {
  const limit = Math.min(args.length, upTo ?? paramTypes.length);
  let abstract = false;
  for (let i = 0; i < limit; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    const pt = paramTypes[i];
    if (pt === undefined) continue;
    if (isAbstractArg(arg)) {
      abstract = true;
      continue;
    }
    const verdict = argIncompatibility(arg, pt);
    if (verdict === "all") {
      // 全部分支都不兼容 ⇒ 必抛 TypeError（abs 面 = never ⇒ core 抛 NudoThrow）。
      return makeAbsApplyResult(never, errBrand("TypeError"));
    }
    if (verdict === "some") {
      // 并集实参的部分分支不兼容 ⇒ 原生只在那些分支抛 ⇒ may-throw。
      abstract = true;
      continue;
    }
  }
  if (abstract) return makeAbsApplyResult(returnType, errBrand("TypeError"));
  return undefined;
}

/**
 * Variadic env fn (path.join / util.format / stream.pipeline).
 * `restType` is the element type of the trailing rest slot; optional
 * `required` prefix params stay required. formatShape shows `...restName`.
 *
 * `throws` / `enforceArgs` 透传给 `envFn`（变长参数的 `enforceArgs`
 * **只查 `required` 那几段**——rest 段类型由声明侧自行把关）。
 */
export function envFnVariadic(
  restType: Abs,
  returnType: Abs,
  opts?: {
    apply?: EnvApplyImpl;
    required?: Abs[];
    restName?: string;
    name?: string;
    /** throws 面（错误品牌 Abs，如 `errBrand("TypeError")`） */
    throws?: Abs;
    /** 实参类型执法（只查 `required` 段） */
    enforceArgs?: boolean;
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
    ...(opts?.throws ? { throws: opts.throws } : {}),
    ...(opts?.enforceArgs !== undefined
      ? { enforceArgs: opts.enforceArgs, enforceArgsUpTo: required.length }
      : {}),
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
