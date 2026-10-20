/**
 * $fork 短路协议发射（expr 按域拆分之一；主分派在 ./transpile.ts）。
 *
 * 不变量：
 * - 臂内有数组 mutator / 守卫名写时必须走绑定-join 协议（forkArmThunk +
 *   forkBindingDecls + forkJoinBindings）——嵌套直接求值会撕裂 mutator 写回；
 * - 守卫臂剪影（nullish/typeof/判别等值/关系）统一经 stmt-predicates，与
 *   stmt.ts IfStatement 同源；守卫名在 fork 绑定集时跳过（影子参数会吞掉
 *   臂内写）；
 * - 无 mutator 绑定时保持简单 $fork 形态（__test 槽位回填，既有输出面）。
 */
import type { Node } from "@babel/types";
import type { TranspileOptions } from "../types.ts";
import type { DiscriminantGuard, NullishGuard, TypeGuard, RelGuard } from "../stmt-predicates.ts";
import {
  narrowNullishArmThunks,
  narrowTypeArmThunk,
  nullishRemoveCallOf,
  narrowDiscriminantArmThunks,
  narrowRelArmThunk,
} from "../stmt-predicates.ts";
import { collectForkBindingNames } from "../helpers.ts";
import { emitArrMutatorRebinds, forkArmThunk, forkBindingDecls, forkJoinBindings } from "../emit.ts";

/**
 * 左操作数是否可能带副作用（getter / 调用 / 计算键 / 自增 …）——这类左
 * 操作数必须**单次求值**（绑到临时量），不得在测试与臂里各发一份源码。
 * 纯左（标识符 / 字面量 / this）重复读不可观测，保持原形态。
 */
function leftIsImpure(node: Node | null | undefined): boolean {
  if (!node) return false;
  switch (node.type) {
    case "Identifier":
    case "ThisExpression":
    case "NumericLiteral":
    case "StringLiteral":
    case "BooleanLiteral":
    case "NullLiteral":
    case "BigIntLiteral":
      return false;
    default:
      return true;
  }
}
export function transpileShortCircuitExpr(opts: TranspileOptions, parts: {
  alwaysNodes: Array<Node | null | undefined>;
  alwaysSrc: string;
  /** 左操作数节点（单次求值绑定的纯度判定）——缺省取 alwaysNodes[0] */
  leftNode?: Node | null;
  /** cons 臂表达式源；null 表示复用 __test（&&/|| 的短路返回侧） */
  consSrc: string;
  consNodes: Array<Node | null | undefined>;
  /** alt 臂表达式源；null 表示复用 __test（与 altOf 二选一） */
  altSrc?: string;
  altNodes: Array<Node | null | undefined>;
  /** 覆盖 $fork 测试表达式（?? 用 $nullishTest(left)）——入参是左操作数的**绑定名** */
  testOf?: (leftRef: string) => string;
  /** alt 臂表达式（?? 用 $removeNullish(left)）——入参是左操作数的绑定名；优先于 altSrc */
  altOf?: (leftRef: string) => string;
  /** 额外的 fork 绑定名（臂内写回的绑定——须走 fork 绑定-join 协议收口） */
  extraBindingNames?: string[];
  /** nullish 守卫（issue #97 / #118 v3 多名）：指定臂内以 remove 串影子重绑各守卫名 */
  narrowGuards?: readonly NullishGuard[];
  /** typeof 类型守卫（Bug 23）：两臂分别绑匹配成员 / 补集 */
  typeGuard?: TypeGuard;
  /** 判别等值守卫（issue #126）：事实臂内 $narrowMemberEq 剪 union 成员 */
  discGuards?: readonly DiscriminantGuard[];
  /** 关系守卫（Bug 1）：事实臂内 $refineRel 影子重绑（`x >= 0 ? x : 0`） */
  relGuard?: RelGuard;
}): string {
  const alwaysNames = new Set<string>(collectForkBindingNames(...parts.alwaysNodes));
  const branchNames = new Set<string>(alwaysNames);
  for (const n of parts.consNodes) for (const id of collectForkBindingNames(n)) branchNames.add(id);
  for (const n of parts.altNodes) for (const id of collectForkBindingNames(n)) branchNames.add(id);
  // 臂内写回的绑定（逻辑赋值的写回根等）——必须进 fork 绑定-join 协议，
  // 否则臂内的写会泄漏到 fork 之后的绑定（两臂都跑时后跑臂覆盖先跑臂）。
  for (const n of parts.extraBindingNames ?? []) branchNames.add(n);
  const names = [...branchNames];
  const alwaysRebinds: string[] = [];
  for (const n of parts.alwaysNodes) {
    alwaysRebinds.push(...emitArrMutatorRebinds(n, opts, ""));
  }
  const consRebinds: string[] = [];
  for (const n of parts.consNodes) {
    if (parts.alwaysNodes.includes(n)) continue;
    consRebinds.push(...emitArrMutatorRebinds(n, opts, ""));
  }
  const altRebinds: string[] = [];
  for (const n of parts.altNodes) {
    if (parts.alwaysNodes.includes(n)) continue;
    altRebinds.push(...emitArrMutatorRebinds(n, opts, ""));
  }

  if (alwaysNames.size === 0 && branchNames.size === 0) {
    // 无 mutator：保持简单 $fork（__test 槽位回填 alwaysSrc；testOf 可覆盖）
    //
    // Bug 134：左操作数**只求值一次**。$fork 只保证测试单次求值、惰性跑臂，
    // 测试值本身不回传给臂——把左操作数的**源码**回填到臂里等于再求值一次
    // （getter / 调用 / 计算键各跑两次；自增 getter 第二次读到不同值）。
    // 纯左（标识符 / 字面量 / this）重复读不可观测，保持原形态；其余先绑
    // 到临时量 __sc0，臂内一律引用该绑定。
    const leftNode = parts.leftNode ?? parts.alwaysNodes[0] ?? null;
    const leftReused =
      parts.consSrc === "__test" ||
      parts.altSrc === "__test" ||
      parts.altOf !== undefined;
    const bindLeft = leftReused && leftIsImpure(leftNode);
    const leftRef = bindLeft ? "__sc0" : parts.alwaysSrc;
    const forkTest = parts.testOf ? parts.testOf(leftRef) : leftRef;
    let consExpr = parts.consSrc === "__test" ? leftRef : parts.consSrc;
    let altExpr =
      parts.altSrc === "__test"
        ? leftRef
        : parts.altOf
          ? parts.altOf(leftRef)
          : (parts.altSrc ?? "$lit(void 0)");
    // 多守卫一名一影子参数齐用（issue #118 v3 / #120；此处无 mutator 绑定，
    // 只需按臂过滤）；issue #118：成员守卫经 nullishRemoveCallOf 分发
    // （$removeMemberNullish）
    const applyGuards = (src: string, arm: "cons" | "alt"): string => {
      const gs = (parts.narrowGuards ?? []).filter((g) => g.arm === arm);
      if (gs.length === 0) return src;
      const params = gs.map((g) => g.name).join(", ");
      const args = gs.map((g) => nullishRemoveCallOf(g)).join(", ");
      return `((${params}) => (${src}))(${args})`;
    };
    consExpr = applyGuards(consExpr, "cons");
    altExpr = applyGuards(altExpr, "alt");
    if (parts.typeGuard) {
      const g = parts.typeGuard;
      const apply = (src: string, arm: "cons" | "alt"): string =>
        `((${g.name}) => (${src}))($narrowTypeOf(${g.name}, ${JSON.stringify(g.typeOf)}, ${arm === g.arm}))`;
      consExpr = apply(consExpr, "cons");
      altExpr = apply(altExpr, "alt");
    }
    // 判别等值守卫（issue #126）：事实臂内 union 成员剪影（与 stmt.ts
    // IfStatement 同源；此路径无 mutator 绑定，只需按臂过滤）
    const applyDisc = (src: string, arm: "cons" | "alt"): string =>
      narrowDiscriminantArmThunks(src, parts.discGuards, arm, []);
    consExpr = applyDisc(consExpr, "cons");
    altExpr = applyDisc(altExpr, "alt");
    // 关系守卫（Bug 1）：事实臂影子重绑（与 stmt.ts IfStatement 同源）
    consExpr = narrowRelArmThunk(consExpr, parts.relGuard, "cons", []);
    const forkCall = `$fork(${forkTest}, () => ${consExpr}, () => ${altExpr})`;
    // 绑定形态：左操作数作实参求值一次（IIFE 箭头参数——表达式位合法）
    return bindLeft ? `((__sc0) => ${forkCall})(${parts.alwaysSrc})` : forkCall;
  }

  const consLines =
    parts.consSrc === "__test"
      ? [`return __test;`]
      : consRebinds.length === 0
        ? [`return (${parts.consSrc});`]
        : [`const __v = (${parts.consSrc});`, ...consRebinds, `return __v;`];
  // alt 臂：__test 槽位回填左操作数绑定（__test 已单次求值）；altOf 形
  // （?? 的 $removeNullish(left)）同样只引用绑定，不重发左操作数源码。
  const altExprSrc = parts.altOf
    ? parts.altOf("__test")
    : (parts.altSrc ?? "$lit(void 0)");
  const altLines =
    parts.altSrc === "__test" && !parts.altOf
      ? [`return __test;`]
      : altRebinds.length === 0
        ? [`return (${altExprSrc});`]
        : [`const __v = (${altExprSrc});`, ...altRebinds, `return __v;`];

  const forkTest = parts.testOf ? parts.testOf("__test") : "__test";
  const guards = parts.narrowGuards;
  // nullish 守卫臂剪影与 stmt.ts IfStatement 同源（#97 / #118 v3 多名）：
  // 任一守卫名在 fork 绑定集（mutator 重绑/臂内写）时不收窄——影子参数会
  // 吞掉臂内写（narrowNullishArmThunks 内统一跳过）
  const consFinal = narrowRelArmThunk(
    narrowDiscriminantArmThunks(
      narrowNullishArmThunks(forkArmThunk(consLines, "fk1_", names), guards, "cons", names),
      parts.discGuards,
      "cons",
      names,
    ),
    parts.relGuard,
    "cons",
    names,
  );
  const altFinal = narrowDiscriminantArmThunks(
    narrowNullishArmThunks(forkArmThunk(altLines, "fk2_", names), guards, "alt", names),
    parts.discGuards,
    "alt",
    names,
  );
  return [
    `(() => {`,
    `  const __test = (${parts.alwaysSrc});`,
    ...alwaysRebinds.map((l) => `  ${l}`),
    ...(names.length ? forkBindingDecls(names, "  ") : []),
    `  const __r = $fork(${forkTest}, ${narrowTypeArmThunk(consFinal, parts.typeGuard, "cons", names)}, ${narrowTypeArmThunk(altFinal, parts.typeGuard, "alt", names)});`,
    ...forkJoinBindings(names, "  "),
    `  return __r;`,
    `})()`,
  ].join("\n");
}
