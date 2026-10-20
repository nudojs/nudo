/**
 * 可选链整链短路（expr 按域拆分之一；主分派在 ./transpile.ts）。
 *
 * 不变量：
 * - ES：a?.b.c ≡ a == null ? undefined : a.b.c——`?.` 命中 nullish 时
 *   **剩余整条链**（含非可选访问/调用）不再求值；
 * - 非 nullish 臂接收者先过 $removeNullish（issue #97）——假臂里已证非
 *   nullish，成员读不再记 may-throw；
 * - 位置插桩（$nodoPos）与 transpile.ts positionRecordWrap 同口径：静态
 *   属性记属性位、计算成员记表达式起始位；
 * - delete 链中缀含 call/invoke/invokeKey/len（不可删除目标的父链）→ undefined
 *   交消费方 unsupported；
 * - 计算键调用 hop（o[k]() / o?.[k]() / o[k]?.()）走 $invokeKey 保 this；
 * - 接收者经构造器注入而非文本替换（嵌套可选链 IIFE 的参数位不可盲替换，
 *   review Blocker 1）。
 */
import type { Expression, Node } from "@babel/types";
import type { TranspileOptions } from "../types.ts";
import { isExpression } from "../helpers.ts";
import { REGEX_STATEFUL_NAMES } from "../ops.ts";
import { emitTranspileExpression as transpileExpression } from "../transpile-dispatch.ts";
// --- 可选链整链短路 -------------------------------------------------------
// ES：`a?.b.c` ≡ `a == null ? undefined : a.b.c`——`?.` 命中 nullish 时
// **剩余整条链**（含非可选访问/调用）不得再求值。此前每跳独立 `$optionalGet`，
// 下一跳 `$get(undefined, "x")` 硬抛 TypeError。
export type ChainHop =
  | { kind: "get"; key: string; optional: boolean; posArg: string }
  | { kind: "idx"; keySrc: string; optional: boolean; posArg: string }
  | { kind: "len"; optional: boolean; posArg: string }
  | { kind: "call"; argsSrc: string; optional: boolean; locArg: string }
  | {
      kind: "invoke";
      method: string;
      argsSrc: string;
      locArg: string;
      /** `o?.m()`：接收者 nullish 短路 */
      recvOptional: boolean;
      /** `o.m?.()`：方法值 nullish 短路（this 仍绑 o） */
      fnOptional: boolean;
      /** 标识符 receiver（RegExp test/exec 的 lastIndex 写回目标） */
      recvName?: string;
    }
  | {
      kind: "invokeKey";
      /** 计算键源（运行时求值折叠槽名） */
      keySrc: string;
      argsSrc: string;
      locArg: string;
      /** `o?.[k]()`：接收者 nullish 短路 */
      recvOptional: boolean;
      /** `o[k]?.()`：方法值 nullish 短路（this 仍绑 o） */
      fnOptional: boolean;
    };

function isChainLink(n: { type?: string }): boolean {
  return (
    n.type === "MemberExpression" ||
    n.type === "OptionalMemberExpression" ||
    n.type === "CallExpression" ||
    n.type === "OptionalCallExpression"
  );
}

function linkIsOptional(n: { type?: string; optional?: boolean }): boolean {
  // Babel 用 OptionalMember/CallExpression 表达整条链，`optional: true` 只标
  // 当前这一跳的 `?.`。类型名不是判定依据。
  return n.optional === true;
}

/** 脊柱上任一跳 optional → 整链需短路编译 */
export function chainNeedsShortCircuit(n: Node): boolean {
  let cur = n as { type?: string; optional?: boolean; object?: Node; callee?: Node };
  while (isChainLink(cur)) {
    if (linkIsOptional(cur)) return true;
    cur = (cur.callee ?? cur.object) as typeof cur;
  }
  return false;
}

/** 链跳位置 posArg（hover 重放插桩——
 * `$nodoPos` 记录成员读结果的位置——
 * 静态属性记属性位、计算成员记表达式
 * 起始位，与 positionRecordWrap 同口
 * 径）；节点无 loc → 空串（不记录） */
function posArgOf(n: {
  loc?: { start: { line: number; column: number } } | null;
}): string {
  return n.loc ? `, ${n.loc.start.line}, ${n.loc.start.column}` : "";
}

/** 链跳结果的位置插桩包装（posArg
 * 空时直通——与 transpileExpression 的
 * recordPositions 门同语义：无收集器
 * 时 $nodoPos 运行时恒等直通） */
function posWrap(src: string, posArg: string): string {
  return posArg === "" ? src : `$nodoPos(${src}${posArg})`;
}

export function flattenChain(
  expr: Expression,
  opts: TranspileOptions,
): { baseSrc: string; hops: ChainHop[] } | undefined {
  const hops: ChainHop[] = [];
  let cur = expr as unknown as {
    type: string;
    optional?: boolean;
    object?: Node;
    callee?: Node;
    property?: Node;
    computed?: boolean;
    arguments?: unknown[];
    loc?: { start: { line: number; column: number } };
  };
  while (isChainLink(cur)) {
    const optional = linkIsOptional(cur);
    if (cur.type === "CallExpression" || cur.type === "OptionalCallExpression") {
      const args = (cur.arguments ?? [])
        .map((a) =>
          (a as { type?: string }).type === "SpreadElement"
            ? "$unknown()"
            : transpileExpression(a as Expression, opts),
        )
        .join(", ");
      const loc = cur.loc;
      const locArg = loc ? `, [${loc.start.line}, ${loc.start.column}]` : "";
      // obj.method(args) / obj?.method(args) / obj.method?.() —— $invoke 保 this
      // 字符串字面量计算键 `o["m"]()` 同走 invoke（this 仍绑 o；非链路径 $call 丢 this）
      const callee = cur.callee as typeof cur | undefined;
      const calleeProp = callee?.property as { type?: string; name?: string; value?: unknown; id?: { name?: string } } | undefined;
      const methodName: string | undefined =
        callee &&
        (callee.type === "MemberExpression" || callee.type === "OptionalMemberExpression")
          ? !callee.computed && calleeProp?.type === "Identifier"
            ? calleeProp.name
            : !callee.computed && calleeProp?.type === "PrivateName"
              // Bug 78：this.#m() → "#m" 混淆键（方法表同键注册）
              ? `#${calleeProp.id?.name ?? calleeProp.name ?? ""}` || undefined
              : callee.computed && calleeProp?.type === "StringLiteral"
                ? String(calleeProp.value)
                : callee.computed && calleeProp?.type === "NumericLiteral"
                  // Bug 60：c[1]() → ToPropertyKey("1") 方法名（键串行化注册）
                  ? String(calleeProp.value)
                  : undefined
          : undefined;
      if (callee && methodName !== undefined) {
        const recvNode = callee.object as { type?: string; name?: string } | undefined;
        hops.unshift({
          kind: "invoke",
          method: JSON.stringify(methodName),
          argsSrc: `[${args}]`,
          locArg,
          recvOptional: linkIsOptional(callee),
          fnOptional: linkIsOptional(cur),
          recvName:
            recvNode?.type === "Identifier" && recvNode.name ? recvNode.name : undefined,
        });
        cur = callee.object as typeof cur;
        continue;
      }
      // 计算非字面量键调用（o[k]() / o?.[k]() / o[k]?.()）→ invokeKey hop：
      // $invokeKey 保接收者（键运行时折叠槽名 + $invoke 派发）；此前落
      // {kind:"call"} hop → $callNamed("call", $idx(o,k), …) 丢 this → 假
      // never。super 接收者不在此列（链遇 Super 整体放弃，super[k]() 走
      // call.ts 的 $invokeSuperKey 专用分支）。
      {
        const calleeComputed = callee?.computed === true;
        const calleeKey = calleeComputed ? callee?.property : undefined;
        if (
          callee &&
          callee.object &&
          (callee.type === "MemberExpression" || callee.type === "OptionalMemberExpression") &&
          callee.object.type !== "Super" &&
          isExpression(calleeKey as Node)
        ) {
          hops.unshift({
            kind: "invokeKey",
            keySrc: transpileExpression(calleeKey as Expression, opts),
            argsSrc: `[${args}]`,
            locArg,
            recvOptional: linkIsOptional(callee),
            fnOptional: linkIsOptional(cur),
          });
          cur = callee.object as typeof cur;
          continue;
        }
      }
      hops.unshift({ kind: "call", argsSrc: `[${args}]`, optional: linkIsOptional(cur), locArg });
      cur = (cur.callee ?? cur.object) as typeof cur;
      continue;
    }
    // member
    const optionalM = optional;
    if (cur.computed) {
      const key = cur.property as { type?: string; value?: unknown };
      // 计算成员：记表达式起始位（与 positionRecordWrap 同口径）
      if (key?.type === "StringLiteral") {
        hops.unshift({ kind: "get", key: JSON.stringify(key.value), optional: optionalM, posArg: posArgOf(cur) });
      } else if (key?.type === "NumericLiteral") {
        hops.unshift({ kind: "idx", keySrc: `$lit(${key.value})`, optional: optionalM, posArg: posArgOf(cur) });
      } else if (isExpression(cur.property as Node)) {
        hops.unshift({
          kind: "idx",
          keySrc: transpileExpression(cur.property as Expression, opts),
          optional: optionalM,
          posArg: posArgOf(cur),
        });
      } else {
        return undefined;
      }
      cur = cur.object as typeof cur;
      continue;
    }
    const prop = cur.property as {
      type?: string;
      name?: string;
      loc?: { start: { line: number; column: number } } | null;
    };
    if (prop?.type !== "Identifier") return undefined;
    // 静态属性：记属性位（hover 属性名直读槽位 Abs）
    if (prop.name === "length") {
      hops.unshift({ kind: "len", optional: optionalM, posArg: posArgOf(prop) });
    } else {
      hops.unshift({ kind: "get", key: JSON.stringify(prop.name), optional: optionalM, posArg: posArgOf(prop) });
    }
    cur = cur.object as typeof cur;
  }
  if (cur.type === "Super") return undefined; // super 链走专用路径
  const baseSrc = isExpression(cur as unknown as Node)
    ? transpileExpression(cur as unknown as Expression, opts)
    : undefined;
  if (baseSrc === undefined) return undefined;
  return { baseSrc, hops };
}

function emitChainFrom(hops: ChainHop[], i: number, valSrc: string): string {
  if (i >= hops.length) return valSrc;
  const hop = hops[i]!;
  const rest = (recv: string): string => emitChainFrom(hops, i + 1, recv);
  switch (hop.kind) {
    case "get":
      // 可选跳的非 nullish 臂：?. 守卫已排除 nullish，对非 nullish 值的属性读
      // 原生不抛 → silent（不记 any may-throw，Bug 3）。链上后续跳仍走 $get
      //（x?.a.b 的 .b 保持 may-throw）。
      return hop.optional
        ? shortCircuitHop(valSrc, (r) => posWrap(`$get(${r}, ${hop.key}, { silent: true })`, hop.posArg), hops, i)
        : rest(posWrap(`$get(${valSrc}, ${hop.key})`, hop.posArg));
    case "idx":
      return hop.optional
        ? shortCircuitHop(valSrc, (r) => posWrap(`$idx(${r}, ${hop.keySrc}, { silent: true })`, hop.posArg), hops, i)
        : rest(posWrap(`$idx(${valSrc}, ${hop.keySrc})`, hop.posArg));
    case "len":
      // 可选跳（a?.length）：nullish 已由守卫臂剪除；any 不记 may-throw
      //（Bug 3，与 get/idx 跳同口径）。非可选 `.length` 走 $len 守卫诊断。
      return hop.optional
        ? shortCircuitHop(valSrc, (r) => posWrap(`$len(${r}, { silent: true })`, hop.posArg), hops, i)
        : rest(posWrap(`$len(${valSrc})`, hop.posArg));
    case "call":
      return hop.optional
        ? shortCircuitHop(valSrc, (r) => `$callNamed("call", ${r}, ${hop.argsSrc}${hop.locArg})`, hops, i)
        : rest(`$callNamed("call", ${valSrc}, ${hop.argsSrc}${hop.locArg})`);
    case "invoke": {
      const invokeOf = (recv: string, fnCheck: boolean): string => {
        let call = `$invoke(${recv}, ${hop.method}, ${hop.argsSrc}${hop.locArg})`;
        // RegExp test/exec 的 lastIndex 写回：与非链路径同口径（receiver 为标识符时
        // 表达式内联 IIFE）。漏掉会让 `r.exec(s)?.[0]` 不推进 lastIndex。
        // Bug 171：实参**只求值一次**——argsSrc 同一份数组字面量内联进 $invoke
        // 与 $reStateCall 两处会让实参表达式跑两遍（副作用翻倍）；改为先物化
        // 成 __a，两个通道共用同一份值。
        const rawMethod = JSON.parse(hop.method) as string;
        if (hop.recvName && REGEX_STATEFUL_NAMES.has(rawMethod)) {
          call = `(() => { const __nudoReArgs = ${hop.argsSrc}; const __v = $invoke(${recv}, ${hop.method}, __nudoReArgs${hop.locArg}); ${hop.recvName} = $reStateCall(${hop.recvName}, ${hop.method}, __nudoReArgs); return __v; })()`;
        }
        if (!fnCheck) return call;
        // o.m?.()：方法值 nullish 短路；this 仍绑 recv（$invoke 二次 get 方法属已知
        // 取舍——保 builtin 派发，getter 会跑两遍）
        return `(($__fn) => $fork($nullishTest($__fn), () => $lit(void 0), () => ${call}))($get(${recv}, ${hop.method}))`;
      };
      if (hop.recvOptional) {
        return shortCircuitHop(valSrc, (r) => invokeOf(r, hop.fnOptional), hops, i);
      }
      return rest(invokeOf(valSrc, hop.fnOptional));
    }
    case "invokeKey": {
      // 计算键调用：$invokeKey 保 this；fnOptional（o[k]?.()）的方法值
      // nullish 检查读 $idx(recv, key)——计算键无静态名（$get 不可用）。
      // 键/接收者源文本内联两次与 invoke hop 的 fnCheck 同取舍（保派发，
      // 副作用键表达式会跑两遍）。
      const invokeOf = (recv: string, fnCheck: boolean): string => {
        const call = `$invokeKey(${recv}, ${hop.keySrc}, ${hop.argsSrc}${hop.locArg})`;
        if (!fnCheck) return call;
        return `(($__fn) => $fork($nullishTest($__fn), () => $lit(void 0), () => ${call}))($idx(${recv}, ${hop.keySrc}))`;
      };
      if (hop.recvOptional) {
        return shortCircuitHop(valSrc, (r) => invokeOf(r, hop.fnOptional), hops, i);
      }
      return rest(invokeOf(valSrc, hop.fnOptional));
    }
  }
}

/** 可选跳：valSrc nullish → 剩余链短路 undefined；否则从 pruned 接收者继续。
 *  非 nullish 臂的接收者先过 $removeNullish（issue #97）——`p?.major` 的
 *  假臂里 p 已证非 nullish，sum 的 null/undefined 臂剪除后成员读不再记
 *  may-throw、不触发 nullish 硬抛。
 *  接收者经构造器注入（非占位符文本替换）——appliedOf 内的实参/计算键
 *  子表达式可能嵌套自建 `$__oc` 绑定的可选链 IIFE，盲替换会把嵌套 IIFE
 *  的参数位改成 (($removeNullish($__oc)) => …) 产生非法箭头参数（review
 *  Blocker 1：`a?.b(c?.d)` 整模块 new Function SyntaxError fail-closed）。 */
function shortCircuitHop(
  valSrc: string,
  appliedOf: (recv: string) => string,
  hops: ChainHop[],
  i: number,
): string {
  const applied = appliedOf("$removeNullish($__oc)");
  return `(($__oc) => $fork($nullishTest($__oc), () => $lit(void 0), () => ${emitChainFrom(hops, i + 1, applied)}))(${valSrc})`;
}

/**
 * Bug 60：可选链 delete 的链式发射（delete o?.a / delete o.a?.b / delete
 * o?.[k]）。与读链（emitChainFrom）同构，差异两处：
 * - 任一 optional 跳命中 nullish → 短路臂返回 **true**（delete 表达式值），
 *   不是 undefined；
 * - 最后一跳（get/idx）发射 delete 的**求值点自包含**形态（delOpSrc）而非
 *   $get/$idx。
 * 中缀含 call/invoke/len（不可删除目标的父链）→ undefined（调用方 unsupported）。
 */

/**
 * delete 的求值点自包含形态（Bug 176）：父对象与键各只求值一次，删除
 * （$del）与布尔值（$delRes）**同点**产出 ⇒ 同一条表达式里排在 delete
 * 之后的读看到变更后的状态。Proxy 陷阱派发唯一在 $delRes（Bug 172）⇒
 * 陷阱恰好一次。
 */
function delOpSrc(parentSrc: string, keySrc: string): string {
  return `(() => { const __nudoDelP = ${parentSrc}; const __nudoDelK = ${keySrc}; $del(__nudoDelP, __nudoDelK); return $delRes(__nudoDelP, __nudoDelK); })()`;
}
export function emitDeleteChainFrom(hops: ChainHop[], i: number, valSrc: string): string | undefined {
  if (i >= hops.length) return undefined;
  const hop = hops[i]!;
  const isLast = i === hops.length - 1;
  const delShortCircuit = (recv: string, body: string): string =>
    `((__oc) => $fork($nullishTest(__oc), () => $lit(true), () => ${body}))(${recv})`;
  if (hop.kind === "get") {
    if (isLast) {
      return hop.optional
        ? delShortCircuit(valSrc, delOpSrc(`$removeNullish(__oc)`, hop.key))
        : delOpSrc(valSrc, hop.key);
    }
    if (hop.optional) {
      const rest = emitDeleteChainFrom(hops, i + 1, `$get($removeNullish(__oc), ${hop.key})`);
      return rest === undefined ? undefined : delShortCircuit(valSrc, rest);
    }
    return emitDeleteChainFrom(hops, i + 1, `$get(${valSrc}, ${hop.key})`);
  }
  if (hop.kind === "idx") {
    if (isLast) {
      return hop.optional
        ? delShortCircuit(valSrc, delOpSrc(`$removeNullish(__oc)`, hop.keySrc))
        : delOpSrc(valSrc, hop.keySrc);
    }
    if (hop.optional) {
      const rest = emitDeleteChainFrom(hops, i + 1, `$idx($removeNullish(__oc), ${hop.keySrc})`);
      return rest === undefined ? undefined : delShortCircuit(valSrc, rest);
    }
    return emitDeleteChainFrom(hops, i + 1, `$idx(${valSrc}, ${hop.keySrc})`);
  }
  return undefined; // call/invoke/invokeKey/len 中缀：delete 目标父链不可发射
}

/** 若 expr 是含 `?.` 的成员/调用脊柱，返回整链短路源码 */
export function tryTranspileOptionalChain(expr: Expression, opts: TranspileOptions): string | undefined {
  const t = (expr as { type?: string }).type;
  if (
    t !== "MemberExpression" &&
    t !== "OptionalMemberExpression" &&
    t !== "CallExpression" &&
    t !== "OptionalCallExpression"
  ) {
    return undefined;
  }
  if (!chainNeedsShortCircuit(expr as Node)) return undefined;
  const flat = flattenChain(expr, opts);
  if (!flat) return undefined;
  return emitChainFrom(flat.hops, 0, flat.baseSrc);
}
