/**
 * 求值引擎 transpile：JS AST → 可在 Node 上执行的抽象值程序（源码字符串）。
 * 运算符改为 $add/$sub/…；if 改为 $fork；for 改为 $for。
 * 值类型是 Abs；副作用与模块仍由 host mock/注入。
 *
 * 实现按语句/表达式/模式拆在 transpile/*.ts；本文件是 re-export facade，
 * 对外符号面保持不变（exec/index.ts `export * from "./transpile.ts"`）。
 *
 * 不变量（解构临时名，Bug 181）：
 * - 模块级解构临时名计数器（`destrTmpSeq`）在**创建处**即预置避让：序号
 *   推过用户已占用的 `_d{n}` / `_n{n}` ⇒ 首次分配（模块首条语句即解构
 *   声明）也拿不到与用户同名绑定重复的临时名（重复词法声明 ⇒ SyntaxError
 *   ⇒ 整模块求值失败 ⇒ 导出退化 unknown）。
 */
import type { File, Expression, Statement, Node } from "@babel/types";
import { parseSource } from "../parse-source.ts";
import { transpileStatement } from "./transpile/stmt.ts";
import type { TranspileOptions } from "./transpile/types.ts";

export type { TranspileOptions } from "./transpile/types.ts";
export {
  foldStaticStringExpr,
  foldRequireSpecArg,
} from "./transpile/helpers.ts";
import {
  collectVarHoistNames,
  collectExportVarNames,
  userIdentInfo,
  bumpDestrTmpSeq,
  registerConstFnScope,
} from "./transpile/helpers.ts";
export { transpileBodyNode } from "./transpile/stmt.ts";
export { transpileExpression } from "./transpile/expr.ts";

export function transpileSource(source: string, opts: TranspileOptions = {}): string {
  const file = parseSource(source);
  return transpileFile(file, { ...opts, source: opts.source ?? source });
}

/** 运行时 import 行（body-fn 编译执行拼接用） */
export function runtimeImportOf(runtime: string): string {
  return `import { $absVal, $add, $sub, $mul, $div, $mod, $bitand, $bitor, $bitxor, $bitnot, $shl, $shr, $ushr, $pow, $toNumber, $toNumeric, $updateAdd, $updateSub, $in, $instanceof, $instanceofNonIdent, $classExpr, $del, $delRes, $objAccessor, $objAccessorKey, $neg, $typeof, $not, $eq, $ne, $eqLoose, $neLoose, $lt, $le, $gt, $ge, $join, $lit, $fork, $for, $forIter, $obj, $get, $set, $setProto, $while, $whileSeq, $arr, $arrWithHoles, $restBind, $idx, $idxSet, $len, $call, $throw, $loopReturn, $catchReturn, $loopBreak, $loopContinue, $class, $new, $invoke, $invokeSuper, $invokeSuperObj, $invokeSuperKey, \$getSuper, \$getSuperObj, \$setSuper, \$setSuperObj, \$setSuperStatic, \$staticSuperInvoke, \$super, $async, $copy, $await, $asyncReturn, $orDefault, $callNamed, $optionalGet, $optionalInvoke, $spread, $concat, $forOf, $forInKeys, $iterCheck, $catchVal, $switch, $staticInvoke, $setKey, $gen, $newTarget, $staticInit, $yield, $fnVal, $regex, $reStateCall, $rethrowIfNudoReturn, $nullishTest, \$refineRel, \$removeNullish, $removeNull, $removeUndefined, $removeMemberNullish, $narrowMemberEq, $narrowTypeOf, $tryMark, $assignRecord, $recordBinding, $unknown, $importMeta, $dynamicImport, $tryTakeSince, $tryCurrentMark, $tryPopMark, $tryDigestSoftCatch, $tryReleaseSoftOut, $tryDetachSoftCatch, $tryDiscardSoft, $tryOrphanSoft, $pushLoopExit, $objRest, $arrRest, $elems, $arguments, $isForkExit, $rawThis, $isBreakTo, $yieldStar, $tpl, $fnKindStamp } from ${JSON.stringify(runtime)};`;
}

export function transpileFile(file: File, opts: TranspileOptions = {}): string {
  const runtime = opts.runtimeImport ?? "@nudojs/core/exec";
  // Bug 15：解构临时名单调计数器（跨语句/prologue 唯一，与源行号解耦）
  const destrTmpSeq = opts.destrTmpSeq ?? { n: 0 };
  // Bug 181：计数器创建处**预置避让**——用户自己声明了 `_d{n}` / `_n{n}`
  // 时，**首次分配**（模块**首条语句**即解构声明）在避让生效前就拿到了
  // `_d0` ⇒ 与用户同名绑定重复词法声明（SyntaxError ⇒ 整模块求值失败 ⇒
  // 导出退化 unknown + 假 nudo:opaque-result）。此处把序号**推过**用户
  // 占用的最大序号，首次分配起即安全（`_d`/`_n` 共用同一序号源）。
  bumpDestrTmpSeq(destrTmpSeq, userIdentInfo(opts.source));
  // Bug 42：try 临时名单调计数器（`__nudoTm_`/`__nudoE_` 同口径）
  const tryTmpSeq = opts.tryTmpSeq ?? { n: 0 };
  // Bug 21：模块级 var 提升（模块体是单作用域——块内 var 提升到模块顶；
  // export var 保持声明面不发提升 let，但名字留在发射集——块内同名 var
  // 仍改发赋值，写到导出绑定）
  const varNames = collectVarHoistNames(file.program.body);
  const exportVarNames = collectExportVarNames(file.program.body);
  // 提升声明扣除 export var 名与顶层函数声明名（声明面保留时 let 重声明
  // 是 SyntaxError；var 与函数声明原生同一绑定）；发射集保留并集——
  // 块内同名 var 改发赋值写到导出/函数绑定
  const skipDecl = new Set<string>(exportVarNames);
  for (const s of file.program.body) {
    if (s.type === "FunctionDeclaration" && s.id) skipDecl.add(s.id.name);
  }
  const varDeclNames = [...varNames].filter((n) => !skipDecl.has(n));
  const varHoistLine =
    varDeclNames.length > 0
      ? `let ${varDeclNames.map((n) => `${n} = $lit(void 0)`).join(", ")};`
      : null;
  const varEmitNames = new Set([...varNames, ...exportVarNames]);
  // issue #165：文件级 @nudo:assume 快速门——源文本含引理指令才置
  // assumeDirectiveFile（transpileFnBodyStmts 在函数体边界收待锚定
  // declarator）；无引理的文件锚定收集整体跳过，发射产物逐字节不变。
  const assumeFile = (opts.source ?? "").includes("@nudo:assume");
  // Bug ②：ESM import 绑定对用户代码不可变（再赋值 TypeError，
  // "Assignment to constant variable"）——import 本地名进模块级 const 面：
  // 标识符赋值/自增/逻辑赋值走既有 $throwConstAssign 通道；嵌套作用域
  // computeConstScope 并集继承、参数/块级 let 遮蔽自动扣除。
  const importConstNames = new Set<string>();
  for (const s of file.program.body) {
    if (s.type !== "ImportDeclaration") continue;
    for (const spec of s.specifiers) importConstNames.add(spec.local.name);
  }
  // 族 59 · W9：模块级 const 作用域集（**只**含 import 绑定 + 调用方传入的
  // 继承集）——模块体自身的 const 声明不进 `constNames`（该表是「用户层直接
  // 赋值 ⇒ TypeError」的判据，加模块自身 const 会改变既有门禁结论）。
  // 模块体自身的 const 只登记 **fn-const 面**（成员写不得重绑 const 根）。
  const moduleConstNames = new Set<string>(opts.constNames ?? []);
  for (const name of importConstNames) moduleConstNames.add(name);
  registerConstFnScope(moduleConstNames, file.program.body, opts.constNames);
  const scopedOpts: TranspileOptions = {
    ...opts,
    destrTmpSeq,
    tryTmpSeq,
    constNames: moduleConstNames,
    ...(varEmitNames.size > 0 ? { hoistedVarNames: varEmitNames } : {}),
    ...(assumeFile ? { assumeDirectiveFile: true } : {}),
  };
  const lines: string[] = [
    `// nudo evaluator transpile — values are Abs; operators are overloaded calls`,
    `import { $absVal, $add, $sub, $mul, $div, $mod, $bitand, $bitor, $bitxor, $bitnot, $shl, $shr, $ushr, $pow, $toNumber, $toNumeric, $updateAdd, $updateSub, $in, $instanceof, $instanceofNonIdent, $classExpr, $del, $delRes, $objAccessor, $objAccessorKey, $neg, $typeof, $not, $eq, $ne, $eqLoose, $neLoose, $lt, $le, $gt, $ge, $join, $lit, $fork, $for, $forIter, $obj, $get, $set, $setProto, $while, $whileSeq, $arr, $arrWithHoles, $restBind, $idx, $idxSet, $len, $call, $throw, $loopReturn, $catchReturn, $loopBreak, $loopContinue, $class, $new, $invoke, $invokeSuper, $invokeSuperObj, $invokeSuperKey, \$getSuper, \$getSuperObj, \$setSuper, \$setSuperObj, \$setSuperStatic, \$staticSuperInvoke, \$super, $async, $copy, $await, $asyncReturn, $orDefault, $callNamed, $optionalGet, $optionalInvoke, $spread, $concat, $forOf, $forInKeys, $iterCheck, $catchVal, $switch, $staticInvoke, $setKey, $gen, $newTarget, $staticInit, $yield, $fnVal, $regex, $reStateCall, $rethrowIfNudoReturn, $nullishTest, \$refineRel, \$removeNullish, $removeNull, $removeUndefined, $removeMemberNullish, $narrowMemberEq, $narrowTypeOf, $tryMark, $assignRecord, $recordBinding, $unknown, $importMeta, $dynamicImport, $tryTakeSince, $tryCurrentMark, $tryPopMark, $tryDigestSoftCatch, $tryReleaseSoftOut, $tryDetachSoftCatch, $tryDiscardSoft, $tryOrphanSoft, $pushLoopExit, $objRest, $arrRest, $elems, $arguments, $isForkExit, $rawThis, $isBreakTo, $yieldStar, $tpl, $fnKindStamp } from ${JSON.stringify(runtime)};`,
    ``,
  ];
  if (varHoistLine) lines.push(varHoistLine);
  for (const stmt of file.program.body) {
    lines.push(transpileStatement(stmt, 0, scopedOpts));
  }
  return lines.join("\n") + "\n";
}

/** 解析 + transpile */
export function transpile(source: string, opts?: TranspileOptions): string {
  return transpileSource(source, opts);
}
