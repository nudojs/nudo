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
export function transpileShortCircuitExpr(opts: TranspileOptions, parts: {
  alwaysNodes: Array<Node | null | undefined>;
  alwaysSrc: string;
  /** cons 臂表达式源；null 表示复用 __test（&&/|| 的短路返回侧） */
  consSrc: string;
  consNodes: Array<Node | null | undefined>;
  /** alt 臂表达式源；null 表示复用 __test */
  altSrc: string;
  altNodes: Array<Node | null | undefined>;
  /** 覆盖 $fork 测试表达式（?? 用 $nullishTest(left)） */
  testSrc?: string;
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
    // 无 mutator：保持简单 $fork（__test 槽位回填 alwaysSrc；testSrc 可覆盖）
    const forkTest = parts.testSrc ?? parts.alwaysSrc;
    let consExpr = parts.consSrc === "__test" ? parts.alwaysSrc : parts.consSrc;
    let altExpr = parts.altSrc === "__test" ? parts.alwaysSrc : parts.altSrc;
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
    return `$fork(${forkTest}, () => ${consExpr}, () => ${altExpr})`;
  }

  const consLines =
    parts.consSrc === "__test"
      ? [`return __test;`]
      : consRebinds.length === 0
        ? [`return (${parts.consSrc});`]
        : [`const __v = (${parts.consSrc});`, ...consRebinds, `return __v;`];
  const altLines =
    parts.altSrc === "__test"
      ? [`return __test;`]
      : altRebinds.length === 0
        ? [`return (${parts.altSrc});`]
        : [`const __v = (${parts.altSrc});`, ...altRebinds, `return __v;`];

  const forkTest = parts.testSrc ?? "__test";
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
