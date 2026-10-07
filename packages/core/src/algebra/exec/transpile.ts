/**
 * 求值引擎 transpile：JS AST → 可在 Node 上执行的抽象值程序（源码字符串）。
 * 运算符改为 $add/$sub/…；if 改为 $fork；for 改为 $for。
 * 值类型是 Abs；副作用与模块仍由 host mock/注入。
 *
 * 实现按语句/表达式/模式拆在 transpile/*.ts；本文件是 re-export facade，
 * 对外符号面保持不变（exec/index.ts `export * from "./transpile.ts"`）。
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
import { collectVarHoistNames, collectExportVarNames } from "./transpile/helpers.ts";
export { transpileBodyNode } from "./transpile/stmt.ts";
export { transpileExpression } from "./transpile/expr.ts";

export function transpileSource(source: string, opts: TranspileOptions = {}): string {
  const file = parseSource(source);
  return transpileFile(file, { ...opts, source: opts.source ?? source });
}

/** 运行时 import 行（body-fn 编译执行拼接用） */
export function runtimeImportOf(runtime: string): string {
  return `import { $absVal, $add, $sub, $mul, $div, $mod, $bitand, $bitor, $bitxor, $bitnot, $shl, $shr, $ushr, $pow, $toNumber, $toNumeric, $updateAdd, $updateSub, $in, $instanceof, $instanceofNonIdent, $classExpr, $del, $delRes, $objAccessor, $objAccessorKey, $neg, $typeof, $not, $eq, $ne, $eqLoose, $neLoose, $lt, $le, $gt, $ge, $join, $lit, $fork, $for, $forIter, $obj, $get, $set, $setProto, $while, $whileSeq, $arr, $arrWithHoles, $arrMutContainer, $idx, $idxSet, $len, $call, $throw, $loopReturn, $loopBreak, $loopContinue, $class, $new, $invoke, $invokeSuper, $invokeSuperObj, $invokeSuperKey, $getSuper, $getSuperObj, $super, $async, $copy, $await, $asyncReturn, $orDefault, $callNamed, $optionalGet, $optionalInvoke, $spread, $concat, $forOf, $forInKeys, $iterCheck, $catchVal, $switch, $staticInvoke, $setKey, $gen, $newTarget, $staticInit, $yield, $fnVal, $regex, $reStateCall, $rethrowIfNudoReturn, $nullishTest, $removeNullish, $removeNull, $removeUndefined, $removeMemberNullish, $narrowMemberEq, $narrowTypeOf, $tryMark, $assignRecord, $recordBinding, $unknown, $importMeta, $dynamicImport, $tryTakeSince, $tryCurrentMark, $tryPopMark, $tryDigestSoftCatch, $tryReleaseSoftOut, $tryDetachSoftCatch, $tryDiscardSoft, $tryOrphanSoft, $pushLoopExit, $objRest, $arrRest, $elems, $arguments, $isForkExit, $rawThis, $isBreakTo, $yieldStar, $tpl } from ${JSON.stringify(runtime)};`;
}

export function transpileFile(file: File, opts: TranspileOptions = {}): string {
  const runtime = opts.runtimeImport ?? "@nudojs/core/exec";
  // Bug 15：解构临时名单调计数器（跨语句/prologue 唯一，与源行号解耦）
  const destrTmpSeq = opts.destrTmpSeq ?? { n: 0 };
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
  const scopedOpts: TranspileOptions = {
    ...opts,
    destrTmpSeq,
    ...(varEmitNames.size > 0 ? { hoistedVarNames: varEmitNames } : {}),
  };
  const lines: string[] = [
    `// nudo evaluator transpile — values are Abs; operators are overloaded calls`,
    `import { $absVal, $add, $sub, $mul, $div, $mod, $bitand, $bitor, $bitxor, $bitnot, $shl, $shr, $ushr, $pow, $toNumber, $toNumeric, $updateAdd, $updateSub, $in, $instanceof, $instanceofNonIdent, $classExpr, $del, $delRes, $objAccessor, $objAccessorKey, $neg, $typeof, $not, $eq, $ne, $eqLoose, $neLoose, $lt, $le, $gt, $ge, $join, $lit, $fork, $for, $forIter, $obj, $get, $set, $setProto, $while, $whileSeq, $arr, $arrWithHoles, $arrMutContainer, $idx, $idxSet, $len, $call, $throw, $loopReturn, $loopBreak, $loopContinue, $class, $new, $invoke, $invokeSuper, $invokeSuperObj, $invokeSuperKey, $getSuper, $getSuperObj, $super, $async, $copy, $await, $asyncReturn, $orDefault, $callNamed, $optionalGet, $optionalInvoke, $spread, $concat, $forOf, $forInKeys, $iterCheck, $catchVal, $switch, $staticInvoke, $setKey, $gen, $newTarget, $staticInit, $yield, $fnVal, $regex, $reStateCall, $rethrowIfNudoReturn, $nullishTest, $removeNullish, $removeNull, $removeUndefined, $removeMemberNullish, $narrowMemberEq, $narrowTypeOf, $tryMark, $assignRecord, $recordBinding, $unknown, $importMeta, $dynamicImport, $tryTakeSince, $tryCurrentMark, $tryPopMark, $tryDigestSoftCatch, $tryReleaseSoftOut, $tryDetachSoftCatch, $tryDiscardSoft, $tryOrphanSoft, $pushLoopExit, $objRest, $arrRest, $elems, $arguments, $isForkExit, $rawThis, $isBreakTo, $yieldStar, $tpl } from ${JSON.stringify(runtime)};`,
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
