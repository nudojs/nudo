/**
 * 方法/函数体统一发射（stmt 按域拆分之一；语句 switch 在 ./statement.ts）。
 *
 * 不变量：
 * - ObjectMethod / ClassMethod / 属性位 FunctionExpression 体必须走本入口
 *   （emitFnBlockBody / transpileFnBodyStmts）——逐语句 map(transpileStatement)
 *   会绕过早退 if 提升，`if (c) return X; return Y` 的早退值被语句级 $fork
 *   thunk 吞掉（假精确）；
 * - 函数体边界 var 提升（Bug 21）：skip = 参数模式名；嵌套块不传
 *   varScope（var 已在函数级提升，块内改发赋值）；
 * - P4b 参数遮蔽：继承 constNames 被本函数参数模式名遮蔽时扣除（假
 *   TypeError 是 wrong-definite）；
 * - generator/async 函数声明的 __nudoNonCtor 标记提升到语句列表顶部
 *   （Bug 9：先用后声明时 new g() 不误判）。
 */
import type { Expression, Node, Statement } from "@babel/types";
import type { TranspileOptions } from "../types.ts";
import {
  stmtReturns,
  completeElseChains,
  withImplicitReturn,
  narrowNullishArmThunks,
  narrowTypeArmThunk,
  nullishGuardsOf,
  typeGuardOf,
  discriminantGuardsOf,
  narrowDiscriminantArmThunks,
  relGuardOf,
  narrowRelArmThunk,
} from "../stmt-predicates.ts";
import {
  isExpression,
  indent,
  collectForkBindingNames,
  collectPatternNames,
  collectVarHoistNames,
  computeConstScope,
} from "../helpers.ts";
import { emitArrMutatorRebinds, forkBindingDecls, forkJoinBindings } from "../emit.ts";
import { emitTranspileExpression } from "../transpile-dispatch.ts";
import { transpileStatement } from "./statement.ts";
import { transpileBlockAsThunk } from "./block.ts";
/**
 * 方法/函数体统一发射：早退 if 提升（transpileFnBodyStmts）+ 可选隐式 return。
 * ObjectMethod / ClassMethod / 属性位 FunctionExpression 必须走本入口——
 * 逐语句 map(transpileStatement) 会绕过提升，`if (c) return X; return Y`
 * 的早退值被语句级 $fork thunk 吞掉（恒折 fall-through 值的假精确）。
 */
export function emitFnBlockBody(
  body: Node | undefined | null,
  depth: number,
  opts: TranspileOptions,
  o: { implicitReturn?: boolean; varParams?: ReadonlySet<string> } = {},
): string {
  const implicitReturn = o.implicitReturn !== false;
  if (!body) {
    return implicitReturn ? `${indent(depth)}return $lit(void 0);` : "";
  }
  if (body.type !== "BlockStatement") {
    return `${indent(depth)}return ${emitTranspileExpression(body as Expression, opts)};`;
  }
  const stmts = transpileFnBodyStmts(body.body as Statement[], depth, opts, {
    // Bug 21：方法体 var 提升边界（varParams = 方法参数模式名）
    skip: o.varParams ?? new Set(),
  });
  return implicitReturn ? withImplicitReturn(body, stmts, depth) : stmts;
}

/**
 * 提升态非构造器标记（Bug 9）：generator/async 函数声明原生
 * 提升——声明语句之前的 `new g()` 也须见 `__nudoNonCtor`
 * （此前行内标记在声明处赋值，先用后声明时未执行→$new 误判
 * 「可构造性未知」may 档 + 假 brand 值域）。标记提升到所在
 * 语句列表顶部；早退拆分时 head 声明标记在外层、rest 声明
 * 标记由递归调用在 thunk 内各自提升（声明本身也在 thunk 内）。
 */
/** 参数模式名集（var 提升边界扣除：宿主签名/prologue 已绑定） */
export function paramNamesOf(params: Node[]): ReadonlySet<string> {
  const acc = new Set<string>();
  for (const p of params) collectPatternNames(p, acc);
  return acc;
}

function hoistNonCtorMarkers(stmts: Statement[], depth: number): string {
  const names: string[] = [];
  for (const s of stmts) {
    if (
      s.type === "FunctionDeclaration" &&
      s.id &&
      (s.generator || s.async)
    ) {
      names.push(s.id.name);
    }
  }
  if (names.length === 0) return "";
  const pad = indent(depth);
  return names.map((n) => `${pad}${n}.__nudoNonCtor = 1;`).join("\n") + "\n";
}

export function transpileFnBodyStmts(
  stmtsIn: Statement[],
  depth: number,
  opts: TranspileOptions,
  /** 函数/方法体边界（var 提升层）：skip = 参数模式名（宿主签名/prologue
   *  已绑定，不得再提升重复声明）。嵌套块（transpileBlockAsThunk）不传——
   * var 已在函数级提升，块内按 hoistedVarNames 改发赋值（Bug 21）。 */
  varScope?: { skip: ReadonlySet<string> },
): string {
  const stmts = completeElseChains(stmtsIn);
  // Bug 21：函数体级 var 提升——收集体内（含嵌套块）var 名，顶部发射
  // `let <name> = $lit(void 0);`（声明前置、初始化留原位改发赋值）。
  const varHoist: string[] = [];
  let varOpts = opts;
  if (varScope) {
    const hoisted = collectVarHoistNames(stmts);
    // 提升声明扣除参数遮蔽名与顶层函数声明名（宿主签名/prologue/函数声明
    // 已绑定，let 重声明是 SyntaxError；var 与函数声明原生同一绑定）；
    // 发射集保留全部名——遮蔽的 `var a = init` 在块内仍改发赋值
    const skipDecl = new Set<string>(varScope.skip);
    for (const s of stmts) {
      if (s.type === "FunctionDeclaration" && s.id) skipDecl.add(s.id.name);
    }
    const declNames = [...hoisted].filter((n) => !skipDecl.has(n));
    if (declNames.length > 0) {
      const pad = indent(depth);
      varHoist.push(
        `${pad}let ${declNames.map((n) => `${n} = $lit(void 0)`).join(", ")};`,
      );
    }
    // 函数体边界：重算提升集；keepVarDecl 只属于模块顶层 export var 的
    // 直接声明发射，不得泄漏进嵌套函数体（否则块内 var 误发块级 let）
    varOpts = { ...opts, hoistedVarNames: hoisted, keepVarDecl: undefined };
    // P4b：函数边界参数遮蔽——继承的 constNames（外层 const / 类体不可变
    // 自有名）被本函数参数模式名遮蔽时必须扣除：`function f(K) { K = 5 }`
    // 外层 `const K` / 类名 K，体内写的是参数绑定（原生 no-throw），不得
    // 假 TypeError（wrong-definite）。参数默认值表达式仍以 opts 求值
    //（emitParamBinding 的 paramOpts 不减——默认式里写外层 const 原生照抛）。
    if (opts.constNames && varScope.skip.size > 0) {
      varOpts = {
        ...varOpts,
        constNames: new Set(
          [...opts.constNames].filter((n) => !varScope!.skip.has(n)),
        ),
      };
    }
  }
  // issue #165：@nudo:assume 引理锚定收集——仅函数/方法体边界（varScope
  // 存在）且文件含 @nudo:assume（assumeDirectiveFile 快速门）时进行。从
  // stmtsIn（completeElseChains 之前，保持节点身份）收**直接子语句**
  // VariableDeclaration 中 id 为 Identifier 且有 init 的 declarator 节点，
  // 发射位按对象身份匹配（completeElseChains 的浅拷贝语句共享 declarations
  // 数组，declarator 身份不变）。嵌套块 / for-init / 解构不收——嵌套块
  // 沿用外层集合但节点不命中（身份判定天然排除）；嵌套函数体在自身边界
  // 重算并集（外层节点不越界出现在体内，并集幂等）。早退拆分的 rest
  // 递归不传 varScope → 沿用本集合，同节点身份仍命中。
  let anchorNodes: Set<object> | null = null;
  if (varScope && opts.assumeDirectiveFile) {
    for (const s of stmtsIn) {
      if (s.type !== "VariableDeclaration") continue;
      for (const d of s.declarations) {
        if (d.id.type !== "Identifier" || !d.init) continue;
        // 外层已有集合取并集新 Set（varOpts 已携带外层集合时保持单调）
        if (!anchorNodes) anchorNodes = new Set(opts.anchorDeclNodes);
        anchorNodes.add(d);
      }
    }
  }
  // 本层 const 可见性（含父作用域、扣除本层 let/var 遮蔽）——用户再赋值 TypeError
  const scopedOpts: TranspileOptions = {
    ...varOpts,
    constNames: computeConstScope(stmts, varOpts.constNames),
    ...(anchorNodes ? { anchorDeclNodes: anchorNodes } : {}),
  };
  for (let i = 0; i < stmts.length; i++) {
    const stmt = stmts[i]!;
    if (stmt.type !== "IfStatement" || stmt.alternate != null) continue;
    if (!stmtReturns(stmt.consequent)) continue;
    const rest = stmts.slice(i + 1);
    if (rest.length === 0) continue;
    const head = stmts
      .slice(0, i)
      .map((s) => transpileStatement(s, depth, scopedOpts))
      .join("\n");
    const test = emitTranspileExpression(stmt.test, scopedOpts);
    // P0.1：早退提升同样必须隔离臂间 mutator/普通绑定
    const recvSet = new Set<string>([
      ...collectForkBindingNames(stmt.consequent),
      ...collectForkBindingNames(stmt.test),
      ...collectForkBindingNames(...rest),
    ]);
    const names = [...recvSet];
    const pad = indent(depth);
    const padIn = indent(depth + 1);
    // 与 IfStatement 同协议：set-flag 哨兵 + forkJoinBindings
    const wrapArm = (thunk: string, outPrefix: string): string => {
      if (names.length === 0) return thunk;
      return [
        `() => {`,
        ...names.map((n) => `${padIn}${n} = $copy(__fk0_${n});`),
        `${padIn}let __cont = true;`,
        `${padIn}try {`,
        `${padIn}  return (${thunk})();`,
        `${padIn}} catch (e) {`,
        `${padIn}  if ($isForkExit(e)) __cont = false;`,
        `${padIn}  throw e;`,
        `${padIn}} finally {`,
        `${padIn}  if (__cont) {`,
        ...names.map((n) => `${padIn}    __${outPrefix}${n} = ${n};`),
        ...names.map((n) => `${padIn}    __${outPrefix}set_${n} = true;`),
        `${padIn}  }`,
        `${padIn}}`,
        `}`,
      ].join("\n");
    };
    const testRebinds = emitArrMutatorRebinds(stmt.test as Node, scopedOpts, pad);
    // Bug 2：早退提升路径同样做守卫剪影——rest 在测试假值臂内执行，守卫名
    // 以 $removeNullish/$narrowTypeOf 影子重绑后，`const t = p.major` 类
    // 非终结尾句不再撞未剪 null/undefined 臂记假 may-throw（与 IfStatement
    // 路径同源；守卫名在 fork 绑定集时跳过）。
    // issue #118：早退体（cons 臂）同样剪影——`if (o.p) return o.p.q` 的
    // 属性读在测试真值臂内，守卫事实（成员真值）作用于该臂。
    // issue #118 v3 / #120：多名复合测试（`obj == null || node.p == null`）
    // 经 nullishGuardsOf 一臂多事实齐用。
    const earlyGuards = nullishGuardsOf(stmt.test);
    const earlyTGuard = typeGuardOf(stmt.test);
    const earlyDGuards = discriminantGuardsOf(stmt.test);
    // 关系守卫（Bug 1）：早退提升路径与 IfStatement 分叉路径同口径——
    // cons 臂裸 `return x` 携带守卫界（缺省时 return-constraint 假阳）
    const earlyRGuard = relGuardOf(stmt.test);
    const consNarrowed = narrowRelArmThunk(
      narrowDiscriminantArmThunks(
        narrowTypeArmThunk(
          narrowNullishArmThunks(
            transpileBlockAsThunk(stmt.consequent, depth, scopedOpts),
            earlyGuards,
            "cons",
            recvSet,
          ),
          earlyTGuard,
          "cons",
          recvSet,
        ),
        earlyDGuards,
        "cons",
        recvSet,
      ),
      earlyRGuard,
      "cons",
      recvSet,
    );
    const cons = wrapArm(consNarrowed, "fk1_");
    const altBody = transpileFnBodyStmts(rest, depth + 1, { ...scopedOpts, inLoop: opts.inLoop });
    const altThunk = `() => {\n${altBody}\n${pad}}`;
    const altNarrowed = narrowRelArmThunk(
      narrowDiscriminantArmThunks(
        narrowTypeArmThunk(
          narrowNullishArmThunks(altThunk, earlyGuards, "alt", recvSet),
          earlyTGuard,
          "alt",
          recvSet,
        ),
        earlyDGuards,
        "alt",
        recvSet,
      ),
      earlyRGuard,
      "alt",
      recvSet,
    );
    const alt = wrapArm(altNarrowed, "fk2_");
    const inCtrl = (opts.inLoop ?? 0) > 0 || (opts.inTry ?? 0) > 0;
    const applyJoin = names.length ? forkJoinBindings(names, pad).join("\n") : "";
    if (names.length === 0) {
      const promoted = [
        ...testRebinds,
        inCtrl
          ? `${pad}$loopReturn($fork(${test}, ${cons}, ${alt}));`
          : `${pad}return $fork(${test}, ${cons}, ${alt});`,
      ].join("\n");
      return (varHoist.length ? varHoist.join("\n") + "\n" : "") + hoistNonCtorMarkers(stmts.slice(0, i), depth) + (head ? `${head}\n${promoted}` : promoted);
    }
    const promoted = [
      `${pad}{`,
      ...testRebinds,
      ...forkBindingDecls(names, padIn),
      `${padIn}const __fkR = $fork(${test}, ${cons}, ${alt});`,
      applyJoin.split("\n").map((l) => l.replace(/^\s*/, padIn)).join("\n"),
      inCtrl
        ? `${padIn}$loopReturn(__fkR);`
        : `${padIn}return __fkR;`,
      `${pad}}`,
    ].join("\n");
    return (varHoist.length ? varHoist.join("\n") + "\n" : "") + hoistNonCtorMarkers(stmts.slice(0, i), depth) + (head ? `${head}\n${promoted}` : promoted);
  }
  return (varHoist.length ? varHoist.join("\n") + "\n" : "") + hoistNonCtorMarkers(stmts, depth) + stmts.map((s) => transpileStatement(s, depth, scopedOpts)).join("\n");
}


export function transpileBodyNode(node: Node, opts: TranspileOptions): string {
  // Bug 42：body-fn 转译单元也建 try 临时计数器（外层未传时兜底，
  // 保证单元内同级 try 不撞名——与 transpileFile 同口径）
  const unitOpts: TranspileOptions = opts.tryTmpSeq ? opts : { ...opts, tryTmpSeq: { n: 0 } };
  if (isExpression(node as { type: string })) {
    return `return ${emitTranspileExpression(node as Expression, unitOpts)};`;
  }
  return withImplicitReturn(node, transpileStatement(node as Statement, 1, unitOpts), 1);
}
