/**
 * 方法/函数体统一发射（stmt 按域拆分之一；语句 switch 在 ./statement.ts）。
 *
 * 不变量：
 * - ObjectMethod / ClassMethod / 属性位 FunctionExpression 体必须走本入口
 *   （emitFnBlockBody / transpileFnBodyStmts）——逐语句 map(transpileStatement)
 *   会绕过早退 if 提升，`if (c) return X; return Y` 的早退值被语句级 $fork
 *   thunk 吞掉（假精确）；
 * - 早退提升的 alt 臂 = **后续路径**（事实臂已 return/throw 提前退出 ⇒ 测试
 *   为假）⇒ 该臂**不断言否定关系界**（Bug 1115：¬(x <= k) 含 NaN，不可健全
 *   表示 ⇒ 断言否定界会把 NaN 排除 ⇒ 假绿；事实臂窄化不受影响）；
 * - 早退摊平的**送达范围**（Bug 186）：内含早退 if 且**无词法声明**的块
 *   摊平到当前语句表（flattenEarlyReturnBlocks）——块正常完成 ⇒ 早退测试为
 *   假；块内有词法声明时不摊平（作用域不外泄）；
 * - try / catch / finally 的**块体**也走本入口（与函数体顶层同口径）——裸
 *   map(transpileStatement) 会绕过早退提升；
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
  collectScopeShadowNames,
  collectVarHoistNames,
  computeConstScope,
  copyConstScope,
  internalTmpName,
  leadingConstAliasGroups,
  mergeAliasGroups,
  shadowedIntrinsicsOf,
  expandAliasNames,
} from "../helpers.ts";
import { emitArrMutatorRebinds, forkArmThunkExpr, forkBindingDecls, forkJoinBindings, forkTmpNames } from "../emit.ts";
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

/**
 * 语句表内是否存在「早退 if」（无 else、cons 体 return）——块内早退的
 * 存在性判定（Bug 186 跨块早退摊平的前置条件）。
 */
function blockHasEarlyReturn(stmts: readonly Statement[]): boolean {
  return stmts.some(
    (s) =>
      (s.type === "IfStatement" && s.alternate == null && stmtReturns(s.consequent)) ||
      (s.type === "BlockStatement" && blockHasEarlyReturn(s.body)),
  );
}

/**
 * 语句表内是否有**词法声明**（let/const/function/class）——块内**有**词法
 * 声明时不得把块摊平到外层（作用域会被摊平 ⇒ 名字外泄 / 撞名）。`var`
 * 是函数级作用域，摊平无差别。
 */
function hasLexicalDecl(stmts: readonly Statement[]): boolean {
  return stmts.some(
    (s) =>
      (s.type === "VariableDeclaration" && s.kind !== "var") ||
      s.type === "FunctionDeclaration" ||
      s.type === "ClassDeclaration",
  );
}

/**
 * 跨块早退摊平（Bug 186）：把「内含早退 if 且**无词法声明**」的块摊平到
 * 当前语句表。
 *
 * 原生语义：块内 `if (v === null) { return 0; }` 早退 ⇒ **块正常完成**
 * ⇒ 早退测试为**假** ⇒ 「v 不再是 null」的补集事实作用于**块之后**的
 * 路径。此前补集窄化只挂在「函数体顶层语句表」上（同层有 `if` + 其后
 * `rest` 才提升），裸块 / try / catch / finally 块内的同一段代码拿不到
 * 补集 ⇒ 同一段代码换位置结论相反（L2 假红）。
 *
 * 摊平口径：块内**无词法声明** ⇒ 块只是作用域包装，摊平到当前语句表后
 * 语义无差别（`var` 本就是函数级）；早退 if 随即进入既有的同层提升路径
 * ——补集事实送达块之后的路径。块内有词法声明时不摊平（宁缺毋假）。
 */
function flattenEarlyReturnBlocks(stmts: readonly Statement[]): Statement[] {
  const out: Statement[] = [];
  for (const s of stmts) {
    if (
      s.type === "BlockStatement" &&
      !hasLexicalDecl(s.body) &&
      blockHasEarlyReturn(s.body)
    ) {
      out.push(...flattenEarlyReturnBlocks(s.body));
      continue;
    }
    out.push(s);
  }
  return out;
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
  // Bug 186：跨块早退摊平（内含早退 if 的无声明块 → 当前语句表），
  // 早退的补集事实由此送达块之后的路径
  const stmts = completeElseChains(flattenEarlyReturnBlocks(stmtsIn));
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
    // paramNames：形参重赋值不参与 assign-mismatch（见 types.ts 该字段说明）
    varOpts = {
      ...opts,
      hoistedVarNames: hoisted,
      keepVarDecl: undefined,
      paramNames: varScope.skip,
    };
    // P4b：函数边界参数遮蔽——继承的 constNames（外层 const / 类体不可变
    // 自有名）被本函数参数模式名遮蔽时必须扣除：`function f(K) { K = 5 }`
    // 外层 `const K` / 类名 K，体内写的是参数绑定（原生 no-throw），不得
    // 假 TypeError（wrong-definite）。参数默认值表达式仍以 opts 求值
    //（emitParamBinding 的 paramOpts 不减——默认式里写外层 const 原生照抛）。
    if (opts.constNames && varScope.skip.size > 0) {
      varOpts = {
        ...varOpts,
        constNames: copyConstScope(opts.constNames, varScope!.skip),
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
  //
  // 别名组（**作用域边界**）：本层**自有**组 = 本层开头连续 const 声明里的
  // 直接别名（`const a = {...}; const b = a;`）——同层声明 ⇒ 同绑定 ⇒ 展开
  // 安全；**继承**组（外层作用域）按本层**遮蔽名**过滤后并入——本层重新
  // 声明了组内任一成员时，该成员在本层指向**不同绑定**（展开会把外层伙伴
  // 当成本层绑定复制/重绑 ⇒ 断开别名身份 ⇒ 自信错值）；未被遮蔽时外层
  // 伙伴在本层仍是同一绑定（嵌套函数写外层别名成员时靠它保持身份）。
  //
  // 边界口径：函数/方法体（varScope 存在）与**嵌套块**（transpileBlockAsThunk
  // → 本入口，无 varScope）都是作用域边界 ⇒ 两处都算本层组。形参也遮蔽
  // 外层绑定（varScope.skip = 参数模式名）。
  //
  // **模块顶层**同样是作用域边界，但它不经本入口（模块体由 transpile.ts
  // 逐语句发射）⇒ 模块的自有组在 transpile.ts 算好后经 opts.aliasGroups
  // 下发，本入口按上面的「继承组」口径并入：嵌套函数体未遮蔽时保持外层
  // 别名身份，遮蔽时丢组。
  const ownAliasGroups = leadingConstAliasGroups(stmts);
  const shadowNames = collectScopeShadowNames(stmts);
  if (varScope) for (const n of varScope.skip) shadowNames.add(n);
  const aliasGroups = mergeAliasGroups(opts.aliasGroups, ownAliasGroups, shadowNames);
  const scopedOpts: TranspileOptions = {
    ...varOpts,
    constNames: computeConstScope(stmts, varOpts.constNames),
    ...(anchorNodes ? { anchorDeclNodes: anchorNodes } : {}),
    // **总是覆写**（含空数组）：`aliasGroups` 是**本层已裁决**的结果（继承
    // 组已按本层遮蔽名过滤 + 本层自有组）——条件展开（`aliasGroups.length
    // > 0 ? … : {}`）会让 `...varOpts` 里的**未过滤**外层组漏进本层 ⇒ 被
    // 本层遮蔽的成员仍被当成同一绑定 ⇒ 复制/重绑了不同绑定 ⇒ 别名身份
    // 断开（自信错值）。恒覆写保证「本层看到的组」= 本层算出的组。
    aliasGroups,
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
    const names = expandAliasNames(recvSet, scopedOpts);
    const pad = indent(depth);
    const padIn = indent(depth + 1);
    // 与 IfStatement 同协议：set-flag 哨兵 + forkJoinBindings
    // Bug 1151-b：fork 协议内部临时名（快照 `__fk0_*` / 臂槽位 / 臂标志
    // `__cont` / 结果载体 `__fkR`）**避开用户标识符**——写死名会遮蔽用户
    // 同名绑定（自信错值 ⇒ 闸门假绿）。分配器与声明点（`forkBindingDecls`）
    // 同源 ⇒ 「成对一致」。
    const fk = forkTmpNames(names, scopedOpts);
    const testRebinds = emitArrMutatorRebinds(stmt.test as Node, scopedOpts, pad);
    // Bug 2：早退提升路径同样做守卫剪影——rest 在测试假值臂内执行，守卫名
    // 以 $removeNullish/$narrowTypeOf 影子重绑后，`const t = p.major` 类
    // 非终结尾句不再撞未剪 null/undefined 臂记假 may-throw（与 IfStatement
    // 路径同源；守卫名在 fork 绑定集时跳过）。
    // issue #118：早退体（cons 臂）同样剪影——`if (o.p) return o.p.q` 的
    // 属性读在测试真值臂内，守卫事实（成员真值）作用于该臂。
    // issue #118 v3 / #120：多名复合测试（`obj == null || node.p == null`）
    // 经 nullishGuardsOf 一臂多事实齐用。
    const earlyGuards = nullishGuardsOf(stmt.test, scopedOpts.shadowedIntrinsics?.has("undefined") !== true);
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
    const inCtrl =
      (opts.inLoop ?? 0) > 0 || (opts.inTry ?? 0) > 0 || (opts.inCtrlBlock ?? 0) > 0;
    // 标志名避开用户标识符（Bug 1058 同款口径：用户写了同名标识符 ⇒ 重复
    // 词法声明 ⇒ 产物非法 JS ⇒ 整模块 fail-closed）。
    const fkConsName = internalTmpName("__fkCons", opts);
    // 族 65 · BC #28（try/catch 吞控制流信号）：inCtrl 形态（循环体 / try 块
    // 体内）的早退提升此前发 `$loopReturn($fork(test, cons, alt))`——**测试为
    // 假**时 $fork 走 alt 臂（后续路径），其值被当成早退值抛出 ⇒ 函数**提前
    // 返回**后续路径的值（原生：后续路径照常跑完，函数继续走到块外）。
    // 复现（node v26.10.0 对拍）：
    //   let n=0; try { if (0) return 42; n++; } catch (e) {} return n;
    //   原生 1 ⇒ 此前引擎折 undefined（自信的错值：把「块内后续路径的值」
    //   当成函数返回值）。
    //
    // 修法：区分「早退真的发生」与「走后续路径」——
    // - cons 臂（早退臂）跑 ⇒ 置 `__fkCons` 标志；
    // - alt 臂（后续路径）内的 `return` 走 $loopReturn 信号（inLoop +1 ⇒
    //   ReturnStatement 发 $loopReturn）⇒ alt 臂的 return 是**函数级**早退
    //   （原生语义），不被当成本次提升的返回值；
    // - 只有 `__fkCons` 为真才 $loopReturn ⇒ 测试为假时**不**早退（后续路径
    //   照常跑完，函数继续）。
    // 抽象测试（双臂都跑）：cons 臂置标志 ⇒ 仍按 join 值早退（既有口径不变）。
    const consMarked = inCtrl
      ? `() => { ${fkConsName} = true; return (${consNarrowed})(); }`
      : consNarrowed;
    const cons = forkArmThunkExpr(consMarked, 0, names, padIn, scopedOpts);
    const altBody = transpileFnBodyStmts(rest, depth + 1, {
      ...scopedOpts,
      inLoop: inCtrl ? (opts.inLoop ?? 0) + 1 : opts.inLoop,
    });
    const altThunk = `() => {\n${altBody}\n${pad}}`;
    // Bug 1115：alt 臂 = **后续路径**（事实臂已 return / throw 提前退出 ⇒ 落到
    // alt 的路径上测试为**假**）——但**不得**在后续路径上断言**否定关系界**
    // （`x <= 0` 为假 ⇒ `x > 0`）：JS 里 `¬(x <= k)` 还含 `x` 为 NaN 的情形
    // （NaN 与任何比较皆假）⇒ 后续路径只能断定 `x > k ∨ x is NaN`，
    // 断言 `x > k` 会**排除 NaN**（不健全）⇒
    // - `if (x < 0) return 0; return x;` + `return nonNeg`：后续路径断言
    //   `x >= 0` ⇒ 契约被「证成」⇒ **0 诊断**（假绿）——原生 x=NaN 时
    //   `NaN < 0` 为假 ⇒ 走到 `return x` ⇒ 返回 NaN ⇒ 违反 nonNeg。
    // - 三元写法 `return x < 0 ? 0 : x;` 的 else 臂**没有**否定界窄化 ⇒
    //   判 `unproven-return` ⇒ 两种等价写法结论不一致。
    // ⇒ 后续路径**不断言否定界**（与三元路径同口径）：事实臂窄化
    //   （narrowRelArmThunk）只管「测试为真」的方向（那侧 NaN 不可达）。
    const altNarrowed = narrowDiscriminantArmThunks(
      narrowTypeArmThunk(
        narrowNullishArmThunks(altThunk, earlyGuards, "alt", recvSet),
        earlyTGuard,
        "alt",
        recvSet,
      ),
      earlyDGuards,
      "alt",
      recvSet,
    );
    const alt = forkArmThunkExpr(altNarrowed, 1, names, padIn, scopedOpts);
    const applyJoin = names.length ? forkJoinBindings(names, pad, scopedOpts).join("\n") : "";
    if (names.length === 0) {
      const promoted = [
        ...testRebinds,
        ...(inCtrl ? [`${pad}let ${fkConsName} = false;`] : []),
        inCtrl
          ? `${pad}const ${fk.result} = $fork(${test}, ${cons}, ${alt});\n${pad}if (${fkConsName}) $loopReturn(${fk.result});`
          : `${pad}return $fork(${test}, ${cons}, ${alt});`,
      ].join("\n");
      return (varHoist.length ? varHoist.join("\n") + "\n" : "") + hoistNonCtorMarkers(stmts.slice(0, i), depth) + (head ? `${head}\n${promoted}` : promoted);
    }
    const promoted = [
      `${pad}{`,
      ...testRebinds,
      ...forkBindingDecls(names, padIn, scopedOpts),
      ...(inCtrl ? [`${padIn}let ${fkConsName} = false;`] : []),
      `${padIn}const ${fk.result} = $fork(${test}, ${cons}, ${alt});`,
      applyJoin.split("\n").map((l) => l.replace(/^\s*/, padIn)).join("\n"),
      inCtrl
        ? `${padIn}if (${fkConsName}) $loopReturn(${fk.result});`
        : `${padIn}return ${fk.result};`,
      `${pad}}`,
    ].join("\n");
    return (varHoist.length ? varHoist.join("\n") + "\n" : "") + hoistNonCtorMarkers(stmts.slice(0, i), depth) + (head ? `${head}\n${promoted}` : promoted);
  }
  return (varHoist.length ? varHoist.join("\n") + "\n" : "") + hoistNonCtorMarkers(stmts, depth) + stmts.map((s) => transpileStatement(s, depth, scopedOpts)).join("\n");
}

/**
 * 关系守卫的**补集**精化已**整体撤销**（Bug 1115）。
 *
 * 原实现（Bug 182）在「测试为假」的后续路径上断言**否定关系界**
 * （`x <= k` 为假 ⇒ `x > k`，`REL_COMPLEMENT_OP`）——但 JS 里
 * `¬(x <= k)` 还含 `x` 为 NaN 的情形（NaN 与任何比较皆假）：
 * 后续路径只能断定 `x > k ∨ x is NaN` ⇒ 断言 `x > k` **排除了 NaN**
 * （不健全）⇒
 * - `if (x < 0) return 0; return x;` + `return nonNeg`：后续路径断言
 *   `x >= 0` ⇒ 契约被「证成」⇒ **0 诊断**（假绿）；原生 x=NaN ⇒
 *   `NaN < 0` 为假 ⇒ `return x` ⇒ 返回 NaN ⇒ 违反 nonNeg（真违规）。
 * - 三元写法 `return x < 0 ? 0 : x;` 的 else 臂没有否定界窄化 ⇒ 判
 *   `unproven-return` ⇒ 两种等价写法结论不一致。
 *
 * ⇒ 后续路径**不断言否定界**（事实臂 `narrowRelArmThunk` 保留：那一侧
 * 「测试为真」⇒ NaN 不可达，断言是健全的）。
 */

export function transpileBodyNode(node: Node, opts: TranspileOptions): string {
  // Bug 42：body-fn 转译单元也建 try 临时计数器（外层未传时兜底，
  // 保证单元内同级 try 不撞名——与 transpileFile 同口径）
  let unitOpts: TranspileOptions = opts.tryTmpSeq ? opts : { ...opts, tryTmpSeq: { n: 0 } };
  // Bug 1160：body 单元同样在**入口**分配 this 载体名（与 transpileFile 同
  // 口径）——本单元内的函数 prologue 与嵌套生成的首参共用；无碰撞时基名
  // `__this` 原样返回 ⇒ 产物逐字不变。
  if (!unitOpts.thisSlot) {
    unitOpts = { ...unitOpts, thisSlot: internalTmpName("__this", unitOpts) };
  }
  // 宿主内建名遮蔽：本单元 body 的声明扫描 ∪ 调用方补给（body-fn 的形参 /
  // 闭包绑定名，见 exec/body-fn.ts）。无命中不写字段（产物逐字节不变）。
  const shadowedIntrinsics = shadowedIntrinsicsOf(node, unitOpts.shadowedIntrinsics);
  if (shadowedIntrinsics) unitOpts = { ...unitOpts, shadowedIntrinsics };
  if (isExpression(node as { type: string })) {
    return `return ${emitTranspileExpression(node as Expression, unitOpts)};`;
  }
  return withImplicitReturn(node, transpileStatement(node as Statement, 1, unitOpts), 1);
}
