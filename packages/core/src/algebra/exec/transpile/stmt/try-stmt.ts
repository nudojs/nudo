/**
 * try 语句发射（stmt 按域拆分之一）：可选 require 折叠、soft 效果帧
 * （$tryMark / $tryTakeSince / $tryDetachSoftCatch）、catch 模式参解构、
 * finally 块作用域 const 面与 yield 上下文位（Bug 52）等不变量注释随
 * emitTryStatement 原样保留；总账另见 ./statement.ts 头注释。主分派
 * （transpileStatement）在 ./statement.ts。
 */
import type { Node, Statement, TryStatement } from "@babel/types";
import type { TranspileOptions } from "../types.ts";
import {
  indent,
  collectPatternNames,
  internalTmpName,
  computeConstScope,
  copyConstScope,
  finalizerBits,
} from "../helpers.ts";
import {
  emitDestructure,
  matchOptionalRequire,
  catchMayRethrow,
} from "../emit.ts";
import { transpileFnBodyStmts } from "./fn-body.ts";
import {
  YIELD_TRY_FINALLY,
  YIELD_TRY_CATCH,
  YIELD_FINALLY_YIELDS,
  YIELD_FINALLY_RETURNS,
  YIELD_CATCH_RETURNS,
  YIELD_CATCH_YIELDS,
  YIELD_CATCH_RETHROWS,
} from "../../yield-bits.ts";
import { transpileStatement } from "./statement.ts";

export function emitTryStatement(
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
  // 原样）。位值单源：exec/yield-bits.ts（transpile 与 runtime 共引）。
  const fin = stmt.finalizer
    ? finalizerBits(stmt.finalizer as Node)
    : undefined;
  const finBits = stmt.finalizer
    ? YIELD_TRY_FINALLY | (fin!.yields ? YIELD_FINALLY_YIELDS : 0) | (fin!.returns ? YIELD_FINALLY_RETURNS : 0)
    : 0;
  // R1a：catch 静态事实（finalizerBits 同口径：含 yield / 含 return /
  // 可能 rethrow）——描述**最近** enclosing catch 的吸收结局，故本 try
  // 带 handler 时替换外层 catch 事实位（外层 catch 只有在内层重抛后才
  // 可达，此时结局不可分类 → 64 降级）。内层可能 rethrow 且外层还有
  // catch → 二次吸收路径外层事实未标注，同样置 64。
  const catchFacts = stmt.handler
    ? (() => {
        const cb = finalizerBits(stmt.handler!.body as Node);
        const rethrows = catchMayRethrow(stmt.handler!) && ((opts.yieldTryCtx ?? 0) & YIELD_TRY_CATCH) !== 0;
        return YIELD_TRY_CATCH | (cb.returns ? YIELD_CATCH_RETURNS : 0) | (cb.yields ? YIELD_CATCH_YIELDS : 0) | (rethrows ? YIELD_CATCH_RETHROWS : 0);
      })()
    : 0;
  const innerYieldCtx =
    ((opts.yieldTryCtx ?? 0) & ~(YIELD_CATCH_RETURNS | YIELD_CATCH_YIELDS | YIELD_CATCH_RETHROWS)) | finBits | catchFacts;
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

