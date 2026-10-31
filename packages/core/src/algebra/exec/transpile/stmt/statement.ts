/**
 * 语句 switch 主分派（stmt 按域拆分之一；方法/函数体入口在 ./fn-body.ts，
 * 块 thunk 化在 ./block.ts）。主分派是**路由表**：各 case 体在同文件下方的
 * emit*Statement helper 里（只共享模块级计数器与 opts，不传上下文对象）。
 *
 * 不变量：
 * - switchBodySeq 是模块内私有计数器（跨语句/函数去重），只随
 *   transpileStatement 的 switch 共享体发射递增；
 * - switch 臂内的 break 走**带标签**的 break 信号（$loopBreak(标签)）：信号
 *   穿过嵌套 thunk（if 臂），由 switch 臂入口的 catch 吸收 ⇒ break 真的
 *   退出 switch（原生语义）；带标签 ⇒ 外层循环不吸收（$isBreakTo 只匹配
 *   同标签）；curSwitchBreakLabel 是当前正在发射的 switch 臂的标签（栈式
 *   保存 / 恢复，嵌套 switch 各自一份）；
 * - switch 的 case 测试**惰性**求值（test 为 getter，$switch 按序匹配时才
 *   读）⇒ 命中即停（原生 CaseBlock 语义）；臂入口在抽象判别式路径补求值
 *   全部 case 测试（$switch 抽象路径不读 getter）；
 * - switch 的 **pack/join 绑定集**（`names`）按**逐臂**自由写计算
 *   （`collectForkBindingNames(...arm.stmts)` 后再并集），且发射在**外层
 *   作用域**（快照 `__sw0_<name>` / 臂入口恢复 / 结束后 join）。因此集合里
 *   **不得**出现臂内声明的同名局部绑定——否则外层同名绑定被 $copy 后重绑
 *   ⇒ 外层别名身份断开 ⇒ 自信错值。剔除靠 `collectFreeAssignedNames` 的
 *   `batchDecl` + walk 遮蔽（覆盖：直接 let/const/function/class、任意深度
 *   嵌套块、for/for-of/for-in 头、catch 形参、嵌套函数形参与其体内
 *   let/const）；`var` 是**函数**作用域绑定，不按 arm-local 剔除（同函数
 *   作用域内与外层 `var` 同名即同一绑定，必须留在协议里）。已知边界：
 *   嵌套函数**体内**的 `var` 未在 helpers 的 walk 中提升遮蔽（if-fork /
 *   三元同病）——修法在 `collectFreeAssignedNames`，不在本文件；
 *   不变量与形状矩阵见 `exec/__tests__/switch-arm-local-scope.test.ts`；
 * - case 标签窄化（Bug 184）：命中 / 排除事实经 switchCaseFacts 计算，
 *   经 narrowCaseLabelArmThunk 影子重绑进臂体；
 * - 语句级 emit 协议（fork 臂隔离/mutator rebinds/守卫剪影）与表达式侧
 *   short-circuit.ts 同源；控制流谓词在 ../stmt-predicates.ts（leaf）；
 * - 关系守卫只接**事实臂**（narrowRelArmThunk）：「测试为真」的方向
 *   （那侧 NaN 不可达）；**后续路径**（早退后的 else 臂）**不断言否定界**
 *   （Bug 1115：¬(x <= k) 含 NaN ⇒ 否定界不可健全表示 ⇒ 断言它会排除
 *   NaN ⇒ 假绿）；
 * - 循环体守卫接线（Bug 183 / 185）：`for` / `while` / `do-while` 的**测试
 *   事实**（nullish + 关系）经 loopBodyGuardsOf / narrowLoopBody 以影子参数
 *   接进循环体——事实臂 = 「测试为真 ⇒ 体内成立」（与 `if` 的事实臂同义）；
 *   跳过规则同既有 while 口径（体侧写守卫名 / 体顶层同名列 ⇒ 全跳过），
 *   `for` 主路径另排除循环变量（状态线程形参，影子会顶掉它）；do-while 只
 *   收窄**第 2 轮起**的体内拷贝（首轮先于测试求值 ⇒ 无事实，保持未收窄）；
 * - Bug 141：async generator 声明面（`async function* g(){}`）——$gen 第二
 *   实参 = async 位（next 返 promise、装 @@asyncIterator / @@toStringTag）；
 *   **不进** $async 包装（原生返回 AsyncGenerator 本身，非 promise）；
 * - Bug 174：默认参数表达式在**本函数作用域**求值 ⇒ 其中的 `this` 读本
 *   函数的 __this 槽（形参面一并扫描 this——fnParamsHaveThis）；
 * - for 头绑定的**作用域形态**（Bug 163 / 178）：`let`/`const` 头 = 回调
 *   形参（每轮新绑定）；`var` 头 = **函数级共享槽**（每轮把迭代项写回
 *   同一槽，循环后仍可见）；标识符头 / 成员表达式头 = **头赋值**（写回
 *   既有绑定 / 成员槽，被写的根绑定进 pack/unpack 写回集）；
 * - do-while 的体**恒在循环 thunk 内**执行（首轮用首轮标记移进 thunk），
 *   否则体里的 break/continue 无人吸收 ⇒ 信号逃出函数体；
 * - @nudo:as 是**类型覆盖**：被断言的表达式**仍求值**（副作用 + throws 域
 *   保留），本次的值取断言值（与 @nudo:replace 同款：`(原表达式, 注入值)`）；
 * - 解构临时名（`_d{n}`）的**首次分配**也要避让用户标识符（Bug 181）：与
 *   用户同名绑定重复词法声明 ⇒ 整模块求值失败 ⇒ 导出退化 unknown；
 * - 未 lowering 的语句统一 default unsupported（不得假精确 no-op）。
 */
import type {
  DoWhileStatement,
  ExportNamedDeclaration,
  Expression,
  ExpressionStatement,
  ForInStatement,
  ForOfStatement,
  ForStatement,
  FunctionDeclaration,
  IfStatement,
  ImportDeclaration,
  Node,
  ReturnStatement,
  Statement,
  SwitchStatement,
  TryStatement,
  VariableDeclaration,
  WhileStatement,
} from "@babel/types";
import type { TranspileOptions } from "../types.ts";
import {
  stmtCompletesControl,
  stmtReturns,
  withImplicitReturn,
  narrowNullishArmThunks,
  narrowTypeArmThunk,
  nullishGuardsOf,
  nullishRemoveCallOf,
  typeGuardOf,
  discriminantGuardsOf,
  narrowDiscriminantArmThunks,
  switchCaseFacts,
  narrowCaseLabelArmThunk,
  relGuardOf,
  narrowRelArmThunk,
  type NullishGuard,
  type RelGuard,
} from "../stmt-predicates.ts";
import {
  matchAsOverride,
  getFnFacets,
  indent,
  collectForkBindingNames,
  collectAssignedIds,
  collectLoopBodyTopLevelDeclNames,
  collectArrMutatorReceivers,
  collectPatternNames,
  finalizerBits,
  withClassNameHint,
  userIdentInfoOf,
  bumpDestrTmpSeq,
  internalTmpName,
  internalTmpNameSet,
  expandAliasNames,
  filterAliasGroups,
  collectScopeShadowNames,
  thisCarrierOf,
} from "../helpers.ts";
import { HOST_INTRINSIC_SET, UNDEF_LIT } from "../intrinsics.ts";
import { NudoUnsupportedError } from "../../unsupported.ts";
import {
  emitArrMutatorRebinds,
  emitDestructure,
  emitParamBinding,
  forkBindingDecls,
  forkJoinBindings,
  forkTmpNames,
  forkArmThunkExpr,
  switchTmpNames,
  matchOptionalRequire,
  catchMayRethrow,
} from "../emit.ts";
import { emitTranspileExpression } from "../transpile-dispatch.ts";
import { paramNamesOf, transpileFnBodyStmts } from "./fn-body.ts";
import { computeConstScope, copyConstScope } from "../helpers.ts";
// Bug 174：形参默认值里的 `this` 判定（声明面与表达式面共用同一实现）
import { asyncBodyPlan } from "../async-plan.ts";
import { transpileBlockAsThunk, extractForInitName } from "./block.ts";
import { transpileClass } from "../class-emit.ts";
/** switch 共享体函数名序号（跨语句/函数去重） */
let switchBodySeq = 0;

/** Bug 147：switch break 标签序号（跨语句/函数去重，标签即 break 信号靶） */
let switchBreakSeq = 0;

/**
 * Bug 147：当前正在发射的 switch 臂的 break 标签（栈式保存 / 恢复）。
 * switch 臂内的无标签 break 走 `$loopBreak(<标签>)`——带标签的 break 信号
 * 不被外层循环吸收（$isBreakTo 只匹配同标签），由 switch 臂入口的 catch
 * 吸收 ⇒ break 真的退出 switch（此前发 `return;` 只结束最近的 thunk：
 * if 臂内的 break 只结束 if 臂 thunk ⇒ 臂内后续语句照跑）。
 */
let curSwitchBreakLabel: string | null = null;

/** Bug 98：非纯 for-in 接收者临时名计数器（同块多 for-in 防重复声明） */
let forInRecvSeq = 0;

/**
 * Bug 228：for 主路径（`for (let i = …)`）的**循环变量捕获槽**序号
 * （跨语句/函数去重——同块多个 for 各自一个槽，不得重名）。
 * 槽内是体退出瞬间的循环变量最新写（continue 之前的写也在内），
 * $for 的 continue 臂经 `loopVar` 回调取用。
 */
let forLoopVarSeq = 0;

/** Bug 98：for-in 接收者重读是否无副作用——标识符 / 非计算成员链
 *  （o、o.sub、o.a.b）。其余形态（调用、计算键、三元/短路等）经
 *  emitTranspileExpression 可能含求值副作用，重读会重复副作用 →
 *  循环头一次性求值入 __firN 临时。 */
function isPureForInRecv(n: Expression): boolean {
  switch (n.type) {
    case "Identifier":
      return true;
    case "MemberExpression":
      return !n.computed && isPureForInRecv(n.object as Expression);
    default:
      return false;
  }
}

/**
 * Bug 178：for 头成员表达式的**根绑定名**（`o.x` → `o`、`o.a.b` → `o`）——
 * 头赋值写回的是根绑定（成员槽经 $set 就地更新 + 根重绑），根须进循环
 * pack/unpack 写回集（否则抽象出口把成员写覆盖成旧值）。根不可重绑
 * （`this.x` / 调用结果）返回 null（不进写回集）。
 */
function memberHeadRootName(m: Node): string | null {
  let cur = m as { type?: string; object?: unknown; name?: string };
  while (cur?.type === "MemberExpression") cur = cur.object as typeof cur;
  if (cur?.type === "Identifier" && cur.name) return cur.name;
  return null;
}

/** 宿主内建 `undefined` 是否仍是**未遮蔽**的字面量——nullish 守卫 / case 标签
 *  等静态窄化事实的前提。本单元内被用户绑定遮蔽（`const undefined = 5` /
 *  形参名）时，比较值/标签是绑定值，不得当 undefined 字面量识别
 *  （transpileFile / transpileBodyNode 经 opts.shadowedIntrinsics 线程化）。 */
function undefinedIsIntrinsicOf(opts: TranspileOptions): boolean {
  return opts.shadowedIntrinsics?.has("undefined") !== true;
}

/**
 * 循环 pack 源：同一次 pack 的绑定集合共享一个身份图 memo。
 *
 * memo 必须是**每次 pack 调用**新建的：循环/测试里的就地写会让同一个原始
 * Abs 的值变化，复用旧 memo 会拿回上一轮的陈旧副本。
 */
function packSrcOf(names: readonly string[], opts: TranspileOptions): string {
  const memo = internalTmpName("__packCopyMemo", opts);
  return `((${memo}) => $obj({ ${names.map((n) => `${JSON.stringify(n)}: $copy(${n}, ${memo})`).join(", ")} }))(new WeakMap())`;
}

/** 循环 unpack 源：从 pack 槽逐名读回（不复制——pack 已是本轮私有副本）。 */
function unpackSrcOf(names: readonly string[]): string {
  return `(__lp) => { ${names.map((n) => `${n} = $get(__lp, ${JSON.stringify(n)});`).join(" ")} }`;
}

/**
 * 循环体守卫事实（Bug 183 / 185）：测试为真 ⇒ 体内成立（**事实臂** cons）。
 * nullish 守卫（`v !== null`）与关系守卫（`x > 0`）同口径接线——`for` /
 * `while` 的测试在每轮迭代前求值、为真则进体，语义与 `if` 的事实臂等价。
 * 跳过规则（与既有 while 口径一致）：体侧守卫名有写（含 mutator
 * receiver）/ 体顶层同名词法声明 ⇒ 全部跳过（影子参数吞体侧写 / 重复
 * 声明 SyntaxError）；extraSkip 供 for 主路径排除循环变量（状态线程形参
 * ——影子会顶掉状态线程）。
 */
function loopBodyGuardsOf(
  test: Node | null | undefined,
  bodyLocalDecls: ReadonlySet<string>,
  bodyWrites: ReadonlySet<string>,
  extraSkip?: ReadonlySet<string>,
  undefinedIsIntrinsic = true,
): { nullish: NullishGuard[]; rel: RelGuard | undefined } {
  const skip = (name: string): boolean =>
    bodyWrites.has(name) ||
    bodyLocalDecls.has(name) ||
    (extraSkip?.has(name) ?? false);
  const nullish = nullishGuardsOf(test, undefinedIsIntrinsic).filter(
    (g) => g.arm === "cons" && !skip(g.name),
  );
  const rel = relGuardOf(test);
  return { nullish, rel: rel !== undefined && !skip(rel.name) ? rel : undefined };
}

/**
 * 循环体守卫剪影（Bug 183 / 185）：把守卫事实以**影子参数**接进循环体——
 * nullish 走 $removeNullish 通道（既有口径），关系走 $refineRel 通道
 * （事实臂；补集方向不可健全表示，见 narrowRelArmThunk）。关系剪影在
 * nullish 剪影**内侧**（同名时关系事实作用在已去 nullish 的值上）。
 */
function narrowLoopBody(
  body: string,
  guards: { nullish: NullishGuard[]; rel: RelGuard | undefined },
  depth: number,
  forkBindingNames: ReadonlySet<string> | readonly string[],
): string {
  let out = body;
  if (guards.rel) {
    out = narrowRelArmThunk(`{ ${out} }`, guards.rel, "cons", forkBindingNames);
  }
  if (guards.nullish.length > 0) {
    out = [
      `${indent(depth + 1)}((${guards.nullish.map((g) => g.name).join(", ")}) => {`,
      out,
      `${indent(depth + 1)}})(${guards.nullish.map((g) => nullishRemoveCallOf(g)).join(", ")});`,
    ].join("\n");
  }
  return out;
}

/**
 * 循环体 TranspileOptions 工厂（`for` 主/回退路径、`for-in`/`for-of`、
 * `while`、`do-while` 共用的 ~27 行样板，单一真值源）：
 *
 * - 体是**块作用域**（体 thunk 内）——体顶层词法声明在体内遮蔽外层绑定
 *   ⇒ 别名组按体顶层声明过滤（体内 fork 不得把外层别名伙伴拉进绑定集）；
 *   pack/unpack 发射在**外层**作用域 ⇒ 用未过滤的组。
 * - `bodyLocalDecls`（体顶层声明名）由**调用方分配**、此处填充——守卫
 *   跳过规则（loopBodyGuardsOf）与 pack 名集过滤都还要用它。
 * - `parentConsts` = 体所处外层 const 面，逐发射器不同：`while` /
 *   `do-while` / `for` 回退路径 = `opts.constNames`；`for` 主路径 =
 *   扣除循环变量后的面（循环变量是状态线程形参，遮蔽外层同名 const）；
 *   `for-in`/`for-of` = 循环头名单之上的面（loopConstNames）。
 *
 * 热路径约束：只是把各发射器原有的对象字面量搬进函数体——不新增任何
 * 分配（bodyLocalDecls 由调用方持有）或闭包。
 */
function loopBodyOptsOf(
  body: Statement,
  opts: TranspileOptions,
  parentConsts: ReadonlySet<string> | undefined,
  bodyLocalDecls: Set<string>,
): TranspileOptions {
  collectLoopBodyTopLevelDeclNames(body, bodyLocalDecls);
  const bodyAliasGroups = filterAliasGroups(opts.aliasGroups, bodyLocalDecls);
  return {
    ...opts,
    inLoop: (opts.inLoop ?? 0) + 1,
    loopLabel: undefined, // 标签属于本循环；体 opts 不得传给嵌套循环
    // Bug 173：循环体**不是** switch 臂——无标签 break 属于本循环
    // （switch 臂标记不得带进循环体：break 被当臂结束 → 循环跑到结束）
    inSwitchArm: false,
    // Bug 148：循环体是块作用域——其内声明的 const 不可再赋（名单自算）
    constNames: computeConstScope(
      body.type === "BlockStatement" ? body.body : [],
      parentConsts,
    ),
    ...(bodyAliasGroups ? { aliasGroups: bodyAliasGroups } : {}),
  };
}

export function transpileStatement(stmt: Statement, depth: number, opts: TranspileOptions): string {
  const pad = indent(depth);
  switch (stmt.type) {
    case "ExportNamedDeclaration":
      return emitExportNamedDeclaration(stmt, depth, opts);
    case "ExportAllDeclaration": {
      if (depth !== 0) return `${pad}/* nested export * skipped */`;
      if (opts.target === "host") {
        return `${pad}__nudoExportStar(${JSON.stringify(stmt.source.value)});`;
      }
      return `${pad}export * from ${JSON.stringify(stmt.source.value)};`;
    }
    case "ImportDeclaration":
      return emitImportDeclaration(stmt, depth, opts);
    case "ExportDefaultDeclaration": {
      const d = stmt.declaration;
      if (d.type === "FunctionDeclaration" || d.type === "ClassDeclaration") {
        // 匿名默认函数/类合成名字（原 <anonymous fn skipped> 整条丢失）；
        // 输出 `function X {}` + `export default X;`——真实 ESM 与 run.ts
        // 后处理（→ __nudoExport("default", X)）都合法。host target 直接
        // 发 `__nudoExport("default", X)`（不残留 export 语句）。
        // Bug 1058：匿名默认导出的合成名避开用户标识符（模块级绑定，撞名
        // ⇒ 重复词法声明 ⇒ 整模块 fail-closed）
        const name =
          d.id?.name ??
          (d.type === "FunctionDeclaration"
            ? internalTmpName("__nudoDefaultFn", opts)
            : internalTmpName("__nudoDefaultClass", opts));
        const named = d.id ? d : ({ ...d, id: { type: "Identifier", name } } as Statement);
        const inner = transpileStatement(named, depth + 1, opts);
        if (opts.target === "host") {
          return `${inner}\n${pad}__nudoExport("default", ${name});`;
        }
        return `${inner}\n${pad}export default ${name};`;
      }
      if (opts.target === "host") {
        return `${pad}__nudoExport("default", ${emitTranspileExpression(d as Expression, opts)});`;
      }
      return `${pad}export default ${emitTranspileExpression(d as Expression, opts)};`;
    }
    case "FunctionDeclaration":
      return emitFunctionDeclaration(stmt, depth, opts);
    case "ReturnStatement":
      return emitReturnStatement(stmt, depth, opts);
    case "ThrowStatement": {
      const arg = stmt.argument ? emitTranspileExpression(stmt.argument, opts) : "$lit(void 0)";
      return `${pad}$throw(${arg});`;
    }
    case "ExpressionStatement":
      return emitExpressionStatement(stmt, depth, opts);
    case "VariableDeclaration":
      return emitVariableDeclaration(stmt, depth, opts);
    case "IfStatement":
      return emitIfStatement(stmt, depth, opts);
    case "ForStatement":
      return emitForStatement(stmt, depth, opts);
    case "BlockStatement": {
      // 真块级作用域：同名 let/const 遮蔽外层，不得摊平成重复 let 声明
      const body = transpileFnBodyStmts(stmt.body, depth + 1, opts);
      return `${pad}{\n${body}\n${pad}}`;
    }
    case "SwitchStatement":
      return emitSwitchStatement(stmt, depth, opts);
    case "TryStatement":
      return emitTryStatement(stmt, depth, opts);
    case "ForOfStatement":
    case "ForInStatement":
      return emitForInStatement(stmt, depth, opts);
    case "WhileStatement":
      return emitWhileStatement(stmt, depth, opts);
    case "DoWhileStatement":
      return emitDoWhileStatement(stmt, depth, opts);
    case "ClassDeclaration": {
      return transpileClass(stmt, depth, opts);
    }
    case "BreakStatement": {
      // switch 臂内无标签 break = **退出 switch**（原生语义）——发带标签的
      // break 信号（$loopBreak(标签)）：信号穿过嵌套 thunk（if 臂内的 break
      // 此前只 `return;` 结束最近的 thunk ⇒ 臂内后续语句照跑、静态贯穿合流
      // 也照串），由 switch 臂入口的 catch 吸收；带标签 ⇒ 外层循环不吸收
      // （$isBreakTo 只匹配同标签）⇒ 不会误跳出外层循环。
      if (opts.inSwitchArm && !stmt.label) {
        if (curSwitchBreakLabel) {
          return `${pad}$loopBreak(${JSON.stringify(curSwitchBreakLabel)});`;
        }
        return `${pad}return;`;
      }
      // 带标签 break 可指向循环或 labeled block（`foo: { break foo; }`）；
      // 统一生成 $loopBreak(label)，由同标签循环/标签块吸收
      if (stmt.label) {
        return `${pad}$loopBreak(${JSON.stringify(stmt.label.name)});`;
      }
      if ((opts.inLoop ?? 0) > 0) {
        return `${pad}$loopBreak();`;
      }
      return `${pad}/* skip break (outside loop) */`;
    }
    case "ContinueStatement": {
      // continue 只能目标循环；labeled block 不可 continue
      if ((opts.inLoop ?? 0) > 0) {
        return `${pad}$loopContinue(${stmt.label ? JSON.stringify(stmt.label.name) : ""});`;
      }
      return `${pad}/* skip continue (outside loop) */`;
    }
    case "LabeledStatement": {
      // 标签包循环：把标签传给内层循环的 $for/$whileSeq/$forOf（信号匹配）
      if (
        stmt.body.type === "ForStatement" ||
        stmt.body.type === "WhileStatement" ||
        stmt.body.type === "DoWhileStatement" ||
        stmt.body.type === "ForOfStatement" ||
        stmt.body.type === "ForInStatement"
      ) {
        return transpileStatement(stmt.body, depth, { ...opts, loopLabel: stmt.label.name });
      }
      // 非循环标签块：break label 跳出本块——try 吸收同标签 break 信号
      const bodySrc = transpileStatement(stmt.body, depth + 2, opts);
      return [
        `${pad}{`,
        `${indent(depth + 1)}try {`,
        bodySrc,
        `${indent(depth + 1)}} catch (__e) {`,
        `${indent(depth + 2)}if (!$isBreakTo(__e, ${JSON.stringify(stmt.label.name)})) throw __e;`,
        `${indent(depth + 1)}}`,
        `${pad}}`,
      ].join("\n");
    }
    case "EmptyStatement":
    case "DebuggerStatement":
      // 良性无操作语句：显式 no-op（不得落 default throw）
      return "";
    default:
      throw new NudoUnsupportedError(
        `statement:${stmt.type}`,
        stmt.loc ? { line: stmt.loc.start.line, column: stmt.loc.start.column } : undefined,
      );
  }
}

function emitExportNamedDeclaration(
  stmt: ExportNamedDeclaration,
  depth: number,
  opts: TranspileOptions,
): string {
  if (opts.target === "host") return emitHostExportNamedDeclaration(stmt, depth, opts);
  const pad = indent(depth);
  const decl = stmt.declaration;
  if (!decl) {
    // 保留合法 ESM 形态：run.ts 后处理改写为 __nudoExport（modules 表
    // 注入绑定）；真实 .mjs import 消费者直接吃标准 ESM 语义。
    if (depth !== 0) return `${pad}/* nested export specifiers skipped */`;
    // ExportNamespaceSpecifier：`export * as ns from "spec"`（Babel 8 无 local）
    const nsSpecs = stmt.specifiers.filter((s) => s.type === "ExportNamespaceSpecifier");
    if (nsSpecs.length > 0) {
      if (!stmt.source) return `${pad}/* export * as without source skipped */`;
      return nsSpecs
        .map((s) => {
          // string 导出名（export * as "a-b" from）重发射必须保引号
          const exported =
            s.exported.type === "Identifier"
              ? s.exported.name
              : JSON.stringify(s.exported.value);
          return `${pad}export * as ${exported} from ${JSON.stringify(stmt.source!.value)};`;
        })
        .join("\n");
    }
    const specs = stmt.specifiers
      .filter(
        (s): s is typeof s & {
          local: { type?: string; name?: string; value?: string };
          exported: { type?: string; name?: string; value?: string };
        } => "local" in s,
      )
      .map((s) => {
        // DESIGN-003：别名导出段 `export { _nudo_1 as class }` /
        // string 导出名 `export { _nudo_1 as "a-b" }` 重发射——保留字
        // 导出名合法（IdentifierName），string 名必须保引号
        const local =
          s.local.type === "Identifier" ? s.local.name : JSON.stringify(s.local.value);
        const exported =
          s.exported.type === "Identifier"
            ? s.exported.name
            : JSON.stringify(s.exported.value);
        return local === exported ? local : `${local} as ${exported}`;
      })
      .join(", ");
    if (stmt.source) {
      return `${pad}export { ${specs} } from ${JSON.stringify(stmt.source.value)};`;
    }
    return `${pad}export { ${specs} };`;
  }
  const inner = transpileStatement(decl as Statement, depth, {
    ...opts,
    // Bug 21：export var 保持声明面（host ESM export 收集依赖声明语句；
    // 名字从模块级提升集扣除），init 内嵌套函数体由边界重算不受此标志
    ...(decl.type === "VariableDeclaration" && decl.kind === "var"
      ? { keepVarDecl: true }
      : {}),
  });
  // 顶层 export const/let/class：保留 export 面（run.ts 收集进 exports，
  // 供 directive case 经 callTranspiledExport 求值；模块图依赖此表）
  if (depth === 0 && (decl.type === "VariableDeclaration" || decl.type === "ClassDeclaration") && !pad) {
    // Bug 156：解构声明的 export 落点必须是**真实绑定**——`export { a, b };`
    // （而非内部临时名 `_d0`：临时名被当导出名 ⇒ 真实导出名丢失 ⇒ 跨模块
    // import 全灭）。运行时把 `export { … }` 改写成 __nudoExportLazy ✓
    // （live binding，与源级 `export { a }` 同口径）。
    if (decl.type === "VariableDeclaration") {
      // 仅**解构**声明走这条路（普通标识符声明仍是 `export const x = …`，
      // 导出名回收正则认这一形态）。
      const patNames = new Set<string>();
      for (const d of decl.declarations) {
        if (d.id.type === "Identifier") continue;
        collectPatternNames(d.id, patNames);
      }
      if (patNames.size > 0) {
        return `${inner}\n${pad}export { ${[...patNames].join(", ")} };`;
      }
    }
    return `export ${inner}`;
  }
  return inner;
}

function emitImportDeclaration(
  stmt: ImportDeclaration,
  depth: number,
  opts: TranspileOptions,
): string {
  if (opts.target === "host") return emitHostImportDeclaration(stmt, depth, opts);
  const pad = indent(depth);
  // 保留 import；run.ts 会改写为 __nudoBindImport
  const src = JSON.stringify(stmt.source.value);
  const named: string[] = [];
  let defaultName: string | null = null;
  let nsName: string | null = null;
  for (const s of stmt.specifiers) {
    if (s.type === "ImportSpecifier") {
      // Bug 177：任意模块导出名（ES2022 `import { "a-b" as x }`）——
      // imported 在字符串字面量形态下是 **StringLiteral 节点对象**，
      // `String(node)` 走 Object.prototype.toString ⇒ "[object Object]"
      // ⇒ 渲染出**非法 JS** ⇒ 整模块求值失败 ⇒ 值静默变 unknown
      // （假绿）。string 名必须保引号（与 export 侧同口径）。
      const imported =
        s.imported.type === "Identifier"
          ? s.imported.name
          : JSON.stringify((s.imported as unknown as { value: string }).value);
      named.push(imported === s.local.name ? imported : `${imported} as ${s.local.name}`);
    } else if (s.type === "ImportDefaultSpecifier") {
      defaultName = s.local.name;
    } else if (s.type === "ImportNamespaceSpecifier") {
      nsName = s.local.name;
    }
  }
  // Bug 153：默认 + 命名空间的**混合形态** `import d, * as ns from "…"`——
  // 摊平成 `{ default as d, * as ns }` 既不是合法 ESM，运行时改写也匹配
  // 不到命名空间分支（`*` 不紧跟 `{`）⇒ 具名分支把 `*` 当成被导入的
  // 名字 ⇒ __nudoBindImport(spec, "*") ⇒ 命名空间绑定折 unknown。
  // 改发**标准 ESM 形态**（run.ts 有对应的改写分支）。
  //
  // 命名空间**独占**形态 `import * as ns from "…"` 同理：`{ * as ns }` 不是
  // 合法 ESM（node: SyntaxError）⇒ 整模块求值失败 ⇒ 导出退化 unknown
  // （假 opaque-result）。发标准形态。
  if (nsName) {
    return defaultName
      ? `${pad}import ${defaultName}, * as ${nsName} from ${src};`
      : `${pad}import * as ${nsName} from ${src};`;
  }
  const specs = [
    ...named,
    ...(defaultName ? [`default as ${defaultName}`] : []),
  ];
  if (specs.length === 0) {
    return `${pad}import ${src};`;
  }
  return `${pad}import { ${specs.join(", ")} } from ${src};`;
}

/** ModuleExportName（Identifier | StringLiteral）→ 运行时字符串名。 */
function moduleExportNameOf(name: {
  type?: string;
  name?: string;
  value?: string;
}): string {
  return name.type === "Identifier" ? (name.name ?? "") : (name.value ?? "");
}

/**
 * host target import：import 绑定 → `__nudoBindImport` / `__nudoBindNamespace`
 * 直接绑定；mock 名改读 `__nudoEnv[<local>]` 且不登记 live refresh。
 *
 * live refresh：全部非 mock 绑定的刷新赋值在**首个产生绑定**的 import 语句后
 * 一次性注册（闭包在模块装载后才被刷新器调用，因此可引用文本上更晚声明的
 * 绑定）。
 */
function emitHostImportDeclaration(
  stmt: ImportDeclaration,
  depth: number,
  opts: TranspileOptions,
): string {
  const pad = indent(depth);
  if (depth !== 0) return `${pad}/* nested import skipped */`;
  const spec = JSON.stringify(stmt.source.value);
  // 无绑定副作用 import → 仅触发模块求值
  if (stmt.specifiers.length === 0) {
    return `${pad}void __nudoBindNamespace(${spec});`;
  }
  const lines: string[] = [];
  let liveBinds = 0;
  const bind = (local: string, init: string): void => {
    if (opts.mockNames?.has(local) === true) {
      lines.push(`${pad}let ${local} = __nudoEnv[${JSON.stringify(local)}];`);
      return;
    }
    liveBinds++;
    lines.push(`${pad}let ${local} = ${init};`);
  };
  for (const s of stmt.specifiers) {
    switch (s.type) {
      case "ImportDefaultSpecifier":
        bind(s.local.name, `__nudoBindImport(${spec}, "default")`);
        break;
      case "ImportNamespaceSpecifier":
        bind(s.local.name, `__nudoBindNamespace(${spec})`);
        break;
      case "ImportSpecifier":
        bind(
          s.local.name,
          `__nudoBindImport(${spec}, ${JSON.stringify(moduleExportNameOf(s.imported))})`,
        );
        break;
    }
  }
  const refresh = opts.hostImportRefresh;
  if (liveBinds > 0 && refresh !== undefined && !refresh.done) {
    refresh.done = true;
    lines.push(
      `${pad}__nudoRegisterImportRefresh(__nudoRefreshKeep = () => { ${refresh.binds.join(" ")} });`,
    );
  }
  return lines.join("\n");
}

/** export 声明携带的真实绑定名（函数/类 id；变量声明的解构模式展开）。 */
function exportedDeclBindingNames(decl: Statement): string[] {
  if (decl.type === "FunctionDeclaration" || decl.type === "ClassDeclaration") {
    return decl.id ? [decl.id.name] : [];
  }
  if (decl.type === "VariableDeclaration") {
    const names = new Set<string>();
    for (const d of decl.declarations) collectPatternNames(d.id, names);
    return [...names];
  }
  return [];
}

/**
 * host target export：不残留 `export` 语句，全部落成 `__nudoExport*` 调用。
 *
 * - 声明导出（`export function|class|const|let|var`）：本地声明（无前缀）+
 *   `__nudoExportLazy(<名>, () => <绑定>)`（ESM live binding 口径）；
 * - 本地 specifier（`export { a as b }`）：`__nudoExportLazy("b", () => a)`；
 * - re-export（`export { a as b } from "s"`）：lazy getter 读
 *   `__nudoBindImport("s", "a")`（依赖内部变异对导入方可见）；
 * - `export * as ns from "s"`：lazy namespace；
 * - `export * from "s"`：`__nudoExportStar("s")`（保留 export * 的显式面
 *   优先级语义，由宿主实现）。
 */
function emitHostExportNamedDeclaration(
  stmt: ExportNamedDeclaration,
  depth: number,
  opts: TranspileOptions,
): string {
  const pad = indent(depth);
  if (depth !== 0) return `${pad}/* nested export skipped */`;
  const decl = stmt.declaration;
  if (!decl) {
    const spec = stmt.source ? JSON.stringify(stmt.source.value) : null;
    const lines: string[] = [];
    for (const s of stmt.specifiers) {
      if (s.type === "ExportNamespaceSpecifier") {
        if (spec === null) continue;
        lines.push(
          `${pad}__nudoExportLazy(${JSON.stringify(moduleExportNameOf(s.exported))}, () => __nudoBindNamespace(${spec}));`,
        );
        continue;
      }
      if (s.type !== "ExportSpecifier") continue;
      const exported = JSON.stringify(moduleExportNameOf(s.exported));
      if (spec !== null) {
        lines.push(
          `${pad}__nudoExportLazy(${exported}, () => __nudoBindImport(${spec}, ${JSON.stringify(moduleExportNameOf(s.local))}));`,
        );
      } else {
        lines.push(
          `${pad}__nudoExportLazy(${exported}, () => ${moduleExportNameOf(s.local)});`,
        );
      }
    }
    return lines.join("\n");
  }
  const inner = transpileStatement(decl as Statement, depth, {
    ...opts,
    // Bug 21：export var 保持声明面（与 esm target 同口径——名字从模块级
    // 提升集扣除，声明留在原语句，供导出绑定读取）
    ...(decl.type === "VariableDeclaration" && decl.kind === "var"
      ? { keepVarDecl: true }
      : {}),
  });
  const lines = [inner];
  for (const name of exportedDeclBindingNames(decl as Statement)) {
    lines.push(`${pad}__nudoExportLazy(${JSON.stringify(name)}, () => ${name});`);
  }
  return lines.filter((l) => l !== "").join("\n");
}

function emitFunctionDeclaration(
  stmt: FunctionDeclaration,
  depth: number,
  opts: TranspileOptions,
): string {
  const pad = indent(depth);
  if (!stmt.id) return `${pad}// <anonymous fn skipped>`;
  // 嵌套函数声明不是 export 面；函数体是新边界，inLoop 必须归零。
  //
  // `export ` 只给**真实源导出名**（opts.exportedDeclNames 来自源
  // AST，transpileFile 收集）——历史 quirk「depth === 0 一律带 export」
  // 让 run.ts 的文本回收把私有顶层函数当导出 ⇒ `export *` 被本地私有
  // 同名函数遮蔽 / 私有名能被跨模块 import（漏 nudo:missing-export）/
  // 转译产物作为真实 ESM 时多出导出。缺省（低层单元未传集合）不发。
  const exportKw =
    opts.target !== "host" &&
    depth === 0 &&
    opts.exportedDeclNames?.has(stmt.id.name) === true
      ? "export "
      : "";
  // Bug 174：默认参数表达式在**本函数作用域**求值 ⇒ 其中的 `this` 是
  // **本函数自己的** this（严格模式：undefined / 调用接收者），不是外层
  // 作用域的 this。fnBodyHasThis 只扫 body ⇒ 形参默认值里的 this 不可见
  // ⇒ 默认表达式沿用外层 thisParam（外层方法体里拿到**外层对象**——
  // 自信错值 + 漏抛 TypeError）。故形参面一并扫描（fnParamsHaveThis，
  // 与表达式面共用同一判定）。
  // 五个 facet 一次遍历（同节点 memo）；形参默认值面 = hasParamsThis
  const facets = getFnFacets(stmt);
  const hasThis = facets.hasThis || facets.hasParamsThis;
  // `arguments`：体/嵌套箭头引用（含参数默认值）时建独立 tuple 槽（strict 映射，见 $arguments）
  const hasArgs = facets.hasOwnArguments;
  // Bug 201：async 体的挂起可行性——体（含 await）且所有 await 都在
  // **生成器级**位置 ⇒ 该体编译成宿主生成器（await = 真挂起点）。
  // 否则沿用既有 `$async(thunk)` 同步路径（发射产物逐字不变）。
  //
  // Bug 1072：**async generator 声明**（`async function*`）的体被编译成
  // `$gen(() => {…}, true)`——体是**普通箭头**，不是宿主生成器 ⇒ 体里的
  // `await` 若按 async 函数口径发射裸 `yield` ⇒ 产物不是合法 JS
  // （`new Function` SyntaxError: Unexpected strict mode reserved word）
  // ⇒ **整模块** fail-closed（导出全退化 unknown + 假 nudo:opaque-result）
  // ⇒ L2 门禁（nudo:entry-may-throw）不再触发 ⇒ 门禁假绿。
  // 与三条兄弟路径（函数表达式 / 对象方法 / class 方法）同口径：
  // `generator !== true` 才做 async 挂起计划 ⇒ async generator 体走
  // `$await(…)` 兜底（await 不是真挂起点，但产物合法）。
  const asyncPlan =
    stmt.async === true && stmt.generator !== true
      ? asyncBodyPlan(stmt.body, opts.disableAsyncGen)
      : undefined;
  const asyncGen = asyncPlan !== undefined && asyncPlan.hasAwait && asyncPlan.allSafe;
  // Bug 1058：arguments 槽名（`__nudoArgs`）必须避开用户标识符——用户
  // 自己声明同名绑定时，生成的 `let __nudoArgs = …` 与之**重复词法
  // 声明** ⇒ 产物非法 JS ⇒ 整模块 fail-closed（导出全退化 unknown +
  // 假 nudo:opaque-result ⇒ 门禁假绿）。
  const argsSlot = internalTmpName("__nudoArgs", opts);
  // Bug 1058：函数体自吸收 catch 的载体名同样避开用户标识符
  const fnRetCarrier = internalTmpName("__nudoFnRet", opts);
  // Bug 1160：this 载体名 = 转译单元共享名（prologue / 宿主生成器 hoist /
  // 体内 this 读三方同名；撞名经 `internalTmpName` 加 `_k` 后缀）。
  const thisSlot = thisCarrierOf(opts);
  const fnOpts: TranspileOptions = {
    ...opts,
    inLoop: 0,
    // 函数体是新边界：return 是本函数的返回，不是外层 if 臂的退出信号
    conditionalFlow: 0,
    inFunction: true,
    // Bug 201：async 体的 await 发射 `yield`（真挂起点）；非 async 体
    // 必须归零（嵌套同步函数不是生成器——`yield` 会是语法错误）
    inAsyncBody: asyncGen,
    ...(asyncGen && asyncPlan ? { asyncForAwaitGates: asyncPlan.forAwaitGates } : {}),
    ...(hasThis ? { thisParam: thisSlot } : {}),
    argsBinding: hasArgs ? argsSlot : undefined,
    // Bug 52：函数体是新生成器边界——外层 try 不覆盖体内 yield
    yieldTryCtx: 0,
  };
  const { sig, rest, prologue, defaulted } = emitParamBinding(
    stmt.params as Node[],
    indent(depth + 2),
    fnOpts,
  );
  const named = sig;
  // Bug 69：宿主签名默认参占位 `_p{i}` 按位补显式默认 `= void 0`——
  // 宿主 fn.length 与原生对齐（首个默认值前形参数；占位收 undefined
  // 的绑定语义不变，$orDefault 缺参归一同效）
  const defaultedSet = new Set(defaulted);
  const hostSig = named.map((p, i) => (defaultedSet.has(i) ? `${p} = void 0` : p));
  // Bug 7：缺参归一——省略的尾实参以宿主 undefined 绑定宿主签名形参，
  // 裸值流进 $add 等算子读 .shape 崩溃（假 may-throw），直接 return 时
  // 经结果通道泄漏裸 undefined。函数边界统一 $absVal 收形：省略 ≡ 显式
  // 传 undefined（$orDefault 默认参 / $typeof / $get nullish 硬抛均按
  // lit(undefined) 折叠）。rest 不经宿主绑定（restBind 按 arguments
  // 切片，长度保持原生），不在归一名单；sloppy arguments 别名只覆盖
  // i < arguments.length 的槽位，归一不改变 arguments.length。
  const bindParams = named.map((p) => `${indent(depth + 2)}${p} = $absVal(${p});`);
  // Bug 16：__this 必须 let——`this.s = v` 的赋值包装发射
  // `__this = $set(__this, …)` 重绑（构造调用 this 是对象时执行到），
  // const 重绑宿主 TypeError
  // 顺序：缺参归一 → __nudoArgs/__this 建立 → 参数默认值/解构（默认值
  // 可读自有 arguments（`a = arguments.length`）与 this——槽必须先于
  // prologue 声明，否则 TDZ ReferenceError）
  //
  // Bug 201：生成器路径（asyncGen）——宿主生成器**不自带** `this` /
  // `arguments`（生成器函数有自己的 this 绑定、无 arguments 绑定）⇒
  // 两个槽提到**宿主函数作用域**（生成器体闭包读它们，语义不变）。
  const thisPrologue = hasThis
    ? `${indent(depth + 2)}let ${thisSlot} = $rawThis(this);\n`
    : "";
  // 真实 function 有宿主 arguments → 投成独立 tuple（不破坏下方 restBind）
  const argsPrologue = hasArgs
    ? `${indent(depth + 2)}let ${argsSlot} = $arguments(arguments);\n`
    : "";
  // 生成器路径：宿主函数作用域里的 this / arguments 捕获（生成器体内不再发）
  const genHoist = [
    ...(hasThis ? [`${indent(depth + 1)}let ${thisSlot} = $rawThis(this);`] : []),
    ...(hasArgs ? [`${indent(depth + 1)}let ${argsSlot} = $arguments(arguments);`] : []),
  ];
  const bodyStmts =
    stmt.body.type === "BlockStatement"
      ? withImplicitReturn(
          stmt.body,
          [...bindParams, ...(asyncGen ? [] : [thisPrologue, argsPrologue]), ...prologue, transpileFnBodyStmts(stmt.body.body, depth + 2, fnOpts, {
            // Bug 21：函数体 var 提升边界——参数模式名已绑定，不得提升
            skip: paramNamesOf(stmt.params as Node[]),
          })]
            .filter(Boolean)
            .join("\n"),
          depth + 2,
        )
      : `${indent(depth + 2)}${bindParams.map((l) => `${l.trim()} `).join("")}${thisPrologue.trim()}${argsPrologue.trim()}return ${emitTranspileExpression(stmt.body as unknown as Expression, fnOpts)};`;
  // 函数体自包含边界：体内 $loopReturn 早退（循环 / if 臂 both-return）
  // 在函数自身边界收成返回值——裸宿主调用（e2e 真实 .mjs 导入、模块
  // 顶层互调）不经引擎调用边界（callTranspiledExportFullInner /
  // callAtFunctionBoundary 的 NudoReturn 捕获），必须体内自吸收。
  // 引擎路径不受影响：settleForkArms 对 ret 值恰一次交付（双 ret 抛出
  // / 单 ret 入 exits），此处捕获的即全部早退值。
  const bodySrc = bodyStmts.includes("$loopReturn(")
    ? [
        `${indent(depth + 1)}try {`,
        bodyStmts,
        // Bug 1058：catch 载体名避开用户标识符（与用户同名绑定重复词法
        // 声明 ⇒ 产物非法 JS ⇒ 整模块 fail-closed）
        `${indent(depth + 1)}} catch (${fnRetCarrier}) {`,
        `${indent(depth + 1)}  return $catchReturn(${fnRetCarrier});`,
        `${indent(depth + 1)}}`,
      ].join("\n")
    : bodyStmts;
  // Bug 44：rest 绑定经 $restBind——真调用按 arguments 切片包 $arr（长度
  // 保持原生）；签名符号执行的开放数组哨兵直通（不塌缩固定 1 元组）
  const restBind = rest
    ? `${indent(depth + 1)}const ${rest} = $restBind(arguments, ${named.length});\n`
    : "";
  // function* → $gen 收集 yield。宿主函数是普通 function（transpile 已去
  // generator 化）——__nudoNonCtor 标记由 hoistNonCtorMarkers
  // 提升到作用域顶部（先用后声明也可见，Bug 9）
  // Bug 141：async generator（`async function*`）——$gen 第二实参 = async
  // 位（next/return/throw 返 promise、装 @@asyncIterator 与
  // @@toStringTag "AsyncGenerator"）；**不进** $async 包装（原生 async
  // generator 返回 AsyncGenerator 本身，非 promise）——generator 分支在
  // async 分支之前，async generator 天然不走 $async。
  // Bug 325：函数**声明**形态的种类戳——声明转译后是宿主**普通函数**
  // （async 体包 $async、generator 体包 $gen）⇒ async/generator 种类
  // 无法从宿主侧反推 ⇒ 显式戳一次（$fnKindStamp）⇒ 标签面
  // （Object.prototype.toString）给出原生标签。
  //
  // 戳放在声明**之前**：函数声明提升 ⇒ 声明前的调用也可能先建出 fn Abs
  // ⇒ 戳晚一步就永久丢失（Abs 按宿主函数缓存）⇒ 提前戳。
  const declKind =
    stmt.async === true
      ? stmt.generator === true
        ? "async-generator"
        : "async"
      : stmt.generator === true
        ? "generator"
        : undefined;
  const kindStamp = declKind !== undefined
    ? `${pad}$fnKindStamp(${stmt.id.name}, ${JSON.stringify(declKind)});`
    : "";
  if (stmt.generator) {
    return [
      kindStamp,
      `${pad}${exportKw}function ${stmt.id.name}(${hostSig.join(", ")}) {`,
      restBind,
      `${indent(depth + 1)}return $gen(() => {`,
      bodySrc,
      `${indent(depth + 1)}}${stmt.async === true ? ", true" : ""});`,
      `${pad}}`,
    ]
      .filter((l) => l !== "")
      .join("\n");
  }
  // async 声明同口径：宿主函数是普通 function（body 包 $async）
  //
  // Bug 201：体（含 await）且所有 await 都在生成器级位置 ⇒ 编译成
  // **宿主生成器**（`$asyncGen(function*(){…})`）：`await` 发射 `yield`
  // = 真挂起点 ⇒ await 之后的语句不在调用点内联跑完（原生：恢复点是
  // 微任务）。`this` / `arguments` 提到宿主函数作用域（生成器不自带）。
  if (stmt.async) {
    if (asyncGen) {
      return [
        kindStamp,
        `${pad}${exportKw}function ${stmt.id.name}(${hostSig.join(", ")}) {`,
        restBind,
        ...genHoist,
        `${indent(depth + 1)}return $asyncGen(function* () {`,
        bodySrc,
        `${indent(depth + 1)}});`,
        `${pad}}`,
      ]
        .filter((l) => l !== "")
        .join("\n");
    }
    return [
      kindStamp,
      `${pad}${exportKw}function ${stmt.id.name}(${hostSig.join(", ")}) {`,
      restBind,
      `${indent(depth + 1)}return $async(() => {`,
      bodySrc,
      `${indent(depth + 1)}});`,
      `${pad}}`,
    ]
      .filter((l) => l !== "")
      .join("\n");
  }
  return [
    kindStamp,
    `${pad}${exportKw}function ${stmt.id.name}(${hostSig.join(", ")}) {`,
    restBind,
    bodySrc,
    `${pad}}`,
  ]
    .filter((l) => l !== "")
    .join("\n");
}

function emitReturnStatement(
  stmt: ReturnStatement,
  depth: number,
  opts: TranspileOptions,
): string {
  const pad = indent(depth);
  const asVar = matchAsOverride(stmt as Node, opts);
  // C2.1：循环体内 return 不是「回调返回」，而是函数提前返回
  // try 内：先 drain 抽象 throwExits，有则 rethrow 让 catch 吸收；正常返回值进 loopExits 后由出口 join
  // if 臂 thunk 内（conditionalFlow>0，非循环）：return 同理是函数退出
  // 信号——裸 JS return 只退出 thunk，值会被语句位 $fork 丢弃（fork-arm
  // × try-region 早退被 fall-through 覆盖的根因）；$loopReturn 沿
  // loopExits 侧信道由函数边界 join（runForkArm/settleForkArms 已按
  // kind:"ret" 处理：确定臂直抛 NudoReturn，抽象臂 exits.push 后兄弟
  // 臂/fall-through 继续探索）。
  const prefix =
    (opts.inLoop ?? 0) > 0 || (opts.conditionalFlow ?? 0) > 0 ? "$loopReturn" : "return";
  const markExpr = opts.tryMarkName ?? "$tryCurrentMark()";
  // return 表达式推导 hover：把返回值记到 **`return` 关键字起始位**
  // （不是 argument 起始位——后者与内部根标识符值读记录同键，
  // first-wins 会让 return 记录丢失；挂关键词位则 hover `return`
  // 精确命中，表达式内部子表达式由既有记录覆盖）。裸 `return;`
  // 不记录。$nodoPos 记录并原样返回（语义恒等；无收集器时直通）
  const retPos =
    opts.recordPositions && stmt.argument?.loc && stmt.loc
      ? `, ${stmt.loc.start.line}, ${stmt.loc.start.column}`
      : "";
  const emitRet = (src: string, mutNodes?: Node | null): string => {
    const rec = retPos === "" ? src : `$nodoPos(${src}${retPos})`;
    const retRebinds = mutNodes ? emitArrMutatorRebinds(mutNodes, opts, pad) : [];
    if ((opts.inTry ?? 0) > 0) {
      // Bug 145：临时量名固定为 `__nudoRet`——同一词法块内出现两个
      // return 时就是**重复 const 声明**（new Function 编译期 SyntaxError
      // → 整模块 fail-closed：同文件所有函数退化为 unknown / never）。
      // 修法：把每个 return 的临时量收进**自己的块**（块作用域独立 →
      // 不再同名冲突）；return 仍在块内——块不改变 return 的函数退出语义。
      //
      // Bug 1059：块内 `const __nudoRet = <用户表达式>` 与用户**外层**同名
      // 绑定**遮蔽** ⇒ 初始化器里的 `__nudoRet` 引用解析到引擎自己的
      // 绑定 ⇒ TDZ ReferenceError ⇒ 被用户自己的 catch 吞掉 ⇒ 原生 15 被
      // 算成 0（wrong-exact + 门禁假绿）。修法：临时量名避开用户标识符
      // （`__nudoRet` → `__nudoRet_1`）⇒ 用户表达式读到的仍是用户绑定。
      // 配对：声明 / `$pushLoopExit` / `prefix(...)` 三处用同一个名字。
      const retTmp = internalTmpName("__nudoRet", opts);
      const xsTmp = internalTmpName("__xs", opts);
      return [
        `${pad}{`,
        `${indent(depth + 1)}const ${retTmp} = ${rec};`,
        ...retRebinds,
        `${indent(depth + 1)}{`,
        `${indent(depth + 2)}const ${xsTmp} = $tryTakeSince(${markExpr});`,
        `${indent(depth + 2)}if (${xsTmp}.length) {`,
        `${indent(depth + 3)}$pushLoopExit(${retTmp});`,
        `${indent(depth + 3)}$throw(${xsTmp}.reduce((a, b) => $join(a, b)));`,
        `${indent(depth + 2)}}`,
        `${indent(depth + 2)}${opts.tryRethrowCatch ? "$tryReleaseSoftCatch();" : opts.hasTryHandler === false ? "$tryReleaseSoftOut();" : "$tryDigestSoftCatch();"}`,
        `${indent(depth + 1)}}`,
        `${indent(depth + 1)}${prefix}(${retTmp});`,
        `${pad}}`,
      ].join("\n");
    }
    if (retRebinds.length === 0) return `${pad}${prefix}(${rec});`;
    // Bug 1058：写回载体名避开用户标识符（用户自己有 `__mutRet` 时改名，
    // 否则 `let __mutRet = __mutRet` ⇒ TDZ ReferenceError）
    const mutTmp = internalTmpName("__mutRet", opts);
    return [
      `${pad}let ${mutTmp} = ${rec};`,
      ...retRebinds,
      `${pad}${prefix}(${mutTmp});`,
    ].join("\n");
  };
  if (asVar) {
    // Bug 164：@nudo:as 是**类型覆盖**（文档口径）——被断言的表达式
    // **仍要求值**：副作用与 throws 域保留，本次返回**结果取断言值**
    // （与 @nudo:replace 同款：逗号表达式 `(原表达式, 注入值)`——左值
    // 求值后丢弃，右值是本次断言的结果）。旧口径把 argument 整段换成
    // 注入常量 ⇒ 原表达式从不求值 ⇒ 副作用丢失 + 抛错域消失
    // （L2 `nudo:entry-may-throw` 假绿）+ 下游观测到错值。
    const argSrc = stmt.argument
      ? emitTranspileExpression(stmt.argument, opts)
      : "$lit(void 0)";
    return emitRet(`((${argSrc}), ${asVar})`, (stmt.argument as Node | null) ?? null);
  }
  if (!stmt.argument) return emitRet(`$lit(void 0)`);
  const retSrc = emitTranspileExpression(stmt.argument, opts);
  return emitRet(retSrc, stmt.argument as Node);
}

function emitExpressionStatement(
  stmt: ExpressionStatement,
  depth: number,
  opts: TranspileOptions,
): string {
  const pad = indent(depth);
  // Bug 49/51：数组 mutator 在 $invoke 调用点就地变更（引用语义——
  // $arrMutContainer 的 writeBack 保持 Abs 身份，变量别名 / 成员槽 /
  // Map 条目同步可见），语句与表达式位置统一走普通调用发射，不再
  // 语句位重绑（旧的「先求值再重绑」P0 顺序让同表达式内第二个
  // mutator 看到变更前容器，且 CallExpression 接收者丢变更）。
  // 此处的写回只剩 defineProperty/delete。
  const expr = stmt.expression as Expression;
  const exprRebinds = emitArrMutatorRebinds(expr, opts, pad);
  if (exprRebinds.length > 0) {
    return [
      `${pad}${emitTranspileExpression(expr, opts)};`,
      ...exprRebinds,
    ].join("\n");
  }
  return `${pad}${emitTranspileExpression(stmt.expression, opts)};`;
}

function emitVariableDeclaration(
  stmt: VariableDeclaration,
  depth: number,
  opts: TranspileOptions,
): string {
  const pad = indent(depth);
  // const → let：成员/下标写经不可变 Abs 更新后需重绑根绑定
  // Bug 21：var 是函数作用域——名字已提升到函数体顶部（hoistedVarNames）
  // 时改发赋值（块内 var 不再退化成块级绑定；重声明合法；跨块写共享）。
  // 未提升的名字（参数遮蔽 / export var 保持声明面 / 无提升层的合成体）
  // 保持 host `var` 声明（原生重声明/参数共存语义）。
  const isVar = stmt.kind === "var" && opts.keepVarDecl !== true;
  const hoistedVar = opts.hoistedVarNames;
  const kw = "let";
  const asVar = matchAsOverride(stmt as Node, opts);
  const lines: string[] = [];
  // Bug 15：跨语句共享计数器（挂 opts）——同行/无 loc 的多条解构不再
  // 因行号后缀撞车（重复 const → 整模块 SyntaxError）
  const tmpSeq = opts.destrTmpSeq ?? { n: 0 };
  for (const d of stmt.declarations) {
    if (d.id.type === "Identifier") {
      // 声明位位置记录（hover 重放 recordPositions 时）：把 init 绑定值
      // 记到 declarator id 起点——非调用初始化（三元 / 可选链 / 字面量）
      // 的局部量声明位 hover 由 A0 直读，不再依赖调用记录配对
      const recInit = (initSrc: string): string =>
        opts.recordPositions && d.id.loc
          ? `$nodoPos(${initSrc}, ${d.id.loc.start.line}, ${d.id.loc.start.column})`
          : initSrc;
      // issue #165：@nudo:assume 引理锚定——函数体直接子语句的
      // declarator 命中 anchorDeclNodes（节点身份判定：嵌套块 /
      // 嵌套函数体 / for-init 的声明不在集合内，天然不包）时，init
      // 最内层包 $assumeAnchor，把非 lit term α-改名 var(<name>)
      //（SSA：引理作用于绑定值，从定义点到作用域尾）。包在 $nodoPos
      // 位置记录与 @nudo:as 覆盖之**内层**——锚定最贴近求值、位置记录
      // 在外；as 覆盖命中时整体替换 init，不再锚定。解构分支不包
      //（保守）。运行时护栏（premise 不含该名 le 原子则直通原值）
      // 见 runtime/ops.ts。
      const anchored = opts.anchorDeclNodes?.has(d) === true;
      // 窄化捕获：闭包内 d.id 无法保持 Identifier 收窄，名字先落局部
      const declName = d.id.name;
      const anchorInit = (initSrc: string): string =>
        anchored
          ? `$assumeAnchor(${initSrc}, ${JSON.stringify(declName)})`
          : initSrc;
      if (isVar && hoistedVar?.has(d.id.name)) {
        // 提升绑定上的赋值：裸 `var x;` 无写跳过（绑定已由顶部 let 提供）
        if (!d.init) {
          if (depth === 0) {
            lines.push(`${pad}$recordBinding(${JSON.stringify(d.id.name)}, ${d.id.name});`);
          }
          continue;
        }
        const initSrc = emitTranspileExpression(
          d.init,
          // Bug 133：NamedEvaluation——`var K = class {}` 以绑定名为类名
          withClassNameHint(opts, d.init, d.id.name),
        );
        const init = recInit(
          // Bug 164：@nudo:as 是**类型覆盖**——原 init **仍求值**
          // （副作用 + throws 域保留），本次绑定的值取断言值。
          asVar ? `((${initSrc}), ${asVar})` : anchorInit(initSrc),
        );
        lines.push(`${pad}${d.id.name} = ${init};`);
        if (depth === 0) {
          lines.push(`${pad}$recordBinding(${JSON.stringify(d.id.name)}, ${d.id.name});`);
        }
        // 原 init 仍求值（Bug 164）⇒ 语句位写回（mutator / 正则状态 /
        // 可选链 delete）照发
        lines.push(...emitArrMutatorRebinds(d.init as Node, opts, pad));
        continue;
      }
      // @nudo:as：覆盖整个声明语句的 init
      const initSrc = d.init
        ? emitTranspileExpression(
            d.init,
            // Bug 133：NamedEvaluation——`const K = class {}` 以绑定名为类名
            withClassNameHint(opts, d.init, d.id.name),
          )
        : "$lit(void 0)";
      const init = recInit(
        // Bug 164：@nudo:as 是**类型覆盖**——原 init **仍求值**
        // （副作用 + throws 域保留），本次绑定的值取断言值。
        asVar ? `((${initSrc}), ${asVar})` : anchorInit(initSrc),
      );
      const declKw = isVar ? "var" : kw;
      lines.push(`${pad}${declKw} ${d.id.name} = ${init};`);
      // 顶层绑定表（checkSource varAbs / scanLiteralCalls 实参解析）
      if (depth === 0) {
        lines.push(`${pad}$recordBinding(${JSON.stringify(d.id.name)}, ${d.id.name});`);
      }
      // P1：表达式位置 mutator（`const x = a.pop()`）同样重绑容器
      // （Bug 164：原 init 仍求值 ⇒ 写回照发）
      if (d.init) {
        lines.push(...emitArrMutatorRebinds(d.init as Node, opts, pad));
      }
      continue;
    }
    // 解构：先绑定 init 到临时，再逐项 $get / $idx
    if (!d.init) {
      lines.push(`${pad}// destructure without init`);
      continue;
    }
    const initSrc = emitTranspileExpression(d.init, opts);
    // Bug 181：解构临时名的**首次分配**也必须避让用户标识符——`_d{n}`
    // 与用户同名绑定重复词法声明 ⇒ SyntaxError ⇒ 整模块求值失败 ⇒
    // 导出退化 unknown（假 nudo:opaque-result）。计数器创建处
    // （transpile.ts）已预置避让；此处再走一次避让路径，覆盖自带
    // 计数器的转译单元（transpileBodyNode 等）。
    bumpDestrTmpSeq(tmpSeq, userIdentInfoOf(opts));
    const tmp = `_d${tmpSeq.n++}`;
    // BUG-080：@nudo:as 的覆盖同样适用于**解构声明**——此前解构分支从头
    // 到尾不读 asVar ⇒ 指令被采集（asTargets 非空）却**静默失效**
    // （零诊断的假绿：两条语法等价的声明给出相反的类型）。
    //
    // 修法（与 Identifier 分支同口径）：覆盖值取代 init 的**值**，原 init
    // 仍求值（副作用 + throws 域保留——@nudo:as 是**类型覆盖**不是求值
    // 替换）。随后逐项 $get / $idx 从**覆盖值**取槽 ⇒ 每个绑定各自从
    // 覆盖形状取自己的槽（const { a, b } = expr ⇒ a 取槽 a、b 取槽 b）；
    // 槽缺 / 非对象覆盖 ⇒ 走既有成员读口径（原生同形）。
    const destrInit = asVar ? `((${initSrc}), ${asVar})` : initSrc;
    lines.push(`${pad}const ${tmp} = ${destrInit};`);
    lines.push(...emitArrMutatorRebinds(d.init as Node, opts, pad));
    // var 解构：名字已提升 → kw ""（赋值模式）；未提升（参数遮蔽 /
    // export var）→ host `var` 声明
    let destrKw = kw;
    if (isVar) {
      const patNames = new Set<string>();
      collectPatternNames(d.id, patNames);
      destrKw = [...patNames].some((n) => hoistedVar?.has(n)) ? "" : "var";
    }
    emitDestructure(d.id as Node, tmp, destrKw, pad, opts, lines, tmpSeq);
    // 顶层绑定表（checkSource varAbs / scanLiteralCalls 实参解析）——
    // 解构声明的子名与 Identifier 声明**同口径**登记。
    //
    // BUG-080 残留：此前**只**登记 Identifier 声明 ⇒ 解构子名在绑定表里
    // **缺席**（不是 any，是根本没有）⇒ 该名字在别处被当作实参时解析不出
    // 类型 ⇒ 调用点的契约检查被整条跳过 ⇒ **假绿**（同一份值走 Identifier
    // 形态会报 `nudo:constraint-violated`，走解构形态一声不吭）。
    //
    // 登记时机 = 解构绑定**之后**（值已就位）；范围 = 顶层（depth 0）——
    // 块内 / 形参 / catch / for 头的解构子名不是顶层绑定（与 Identifier
    // 分支的 depth 0 口径一致）。
    if (depth === 0) {
      const boundNames = new Set<string>();
      collectPatternNames(d.id, boundNames);
      for (const n of boundNames) {
        lines.push(`${pad}$recordBinding(${JSON.stringify(n)}, ${n});`);
      }
    }
  }
  return lines.join("\n");
}

function emitIfStatement(
  stmt: IfStatement,
  depth: number,
  opts: TranspileOptions,
): string {
  const pad = indent(depth);
  const test = emitTranspileExpression(stmt.test, opts);
  // 抽象分支：普通绑定 + 数组 mutator + 对象写根 都要 snapshot/join
  const recvSet = new Set<string>([
    ...collectForkBindingNames(stmt.consequent),
    ...collectForkBindingNames(stmt.alternate),
  ]);
  const testRebinds = emitArrMutatorRebinds(stmt.test as Node, opts, pad);
  const names = expandAliasNames(recvSet, opts);
  const padIn = indent(depth + 1);
  // 块级作用域：同一函数内多个 if 都改 errors 时，__fk0_* 不得重复声明
  const padDecl = names.length > 0 ? padIn : pad;
  // Bug 1151-b：fork 协议内部临时名（快照 `__fk0_*` / 臂槽位 / 臂标志
  // `__cont` / 测试载体 `__fkT` / 结果载体 `__fkR`）**避开用户标识符**
  // ——写死名会遮蔽用户同名绑定（自信错值 ⇒ 闸门假绿）。分配器与声明点
  // （`forkBindingDecls`）同源 ⇒ 「成对一致」。
  const fk = forkTmpNames(names, opts);
  const consRaw = transpileBlockAsThunk(stmt.consequent, depth, {
    ...opts,
    conditionalFlow: (opts.conditionalFlow ?? 0) + 1,
  });
  const altRaw = stmt.alternate
    ? transpileBlockAsThunk(stmt.alternate, depth, {
        ...opts,
        conditionalFlow: (opts.conditionalFlow ?? 0) + 1,
      })
    : null;
  // nullish 守卫臂收窄（issue #97）：`if (p === null) …` 的 else 臂 /
  // `if (p !== null) …` 的 then 臂内，p 以 $removeNullish 影子重绑——
  // 后续 p.major 不再记 may-throw。守卫名在 fork 绑定集（臂内写）时跳过。
  // typeof 类型守卫（Bug 23）：事实臂绑匹配成员、对侧臂绑补集。
  // issue #118 v3 / #120：多名复合测试（`obj == null || node.p == null`
  // 穿透臂双事实）与赋值即守卫（`if ((m = re.exec(s)))`）经
  // nullishGuardsOf 一臂多事实齐用。
  const guards = nullishGuardsOf(stmt.test, undefinedIsIntrinsicOf(opts));
  const tguard = typeGuardOf(stmt.test);
  const dguards = discriminantGuardsOf(stmt.test);
  // 关系守卫（Bug 1）：`if (x >= 0)` 真臂 x 影子重绑带界 Abs——
  // 裸 `return x` 不再丢守卫事实（return-constraint gate 假阳根因）
  const rguard = relGuardOf(stmt.test);
  const consNarrowed = narrowRelArmThunk(
    narrowDiscriminantArmThunks(
      narrowTypeArmThunk(
        narrowNullishArmThunks(consRaw, guards, "cons", recvSet),
        tguard,
        "cons",
        recvSet,
      ),
      dguards,
      "cons",
      recvSet,
    ),
    rguard,
    "cons",
    recvSet,
  );
  const altNarrowed =
    altRaw === null
      ? null
      : narrowDiscriminantArmThunks(
          narrowTypeArmThunk(
            narrowNullishArmThunks(altRaw, guards, "alt", recvSet),
            tguard,
            "alt",
            recvSet,
          ),
          dguards,
          "alt",
          recvSet,
        );
  const cons = forkArmThunkExpr(consNarrowed, 0, names, padIn, opts);
  // 缺 else：names 空时**省略** $fork 第三参（不得发裸 undefined 哨兵——
  // 那是标识符，被遮蔽后会把 Abs 当 alternate 函数传进去）；有 fork 绑定时
  // 需要真 alternate 参与 join，折 UNDEF_LIT。
  const alt = names.length
    ? forkArmThunkExpr(
        altNarrowed === null ? `() => ${UNDEF_LIT}` : altNarrowed,
        1,
        names,
        padIn,
        opts,
      )
    : altNarrowed;
  const altArg = alt === null ? "" : `, ${alt}`;
  // Bug 135：fork 快照（__fk0_*）是**臂的基线**——基线必须取自**测试
  // 求值之后**。此前快照行排在 $fork(...) 之前，而测试表达式是 $fork 的
  // 第一实参（后求值）——于是测试里的副作用（f() 计数 / getter / 赋值 /
  // 自增）在臂入口被 `n = $copy(__fk0_n)` 整体回滚（原生保留）。
  // 修法：测试先落临时量 __fkT，再取快照，$fork 用 __fkT。
  const joinLines = names.length
    ? [
        `${padDecl}const ${fk.test} = (${test});`,
        ...testRebinds,
        ...forkBindingDecls(names, padDecl, opts),
      ]
    : testRebinds;
  const applyJoin = names.length
    ? forkJoinBindings(names, padDecl, opts).join("\n")
    : "";
  // 有 fork 绑定（快照基线）时测试已落 __fkT；否则测试仍是 $fork 的实参
  const testRef = names.length > 0 ? fk.test : test;
  // 两分支都以 return/throw 退出时，$fork 即函数返回值
  // （循环/switch 臂内：用 $loopReturn 抛 NudoReturn，与早退语义一致）
  // else-if 链经 completeElseChains 补全最终 else 后同样命中本路径。
  const inCtrl = (opts.inLoop ?? 0) > 0;
  const openBlock = names.length > 0 ? `${pad}{` : null;
  const closeBlock = names.length > 0 ? `${pad}}` : null;
  if (
    stmtReturns(stmt.consequent) &&
    stmt.alternate !== undefined &&
    stmt.alternate !== null &&
    stmtReturns(stmt.alternate)
  ) {
    if (names.length === 0) {
      return [
        ...joinLines,
        inCtrl
          ? `${pad}$loopReturn($fork(${testRef}, ${cons}${altArg}));`
          : `${pad}return $fork(${testRef}, ${cons}${altArg});`,
      ].join("\n");
    }
    return [
      openBlock,
      ...joinLines,
      `${padDecl}const ${fk.result} = $fork(${testRef}, ${cons}${altArg});`,
      applyJoin,
      inCtrl ? `${padDecl}$loopReturn(${fk.result});` : `${padDecl}return ${fk.result};`,
      closeBlock,
    ].join("\n");
  }
  return [
    openBlock,
    ...joinLines,
    `${padDecl}$fork(${testRef}, ${cons}${altArg});`,
    applyJoin,
    closeBlock,
  ]
    .filter((l) => l !== null && l !== "")
    .join("\n");
}

function emitForStatement(
  stmt: ForStatement,
  depth: number,
  opts: TranspileOptions,
): string {
  const pad = indent(depth);
  const initName = extractForInitName(stmt.init);
  if (!initName) {
    // 回退：非 `let i = …` 形态（空 init / 赋值表达式 / 逗号序列）。
    // 此前整条循环被丢弃（unsupported for-init）——循环体零次执行。
    // 修复：init 就地求值（副作用写真实绑定），$for 以合成计数器作状态
    // 线程，test/update/body 闭包读真实绑定；计数器恒前进，不触发
    // 不动点早停（外部绑定经 pack/unpack 收口）。
    const initSrc =
      stmt.init == null
        ? null
        : stmt.init.type === "VariableDeclaration"
          ? transpileStatement(stmt.init as Statement, depth, opts)
          : `${pad}${emitTranspileExpression(stmt.init as Expression, opts)};`;
    const testSrc = stmt.test ? emitTranspileExpression(stmt.test, opts) : "$lit(true)";
    // 步进表达式只取副作用（写真实绑定）；状态线程是合成计数器。
    // i++/i-- 的后置值语义会丢自增写回（步进闭包内无语句级 rebind pass），
    // 与主路径同口径：标识符 Update 强制 `name = $updateAdd/$updateSub(name)`。
    // Bug 363 配套：步进里的赋值是**循环携带**的重绑定（可变绑定在路径上
    // 取并集是合法 JS）⇒ 赋值记录的 conditional 标记必须为真，否则
    // `for (let c = this; c; c = c.parent)` 这类循环变量改写被误判成
    // 「结构可赋值」违例（real-package 零 FP 红线）。
    const updateOpts: TranspileOptions = {
      ...opts,
      conditionalFlow: (opts.conditionalFlow ?? 0) + 1,
    };
    const stepPart = (u: Node): string => {
      const upd = u as { type?: string; operator?: string; argument?: { type?: string; name?: string }; expressions?: unknown[] };
      if (upd.type === "UpdateExpression" && upd.argument?.type === "Identifier" && upd.argument.name) {
        return `${upd.argument.name} = ${upd.operator === "++" ? "$updateAdd" : "$updateSub"}(${upd.argument.name})`;
      }
      if (upd.type === "SequenceExpression") {
        return (upd.expressions ?? []).map((e) => stepPart(e as Node)).join(", ");
      }
      return emitTranspileExpression(u as Expression, updateOpts);
    };
    const updateSrc = stmt.update ? stepPart(stmt.update as Node) : null;
    // 循环体是**块作用域**（体 thunk 内）——体顶层词法声明在体内遮蔽外层
    // 绑定 ⇒ 别名组按体顶层声明过滤（体内 fork 不得把外层别名伙伴拉进绑定
    // 集：伙伴名在体内指向的是体局部绑定 ⇒ 复制/重绑它会断开外层别名身份）。
    // pack/unpack 发射在**外层**作用域（$for 的 opts 实参）⇒ 用未过滤的组。
    const bodyLocalDecls = new Set<string>();
    const forBodyOpts = loopBodyOptsOf(stmt.body, opts, opts.constNames, bodyLocalDecls);
    const bodyStmts =
      stmt.body.type === "BlockStatement"
        ? stmt.body.body.map((s) => transpileStatement(s, depth + 2, forBodyOpts)).join("\n")
        : transpileStatement(stmt.body, depth + 2, forBodyOpts);
    const max = opts.maxLoopIters ?? 8;
    const assigned = new Set<string>();
    collectAssignedIds(stmt.body, assigned);
    collectAssignedIds(stmt.test, assigned);
    collectAssignedIds(stmt.update, assigned);
    collectArrMutatorReceivers(stmt.body, assigned);
    const names = expandAliasNames([...assigned].filter((n) => !HOST_INTRINSIC_SET.has(n) && !bodyLocalDecls.has(n)), opts);
    // Bug 183：for 循环体接守卫事实（nullish + 关系）——测试在每轮迭代
    // 前求值、为真则进体，语义与 `if`/`while` 的事实臂等价（此前 for
    // 分支一条都没接 ⇒ `for (; v !== null; )` 与 `while (v !== null)`
    // 结论相反）。跳过规则同 while（体侧写 / 体顶层同名声明）。
    const bodyWrites = new Set<string>();
    collectAssignedIds(stmt.body, bodyWrites);
    collectArrMutatorReceivers(stmt.body, bodyWrites);
    const loopGuards = loopBodyGuardsOf(stmt.test, bodyLocalDecls, bodyWrites, undefined, undefinedIsIntrinsicOf(opts));
    const bodyNarrowed = narrowLoopBody(bodyStmts, loopGuards, depth + 1, names);
    const packSrc = names.length === 0 ? null : packSrcOf(names, opts);
    const unpackSrc = names.length === 0 ? null : unpackSrcOf(names);
    const optsSrc = (() => {
      const extra = opts.loopLabel ? `label: ${JSON.stringify(opts.loopLabel)}` : "";
      if (!extra) return packSrc && unpackSrc
        ? `, { pack: () => ${packSrc}, unpack: ${unpackSrc} }`
        : "";
      return packSrc && unpackSrc
        ? `, { pack: () => ${packSrc}, unpack: ${unpackSrc}, ${extra} }`
        : `, { ${extra} }`;
    })();
    // Bug 1159：$for 的状态线程形参名在**用户表达式的作用域里**（测试
    // thunk / 体 thunk 都直接内联用户源码）⇒ 写死 `__n` 会遮蔽用户同名
    // 绑定（条件与体读到合成计数器而非用户绑定 ⇒ 自信错值）。实际名经
    // 分配器；无碰撞时逐字不变。
    const forState = internalTmpName("__n", opts);
    const stepSrc = updateSrc
      ? `(${forState}) => { ${updateSrc}; return $add(${forState}, $lit(1)); }`
      : `(${forState}) => $add(${forState}, $lit(1))`;
    return [
      initSrc,
      `${pad}// for (fallback: non-declaration init) → $for (bounded unroll, max=${max})`,
      `${pad}$for(`,
      `${indent(depth + 1)}$lit(0),`,
      `${indent(depth + 1)}(${forState}) => ${testSrc},`,
      `${indent(depth + 1)}${stepSrc},`,
      `${indent(depth + 1)}(${forState}) => {`,
      bodyNarrowed,
      `${indent(depth + 1)}  return ${forState};`,
      `${indent(depth + 1)}},`,
      `${indent(depth + 1)}${max}${optsSrc}`,
      `${pad});`,
    ]
      .filter((l) => l !== null && l !== "")
      .join("\n");
  }
  const initExpr =
    stmt.init && stmt.init.type === "VariableDeclaration" && stmt.init.declarations[0]?.init
      ? emitTranspileExpression(stmt.init.declarations[0].init, opts)
      : "$lit(void 0)";
  const testSrc = stmt.test ? emitTranspileExpression(stmt.test, opts) : "$lit(true)";
  // for 步进：**只取副作用**，状态线程恒为循环变量自身（与 fallback 路径
  // 同口径——fallback 用合成计数器 `__n`，主路径用 `initName`）。
  // - Bug 132：标识符 Update 必须走 $updateAdd/$updateSub（ToNumeric ± 1）。
  //   $add 是二元 `+`：bigint + number 走 mixed-bigint 抛 TypeError 臂、
  //   string 左操作数走字符串拼接臂（"5"++ 原生 6，拼接得 "51"）。
  // - Bug 144：步进表达式的**值**不得作状态线程——序列表达式（`i++, n++`）
  //   的值是末项值（后缀自增回旧值），会让循环变量停滞 / 超跑。
  // - Bug 363 配套：步进里的赋值是**循环携带**的重绑定 ⇒ 赋值记录的
  //   conditional 标记必须为真（否则 `for (let c = this; c; c = c.parent)`
  //   这类循环变量改写被误判成结构可赋值违例 ⇒ real-package 零 FP 红线）。
  const updateSrc =
    stmt.update && stmt.update.type === "UpdateExpression" &&
    stmt.update.argument.type === "Identifier"
      ? `${stmt.update.argument.name} = ${stmt.update.operator === "++" ? "$updateAdd" : "$updateSub"}(${stmt.update.argument.name})`
      : stmt.update
        ? emitTranspileExpression(stmt.update, {
            ...opts,
            conditionalFlow: (opts.conditionalFlow ?? 0) + 1,
          })
        : null;
  // 循环变量是状态线程参数（`(initName) => {…}`），遮蔽外层
  // const/import 同名绑定（Bug ②）——体内赋值合法，扣除误折面
  const loopParentConsts =
    opts.constNames && opts.constNames.has(initName)
      ? copyConstScope(opts.constNames, new Set([initName]))
      : opts.constNames;
  // 循环体是**块作用域**（体 thunk 内）——体顶层词法声明在体内遮蔽外层
  // 绑定 ⇒ 别名组按体顶层声明过滤（体内 fork 不得把外层别名伙伴拉进绑定
  // 集）。pack/unpack 发射在**外层**作用域（$for 的 opts 实参）⇒ 用未过
  // 滤的组。
  const bodyLocalDecls = new Set<string>();
  const forBodyOpts = loopBodyOptsOf(stmt.body, opts, loopParentConsts, bodyLocalDecls);
  const bodyStmts =
    stmt.body.type === "BlockStatement"
      ? stmt.body.body.map((s) => transpileStatement(s, depth + 2, forBodyOpts)).join("\n")
      : transpileStatement(stmt.body, depth + 2, forBodyOpts);
  const max = opts.maxLoopIters ?? 8;
  const assigned = new Set<string>();
  collectAssignedIds(stmt.body, assigned);
  collectAssignedIds(stmt.test, assigned);
  collectAssignedIds(stmt.update, assigned);
  collectArrMutatorReceivers(stmt.body, assigned);
  const names = expandAliasNames([...assigned].filter((n) => n !== initName && !HOST_INTRINSIC_SET.has(n) && !bodyLocalDecls.has(n)), opts);
  // Bug 183：for 循环体接守卫事实（nullish + 关系）——同 fallback 路径。
  // 循环变量本身（状态线程形参 initName）排除：影子参数会顶掉状态
  // 线程（`for (let i = 0; i < 3; i++)` 的 i 是状态线程，不得被影子
  // 参数遮蔽）。
  const bodyWrites = new Set<string>();
  collectAssignedIds(stmt.body, bodyWrites);
  collectArrMutatorReceivers(stmt.body, bodyWrites);
  const loopGuards = loopBodyGuardsOf(
    stmt.test,
    bodyLocalDecls,
    bodyWrites,
    new Set([initName]),
    undefinedIsIntrinsicOf(opts),
  );
  const bodyNarrowed = narrowLoopBody(bodyStmts, loopGuards, depth + 1, names);
  const packSrc = names.length === 0 ? null : packSrcOf(names, opts);
  const unpackSrc = names.length === 0 ? null : unpackSrcOf(names);
  // Bug 228：循环变量（状态线程形参 initName）在体里是**形参槽**——体对它的
  // 写在 continue 抛出信号时随信号丢失（$for 拿不到「体退出瞬间的值」）。
  // 原生：for (let i…) 每轮绑定独立，continue 前的 `i = 5` 写进本轮绑定
  // ⇒ 下一轮 i++ 得 6。修法：体用 try/finally 把最新值写回共享槽，
  // $for 的 continue 臂经 loopVar 回调取用（迭代次数/结果随之正确）。
  //
  // Bug 1073：槽名必须**避开用户标识符**——用户源码里声明了同名绑定
  // （`const __nudoLv0 = 1;`）时，生成的 `let __nudoLv0;` 与之**重复
  // 词法声明**（同作用域）⇒ 产物不是合法 JS ⇒ `new Function`
  // SyntaxError（Identifier has already been declared）⇒ **整模块**
  // fail-closed（导出全退化 unknown ⇒ L2 门禁假绿）。与 Bug 1058/1059
  // 同款修法（internalTmpName：撞名则加 `_k` 后缀；无碰撞时原名返回
  // ⇒ 产物逐字不变）。
  const loopVarSlot = internalTmpName(`__nudoLv${forLoopVarSeq++}`, opts);
  const optsSrc = (() => {
    const parts: string[] = [];
    if (packSrc && unpackSrc) parts.push(`pack: () => ${packSrc}`, `unpack: ${unpackSrc}`);
    parts.push(`loopVar: () => ${loopVarSlot}`);
    if (opts.loopLabel) parts.push(`label: ${JSON.stringify(opts.loopLabel)}`);
    return `, { ${parts.join(", ")} }`;
  })();
  // 体的 finally 捕获循环变量的最新写（continue / break 抛出信号时也跑到）
  const bodyCaptured = bodyNarrowed
    .split("\n")
    .map((l) => (l.trim() === "" ? l : `${indent(depth + 2)}${l}`))
    .join("\n");
  return [
    `${pad}let ${loopVarSlot};`,
    `${pad}// for → $for (bounded unroll, max=${max})`,
    `${pad}$for(`,
    `${indent(depth + 1)}${initExpr},`,
    `${indent(depth + 1)}(${initName}) => ${testSrc},`,
    `${indent(depth + 1)}(${initName}) => { ${updateSrc ? `${updateSrc};` : ""} return ${initName}; },`,
    `${indent(depth + 1)}(${initName}) => {`,
    `${indent(depth + 2)}try {`,
    bodyCaptured,
    `${indent(depth + 2)}  return ${initName};`,
    `${indent(depth + 2)}} finally {`,
    `${indent(depth + 3)}${loopVarSlot} = ${initName};`,
    `${indent(depth + 2)}}`,
    `${indent(depth + 1)}},`,
    `${indent(depth + 1)}${max}${optsSrc}`,
    `${pad});`,
  ].join("\n");
}

function emitSwitchStatement(
  stmt: SwitchStatement,
  depth: number,
  opts: TranspileOptions,
): string {
  const pad = indent(depth);
  const disc = emitTranspileExpression(stmt.discriminant as Expression, opts);
  // `src`：臂体在源 AST 里的**原数组引用**——`case 1: default: body` 形态下
  // default 的 consequent 与前一个 case 臂共享同一份（Bug 146：合并阶段
  // 不得再串一份 → 体被执行两次）。
  type Arm = {
    tests: string[];
    /** case 测试的源节点（Bug 184：case 标签窄化事实的字面量识别） */
    testNodes: Node[];
    stmts: Statement[];
    isDefault: boolean;
    src?: Statement[];
  };

  // 1) 空 case 测试并入下一有体臂；default 独立
  const pre: Arm[] = [];
  let pendingTests: string[] = [];
  let pendingNodes: Node[] = [];
  for (const c of stmt.cases) {
    const testSrc = c.test ? emitTranspileExpression(c.test as Expression, opts) : null;
    if (testSrc === null) {
      // Bug 146：default 紧跟空 case（`case 1: default: body`）——default
      // 的 consequent 与前一个 case 臂**共享同一份语句**：case 臂负责
      // 「命中 case 1 时落入 default 体」，default 臂负责「全不命中时也
      // 落入 default 体」。两条路径各自引用同一份体，但**合并阶段不得
      // 再串一份**（否则体在同一条臂里执行两次：返回值错、副作用翻倍）。
      if (pendingTests.length > 0 && c.consequent.length > 0) {
        pre.push({ tests: pendingTests, testNodes: pendingNodes, stmts: c.consequent, isDefault: false, src: c.consequent });
        pendingTests = [];
        pendingNodes = [];
      }
      pre.push({ tests: [], testNodes: [], stmts: c.consequent, isDefault: true, src: c.consequent });
      continue;
    }
    if (c.consequent.length === 0) {
      pendingTests.push(testSrc);
      pendingNodes.push(c.test as Node);
      continue;
    }
    pre.push({ tests: [...pendingTests, testSrc], testNodes: [...pendingNodes, c.test as Node], stmts: c.consequent, isDefault: false });
    pendingTests = [];
    pendingNodes = [];
  }
  if (pendingTests.length > 0) {
    pre.push({ tests: pendingTests, testNodes: pendingNodes, stmts: [], isDefault: false });
  }

  // 2) 非 break 贯穿：把后续臂体串进当前臂（JS 语义）
  const merged: Arm[] = pre.map((arm) => ({ ...arm, tests: [...arm.tests], stmts: [...arm.stmts] }));
  for (let i = 0; i < merged.length; i++) {
    const arm = merged[i]!;
    const body = [...arm.stmts];
    let j = i + 1;
    while (j < merged.length && !stmtCompletesControl(body[body.length - 1] as Statement)) {
      const next = merged[j]!;
      // Bug 146：下一个臂与当前臂**共享同一份源语句**（default 紧跟空
      // case）——体已在当前臂里，不得再串一份（否则执行两次）。
      if (!(next.src && next.src === arm.src)) {
        body.push(...next.stmts);
        if (stmtCompletesControl(body[body.length - 1] as Statement)) break;
      }
      j++;
    }
    arm.stmts = body;
  }

  const armReturns = (arm: Arm): boolean =>
    arm.stmts.length > 0 && arm.stmts.every(stmtReturns);
  const nonDefaultArms = merged.filter((a) => !a.isDefault);
  const defaultArm = merged.find((a) => a.isDefault);
  // 无 default 不得当终止；allReturn 仍按源 default 判定
  const allReturn =
    defaultArm !== undefined &&
    nonDefaultArms.length > 0 &&
    nonDefaultArms.every(armReturns) &&
    armReturns(defaultArm);

  // Bug 184：case 标签窄化事实（命中 / 排除）——按臂序，与 merged 同序
  const caseFacts = switchCaseFacts(
    stmt.discriminant,
    pre.map((a) => ({ tests: a.testNodes, isDefault: a.isDefault })),
    undefinedIsIntrinsicOf(opts),
  );

  const caseLines: string[] = [];
  const sharedBodyDecls: string[] = [];
  let defaultSrc: string | null = null;
  const bodyIdxBase = switchBodySeq;
  let bodyIdx = 0;
  const armOpts: TranspileOptions = {
    ...opts,
    inLoop: (opts.inLoop ?? 0) + 1,
    inSwitchArm: true,
  };
  const recvSet = new Set<string>([
    ...merged.flatMap((a) => collectForkBindingNames(...a.stmts)),
    ...collectForkBindingNames(stmt.discriminant as Node),
  ]);
  const names = expandAliasNames(recvSet, opts);
  // 源有 default 则每臂一槽；无 default 时多一个「no-match=快照」槽
  const nArms = merged.filter((a) => !a.isDefault).length + (defaultArm ? 1 : 0) + (defaultArm ? 0 : 1);
  // Bug 147：switch 臂的 break 标签——带标签的 break 信号不被外层循环
  // 吸收（$isBreakTo 只匹配同标签），由 switch 臂入口的 catch 吸收。
  // Bug 1159：标签是**信号字符串**（`$loopBreak(标签)` / `$isBreakTo` 按
  // 字符串比对）⇒ 写死名会与用户同名标签（`__nudoSw0: { … break; }`）相撞：
  // 臂内无标签 break 的信号被用户的**标签块** catch 吸收 ⇒ 不退出 switch
  // （少执行/多执行后续语句 ⇒ 自信错值）。实际名经分配器避让用户词形；
  // 无碰撞时基名原样返回 ⇒ 产物逐字不变。
  const breakLabel = internalTmpName(`__nudoSw${switchBreakSeq++}`, opts);
  // Bug 168：case 测试**惰性**求值——$switch 的 cases 实参数组在调用前
  // 全部求值（JS 实参语义）⇒ 命中第一个 case 后后续 case 测试仍会执行。
  // 修法：test 改为 getter（$switch 按序匹配时才读 c.test）⇒ 命中即停
  // （原生 CaseBlock：逐个求值 case 测试，命中即跳出求值循环）。
  const hasTests = stmt.cases.some((c) => c.test != null);
  const testSrcs: string[] = [];
  // Bug 1151-b：switch 协议内部临时名（基线快照 `__sw0_*` / 臂槽位
  // `__sw${i}_*` / 臂标志 `__cont`）**避开用户标识符**——写死名会遮蔽
  // 用户同名绑定（自信错值 ⇒ 闸门假绿）。分配器与声明点（`decls`）同源
  // ⇒ 「成对一致」。
  const sw = switchTmpNames(names, nArms, opts);
  // 快照/恢复/测试刷新各自的身份图 memo：一次操作内的别名绑定共享副本，
  // 循环引用也不会在 switch 臂里栈溢出。
  const swCopyMemo = internalTmpName("__swCopyMemo", opts);
  const swArmMemo = internalTmpName("__swArmMemo", opts);
  const swRefreshMemo = internalTmpName("__swRefreshMemo", opts);
  // Bug 1159：case 测试机制 / 共享体的**块级**内部名同样避开用户标识符
  // ——测试 thunk（`() => (用户 case 表达式)`）与臂 thunk 都在本块作用域
  // 里求值用户表达式 ⇒ 写死名 `__swT` / `__swTestRead` / `__swEval` /
  // `__swAllDone` 会**遮蔽**用户同名外层绑定（`const __swAllDone = 42`
  // 被读成引擎的 false ⇒ 自信错值）或撞 **TDZ**（`let __swTestRead` 在
  // 臂体顶层 ⇒ 臂入口的 `if (!__swTestRead)` 抛 ReferenceError）。
  // 同 `switchTmpNames` 口径（批内一次分配）；无碰撞时基名原样返回 ⇒
  // 产物逐字不变。
  const [swT, swTV, swTD, swAllDone, swTestRead, swEval, swEvalAll, swI, swJ] =
    internalTmpNameSet(
      [
        "__swT",
        "__swTV",
        "__swTD",
        "__swAllDone",
        "__swTestRead",
        "__swEval",
        "__swEvalAll",
        "__swI",
        "__swJ",
      ],
      opts,
    );
  // 本函数与 `forkArmThunkExpr` **刻意不共用**：switch 臂协议多出
  // ①抽象判别式的 case 测试补求值 prologue（`__swTestRead` / `__swEvalAll`）、
  // ②break 信号吸收（`$isBreakTo` —— if-fork 臂不吸收 break）、
  // ③多臂槽位按 `outIdx` 取、④finally 仅在存在绑定名时发射。共享面只剩
  // 快照恢复 / try-catch-finally 骨架；强行参数化会把 break 语义藏进标志位。
  const wrapArmThunk = (thunk: string, outIdx: number): string => {
    // 与 if-fork 同口径：return/throw 臂不写 continue 路径绑定
    const lines: string[] = [`() => {`];
    // 抽象判别式路径（$switch 不读 case 测试 getter）→ 臂入口补求值全部
    // case 测试（原生：case 测试按序求值到命中为止；抽象路径判不出命中
    // ⇒ 全部求值 = 上界）
    if (hasTests) lines.push(`${indent(depth + 1)}if (!${swTestRead}) ${swEvalAll}();`);
    if (names.length > 0) {
      lines.push(`${indent(depth + 1)}const ${swArmMemo} = new WeakMap();`);
      lines.push(...names.map((n, i) => `${indent(depth + 1)}${n} = $copy(${sw.snap[i]}, ${swArmMemo});`));
      lines.push(`${indent(depth + 1)}let ${sw.cont} = true;`);
    }
    lines.push(`${indent(depth + 1)}try {`);
    lines.push(`${indent(depth + 2)}return (${thunk})();`);
    lines.push(`${indent(depth + 1)}} catch (e) {`);
    // Bug 147：switch 臂的 break 信号 → 臂结束（switch 随之结束）
    lines.push(`${indent(depth + 2)}if ($isBreakTo(e, ${JSON.stringify(breakLabel)})) {`);
    lines.push(`${indent(depth + 3)}/* switch 臂 break：臂结束 */`);
    lines.push(`${indent(depth + 2)}} else {`);
    if (names.length > 0) lines.push(`${indent(depth + 3)}if ($isForkExit(e)) ${sw.cont} = false;`);
    lines.push(`${indent(depth + 3)}throw e;`);
    lines.push(`${indent(depth + 2)}}`);
    lines.push(`${indent(depth + 1)}}`);
    if (names.length > 0) {
      lines.push(`${indent(depth + 1)}finally {`);
      lines.push(`${indent(depth + 2)}if (${sw.cont}) {`);
      lines.push(...names.map((n, i) => `${indent(depth + 3)}${sw.arm[outIdx]![i]} = ${n};`));
      lines.push(...names.map((_n, i) => `${indent(depth + 3)}${sw.armSet[outIdx]![i]} = true;`));
      lines.push(`${indent(depth + 2)}}`);
      lines.push(`${indent(depth + 1)}}`);
    }
    lines.push(`}`);
    return lines.join("\n");
  };
  let armSeq = 0;
  // Bug 147：臂体发射期间本 switch 的 break 标签生效（嵌套 switch 各自一份）
  const prevBreakLabel = curSwitchBreakLabel;
  curSwitchBreakLabel = breakLabel;
  try {
    for (let armIdx = 0; armIdx < merged.length; armIdx++) {
      const arm = merged[armIdx]!;
      // 臂体是**块作用域**（臂 thunk 内）——臂内词法声明在臂内遮蔽外层绑定
      // ⇒ 别名组按臂内声明过滤（臂内 fork 不得把外层别名伙伴拉进绑定集：
      // 伙伴名在臂内指向臂局部绑定 ⇒ 复制/重绑它会断开外层别名身份）。
      // switch 自身的 pack/join 发射在**外层**作用域 ⇒ 用未过滤的组。
      const armAliasGroups = filterAliasGroups(
        armOpts.aliasGroups,
        collectScopeShadowNames(arm.stmts),
      );
      const armBodyOpts: TranspileOptions = armAliasGroups
        ? { ...armOpts, aliasGroups: armAliasGroups }
        : armOpts;
      const body =
        arm.stmts.length === 0
          ? ""
          : arm.stmts.map((s) => transpileStatement(s, depth + 2, armBodyOpts)).join("\n");
      // Bug 184：case 标签窄化——命中 / 排除事实影子重绑进臂体
      const rawThunk = narrowCaseLabelArmThunk(
        `() => {\n${body}\n${indent(depth + 1)}}`,
        caseFacts[armIdx],
        names,
      );
      const thunk = wrapArmThunk(rawThunk, armSeq);
      armSeq++;
      const shared = arm.tests.length > 1 && !arm.isDefault;
      const runRef = shared
        ? internalTmpName(`__swBody${bodyIdxBase + bodyIdx++}`, opts)
        : thunk;
      if (shared) {
        sharedBodyDecls.push(`${pad}const ${runRef} = ${thunk};`);
      }
      if (arm.isDefault) {
        defaultSrc = thunk;
      } else {
        for (const t of arm.tests) {
          const testIdx = testSrcs.length;
          testSrcs.push(t);
          // Bug 168：test 为 getter——$switch 按序匹配时才求值（命中即停）
          caseLines.push(
            `{ get test() { ${swTestRead} = true; return ${swEval}(${testIdx}); }, run: ${runRef} },`,
          );
        }
      }
    }
  } finally {
    curSwitchBreakLabel = prevBreakLabel;
  }
  // 无 default：合成 no-match 臂，把快照写入 join 槽（抽象 disc 时参与 join）
  if (!defaultArm && names.length > 0) {
    defaultSrc = wrapArmThunk(`() => {\n${indent(depth + 2)}return $lit(void 0);\n${indent(depth + 1)}}`, armSeq);
  }
  switchBodySeq += Math.max(bodyIdx, 1);
  const dflt = defaultSrc ? `, ${defaultSrc}` : "";
  const discRebinds = emitArrMutatorRebinds(stmt.discriminant as Node, opts, pad);
  const switchCall = (discRef: string): string =>
    `$switch(${discRef}, [\n${caseLines.map((l) => indent(depth + 1) + l).join("\n")}\n${indent(depth + 1)}]${dflt})`;
  // Bug 168/169：case 测试的惰性求值机制（test thunk + 缓存 + 抽象路径
  // 补求值）+ 基线刷新（case 测试求值后刷新快照槽 ⇒ 臂入口恢复的是
  // 「测试之后」的状态 ⇒ 测试里的写不被抹掉）。名称经 Bug 1159 分配器。
  const testHelpers: string[] = [];
  if (testSrcs.length > 0) {
    const refresh = names.map((n, i) => `${indent(depth + 2)}${sw.snap[i]} = $copy(${n}, ${swRefreshMemo});`);
    testHelpers.push(
      `${pad}const ${swT} = [${testSrcs.map((t) => `() => (${t})`).join(", ")}];`,
      `${pad}const ${swTV} = [];`,
      `${pad}const ${swTD} = [];`,
      `${pad}let ${swAllDone} = false;`,
      `${pad}let ${swTestRead} = false;`,
      // 形参 / 循环变量同样经分配器——不得与用户绑定同名（用户 case
      // 表达式在该块作用域里求值 ⇒ `__swI` 之类若写死会遮蔽用户绑定）
      `${pad}const ${swEval} = (${swI}) => {`,
      `${indent(depth + 1)}if (!${swTD}[${swI}]) {`,
      `${indent(depth + 2)}${swTD}[${swI}] = true;`,
      `${indent(depth + 2)}${swTV}[${swI}] = ${swT}[${swI}]();`,
      `${indent(depth + 2)}const ${swRefreshMemo} = new WeakMap();`,
      ...refresh,
      `${indent(depth + 1)}}`,
      `${indent(depth + 1)}return ${swTV}[${swI}];`,
      `${pad}};`,
      `${pad}const ${swEvalAll} = () => {`,
      `${indent(depth + 1)}if (${swAllDone}) return;`,
      `${indent(depth + 1)}${swAllDone} = true;`,
      `${indent(depth + 1)}for (let ${swJ} = 0; ${swJ} < ${swT}.length; ${swJ}++) ${swEval}(${swJ});`,
      `${pad}};`,
    );
  }
  if (names.length === 0) {
    const lines = [
      ...discRebinds,
      ...testHelpers,
      ...sharedBodyDecls,
      allReturn
        ? `${pad}return ${switchCall(disc)};`
        : `${pad}${switchCall(disc)};`,
    ];
    // 测试机制带块级绑定（__swT / __swTV / …）→ switch 包块（同名不撞）
    if (testHelpers.length === 0) return lines.join("\n");
    return [`${pad}{`, ...lines, `${pad}}`].join("\n");
  }
  // 槽位数 ≡ nArms（恒等式：slotCount = max(nArms, armSeq + (defaultArm ? 0 : 1))
  // 且 armSeq ≡ merged.length ⇒ 两支下都等于 nArms）⇒ 分配器按 nArms 分配
  // 即可覆盖全部槽位（`sw.arm` / `sw.armSet` 的长度 = nArms）。
  const slotCount = Math.max(nArms, armSeq + (defaultArm ? 0 : 1));
  const decls = [
    `${pad}const ${swCopyMemo} = new WeakMap();`,
    ...names.flatMap((n, ni) => [
      // 基线可被 case 测试求值刷新（Bug 169）——故 let 而非 const
      `${pad}let ${sw.snap[ni]} = $copy(${n}, ${swCopyMemo});`,
      ...Array.from({ length: slotCount }, (_, i) =>
        `${pad}let ${sw.arm[i]![ni]}; let ${sw.armSet[i]![ni]} = false;`,
      ),
    ]),
  ];
  const joins = names.map((n, ni) => {
    const slots = Array.from(
      { length: slotCount },
      (_, i) => `(${sw.armSet[i]![ni]} ? ${sw.arm[i]![ni]} : null)`,
    );
    return `${pad}${n} = (() => { const ${sw.joinArr} = [${slots.join(",")}].filter((x) => x !== null); return ${sw.joinArr}.length === 0 ? ${n} : ${sw.joinArr}.reduce((a, b) => $join(a, b)); })();`;
  });
  // shared body 必须在声明 __sw0_* 的同一块内，否则闭包解析不到槽位绑定
  //
  // Bug 135：__sw0_* 是**臂的基线**——基线必须取自**判别式求值之后**。
  // 此前判别式是 $switch(...) 的第一实参（后求值），而快照行排在它之前
  // ——判别式里的副作用（f() 计数 / 赋值 / 自增）在臂入口被整体回滚。
  // 修法：判别式先落 __swD（连同其自身写回），再取快照，$switch 用 __swD。
  return [
    `${pad}{`,
    `${pad}const ${sw.disc} = (${disc});`,
    ...discRebinds,
    ...decls.map((l) => l.replace(new RegExp(`^${pad}`), `${pad}`)),
    ...testHelpers,
    ...sharedBodyDecls.map((l) =>
      l.startsWith(pad) ? `${pad}${l.slice(pad.length)}` : `${pad}${l}`,
    ),
    `${pad}const ${sw.result} = ${switchCall(sw.disc)};`,
    ...joins,
    allReturn ? `${pad}return ${sw.result};` : null,
    `${pad}}`,
  ]
    .filter((l): l is string => l !== null)
    .join("\n");
}

function emitTryStatement(
  stmt: TryStatement,
  depth: number,
  opts: TranspileOptions,
): string {
  const pad = indent(depth);
  // 可选 require：两侧都可折叠 → 优先成功侧（__nudoRequireOptional）
  const optReq = matchOptionalRequire(stmt as unknown as Parameters<typeof matchOptionalRequire>[0]);
  if (optReq) {
    const reqSrc = `__nudoRequireOptional(${JSON.stringify(optReq.specs)})`;
    const cond = (opts.inLoop ?? 0) > 0 || (opts.conditionalFlow ?? 0) > 0;
    // Bug 1151-c：赋值 IIFE 形参载体避开用户标识符（写目标在 IIFE 体内
    // 求值 ⇒ 写死名 `__v` 会遮蔽用户同名绑定 ⇒ 用户绑定没被写回）。
    const reqV = internalTmpName("__v", opts);
    const assignSrc = `((${reqV}) => { $assignRecord(${JSON.stringify(optReq.name)}, ${optReq.name}, ${reqV}, ${optReq.locLine}, ${optReq.locCol}, ${cond});${!opts.inFunction ? ` $recordBinding(${JSON.stringify(optReq.name)}, ${reqV});` : ""} return ${optReq.name} = ${reqV}; })(${reqSrc})`;
    const lines = [`${pad}${assignSrc};`];
    if (stmt.finalizer) {
      // Bug 148：finally 体是块作用域——其内 const 名单自算
      // Bug 186：finally 体走 transpileFnBodyStmts（与函数体顶层同口径）
      // ——早退补集窄化送达 finally 体内的嵌套语句表
      const finOpts: TranspileOptions = {
        ...opts,
        constNames: computeConstScope(
          stmt.finalizer.type === "BlockStatement" ? stmt.finalizer.body : [],
          opts.constNames,
        ),
      };
      const finBody =
        stmt.finalizer.type === "BlockStatement"
          ? transpileFnBodyStmts(stmt.finalizer.body, depth, finOpts)
          : transpileStatement(stmt.finalizer as unknown as Statement, depth, finOpts);
      lines.push(finBody);
    }
    return lines.join("\n");
  }
  // Bug 42：try 临时名走单调查询计数器——同作用域同一行两个 try
  // （压缩/生成代码）按行号命名会重复 const 声明 → new Function
  // SyntaxError 整模块 fail-closed；loc 缺失 `?? 0` 同样撞车
  const tryTmpSeq = opts.tryTmpSeq ?? { n: 0 };
  const tmpNo = tryTmpSeq.n++;
  // Bug 1058：try 标记名 / catch 载体名必须**避开用户标识符**——用户自己
  // 声明了 `__nudoTm_0` / `__nudoE_0` 时，生成的同名 `const` 与之**重复
  // 词法声明** ⇒ 产物非法 JS ⇒ 整模块 fail-closed（导出全退化 unknown +
  // 假 nudo:opaque-result ⇒ 门禁假绿）。
  const markName = internalTmpName(`__nudoTm_${tmpNo}`, opts);
  // Bug 52：yield 点 try 上下文位——try 块与 catch 体在本 try 的
  // finally/catch 覆盖内；finally 体不在自身 finally 覆盖内（外层 ctx
  // 原样）。位值与 runtime/control.ts 的 YIELD_* 常量钉死同步（transpile
  // 不 import runtime）：1 = TRY_FINALLY，2 = TRY_CATCH，4 = FINALLY_
  // YIELDS，8 = FINALLY_RETURNS，16 = CATCH_RETURNS，32 = CATCH_YIELDS，
  // 64 = CATCH_RETHROWS
  const fin = stmt.finalizer
    ? finalizerBits(stmt.finalizer as Node)
    : undefined;
  const finBits = stmt.finalizer
    ? 1 | (fin!.yields ? 4 : 0) | (fin!.returns ? 8 : 0)
    : 0;
  // R1a：catch 静态事实（finalizerBits 同口径：含 yield / 含 return /
  // 可能 rethrow）——描述**最近** enclosing catch 的吸收结局，故本 try
  // 带 handler 时替换外层 catch 事实位（外层 catch 只有在内层重抛后才
  // 可达，此时结局不可分类 → 64 降级）。内层可能 rethrow 且外层还有
  // catch → 二次吸收路径外层事实未标注，同样置 64。
  const catchFacts = stmt.handler
    ? (() => {
        const cb = finalizerBits(stmt.handler!.body as Node);
        const rethrows = catchMayRethrow(stmt.handler!) && ((opts.yieldTryCtx ?? 0) & 2) !== 0;
        return 2 | (cb.returns ? 16 : 0) | (cb.yields ? 32 : 0) | (rethrows ? 64 : 0);
      })()
    : 0;
  const innerYieldCtx =
    ((opts.yieldTryCtx ?? 0) & ~(16 | 32 | 64)) | finBits | catchFacts;
  const tryOpts: TranspileOptions = {
    ...opts,
    inTry: (opts.inTry ?? 0) + 1,
    // 族 65 · BC #28：try 块完成 ≠ 函数尾 ⇒ 块内早退提升走控制流协议
    // （见 TranspileOptions.inCtrlBlock）。
    inCtrlBlock: (opts.inCtrlBlock ?? 0) + 1,
    tryMarkName: markName,
    hasTryHandler: !!stmt.handler,
    tryRethrowCatch: stmt.handler ? catchMayRethrow(stmt.handler) : false,
    yieldTryCtx: innerYieldCtx,
  };
  // Bug 148：try 体是**块作用域**——其内声明的 const 在本作用域内不可再赋
  // （此前名单缺失 ⇒ 赋值直写不抛 + throws 域折 never ⇒ L2 假绿）。
  const tryScopeOpts: TranspileOptions = {
    ...tryOpts,
    constNames: computeConstScope(
      stmt.block.type === "BlockStatement" ? stmt.block.body : [],
      tryOpts.constNames,
    ),
  };
  const tryBody =
    stmt.block.type === "BlockStatement"
      ? transpileFnBodyStmts(stmt.block.body, depth + 1, tryScopeOpts)
      : transpileStatement(stmt.block as unknown as Statement, depth + 1, tryScopeOpts);
  const lines = [
    `${pad}const ${markName} = $tryMark();`,
    `${pad}try {`,
    tryBody,
    `${pad}}`,
  ];
  // catch ([a, b]) / catch ({v})：模式参此前只绑载体名 "e"，子名静默丢
  // 绑定 → catch 体自由读 spurious-throw 面（差分 FALSE-THROW）。
  // 载体改用 catchTmp 原生绑定（可再赋、与用户子名不撞车），守卫区内
  // emitDestructure 绑定全部子名（let 语义：catch 参块内可再赋）。
  const handlerParam = stmt.handler?.param as Node | null | undefined;
  const patternParam =
    handlerParam &&
    (handlerParam.type === "ObjectPattern" || handlerParam.type === "ArrayPattern")
      ? handlerParam
      : null;
  const catchTmp = internalTmpName(`__nudoE_${tmpNo}`, opts);
  // Bug 175：可选 catch 绑定（ES2019 `catch { … }`）**不引入任何绑定**——
  // 此前载体名回落成**硬编码 "e"**：① 遮蔽外层同名绑定（自信错值）
  // ② 顶掉未声明名的 ReferenceError（漏抛 / 假绿）③ 与用户自己的
  // `let e` 撞车 → 重复声明 → 转译崩溃、类型塌成 unknown。
  // 修法：可选绑定**不发射用户可见绑定**——catch 体按原样解析外层名字。
  const optionalBinding = !handlerParam;
  const catchParam =
    handlerParam?.type === "Identifier"
      ? (handlerParam as unknown as { name: string }).name
      : catchTmp;
  // Bug 52：catch 体仍受本 try 的 finally 覆盖（.return 注入值可被改写），
  // 但注入到 catch 内 yield 的 .throw 不再被**本** catch 重新吸收
  //（native：catch 内 throw 直接穿出 try，经 finally 上抛）——只并
  // 外层 ctx + 本 finally 位（含 finalizer 静态事实）
  // P4b：catch 参数遮蔽外层 const / 类体不可变自有名——体内写的是
  // catch 绑定（let 语义，原生可再赋 no-throw），不得假 TypeError。
  const catchShadow = new Set<string>();
  if (stmt.handler?.param) collectPatternNames(stmt.handler.param, catchShadow);
  const catchOpts: TranspileOptions = {
    ...opts,
    yieldTryCtx: (opts.yieldTryCtx ?? 0) | finBits,
    // 族 65 · BC #28：catch 体完成 ≠ 函数尾（catch 跑完函数继续）⇒ 体内
    // 早退提升走控制流协议。
    inCtrlBlock: (opts.inCtrlBlock ?? 0) + 1,
    ...(opts.constNames && catchShadow.size > 0
      ? { constNames: copyConstScope(opts.constNames, catchShadow) }
      : {}),
  };
  // Bug 186：catch 体走 transpileFnBodyStmts（与函数体顶层同口径）——
  // 早退补集窄化送达 catch 体内的嵌套语句表
  const transpileCatchBody = (d: number, o: TranspileOptions): string =>
    !stmt.handler
      ? ""
      : stmt.handler.body.type === "BlockStatement"
        ? transpileFnBodyStmts(
            stmt.handler.body.body,
            d,
            // Bug 148：catch 体是块作用域——本作用域的 const 名单自算
            { ...o, constNames: computeConstScope(stmt.handler!.body.body, o.constNames) },
          )
        : transpileStatement(stmt.handler.body as unknown as Statement, d, o);
  if (stmt.handler) {
    const catchBody = transpileCatchBody(depth + 1, catchOpts);
    // Bug 1058：派生临时名（soft 载体 / catch 值 / take-since 序列 /
    // rethrow 载体 / post 序列）同样避开用户标识符——它们由 markName
    // 派生，markName 已避让，但派生名自身仍可能与用户词形相撞。
    const softVar = internalTmpName(`__soft_${markName}`, opts);
    const cvName = internalTmpName(`__cv_${markName}`, opts);
    const xsName = internalTmpName(`__xs_${markName}`, opts);
    const rethrowName = internalTmpName(`__rethrow_${markName}`, opts);
    lines.push(`${pad}catch (${catchTmp}) {`);
    // NudoReturn 是控制流信号，不是 catch 绑定
    lines.push(`${indent(depth + 1)}$rethrowIfNudoReturn(${catchTmp});`);
    // Bug 211：循环信号（break / continue）也不是 catch 绑定——$catchVal
    // 遇信号重抛 ⇒ catch 体不执行、信号透传到循环捕获点（原生：break 不是
    // 异常，到不了 catch 处理器）。求值放在 soft 摘帧**之前**：信号透传时
    // soft 效果不得被本帧消化（须上浮给外层帧）。
    lines.push(`${indent(depth + 1)}const ${cvName} = $catchVal(${catchTmp});`);
    // soft：入口摘下、不立刻消化；catch 落出口 discard，rethrow orphan 上浮
    lines.push(`${indent(depth + 1)}const ${softVar} = $tryDetachSoftCatch();`);
    lines.push(`${indent(depth + 1)}const ${xsName} = $tryTakeSince(${markName});`);
    lines.push(`${indent(depth + 1)}${xsName}.push(${cvName});`);
    lines.push(
      // catch 绑定可再赋（let 语义），不是 const；模式参载体 = catchTmp；
      // 可选 catch 绑定不引入用户可见绑定（Bug 175）
      patternParam
        ? `${indent(depth + 1)}${catchTmp} = ${xsName}.reduce((a, b) => $join(a, b));`
        : optionalBinding
          ? ""
          : `${indent(depth + 1)}let ${catchParam} = ${xsName}.reduce((a, b) => $join(a, b));`,
    );
    lines.push(`${indent(depth + 1)}try {`);
    if (patternParam) {
      // 模式参绑定入守卫区：$iterCheck/$get 抛出的 TypeError 经 rethrow
      // 包装上抛 = native 口径（解构抛错不是 catch 体可消化的路径）
      emitDestructure(
        patternParam,
        catchTmp,
        "let",
        indent(depth + 2),
        catchOpts,
        lines,
        opts.destrTmpSeq ?? { n: 0 },
      );
    }
    lines.push(catchBody);
    lines.push(`${indent(depth + 1)}} catch (${rethrowName}) {`);
    lines.push(`${indent(depth + 2)}$tryOrphanSoft(${softVar});`);
    lines.push(`${indent(depth + 2)}throw ${rethrowName};`);
    lines.push(`${indent(depth + 1)}}`);
    lines.push(`${indent(depth + 1)}$tryDiscardSoft(${softVar});`);
    lines.push(`${pad}}`);
  }
  // catch 体内（任意深度语句，不含嵌套函数/类体）出现 throw → 视为可能
  // rethrow：正常完成路径的 soft 效果不得消化（假想 soft throw 经
  // catch rethrow 逃逸——与 evalTry 的 catchR.threw 口径一致，含条件
  // throw 的保守上浮）。
  const softExit = !stmt.handler
    ? "$tryReleaseSoftOut();"
    : catchMayRethrow(stmt.handler)
      ? "$tryReleaseSoftCatch();"
      : "$tryDigestSoftCatch();";
  if (stmt.finalizer) {
    // Bug 148：finally 体是块作用域——其内声明的 const 不可再赋（名单自算）
    const finScopeOpts: TranspileOptions = {
      ...opts,
      // 族 65 · BC #28：finally 体完成 ≠ 函数尾 ⇒ 体内早退提升走控制流协议
      inCtrlBlock: (opts.inCtrlBlock ?? 0) + 1,
      constNames: computeConstScope(
        stmt.finalizer.type === "BlockStatement" ? stmt.finalizer.body : [],
        opts.constNames,
      ),
    };
    const finBody =
      stmt.finalizer.type === "BlockStatement"
        ? transpileFnBodyStmts(stmt.finalizer.body, depth + 1, finScopeOpts)
        : transpileStatement(stmt.finalizer as unknown as Statement, depth + 1, finScopeOpts);
    lines.push(`${pad}finally {`);
    lines.push(finBody);
    // finally 内收口 soft + mark（catch 与 finally 之间不得插入语句）
    lines.push(`${indent(depth + 1)}${softExit}`);
    lines.push(`${indent(depth + 1)}$tryPopMark();`);
    lines.push(`${pad}}`);
  } else {
    // 合成 finally：保证 try 合法，并在此收口 soft/mark
    lines.push(`${pad}finally {`);
    lines.push(`${indent(depth + 1)}${softExit}`);
    lines.push(`${indent(depth + 1)}$tryPopMark();`);
    lines.push(`${pad}}`);
  }
  // try/catch/finally 之后再 drain 未吸收的抽象 throw
  if (stmt.handler) {
    const catchBody = transpileCatchBody(depth + 2, catchOpts);
    // Bug 1058：post 序列临时名避开用户标识符（配对：声明 / .length /
    // .reduce 三处同名）
    const postName = internalTmpName(`__post_${markName}`, opts);
    lines.push(`${pad}{`);
    lines.push(`${indent(depth + 1)}const ${postName} = $tryTakeSince(${markName});`);
    lines.push(`${indent(depth + 1)}if (${postName}.length) {`);
    lines.push(
      patternParam
        ? `${indent(depth + 2)}let ${catchTmp} = ${postName}.reduce((a, b) => $join(a, b));`
        : optionalBinding
          ? ""
          : `${indent(depth + 2)}let ${catchParam} = ${postName}.reduce((a, b) => $join(a, b));`,
    );
    if (patternParam) {
      emitDestructure(
        patternParam,
        catchTmp,
        "let",
        indent(depth + 2),
        catchOpts,
        lines,
        opts.destrTmpSeq ?? { n: 0 },
      );
    }
    lines.push(
      catchBody
        .split("\n")
        .map((l) => (l ? `${indent(depth + 2)}${l.trimStart()}` : l))
        .join("\n"),
    );
    lines.push(`${indent(depth + 1)}}`);
    lines.push(`${pad}}`);
  } else {
    // Bug 1058：post 序列临时名避开用户标识符（配对：声明 / .length /
    // .reduce 三处同名）
    const postName = internalTmpName(`__post_${markName}`, opts);
    lines.push(`${pad}{`);
    lines.push(`${indent(depth + 1)}const ${postName} = $tryTakeSince(${markName});`);
    lines.push(`${indent(depth + 1)}if (${postName}.length) {`);
    lines.push(`${indent(depth + 2)}$throw(${postName}.reduce((a, b) => $join(a, b)));`);
    lines.push(`${indent(depth + 1)}}`);
    lines.push(`${pad}}`);
  }
  return lines.join("\n");
}

function emitForInStatement(
  stmt: ForInStatement | ForOfStatement,
  depth: number,
  opts: TranspileOptions,
): string {
  const pad = indent(depth);
  const isIn = stmt.type === "ForInStatement";
  // Babel 把 `for await (… of …)` 解析为 ForOfStatement + await:true——
  // 不得丢标志（Bug 13）：否则异步可迭代性永不校验，且仅异步可迭代的
  // 接收者被同步 $elems 投影（对象槽位折进迭代产出）。
  const isForAwait = !isIn && (stmt as { await?: boolean }).await === true;
  // for-in：键序列由 $forInKeys 投影（整数键升序/字符串插入序/hole 跳过）
  // Bug 98：非纯接收者（调用/计算键/短路等副作用面）先求值一次入
  // __forInRecv（原生单次求值口径），iter 与重查 thunk 共用；纯接收者
  // （标识符 / 非计算成员链）直接重读绑定——delete 写回可见。
  let recvPre: string[] = [];
  let recvSrc = "";
  if (isIn && !isPureForInRecv(stmt.right as Expression)) {
    // 同块多个 for-in 不得重复声明：模块级计数器唯一化
    // Bug 1159：接收者临时名同样避开用户标识符——`const __fir1 = (用户
    // 表达式)` 的初始化器与循环体都在该块里求值用户代码 ⇒ 写死名会撞
    // TDZ / 遮蔽；首轮编译失败后的 Bug 1139 重试虽会推高计数器「撞巧」
    // 成功，但两次尝试的序号都被用户占用时（`__fir1` … `__fir{n}`）重试
    // 仍 SyntaxError ⇒ 宿主异常冒出。实际名经分配器；无碰撞时逐字不变。
    const recvTmp = internalTmpName(`__fir${++forInRecvSeq}`, opts);
    recvPre = [`${pad}const ${recvTmp} = (${emitTranspileExpression(stmt.right as Expression, opts)});`];
    recvSrc = recvTmp;
  } else {
    recvSrc = emitTranspileExpression(stmt.right as Expression, opts);
  }
  const iter = isIn
    ? `$forInKeys(${recvSrc})`
    : recvSrc;
  // for (const x of xs) / for (const [a,b] of xs)
  //
  // Bug 163 / 178：头绑定的**作用域形态**分四种，头绑定不是「一律回调形参」——
  //  - let/const 头：块级、**每轮新绑定** → 回调形参（既有口径，不变）
  //  - var 头：**函数级、整个循环共享一个绑定**、循环后仍可见 → 不得
  //    降级成回调形参（此前形参遮蔽函数级槽 ⇒ 循环外恒 undefined、
  //    且每轮独立绑定 ⇒ 闭包捕获值错）；改为每轮把迭代项**写回同一
  //    函数级槽**（槽已由 collectVarHoistNames 提升到函数体/模块体顶部）
  //  - 标识符头 `for (x of …)`：**赋值**给既有绑定 → 头赋值必须发射
  //  - 成员表达式头 `for (o.x of …)`：**写回成员槽** → 头赋值必须发射
  //    （此前两形态的赋值**整条不发射** ⇒ 目标恒为旧值）
  let bindName = "_item";
  /** 头赋值语句源（写回既有绑定 / 成员槽）；null = 无头赋值 */
  let headAssignSrc: string | null = null;
  /** 头赋值写入的外层绑定名（进 pack/unpack 写回集） */
  const headAssignedNames: string[] = [];
  /** 头解构（let/const）的子名——**回调内块级绑定**，不得进 pack 名集 */
  const headLocalNames = new Set<string>();
  const headKind =
    stmt.left.type === "VariableDeclaration" ? stmt.left.kind : null;
  const headPat =
    stmt.left.type === "VariableDeclaration" ? stmt.left.declarations[0]?.id : null;
  if (stmt.left.type === "VariableDeclaration") {
    if (headPat?.type === "Identifier") {
      if (headKind === "var") {
        // var 头：函数级共享绑定 —— 头赋值写回提升槽（不新建回调形参）
        bindName = "_item";
        headAssignedNames.push(headPat.name);
      } else {
        bindName = headPat.name;
      }
    } else if (headPat?.type === "ObjectPattern" || headPat?.type === "ArrayPattern") {
      // 解构绑定：用临时 _item 再 destructure
      bindName = `_of${stmt.loc?.start.line ?? 0}`;
      const patNames = new Set<string>();
      collectPatternNames(headPat, patNames);
      if (headKind === "var") {
        // var 头解构：子名已提升到函数级槽 → destructure 走**赋值**形态
        // （kw ""），写回同一函数级槽而非块级新绑定
        for (const n of patNames) headAssignedNames.push(n);
      } else {
        // let/const 头解构：子名是**循环体回调内**的块级绑定（emitDestructure
        // 在回调里声明）——pack/unpack 闭包在回调**外**，引用它 ⇒ ReferenceError
        // （`for (let {a} of arr) { a = … }` 的抽象出口直接抛）。
        // 报告外发现：这些名字不是外层绑定（每轮独立 / const 不可再赋）⇒
        // 排除出 pack 名集（体对它们的写只改块级绑定，不外泄）。
        for (const n of patNames) headLocalNames.add(n);
      }
    }
  } else if (stmt.left.type === "Identifier") {
    // 标识符头：赋值给既有绑定（此前降级成回调形参 ⇒ 写回丢失）
    bindName = "_item";
    headAssignedNames.push(stmt.left.name);
  } else if (stmt.left.type === "MemberExpression") {
    // 成员表达式头：迭代项必须写回成员槽（此前整条不发射）
    bindName = "_item";
    const root = memberHeadRootName(stmt.left);
    if (root) headAssignedNames.push(root);
  }
  const bodyLines: string[] = [];
  // for (const x of …) 头绑定在循环体内不可再赋
  const loopConstNames = copyConstScope(opts.constNames, new Set()) ?? new Set<string>();
  if (stmt.left.type === "VariableDeclaration" && stmt.left.kind === "const") {
    if (stmt.left.declarations[0]?.id.type === "Identifier") {
      loopConstNames.add(stmt.left.declarations[0].id.name);
    } else if (
      stmt.left.declarations[0]?.id.type === "ObjectPattern" ||
      stmt.left.declarations[0]?.id.type === "ArrayPattern"
    ) {
      const patternNames = new Set<string>();
      collectPatternNames(stmt.left.declarations[0].id, patternNames);
      for (const n of patternNames) loopConstNames.add(n);
    }
  } else if (
    stmt.left.type === "VariableDeclaration" &&
    (stmt.left.kind === "let" || stmt.left.kind === "var")
  ) {
    // let/var 头绑定遮蔽外层 const/import 名（Bug ②）：体内可再赋，
    // 不得误折 TypeError——从继承的 const 面扣除遮蔽名
    // （Bug 161：解构头的子名同样按头种类决定可变性）
    const headId = stmt.left.declarations[0]?.id;
    if (headId?.type === "Identifier") {
      loopConstNames.delete(headId.name);
    } else if (headId?.type === "ObjectPattern" || headId?.type === "ArrayPattern") {
      const patternNames = new Set<string>();
      collectPatternNames(headId, patternNames);
      for (const n of patternNames) loopConstNames.delete(n);
    }
  }
  if (
    stmt.left.type === "VariableDeclaration" &&
    stmt.left.declarations[0] &&
    (stmt.left.declarations[0].id.type === "ObjectPattern" ||
      stmt.left.declarations[0].id.type === "ArrayPattern")
  ) {
    // Bug 161：解构头的绑定种类随头（const 头不可再赋 / let·var 头可再赋）
    // Bug 163：var 头的解构子名是**函数级提升槽**（collectVarHoistNames
    // 收 for 头的 var 声明）→ destructure 走**赋值**形态（kw ""）写回
    // 同一函数级槽；子名未在提升集内时退回块级 let（不得凭空写未声明名）
    const patNames = new Set<string>();
    collectPatternNames(stmt.left.declarations[0].id, patNames);
    const hoisted = opts.hoistedVarNames;
    const varHeadAssigned =
      stmt.left.kind === "var" &&
      hoisted !== undefined &&
      [...patNames].every((n) => hoisted.has(n));
    emitDestructure(
      stmt.left.declarations[0].id as Node,
      bindName,
      varHeadAssigned
        ? ""
        : stmt.left.kind === "const"
          ? "const"
          : "let",
      indent(depth + 2),
      { ...opts, constNames: loopConstNames },
      bodyLines,
      { n: 0 },
    );
  }
  // 循环体是**块作用域**（体 thunk 内）——体顶层词法声明在体内遮蔽外层
  // 绑定 ⇒ 别名组按体顶层声明过滤（体内 fork 不得把外层别名伙伴拉进绑定
  // 集）。pack/unpack 发射在**外层**作用域 ⇒ 用未过滤的组。
  const bodyLocalDecls = new Set<string>();
  const bodyOpts = loopBodyOptsOf(stmt.body, opts, loopConstNames, bodyLocalDecls);
  const bodyStmts =
    stmt.body.type === "BlockStatement"
      ? stmt.body.body.map((s) => transpileStatement(s, depth + 2, bodyOpts)).join("\n")
      : transpileStatement(stmt.body, depth + 2, bodyOpts);
  // Bug 163 / 178：头赋值发射（写回既有绑定 / 成员槽）——复用通用赋值
  // 通道（const 守卫 / $set·$idxSet 写回 / 根重绑），不另起一套。
  // 目标节点：var 头 / 标识符头 = 头标识符；成员头 = 头成员表达式。
  if (headAssignedNames.length > 0 || stmt.left.type === "MemberExpression") {
    const headTarget: Node | null =
      stmt.left.type === "MemberExpression"
        ? (stmt.left as unknown as Node)
        : stmt.left.type === "Identifier"
          ? ({ type: "Identifier", name: stmt.left.name } as unknown as Node)
          : stmt.left.type === "VariableDeclaration" &&
              headKind === "var" &&
              headPat?.type === "Identifier"
            ? ({ type: "Identifier", name: headPat.name } as unknown as Node)
            : null;
    if (headTarget) {
      const synth = {
        type: "AssignmentExpression",
        operator: "=",
        left: headTarget,
        right: { type: "Identifier", name: bindName },
      } as unknown as Expression;
      headAssignSrc = emitTranspileExpression(synth, bodyOpts);
    }
  }
  const max = opts.maxLoopIters ?? 8;
  // 与 while/for 同协议：体内外层绑定 pack/unpack，抽象/空迭代出口可 join
  const assigned = new Set<string>();
  collectAssignedIds(stmt.body, assigned);
  collectArrMutatorReceivers(stmt.body, assigned);
  // Bug 163 / 178：头赋值写入的外层绑定（var 头槽 / 标识符头 / 成员头根）
  // 同样进写回集——否则抽象出口把头写覆盖成旧值
  for (const n of headAssignedNames) {
    // const 绑定被头赋值 = 原生 TypeError（$throwConstAssign 通道），
    // 不得再进 pack/unpack（重绑 const 绑定是非法 JS）
    if (opts.constNames?.has(n)) continue;
    assigned.add(n);
  }
  const names = expandAliasNames(
    [...assigned].filter(
      (n) =>
        n !== bindName &&
        !HOST_INTRINSIC_SET.has(n) &&
        !bodyLocalDecls.has(n) &&
        // 报告外发现：头解构（let/const）的子名是回调内块级绑定——pack/unpack
        // 闭包在回调外，引用它 ⇒ ReferenceError（`for (let {a} of arr)` 抽象
        // 出口直接抛）。排除：它们不是外层绑定（每轮独立 / const 不可再赋）。
        !headLocalNames.has(n),
    ),
    opts,
  );
  const loopOpts = opts.loopLabel ? `label: ${JSON.stringify(opts.loopLabel)}` : "";
  const forAwaitOpt = isForAwait ? "forAwait: true" : "";
  // Bug 98：for-in 接收者以 thunk 传给 $forOf——快照键进体前逐迭代重查
  // 在场（体内 delete 的未访问键跳过，与原生 EnumerateObjectProperties
  // 一致）。纯接收者 thunk 每迭代重读当前绑定（delete 写回
  // o = $del(o, k) / 成员链 o = $set(o, …) 经闭包可见）；副作用接收者
  // 已在循环头求值入 __forInRecv，重查按该快照引用（此形态 delete
  // 不可见，保持快照口径——副作用一次求值优先）。
  const forInRecvOpt = isIn ? `forInRecv: () => (${recvSrc})` : "";
  const tailOpts = [loopOpts, forAwaitOpt, forInRecvOpt].filter(Boolean).join(", ");
  const optsSrc =
    names.length === 0
      ? tailOpts
        ? `, { ${tailOpts} }`
        : ""
      : `, { pack: () => ${packSrcOf(names, opts)}, unpack: ${unpackSrcOf(names)}${tailOpts ? `, ${tailOpts}` : ""} }`;
  return [
    ...recvPre,
    // Bug 201：`for await` 的挂起门——原生每轮一个 await；引擎既有建模
    // 是同步驱动 ⇒ **整循环一个**挂起点（循环前 yield，循环体在恢复点
    // 跑）。口径偏差已登记（与引擎既有的同步 for-await 建模一致）。
    // 只有**生成器级**位置的 for await 才发门（分支臂/循环体里的是宿主
    // thunk——yield 会是语法错误）。
    ...(isForAwait &&
    typeof (stmt as { start?: number }).start === "number" &&
    opts.asyncForAwaitGates?.has(String((stmt as { start?: number }).start))
      ? [`${pad}yield $lit(void 0);`]
      : []),
    `${pad}$forOf(${iter}, (${bindName}, _i) => {`,
    // Bug 163 / 178：头赋值在**每轮进体时**写回目标（原生：每轮把
    // 迭代项赋给头目标）——放在 destructure 之前、循环体语句之前
    ...(headAssignSrc ? [`${indent(depth + 2)}${headAssignSrc};`] : []),
    ...bodyLines,
    bodyStmts,
    `${pad}}, ${max}${optsSrc});`,
  ].join("\n");
}

function emitWhileStatement(
  stmt: WhileStatement,
  depth: number,
  opts: TranspileOptions,
): string {
  const pad = indent(depth);
  const test = emitTranspileExpression(stmt.test, opts);
  // 循环体是**块作用域**（体 thunk 内）——体顶层词法声明在体内遮蔽外层
  // 绑定 ⇒ 别名组按体顶层声明过滤（体内 fork 不得把外层别名伙伴拉进绑定
  // 集）。pack/unpack 发射在**外层**作用域 ⇒ 用未过滤的组。
  const bodyLocalDecls = new Set<string>();
  const bodyOpts = loopBodyOptsOf(stmt.body, opts, opts.constNames, bodyLocalDecls);
  const body =
    stmt.body.type === "BlockStatement"
      ? stmt.body.body.map((s) => transpileStatement(s, depth + 1, bodyOpts)).join("\n")
      : transpileStatement(stmt.body, depth + 1, bodyOpts);
  const max = opts.maxLoopIters ?? 8;
  // body/test 内被赋值的标识符 → pack/unpack，抽象条件出口可 join（P0 健全）
  // 注：mutator 接收者不入集——与既有 while 精度口径一致（for/for-of/
  // do-while 入集；while 保持 #136 的 {0,1} 出口 join 精度）
  const assigned = new Set<string>();
  collectAssignedIds(stmt.body, assigned);
  collectAssignedIds(stmt.test, assigned);
  // while 守卫收窄（issue #118 v3）：测试的 cons 臂事实作用于循环体——
  // `while ((m = re.exec(s)))` 每轮测试真值 ⇒ 该轮体内 m 非 nullish，
  // `m[2].trim()` 不再撞 null 臂记假 may-throw（#97/#118 臂剪影的循环
  // 版）。体工厂逐迭代调用，IIFE 在**每次进体**时以当前绑定求 remove
  // 串（不跨迭代缓存）；$whileSeq 先 test() 后 body()，体内事实成立。
  // 体侧守卫名有写（含 mutator receiver）/体顶层同名词法声明 → 跳过
  // 全部（影子参数吞体侧写 / 重复声明 SyntaxError）；测试侧赋值恰是
  // `(m = …)` 惯用形态，不构成跳过。pack/unpack 名集（体∪测试）不变。
  const bodyWrites = new Set<string>();
  collectAssignedIds(stmt.body, bodyWrites);
  collectArrMutatorReceivers(stmt.body, bodyWrites);
  // Bug 185：关系守卫（`x > 0`）与 nullish 守卫**同口径**接进循环体
  // （此前 while 只接 nullish ⇒ 同一机制内部不自洽：`while (x > 0)`
  // 的体内 x 折不出 > 0 事实）。事实臂 = 测试为真 ⇒ 体内成立。
  const loopGuards = loopBodyGuardsOf(stmt.test, bodyLocalDecls, bodyWrites, undefined, undefinedIsIntrinsicOf(opts));
  const names = expandAliasNames([...assigned].filter((n) => !HOST_INTRINSIC_SET.has(n) && !bodyLocalDecls.has(n)), opts);
  const bodyNarrowed = narrowLoopBody(body, loopGuards, depth, names);
  const loopOpts = opts.loopLabel ? `label: ${JSON.stringify(opts.loopLabel)}` : "";
  if (names.length === 0) {
    return [
      `${pad}// while → $whileSeq (bounded, max=${max})`,
      `${pad}$whileSeq(() => ${test}, () => {`,
      bodyNarrowed,
      `${pad}}, ${max}${loopOpts ? `, { ${loopOpts} }` : ""});`,
    ].join("\n");
  }
  const packSrc = packSrcOf(names, opts);
  const unpackSrc = unpackSrcOf(names);
  return [
    `${pad}// while → $whileSeq (instrumented bindings: ${names.join(", ")})`,
    `${pad}$whileSeq(() => ${test}, () => {`,
    bodyNarrowed,
    `${pad}}, ${max}, { pack: () => ${packSrc}, unpack: ${unpackSrc}${loopOpts ? `, ${loopOpts}` : ""} });`,
  ].join("\n");
}

function emitDoWhileStatement(
  stmt: DoWhileStatement,
  depth: number,
  opts: TranspileOptions,
): string {
  const pad = indent(depth);
  // do { body } while (test) ≡ body; while (test) { body }（有界、可 instrument）
  const test = emitTranspileExpression(stmt.test, opts);
  // 循环体是**块作用域**（体 thunk 内）——体顶层词法声明在体内遮蔽外层
  // 绑定 ⇒ 别名组按体顶层声明过滤（体内 fork 不得把外层别名伙伴拉进绑定
  // 集）。pack/unpack 发射在**外层**作用域 ⇒ 用未过滤的组。
  const bodyLocalDecls = new Set<string>();
  const bodyOpts = loopBodyOptsOf(stmt.body, opts, opts.constNames, bodyLocalDecls);
  const bodyStmts =
    stmt.body.type === "BlockStatement"
      ? stmt.body.body.map((s) => transpileStatement(s, depth + 1, bodyOpts)).join("\n")
      : transpileStatement(stmt.body, depth + 1, bodyOpts);
  const max = opts.maxLoopIters ?? 8;
  const assigned = new Set<string>();
  collectAssignedIds(stmt.body, assigned);
  collectAssignedIds(stmt.test, assigned);
  collectArrMutatorReceivers(stmt.body, assigned);
  // do-while 守卫收窄（issue #118 v3）：**只**收窄内层 $whileSeq 的体
  // 拷贝（第 2 轮起先过测试，cons 臂事实成立）；首次独立拷贝先于任何
  // 测试求值执行（`do { m[0] } while ((m = f()))` 首轮 m 可能
  // nullish），保持未收窄（sound）。跳过规则与 while 同口径：体侧守卫
  // 名有写 / 体顶层同名词法声明 → 全部跳过；测试侧赋值不算。
  const bodyWrites = new Set<string>();
  collectAssignedIds(stmt.body, bodyWrites);
  collectArrMutatorReceivers(stmt.body, bodyWrites);
  const names = expandAliasNames([...assigned].filter((n) => !HOST_INTRINSIC_SET.has(n) && !bodyLocalDecls.has(n)), opts);
  // Bug 185 同构缺口：do-while 的**关系守卫**（`x > 0`）此前没接进体侧
  // （只接了 nullish 守卫）⇒ 体内 x 折不出 > 0 事实（同一机制内部不
  // 自洽：for / while 都接了）。改用 loopBodyGuardsOf + narrowLoopBody
  // （与 for / while **同口径**）：nullish 走 $removeNullish 影子参数、
  // 关系走 $refineRel 影子参数（事实臂；补集方向不可健全表示）。
  const loopGuards = loopBodyGuardsOf(stmt.test, bodyLocalDecls, bodyWrites, undefined, undefinedIsIntrinsicOf(opts));
  const innerBody = narrowLoopBody(bodyStmts, loopGuards, depth, names);
  const packSrc = names.length === 0 ? null : packSrcOf(names, opts);
  const unpackSrc = names.length === 0 ? null : unpackSrcOf(names);
  const loopOpts = opts.loopLabel ? `label: ${JSON.stringify(opts.loopLabel)}` : "";
  const optsSrc =
    packSrc && unpackSrc
      ? `, { pack: () => ${packSrc}, unpack: ${unpackSrc}${loopOpts ? `, ${loopOpts}` : ""} }`
      : loopOpts
        ? `, { ${loopOpts} }`
        : "";
  // Bug 170：体**恒在循环 thunk 内**执行。旧口径把首份体拷贝放在
  // `$whileSeq` **之外**（`body; while (T) { body }`）——此刻没有任何循环
  // 在运行，体里的 `break` / `continue` 发射的 $loopBreak() /
  // $loopContinue() 无人吸收 → 信号冒泡出函数体 → 被记成「函数抛
  // NudoLoopSignal」（L2 门禁假红 + 签名退化成 unknown）。
  // 修法：`do B while(T)` ≡ `$whileSeq(() => 首轮 ? true : T, () => {
  // 首轮 ? B₁ : B₂ })`——首轮用「首轮标记」把首份体 B₁ 移进 thunk
  // （原生 do-while 首轮**先**跑体、后求值条件 ⇒ 首轮不求值 T），
  // 此后各轮先过 T 再跑 B₂。B₁ / B₂ 两份拷贝沿用既有形态（首轮不收窄、
  // 次轮收窄——issue #118 v3：收窄事实来自 T，首轮 T 尚未求值）。
  //
  // Bug 1159：首轮标记是**块级词法绑定**，而体 thunk 里内联用户体源码
  // ⇒ 写死 `__nudoDwFirst` 会遮蔽用户同名绑定（体读到引擎布尔而非用户值）。
  // 实际名经分配器；无碰撞时逐字不变。
  const dwFirst = internalTmpName("__nudoDwFirst", opts);
  return [
    `${pad}// do-while → $whileSeq (体恒在 thunk 内，bounded, max=${max})`,
    `${pad}{`,
    `${indent(depth + 1)}let ${dwFirst} = true;`,
    `${indent(depth + 1)}$whileSeq(() => ${dwFirst} ? $lit(true) : ${test}, () => {`,
    `${indent(depth + 2)}if (${dwFirst}) {`,
    `${indent(depth + 3)}${dwFirst} = false;`,
    bodyStmts,
    `${indent(depth + 2)}} else {`,
    innerBody,
    `${indent(depth + 2)}}`,
    `${indent(depth + 1)}}, ${max}${optsSrc});`,
    `${pad}}`,
  ].join("\n");
}
