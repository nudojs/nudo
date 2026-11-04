/**
 * 语句 switch 主分派（stmt 按域拆分之一；方法/函数体入口在 ./fn-body.ts，
 * 块 thunk 化在 ./block.ts）。主分派是**路由表**：case 体在按域拆分的
 * emit* helper 里——本文件保留声明/return/表达式/变量/if（emit*Statement），
 * import/export 在 ./module-stmt.ts，for/for-in/while/do-while 在
 * ./loop-stmt.ts，switch 在 ./switch-stmt.ts，try 在 ./try-stmt.ts（全部
 * 共享**转译单元级**发射状态袋（opts.stmtEmit，根单元每次新建）与 opts，
 * 不传额外上下文对象）。
 *
 * 不变量：
 * - switchBodySeq 是**转译单元内**私有计数器（跨语句/函数去重，跨单元
 *   不残留——同源 ⇒ 同产物），只随 transpileStatement 的 switch 共享体
 *   发射递增；
 * - switch 臂内的 break 走**带标签**的 break 信号（$loopBreak(标签)）：信号
 *   穿过嵌套 thunk（if 臂），由 switch 臂入口的 catch 吸收 ⇒ break 真的
 *   退出 switch（原生语义）；带标签 ⇒ 外层循环不吸收（$isBreakTo 只匹配
 *   同标签）；curSwitchBreakLabel 是当前正在发射的 switch 臂的标签（栈式
 *   保存 / 恢复，嵌套 switch 各自一份；挂状态袋，非模块级）；
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
 *   short-circuit.ts 同源；控制流谓词在 ./predicates.ts（leaf）；
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
  Expression,
  ExpressionStatement,
  FunctionDeclaration,
  IfStatement,
  Node,
  ReturnStatement,
  Statement,
  VariableDeclaration,
} from "@babel/types";
import type { TranspileOptions } from "../types.ts";
import {
  stmtReturns,
  withImplicitReturn,
  narrowNullishArmThunks,
  narrowTypeArmThunk,
  nullishGuardsOf,
  typeGuardOf,
  discriminantGuardsOf,
  narrowDiscriminantArmThunks,
  relGuardOf,
  narrowRelArmThunk,
} from "./predicates.ts";
import {
  matchAsOverride,
  getFnFacets,
  indent,
  collectForkBindingNames,
  collectPatternNames,
  withClassNameHint,
  userIdentInfoOf,
  bumpDestrTmpSeq,
  stmtEmitStateOf,
  internalTmpName,
  expandAliasNames,
  thisCarrierOf,
} from "../helpers.ts";
import { UNDEF_LIT } from "../intrinsics.ts";
import { NudoUnsupportedError } from "../../unsupported.ts";
import {
  emitStmtWritebackRebinds,
  emitDestructure,
  emitParamBinding,
  forkBindingDecls,
  forkJoinBindings,
  forkTmpNames,
  forkArmThunkExpr,
  genOuterFreeWriteNames,
  genFreeWriteWrap,
} from "../emit.ts";
import { emitTranspileExpression } from "../transpile-dispatch.ts";
import { paramNamesOf, transpileFnBodyStmts } from "./fn-body.ts";
// Bug 174：形参默认值里的 `this` 判定（声明面与表达式面共用同一实现）
import { asyncBodyPlan } from "../async-plan.ts";
import { transpileBlockAsThunk } from "./block.ts";
import { transpileClass } from "../class-emit.ts";
import { emitExportNamedDeclaration, emitImportDeclaration } from "./module-stmt.ts";
import {
  emitForStatement,
  emitForInStatement,
  emitWhileStatement,
  emitDoWhileStatement,
} from "./loop-stmt.ts";
import { emitSwitchStatement } from "./switch-stmt.ts";
import { emitTryStatement } from "./try-stmt.ts";
// 语句发射序号袋（switch 共享体 / break 标签 / for-in 接收者 / for 循环
// 变量槽 + 臂标签栈）是**转译单元级**状态（opts.stmtEmit，根单元每次
// 新建——同源 ⇒ 同产物；此前是本文件模块级 let，跨单元残留 ⇒ 二次
// 转译漂移）。发射器一律经 stmtEmitStateOf(opts) 取同一袋，嵌套语句
// （switch 臂内的 break 读标签）共享同一实例。各计数器与标签栈的语义
// 不变量见各发射点注释（switch 在 ./switch-stmt.ts、循环在 ./loop-stmt.ts）。

/** 宿主内建 `undefined` 是否仍是**未遮蔽**的字面量——nullish 守卫 / case 标签
 *  等静态窄化事实的前提。本单元内被用户绑定遮蔽（`const undefined = 5` /
 *  形参名）时，比较值/标签是绑定值，不得当 undefined 字面量识别
 * （transpileFile / transpileBodyNode 经 opts.shadowedIntrinsics 线程化）。
 * loop/switch 域发射器（./loop-stmt.ts、./switch-stmt.ts）共引本判定。 */
export function undefinedIsIntrinsicOf(opts: TranspileOptions): boolean {
  return opts.shadowedIntrinsics?.has("undefined") !== true;
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
        // 臂标签取本转译单元的发射状态袋（同单元内嵌套 switch 各自一份，
        // 栈式保存/恢复见 emitSwitchStatement）
        const armLabel = stmtEmitStateOf(opts).curSwitchBreakLabel;
        if (armLabel) {
          return `${pad}$loopBreak(${JSON.stringify(armLabel)});`;
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
    // Bug 212（A1 步骤 1）：生成器体 eager 跑完会把**外层**绑定确定地写成
    // 「跑完之后」的值（原生构造点未执行体）⇒ 快照自由写 + finally $join
    // 折回（不写外层绑定的生成器产物逐字不变）。opts = 外层作用域
    //（快照/join 码在 thunk 里，名字解析到外层绑定 ⇒ aliasGroups 取外层集）。
    const genBody = genFreeWriteWrap(
      bodySrc,
      genOuterFreeWriteNames(stmt.body, paramNamesOf(stmt.params as Node[]), opts),
      indent(depth + 2),
      opts,
    );
    return [
      kindStamp,
      `${pad}${exportKw}function ${stmt.id.name}(${hostSig.join(", ")}) {`,
      restBind,
      `${indent(depth + 1)}return $gen(() => {`,
      genBody,
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
    const retRebinds = mutNodes ? emitStmtWritebackRebinds(mutNodes, opts, pad) : [];
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
  // 此处的语句位写回只剩 Bug 96 正则状态（见 emitStmtWritebackRebinds）。
  const expr = stmt.expression as Expression;
  const exprRebinds = emitStmtWritebackRebinds(expr, opts, pad);
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
        lines.push(...emitStmtWritebackRebinds(d.init as Node, opts, pad));
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
        lines.push(...emitStmtWritebackRebinds(d.init as Node, opts, pad));
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
    lines.push(...emitStmtWritebackRebinds(d.init as Node, opts, pad));
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
  const testRebinds = emitStmtWritebackRebinds(stmt.test as Node, opts, pad);
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
