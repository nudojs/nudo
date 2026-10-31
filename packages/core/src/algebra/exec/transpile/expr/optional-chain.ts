/**
 * 可选链整链短路（expr 按域拆分之一；主分派在 ./transpile.ts）。
 *
 * 不变量：
 * - ES：a?.b.c ≡ a == null ? undefined : a.b.c——`?.` 命中 nullish 时
 *   **剩余整条链**（含非可选访问/调用）不再求值；
 * - 调用跳（`o.b?.()`）的 nullish 短路同口径：整链短路 undefined，剩余跳
 *   不再求值/不抛（Bug 187）——短路臂之外不留剩余链；
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
import { isExpression, internalTmpNameSet } from "../helpers.ts";
import { REGEX_STATEFUL_NAMES } from "../ops.ts";
import { emitTranspileExpression as transpileExpression } from "../transpile-dispatch.ts";
import { emitArgList } from "../call-args.ts";
import { emitMemberKey } from "../member-key.ts";

/**
 * Bug 1149：可选链族的引擎内部临时名（**基名**）——实际名经
 * `internalTmpNameSet` 分配（避开用户标识符词形）。
 *
 * 这些名都是**词法绑定**（IIFE 形参 / IIFE 内 `const` 载体），而 IIFE
 * **在自身作用域里求值用户表达式**（接收者剪枝源 / 计算键 / 实参 / 删除键 /
 * proto 值）⇒ 写死名会与用户同名绑定相撞：
 * - **遮蔽**：IIFE 形参 `__oc` / `__nudoDelK` / `__k` 等遮蔽用户同名外层
 *   绑定 ⇒ 用户表达式读到**引擎临时量**（自信错值 ⇒ 签名面写错 ⇒ 假绿）；
 * - **TDZ ReferenceError**：用户表达式读到的同名绑定正处在引擎临时量的
 *   初始化器内（`const __nudoReArgs = (用户实参)` / `const __nudoDelK = (键)`）
 *   ⇒ ReferenceError（可被用户自己的 catch 吞掉 ⇒ 错值）。
 *
 * 口径同 Bug 1058/1059 / 1127 / 1146（`userIdentInfoOf(opts)` = 源文本词形
 * ∪ `opts.userIdents`；撞名加 `_k` 后缀）⇒ **无碰撞时基名原样返回 ⇒ 产物
 * 逐字不变**；同一源文本 ⇒ 同一名 ⇒ 产物确定性。
 */
const OC_BASE = "$__oc";
const FN_BASE = "$__fn";
const DEL_OC_BASE = "__oc";
const DEL_P_BASE = "__nudoDelP";
const DEL_K_BASE = "__nudoDelK";
const DEL_N_BASE = "__nudoDelN";
const DEL_R_BASE = "__nudoDelR";
const RE_ARGS_BASE = "__nudoReArgs";
const RE_RES_BASE = "__v";

/** 一条链的引擎内部临时名（实际名） */
type ChainTmpNames = {
  /** 读链守卫基绑定（IIFE 形参） */
  oc: string;
  /** 调用跳方法值守卫基绑定（IIFE 形参） */
  fn: string;
  /** delete 链守卫基绑定（IIFE 形参） */
  delOc: string;
  /** delete 父对象载体 */
  delP: string;
  /** delete 键载体 */
  delK: string;
  /** delete 新父对象载体（写回用） */
  delN: string;
  /** delete 布尔结果载体 */
  delR: string;
  /** 正则状态写回：实参数组载体 */
  reArgs: string;
  /** 正则状态写回：结果载体 */
  reRes: string;
};

/** 未登记时的兜底（基名原样——正常路径恒经 flattenChain 登记） */
const DEFAULT_CHAIN_TMP: ChainTmpNames = {
  oc: OC_BASE,
  fn: FN_BASE,
  delOc: DEL_OC_BASE,
  delP: DEL_P_BASE,
  delK: DEL_K_BASE,
  delN: DEL_N_BASE,
  delR: DEL_R_BASE,
  reArgs: RE_ARGS_BASE,
  reRes: RE_RES_BASE,
};

/**
 * 链级临时名登记表（按 hops 数组登记）。
 *
 * `emitDeleteChainFrom` 的入参只有 hops（调用方 operators.ts 不传 opts）⇒
 * 用登记表把 `flattenChain` 分配的避让名传下去；同一 hops 数组 ⇒ 同一组名
 * （嵌套链各级共用同一组名——各自的 IIFE 形参作用域独立，语义不变）。
 */
const chainTmpNames = new WeakMap<ChainHop[], ChainTmpNames>();

/** 链级临时名分配（避让口径同 Bug 1058/1059 / 1127 / 1146） */
function allocChainTmpNames(opts: TranspileOptions): ChainTmpNames {
  const n = internalTmpNameSet(
    [OC_BASE, FN_BASE, DEL_OC_BASE, DEL_P_BASE, DEL_K_BASE, DEL_N_BASE, DEL_R_BASE, RE_ARGS_BASE, RE_RES_BASE],
    opts,
  );
  return {
    oc: n[0]!,
    fn: n[1]!,
    delOc: n[2]!,
    delP: n[3]!,
    delK: n[4]!,
    delN: n[5]!,
    delR: n[6]!,
    reArgs: n[7]!,
    reRes: n[8]!,
  };
}

/** 取链级临时名（未登记 ⇒ 兜底基名） */
function tmpNamesOf(hops: ChainHop[]): ChainTmpNames {
  return chainTmpNames.get(hops) ?? DEFAULT_CHAIN_TMP;
}

// --- 可选链整链短路 -------------------------------------------------------
// ES：`a?.b.c` ≡ `a == null ? undefined : a.b.c`——`?.` 命中 nullish 时
// **剩余整条链**（含非可选访问/调用）不得再求值。此前每跳独立 `$optionalGet`，
// 下一跳 `$get(undefined, "x")` 硬抛 TypeError。
export type ChainHop =
  | {
      kind: "get";
      key: string;
      optional: boolean;
      posArg: string;
      /** 符号投影键：读面带 symbolKey 标记；delKeySrc 是 $del 的 Abs 键源 */
      symbolKey?: boolean;
      delKeySrc?: string;
    }
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
      const args = emitArgList(cur.arguments ?? [], opts);
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
    const memberKey = emitMemberKey(
      cur.property as Node,
      cur.computed === true,
      opts,
    );
    if (memberKey === null) return undefined;
    if (
      !cur.computed &&
      cur.property?.type === "Identifier" &&
      cur.property.name === "length"
    ) {
      hops.unshift({ kind: "len", optional: optionalM, posArg: posArgOf(cur.property) });
    } else if (memberKey.kind === "get") {
      hops.unshift({
        kind: "get",
        key: JSON.stringify(memberKey.key),
        optional: optionalM,
        // 静态属性记属性位；计算成员记表达式起始位（与 positionRecordWrap 同口径）
        posArg: posArgOf(!cur.computed ? (cur.property as Node) : (cur as Node)),
        ...(memberKey.symbol !== undefined
          ? {
              symbolKey: true,
              // delete 的键要运行时真 symbol（$del 收 Abs 键），读侧用 "@@X"
              delKeySrc: `$get(Symbol, ${JSON.stringify(memberKey.symbol)})`,
            }
          : { delKeySrc: `$lit(${JSON.stringify(memberKey.key)})` }),
      });
    } else {
      hops.unshift({
        kind: "idx",
        keySrc: memberKey.keySrc,
        optional: optionalM,
        posArg: posArgOf(cur),
      });
    }
    cur = cur.object as typeof cur;
  }
  if (cur.type === "Super") return undefined; // super 链走专用路径
  const baseSrc = isExpression(cur as unknown as Node)
    ? transpileExpression(cur as unknown as Expression, opts)
    : undefined;
  if (baseSrc === undefined) return undefined;
  // Bug 1149：登记链级引擎内部临时名（避开用户标识符词形）——emitChainFrom /
  // emitDeleteChainFrom 都按 hops 取同一组名。
  chainTmpNames.set(hops, allocChainTmpNames(opts));
  return { baseSrc, hops };
}

function emitChainFrom(hops: ChainHop[], i: number, valSrc: string): string {
  if (i >= hops.length) return valSrc;
  const hop = hops[i]!;
  // Bug 1149：引擎内部临时名（守卫基绑定 / 正则载体）避开用户标识符词形。
  const tmp = tmpNamesOf(hops);
  const rest = (recv: string): string => emitChainFrom(hops, i + 1, recv);
  switch (hop.kind) {
    case "get": {
      // 可选跳的非 nullish 臂：?. 守卫已排除 nullish，对非 nullish 值的属性读
      // 原生不抛 → silent（不记 any may-throw，Bug 3）。链上后续跳仍走 $get
      //（x?.a.b 的 .b 保持 may-throw）。
      // 符号投影键与非链路径同口径带 symbolKey 标记（Proxy 陷阱边界还原）。
      const getOpts = (silent: boolean): string => {
        const parts = [
          silent ? "silent: true" : null,
          hop.symbolKey ? "symbolKey: true" : null,
        ].filter((x): x is string => x !== null);
        return parts.length === 0 ? "" : `, { ${parts.join(", ")} }`;
      };
      return hop.optional
        ? shortCircuitHop(valSrc, (r) => posWrap(`$get(${r}, ${hop.key}${getOpts(true)})`, hop.posArg), hops, i, tmp.oc)
        : rest(posWrap(`$get(${valSrc}, ${hop.key}${getOpts(false)})`, hop.posArg));
    }
    case "idx":
      return hop.optional
        ? shortCircuitHop(valSrc, (r) => posWrap(`$idx(${r}, ${hop.keySrc}, { silent: true })`, hop.posArg), hops, i, tmp.oc)
        : rest(posWrap(`$idx(${valSrc}, ${hop.keySrc})`, hop.posArg));
    case "len":
      // 可选跳（a?.length）：nullish 已由守卫臂剪除；any 不记 may-throw
      //（Bug 3，与 get/idx 跳同口径）。非可选 `.length` 走 $len 守卫诊断。
      return hop.optional
        ? shortCircuitHop(valSrc, (r) => posWrap(`$len(${r}, { silent: true })`, hop.posArg), hops, i, tmp.oc)
        : rest(posWrap(`$len(${valSrc})`, hop.posArg));
    case "call":
      return hop.optional
        ? shortCircuitHop(valSrc, (r) => `$callNamed("call", ${r}, ${hop.argsSrc}${hop.locArg})`, hops, i, tmp.oc)
        : rest(`$callNamed("call", ${valSrc}, ${hop.argsSrc}${hop.locArg})`);
    case "invoke": {
      // 调用体（this 绑 recv）。
      const callOf = (recv: string, preRead?: string): string => {
        // 实参 thunk：成员读（$invoke 预读）先于实参求值，与非链路径
        // Bug 152 同口径。spread 已由 emitArgList 展开成 ...$elems(...)。
        // BUG-216：fnOptional 臂已先读一次方法值（nullish 判定）——把该值
        // 作为 preRead 传给 $invoke，派发复用它（有状态 getter 只跑一次；
        // 此前 $get + $invoke 各读一次 ⇒ 返回值取第二轮）。
        const tail = preRead === undefined ? hop.locArg : `${hop.locArg || ", undefined"}, ${preRead}`;
        let call = `$invoke(${recv}, ${hop.method}, () => ${hop.argsSrc}${tail})`;
        // RegExp test/exec 的 lastIndex 写回：与非链路径同口径（receiver 为标识符时
        // 表达式内联 IIFE）。漏掉会让 `r.exec(s)?.[0]` 不推进 lastIndex。
        // 实参只求值一次：thunk 内把实参数组挂到盒子上，$invoke 与
        // $reStateCall 消费同一份值。
        const rawMethod = JSON.parse(hop.method) as string;
        if (hop.recvName && REGEX_STATEFUL_NAMES.has(rawMethod)) {
          call = `(() => { const ${tmp.reArgs} = {}; const ${tmp.reRes} = $invoke(${recv}, ${hop.method}, () => (${tmp.reArgs}._a = ${hop.argsSrc})${tail}); $reStateCall(${hop.recvName}, ${hop.method}, ${tmp.reArgs}._a); return ${tmp.reRes}; })()`;
        }
        return call;
      };
      // 剩余链的接收者 = 调用结果——调用体包一层 IIFE，惰性求值于 else 臂内
      // （无剩余链时不包：保持既有发射形态不变）。
      const contOf = (recv: string, preRead?: string): string =>
        i + 1 < hops.length ? rest(`(() => ${callOf(recv, preRead)})()`) : callOf(recv, preRead);
      if (hop.fnOptional) {
        // o.m?.()：方法值 nullish 短路；this 仍绑 recv。BUG-216：读出的
        // 方法值经 preRead 交给派发 ⇒ **一次 Get**（宿主语义；有状态 getter
        // 不再被读两遍）。
        // Bug 187：ES 的可选链短路是**整链**语义——方法值 nullish 时整条链
        // 求值为 undefined，剩余跳（`o.b?.().c` 的 `.c`）**不再求值/不抛**。
        // 故短路臂发 undefined，剩余链整体搬进 else 臂（接收者 = 调用结果）。
        const fnFork = (recv: string): string =>
          `((${tmp.fn}) => $fork($nullishTest(${tmp.fn}), () => $lit(void 0), () => ${contOf(recv, tmp.fn)}))($get(${recv}, ${hop.method}))`;
        if (hop.recvOptional) {
          // 接收者 nullish 亦整链短路：外层 fork 承载（内层 fn fork 在其 else 臂内）
          return `((${tmp.oc}) => $fork($nullishTest(${tmp.oc}), () => $lit(void 0), () => ${fnFork(`$removeNullish(${tmp.oc})`)}))(${valSrc})`;
        }
        return fnFork(valSrc);
      }
      if (hop.recvOptional) {
        return shortCircuitHop(valSrc, (r) => callOf(r), hops, i, tmp.oc);
      }
      return rest(callOf(valSrc));
    }
    case "invokeKey": {
      // 计算键调用：$invokeKey 保 this；fnOptional（o[k]?.()）的方法值
      // nullish 检查读 $idx(recv, key)——计算键无静态名（$get 不可用）。
      // 键/接收者源文本内联两次与 invoke hop 的 fnCheck 同取舍（保派发，
      // 副作用键表达式会跑两遍）。
      const callOf = (recv: string, preRead?: string): string =>
        `$invokeKey(${recv}, ${hop.keySrc}, () => ${hop.argsSrc}${preRead === undefined ? hop.locArg : `${hop.locArg || ", undefined"}, ${preRead}`})`;
      const contOf = (recv: string, preRead?: string): string =>
        i + 1 < hops.length ? rest(`(() => ${callOf(recv, preRead)})()`) : callOf(recv, preRead);
      if (hop.fnOptional) {
        // 同 invoke hop（Bug 187）：方法值 nullish → 整链短路，剩余链进 else 臂。
        // BUG-216：已读出的方法值经 preRead 复用（一次 Get）。
        const fnFork = (recv: string): string =>
          `((${tmp.fn}) => $fork($nullishTest(${tmp.fn}), () => $lit(void 0), () => ${contOf(recv, tmp.fn)}))($idx(${recv}, ${hop.keySrc}))`;
        if (hop.recvOptional) {
          return `((${tmp.oc}) => $fork($nullishTest(${tmp.oc}), () => $lit(void 0), () => ${fnFork(`$removeNullish(${tmp.oc})`)}))(${valSrc})`;
        }
        return fnFork(valSrc);
      }
      if (hop.recvOptional) {
        return shortCircuitHop(valSrc, (r) => callOf(r), hops, i, tmp.oc);
      }
      return rest(callOf(valSrc));
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
  ocName: string,
): string {
  const applied = appliedOf(`$removeNullish(${ocName})`);
  return `((${ocName}) => $fork($nullishTest(${ocName}), () => $lit(void 0), () => ${emitChainFrom(hops, i + 1, applied)}))(${valSrc})`;
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
 *
 * Bug 1149：父对象/键载体名避开用户标识符词形——本 IIFE **在自身作用域里
 * 求值父对象与键表达式** ⇒ 写死名会遮蔽用户同名绑定（自信错值）或撞 TDZ
 * （ReferenceError）。
 */
function delOpSrc(
  parentSrc: string,
  keySrc: string,
  tmp: ChainTmpNames,
  writeback?: (newParentSrc: string) => string,
): string {
  if (!writeback) {
    return `(() => { const ${tmp.delP} = ${parentSrc}; const ${tmp.delK} = ${keySrc}; $del(${tmp.delP}, ${tmp.delK}); return $delRes(${tmp.delP}, ${tmp.delK}); })()`;
  }
  // 可选链删除与非可选成员删除同口径：$del 产出新父对象后必须写回持有者
  // 路径（const 函数根例外——不重绑根）。写回在 $delRes 之后，Proxy 的
  // deleteProperty 陷阱仍只经 $delRes 派发一次。
  return `(() => { const ${tmp.delP} = ${parentSrc}; const ${tmp.delK} = ${keySrc}; const ${tmp.delN} = $del(${tmp.delP}, ${tmp.delK}); const ${tmp.delR} = $delRes(${tmp.delP}, ${tmp.delK}); ${writeback(tmp.delN)} return ${tmp.delR}; })()`;
}
export function emitDeleteChainFrom(
  hops: ChainHop[],
  i: number,
  valSrc: string,
  writeback?: (newParentSrc: string) => string,
): string | undefined {
  if (i >= hops.length) return undefined;
  const hop = hops[i]!;
  // Bug 1149：delete 链的引擎内部临时名（守卫基绑定 / 父对象载体 / 键载体）
  // 避开用户标识符词形（登记于 flattenChain ⇒ 与读链同源同组名）。
  const tmp = tmpNamesOf(hops);
  const isLast = i === hops.length - 1;
  const delShortCircuit = (recv: string, body: string): string =>
    `((${tmp.delOc}) => $fork($nullishTest(${tmp.delOc}), () => $lit(true), () => ${body}))(${recv})`;
  if (hop.kind === "get") {
    const delKey = hop.delKeySrc ?? `$lit(${hop.key})`;
    const readOpts = hop.symbolKey ? ", { symbolKey: true }" : "";
    if (isLast) {
      return hop.optional
        ? delShortCircuit(valSrc, delOpSrc(`$removeNullish(${tmp.delOc})`, delKey, tmp, writeback))
        : delOpSrc(valSrc, delKey, tmp, writeback);
    }
    if (hop.optional) {
      const rest = emitDeleteChainFrom(
        hops,
        i + 1,
        `$get($removeNullish(${tmp.delOc}), ${hop.key}${readOpts})`,
        writeback,
      );
      return rest === undefined ? undefined : delShortCircuit(valSrc, rest);
    }
    return emitDeleteChainFrom(hops, i + 1, `$get(${valSrc}, ${hop.key}${readOpts})`, writeback);
  }
  if (hop.kind === "idx") {
    if (isLast) {
      return hop.optional
        ? delShortCircuit(valSrc, delOpSrc(`$removeNullish(${tmp.delOc})`, hop.keySrc, tmp, writeback))
        : delOpSrc(valSrc, hop.keySrc, tmp, writeback);
    }
    if (hop.optional) {
      const rest = emitDeleteChainFrom(
        hops,
        i + 1,
        `$idx($removeNullish(${tmp.delOc}), ${hop.keySrc})`,
        writeback,
      );
      return rest === undefined ? undefined : delShortCircuit(valSrc, rest);
    }
    return emitDeleteChainFrom(hops, i + 1, `$idx(${valSrc}, ${hop.keySrc})`, writeback);
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
