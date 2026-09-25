/**
 * B 路径 transpile：JS AST → 可在 Node 上执行的抽象值程序（源码字符串）。
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
export { transpileBodyNode } from "./transpile/stmt.ts";
export { transpileExpression } from "./transpile/expr.ts";

export function transpileSource(source: string, opts: TranspileOptions = {}): string {
  const file = parseSource(source);
  return transpileFile(file, { ...opts, source: opts.source ?? source });
}

/** 运行时 import 行（body-fn 编译执行拼接用） */
export function runtimeImportOf(runtime: string): string {
  return `import { $add, $sub, $mul, $div, $mod, $bitand, $bitor, $bitxor, $bitnot, $shl, $shr, $ushr, $pow, $toNumber, $in, $instanceof, $instanceofNonIdent, $classExpr, $del, $delRes, $objAccessor, $neg, $typeof, $not, $eq, $ne, $eqLoose, $neLoose, $lt, $le, $gt, $ge, $join, $lit, $fork, $for, $forIter, $obj, $get, $set, $while, $whileSeq, $arr, $arrWithHoles, $arrMutContainer, $idx, $idxSet, $len, $call, $throw, $loopReturn, $loopBreak, $loopContinue, $class, $new, $invoke, $invokeSuper, $super, $async, $copy, $await, $asyncReturn, $orDefault, $callNamed, $optionalGet, $optionalInvoke, $spread, $concat, $forOf, $forInKeys, $catchVal, $switch, $staticInvoke, $setKey, $gen, $yield, $fnVal, $regex, $reStateCall, $rethrowIfNudoReturn, $nullishTest, $tryMark, $assignRecord, $recordBinding, $unknown, $importMeta, $dynamicImport, $tryTakeSince, $tryCurrentMark, $tryPopMark, $tryDigestSoftCatch, $tryReleaseSoftOut, $tryDetachSoftCatch, $tryDiscardSoft, $tryOrphanSoft, $pushLoopExit, $objRest, $arrRest, $arguments, $isForkExit, $rawThis, $isBreakTo } from ${JSON.stringify(runtime)};`;
}

export function transpileFile(file: File, opts: TranspileOptions = {}): string {
  const runtime = opts.runtimeImport ?? "@nudojs/core/exec";
  const lines: string[] = [
    `// nudo B-path transpile — values are Abs; operators are overloaded calls`,
    `import { $add, $sub, $mul, $div, $mod, $bitand, $bitor, $bitxor, $bitnot, $shl, $shr, $ushr, $pow, $toNumber, $in, $instanceof, $instanceofNonIdent, $classExpr, $del, $delRes, $objAccessor, $neg, $typeof, $not, $eq, $ne, $eqLoose, $neLoose, $lt, $le, $gt, $ge, $join, $lit, $fork, $for, $forIter, $obj, $get, $set, $while, $whileSeq, $arr, $arrWithHoles, $arrMutContainer, $idx, $idxSet, $len, $call, $throw, $loopReturn, $loopBreak, $loopContinue, $class, $new, $invoke, $invokeSuper, $super, $async, $copy, $await, $asyncReturn, $orDefault, $callNamed, $optionalGet, $optionalInvoke, $spread, $concat, $forOf, $forInKeys, $catchVal, $switch, $staticInvoke, $setKey, $gen, $yield, $fnVal, $regex, $reStateCall, $rethrowIfNudoReturn, $nullishTest, $tryMark, $assignRecord, $recordBinding, $unknown, $importMeta, $dynamicImport, $tryTakeSince, $tryCurrentMark, $tryPopMark, $tryDigestSoftCatch, $tryReleaseSoftOut, $tryDetachSoftCatch, $tryDiscardSoft, $tryOrphanSoft, $pushLoopExit, $objRest, $arrRest, $arguments, $isForkExit, $rawThis, $isBreakTo } from ${JSON.stringify(runtime)};`,
    ``,
  ];
  for (const stmt of file.program.body) {
    lines.push(transpileStatement(stmt, 0, opts));
  }
  return lines.join("\n") + "\n";
}

/** 解析 + transpile */
export function transpile(source: string, opts?: TranspileOptions): string {
  return transpileSource(source, opts);
}
