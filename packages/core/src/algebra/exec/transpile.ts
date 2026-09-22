/**
 * B 路径 transpile：JS AST → 可在 Node 上执行的抽象值程序（源码字符串）。
 * 运算符改为 $add/$sub/…；if 改为 $fork；for 改为 $for。
 * 值类型是 Abs；副作用与模块仍由 host mock/注入。
 */

import type { File, Expression, Statement, Node } from "@babel/types";
import { parseSource } from "../parse-source.ts";
import { NudoUnsupportedError } from "./unsupported.ts";

export type TranspileOptions = {
  /** 运行时 import 说明符 */
  runtimeImport?: string;
  maxLoopIters?: number;
  /** 方法体内 this 的绑定名（transpile class 时注入） */
  thisParam?: string;
  /** 当前类名（super 派发用） */
  className?: string;
  /** 原始源码（@nudo:replace 按节点文本匹配） */
  source?: string;
  /** 替换表：归一化目标文本 → 注入变量名；可选语句范围 */
  replacements?: Array<{
    target: string;
    varName: string;
    /** 仅该语句范围内生效（1-based 行） */
    stmtStart?: number;
    stmtEnd?: number;
  }>;
  /** @nudo:as：覆盖紧随语句的 init / return */
  asOverrides?: Array<{ varName: string; stmtStart: number; stmtEnd: number }>;
  /** 循环嵌套深度（>0 时 return → $loopReturn，C2.1） */
  inLoop?: number;
  /** 循环体/switch 臂内：无标签 break 语义分别为跳出循环信号 / 臂结束 return */
  inSwitchArm?: boolean;
  /** 标签循环名（`outer: for …`）：传给 $for/$whileSeq/$forOf 供信号匹配 */
  loopLabel?: string;
  /** try 嵌套深度（>0 时 return 前 drain throwExits，使 catch 能吸收抽象 throw） */
  inTry?: number;
  /** 当前 try 的 mark 变量名（return drain 用；避免全局栈顶污染） */
  tryMarkName?: string;
  /** 当前 try 是否带 catch handler（soft may-throw digest/release 分支） */
  hasTryHandler?: boolean;
  /** 当前 try 的 catch 体是否可能 rethrow（正常路径 soft 效果 release 而非 digest） */
  tryRethrowCatch?: boolean;
  /** 分支/循环体内深度（赋值记录 conditional 标记；inLoop 也计入） */
  conditionalFlow?: number;
  /** 函数/箭头体内（顶层绑定表只收顶层作用域） */
  inFunction?: boolean;
};

function matchAsOverride(stmt: Node, opts: TranspileOptions): string | null {
  if (!opts.asOverrides?.length || !stmt.loc) return null;
  const line = stmt.loc.start.line;
  for (const a of opts.asOverrides) {
    if (line >= a.stmtStart && line <= a.stmtEnd) return a.varName;
  }
  return null;
}

/**
 * 函数体是否含 this：B 路径默认把函数声明/表达式转成无宿主 this 的调用，
 * 只有 body 引用 this 的函数才需要宿主 this 注入（$rawThis）。
 * 嵌套函数声明/表达式有自己的 this 边界，不下降；箭头函数词法 this 下降。
 */
function fnBodyHasThis(fn: { body?: Node | null }): boolean {
  const body = fn.body;
  if (!body) return false;
  const seen = new Set<Node>();
  const walk = (n: Node): boolean => {
    if (n.type === "ThisExpression") return true;
    if (n.type === "FunctionDeclaration" || n.type === "FunctionExpression") return false;
    if (seen.has(n)) return false;
    seen.add(n);
    for (const [k, v] of Object.entries(n)) {
      if (k === "loc" || k === "start" || k === "end" || k === "leadingComments" || k === "trailingComments") continue;
      if (Array.isArray(v)) {
        for (const item of v) {
          if (item && typeof item === "object" && "type" in (item as object)) {
            if (walk(item as Node)) return true;
          }
        }
      } else if (v && typeof v === "object" && "type" in (v as object)) {
        if (walk(v as Node)) return true;
      }
    }
    return false;
  };
  return walk(body);
}

function normWs(s: string): string {
  return s.replace(/\s+/g, "");
}

/** switch 共享体函数名序号（跨语句/函数去重） */
let switchBodySeq = 0;

function matchReplacement(node: Node, opts: TranspileOptions): string | null {
  if (!opts.source || !opts.replacements?.length) return null;
  if (node.start == null || node.end == null || !node.loc) return null;
  const src = opts.source.slice(node.start, node.end);
  const n = normWs(src);
  const line = node.loc.start.line;
  for (const r of opts.replacements) {
    if (r.stmtStart != null && line < r.stmtStart) continue;
    if (r.stmtEnd != null && line > r.stmtEnd) continue;
    if (normWs(r.target) === n) return r.varName;
  }
  return null;
}

const BIN_OPS: Record<string, string> = {
  "+": "$add",
  "-": "$sub",
  "*": "$mul",
  "/": "$div",
  "%": "$mod",
  "<": "$lt",
  "<=": "$le",
  ">": "$gt",
  ">=": "$ge",
  "===": "$eq",
  "!==": "$ne",
  "==": "$eqLoose",
  "!=": "$neLoose",
  "&": "$bitand",
  "|": "$bitor",
  "^": "$bitxor",
  "<<": "$shl",
  ">>": "$shr",
  ">>>": "$ushr",
  "**": "$pow",
  in: "$in",
};

/** 复合赋值 → 二元运行时（标识符与成员路径统一走读-改-写） */
const COMPOUND_OPS: Record<string, string> = {
  "+=": "$add",
  "-=": "$sub",
  "*=": "$mul",
  "/=": "$div",
  "%=": "$mod",
  "**=": "$pow",
  "<<=": "$shl",
  ">>=": "$shr",
  ">>>=": "$ushr",
  "&=": "$bitand",
  "|=": "$bitor",
  "^=": "$bitxor",
};

type MemberLayer = { get: (base: string) => string; set: (base: string, v: string) => string };
type MemberPath = { rootSrc: string; layers: MemberLayer[] };

/**
 * 成员/下标链 → 可重绑路径。根必须是标识符（或 transpile this 参数），
 * 其余（调用结果、new 表达式等）不可重绑 → null。
 */
function memberPathOf(m: { object: Node; property: Node; computed: boolean }, opts: TranspileOptions): MemberPath | null {
  const layers: MemberLayer[] = [];
  let cur: Node = m as unknown as Node;
  let rootSrc: string | null = null;
  while (cur.type === "MemberExpression") {
    const mm = cur as unknown as { object: Node; property: Node; computed: boolean };
    const k = mm.property;
    if (mm.computed) {
      if (k.type === "NumericLiteral") {
        const key = `$lit(${k.value})`;
        layers.unshift({
          get: (b) => `$idx(${b}, ${key})`,
          set: (b, v) => `$idxSet(${b}, ${key}, ${v})`,
        });
      } else if (k.type === "StringLiteral") {
        const key = JSON.stringify(k.value);
        layers.unshift({
          get: (b) => `$get(${b}, ${key})`,
          set: (b, v) => `$set(${b}, ${key}, ${v})`,
        });
      } else if (isExpression(k)) {
        const key = transpileExpression(k, opts);
        layers.unshift({
          get: (b) => `$idx(${b}, ${key})`,
          set: (b, v) => `$idxSet(${b}, ${key}, ${v})`,
        });
      } else {
        return null;
      }
    } else if (k.type === "Identifier") {
      const key = JSON.stringify(k.name);
      layers.unshift({
        get: (b) => `$get(${b}, ${key})`,
        set: (b, v) => `$set(${b}, ${key}, ${v})`,
      });
    } else {
      return null;
    }
    cur = mm.object;
  }
  if (cur.type === "Identifier") {
    rootSrc = cur.name;
  } else if (cur.type === "ThisExpression" && opts.thisParam) {
    rootSrc = opts.thisParam;
  } else {
    return null;
  }
  return { rootSrc, layers };
}

/** 路径读取源：d[i][0] → $idx($idx(d, i), 0) */
function readPathSrc(p: MemberPath): string {
  return p.layers.reduce((acc, l) => l.get(acc), p.rootSrc);
}

/** 路径写入源（返回新根）：d[i][0]=v → $idxSet(d, i, $idxSet($idx(d,i), 0, v)) */
function setPathSrc(p: MemberPath, valSrc: string): string {
  let acc = valSrc;
  for (let i = p.layers.length - 1; i >= 0; i--) {
    const l = p.layers[i]!;
    const base = i === 0 ? p.rootSrc : readPrefix(p, i - 1);
    acc = l.set(base, acc);
  }
  return acc;
}

/** 前 j 层的读取源 */
function readPrefix(p: MemberPath, j: number): string {
  return p.layers.slice(0, j + 1).reduce((acc, l) => l.get(acc), p.rootSrc);
}

/** 路径「去掉最后一层」的写回源：delete o.a.b ⇒ o = $set(o, "a", $del($get(o,"a"), "b")) */
function setParentPathSrc(p: MemberPath, valSrc: string): string {
  let acc = valSrc;
  for (let i = p.layers.length - 2; i >= 0; i--) {
    const l = p.layers[i]!;
    const base = i === 0 ? p.rootSrc : readPrefix(p, i - 1);
    acc = l.set(base, acc);
  }
  return acc;
}

const ARR_MUTATOR_NAMES = new Set([
  "push",
  "unshift",
  "splice",
  "pop",
  "shift",
  "reverse",
  "sort",
  "copyWithin",
  "fill",
]);

/** RegExp 有状态方法：语句/表达式位置都要把 lastIndex 更新后的 receiver 重绑 */
const REGEX_STATEFUL_NAMES = new Set(["test", "exec"]);

function isStatefulMethodName(name: string): boolean {
  return ARR_MUTATOR_NAMES.has(name) || REGEX_STATEFUL_NAMES.has(name);
}

/**
 * C1.4 / review P1：表达式位置的数组 mutator 也必须重绑容器。
 * 语句位置只重绑（丢 JS 返回值）；表达式位置先取返回值再重绑：
 *   const x = a.pop()  ⇒  let x = $invoke(a,"pop",…); a = $arrMutContainer(a,"pop",…);
 * 不进入函数边界（ObjectMethod / Function* / Arrow），方法体内 mutator
 * 在调用时才生效。
 * 逻辑/三元短路臂内的 mutator **不得**在此无条件重绑（P0）：由
 * transpileExpression 的 arm-snapshot 路径处理。
 */
function emitArrMutatorRebinds(
  expr: Node | null | undefined,
  opts: TranspileOptions,
  pad: string,
): string[] {
  const lines: string[] = [];
  if (!expr || typeof expr !== "object") return lines;
  const visit = (n: unknown): void => {
    if (!n || typeof n !== "object") return;
    const node = n as {
      type?: string;
      callee?: { type?: string; object?: Node; property?: Node; computed?: boolean };
      arguments?: unknown[];
      [k: string]: unknown;
    };
    if (
      node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression" ||
      node.type === "ObjectMethod" ||
      node.type === "ClassMethod"
    ) {
      return; // 函数边界：体内 mutator 不在本语句重绑
    }
    if (node.type === "LogicalExpression" || node.type === "ConditionalExpression") {
      return; // 短路臂：由表达式级 $fork + arm snapshot 负责
    }
    if (
      node.type === "AssignmentExpression" &&
      (node.operator === "||=" || node.operator === "&&=" || node.operator === "??=")
    ) {
      // 逻辑赋值 RHS 由短路 fork 隔离；语句级不得再无条件 rebind（P0-5）
      visit((node as { left?: unknown }).left);
      return;
    }
    if (
      node.type === "CallExpression" &&
      node.callee?.type === "MemberExpression" &&
      node.callee.computed !== true &&
      node.callee.property?.type === "Identifier" &&
      ARR_MUTATOR_NAMES.has((node.callee.property as { name: string }).name)
    ) {
      const methodName = (node.callee.property as { name: string }).name;
      const argSrcs = (node.arguments ?? [])
        .map((a) =>
          (a as { type?: string }).type === "SpreadElement"
            ? "$lit(undefined)"
            : isExpression(a as Node)
              ? transpileExpression(a as Expression, opts)
              : "$lit(undefined)",
        )
        .join(", ");
      // 注：RegExp test/exec 的状态写回在表达式内部联 IIFE 完成（顺序副作用
      // 需要），此处不重复写回（$reStateCall 重复执行会推进 lastIndex 两次）
      const objNode = node.callee.object as Node;
      if (objNode.type === "Identifier") {
        const name = (objNode as { name: string }).name;
        lines.push(
          `${pad}${name} = $arrMutContainer(${name}, ${JSON.stringify(methodName)}, [${argSrcs}]);`,
        );
      } else if (objNode.type === "MemberExpression" || objNode.type === "ThisExpression") {
        const path =
          objNode.type === "MemberExpression"
            ? memberPathOf(
                objNode as unknown as { object: Node; property: Node; computed: boolean },
                opts,
              )
            : null;
        if (path) {
          const recvSrc = readPathSrc(path);
          const mutSrc = `$arrMutContainer(${recvSrc}, ${JSON.stringify(methodName)}, [${argSrcs}])`;
          lines.push(`${pad}${path.rootSrc} = ${setPathSrc(path, mutSrc)};`);
        }
      }
      // 仍要遍历参数内嵌套 mutator（如 a.pop(b.pop())）
    }
    // Object.defineProperty(o, "k", desc)：返回值是新容器（value 进 slots），
    // 语句位置必须写回第一实参（freeze/seal/preventExtensions 就地标记无需写回）
    if (
      node.type === "CallExpression" &&
      node.callee?.type === "MemberExpression" &&
      node.callee.computed !== true &&
      node.callee.object?.type === "Identifier" &&
      (node.callee.object as { name: string }).name === "Object" &&
      node.callee.property?.type === "Identifier" &&
      (node.callee.property as { name: string }).name === "defineProperty" &&
      node.arguments?.[0] &&
      (node.arguments[0] as { type?: string }).type === "Identifier"
    ) {
      const argSrcs = (node.arguments as unknown as Expression[])
        .map((a) =>
          (a as { type?: string }).type === "SpreadElement"
            ? "$lit(undefined)"
            : transpileExpression(a, opts),
        )
        .join(", ");
      const targetName = (node.arguments[0] as { name: string }).name;
      lines.push(
        `${pad}${targetName} = $invoke(Object, "defineProperty", [${argSrcs}]);`,
      );
    }
    // delete obj[key]：语句位置把删键后的容器写回绑定（表达式值 $delRes 由 transpile 负责）
    if (
      node.type === "UnaryExpression" &&
      (node as { operator?: string }).operator === "delete" &&
      (node as { argument?: unknown }).argument &&
      ((node as { argument?: unknown }).argument as { type?: string }).type === "MemberExpression"
    ) {
      const m = (node as { argument: unknown }).argument as unknown as {
        object: Node;
        property: Node;
        computed: boolean;
      };
      const path = memberPathOf(m, opts);
      if (path) {
        const parentRead =
          path.layers.length >= 2 ? readPrefix(path, path.layers.length - 2) : path.rootSrc;
        // 注意：computed key 在此二次求值（副作用型 key 表达式会重复；
        // 与数组 mutator 参数的重绑口径一致，罕见形态接受）
        const keySrc = m.computed
          ? transpileExpression(m.property as Expression, opts)
          : `$lit(${JSON.stringify((m.property as { name: string }).name)})`;
        lines.push(
          `${pad}${path.rootSrc} = ${setParentPathSrc(path, `$del(${parentRead}, ${keySrc})`)};`,
        );
      }
    }
    // 自增/自减：标识符前缀自包含（n = $add(n,1)），后缀表达式值为旧值需补写回；
    // 成员目标（o.n++/++o.n）前后缀表达式值均由本 pass 之外的表达式给出，写回在此统一补
    if (
      node.type === "UpdateExpression" &&
      (node as { argument?: unknown }).argument
    ) {
      const arg = (node as { argument: unknown }).argument as {
        type?: string;
        name?: string;
        object?: Node;
        property?: Node;
        computed?: boolean;
      };
      const fn = (node as { operator?: string }).operator === "++" ? "$add" : "$sub";
      const isPostfix = (node as { prefix?: boolean }).prefix !== true;
      if (arg.type === "Identifier" && arg.name) {
        if (isPostfix) lines.push(`${pad}${arg.name} = ${fn}(${arg.name}, $lit(1));`);
      } else if (arg.type === "MemberExpression") {
        const path = memberPathOf(
          arg as unknown as { object: Node; property: Node; computed: boolean },
          opts,
        );
        if (path) {
          const readSrc = readPathSrc(path);
          lines.push(`${pad}${path.rootSrc} = ${setPathSrc(path, `${fn}(${readSrc}, $lit(1))`)};`);
        }
      }
    }
    for (const key of Object.keys(node)) {
      if (key === "loc" || key === "start" || key === "end" || key === "range") continue;
      if (key === "callee" || key === "property") continue; // 已处理 receiver
      const child = (node as Record<string, unknown>)[key];
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === "object") visit(child);
    }
  };
  visit(expr);
  return lines;
}

export function transpileSource(source: string, opts: TranspileOptions = {}): string {
  const file = parseSource(source);
  return transpileFile(file, { ...opts, source: opts.source ?? source });
}

/** 运行时 import 行（body-fn 编译执行拼接用） */
export function runtimeImportOf(runtime: string): string {
  return `import { $add, $sub, $mul, $div, $mod, $bitand, $bitor, $bitxor, $bitnot, $shl, $shr, $ushr, $pow, $toNumber, $in, $instanceof, $instanceofNonIdent, $classExpr, $del, $delRes, $objAccessor, $neg, $typeof, $not, $eq, $ne, $eqLoose, $neLoose, $lt, $le, $gt, $ge, $join, $lit, $fork, $for, $forIter, $obj, $get, $set, $while, $whileSeq, $arr, $arrWithHoles, $arrMutContainer, $idx, $idxSet, $len, $call, $throw, $loopReturn, $loopBreak, $loopContinue, $class, $new, $invoke, $invokeSuper, $super, $async, $copy, $await, $asyncReturn, $orDefault, $callNamed, $optionalGet, $optionalInvoke, $spread, $concat, $forOf, $forInKeys, $catchVal, $switch, $staticInvoke, $setKey, $gen, $yield, $fnVal, $regex, $reStateCall, $rethrowIfNudoReturn, $nullishTest, $tryMark, $assignRecord, $recordBinding, $unknown, $tryTakeSince, $tryCurrentMark, $tryPopMark, $tryDigestSoftCatch, $tryReleaseSoftOut, $tryDetachSoftCatch, $tryDiscardSoft, $tryOrphanSoft, $pushLoopExit, $objRest, $arrRest, $isForkExit, $rawThis, $isBreakTo } from ${JSON.stringify(runtime)};`;
}

export function transpileFile(file: File, opts: TranspileOptions = {}): string {
  const runtime = opts.runtimeImport ?? "@nudojs/core/exec";
  const lines: string[] = [
    `// nudo B-path transpile — values are Abs; operators are overloaded calls`,
    `import { $add, $sub, $mul, $div, $mod, $bitand, $bitor, $bitxor, $bitnot, $shl, $shr, $ushr, $pow, $toNumber, $in, $instanceof, $instanceofNonIdent, $classExpr, $del, $delRes, $objAccessor, $neg, $typeof, $not, $eq, $ne, $eqLoose, $neLoose, $lt, $le, $gt, $ge, $join, $lit, $fork, $for, $forIter, $obj, $get, $set, $while, $whileSeq, $arr, $arrWithHoles, $arrMutContainer, $idx, $idxSet, $len, $call, $throw, $loopReturn, $loopBreak, $loopContinue, $class, $new, $invoke, $invokeSuper, $super, $async, $copy, $await, $asyncReturn, $orDefault, $callNamed, $optionalGet, $optionalInvoke, $spread, $concat, $forOf, $forInKeys, $catchVal, $switch, $staticInvoke, $setKey, $gen, $yield, $fnVal, $regex, $reStateCall, $rethrowIfNudoReturn, $nullishTest, $tryMark, $assignRecord, $recordBinding, $unknown, $tryTakeSince, $tryCurrentMark, $tryPopMark, $tryDigestSoftCatch, $tryReleaseSoftOut, $tryDetachSoftCatch, $tryDiscardSoft, $tryOrphanSoft, $pushLoopExit, $objRest, $arrRest, $isForkExit, $rawThis, $isBreakTo } from ${JSON.stringify(runtime)};`,
    ``,
  ];
  for (const stmt of file.program.body) {
    lines.push(transpileStatement(stmt, 0, opts));
  }
  return lines.join("\n") + "\n";
}

function indent(n: number): string {
  return "  ".repeat(n);
}

/** 对象键 → 字符串（Identifier/StringLiteral/NumericLiteral；其余 null）。
 *  { 10: "a" } 的键是 NumericLiteral，与 "10" 同键（原生 ToPropertyKey）。 */
function staticKeyOf(key: { type?: string; name?: string; value?: unknown } | null | undefined): string | null {
  if (!key || typeof key !== "object") return null;
  if (key.type === "Identifier") return key.name ?? null;
  if (key.type === "StringLiteral" || key.type === "NumericLiteral") return String(key.value);
  return null;
}

/** 计算键 [Symbol.X] → 已引号化的 "@@X" 投影（对象字面量/访问器）；
 *  其余计算键 → null。镜像成员访问 m[Symbol.iterator] 的投影口径。 */
function symbolKeyOf(key: { type?: string; computed?: boolean; object?: { type?: string; name?: string }; property?: { type?: string; name?: string } } | null | undefined): string | null {
  if (!key || typeof key !== "object") return null;
  if (
    key.type === "MemberExpression" &&
    key.computed !== true &&
    key.object?.type === "Identifier" &&
    key.object.name === "Symbol" &&
    key.property?.type === "Identifier"
  ) {
    return JSON.stringify(`@@${key.property.name}`);
  }
  return null;
}

/** 收集赋值/Update 左值标识符（while/for pack/unpack 用）。
 *  循环 init 声明的名字在整个循环结构内 shadow 外层绑定，不得收集
 *  （否则外层 pack 会引用内层循环变量——闭包作用域外，ReferenceError）。 */
function collectAssignedIds(node: unknown, acc: Set<string>, shadowed?: Set<string>): void {
  if (!node || typeof node !== "object") return;
  const sh = shadowed ?? new Set<string>();
  const n = node as {
    type?: string;
    left?: { type?: string; name?: string; object?: unknown };
    init?: unknown;
    argument?: { type?: string; name?: string };
    [k: string]: unknown;
  };
  if (n.type === "ForStatement" || n.type === "ForOfStatement" || n.type === "ForInStatement") {
    const declNode =
      n.type === "ForStatement" ? n.init : (n as { left?: unknown }).left;
    const loopNames = new Set<string>();
    if (
      declNode &&
      typeof declNode === "object" &&
      (declNode as { type?: string }).type === "VariableDeclaration"
    ) {
      for (const d of (declNode as { declarations?: Array<{ id?: unknown }> }).declarations ?? []) {
        collectPatternNames(d.id, loopNames);
      }
    }
    const next = new Set(sh);
    for (const name of loopNames) next.add(name);
    for (const key of Object.keys(n)) {
      if (key === "loc" || key === "start" || key === "end" || key === "range") continue;
      const child = n[key];
      if (Array.isArray(child)) child.forEach((c) => collectAssignedIds(c, acc, next));
      else if (child && typeof child === "object") collectAssignedIds(child, acc, next);
    }
    return;
  }
  if (n.type === "AssignmentExpression" && n.left?.type === "Identifier" && n.left.name) {
    if (!sh.has(n.left.name)) acc.add(n.left.name);
  }
  if (
    n.type === "AssignmentExpression" &&
    n.left?.type === "MemberExpression"
  ) {
    let cur: { type?: string; object?: { type?: string; name?: string }; name?: string } | undefined =
      n.left as { type?: string; object?: { type?: string; name?: string }; name?: string };
    while (cur?.type === "MemberExpression") cur = cur.object;
    if (cur?.type === "Identifier" && cur.name && !sh.has(cur.name)) acc.add(cur.name);
  }
  if (n.type === "UpdateExpression" && n.argument?.type === "Identifier" && n.argument.name) {
    if (!sh.has(n.argument.name)) acc.add(n.argument.name);
  }
  for (const key of Object.keys(n)) {
    if (key === "loc" || key === "start" || key === "end" || key === "range") continue;
    const child = n[key];
    if (Array.isArray(child)) child.forEach((c) => collectAssignedIds(c, acc, sh));
    else if (child && typeof child === "object") collectAssignedIds(child, acc, sh);
  }
}

const FUNCTION_SCOPE_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ObjectMethod",
  "ClassMethod",
  "ClassPrivateMethod",
]);

const BINDING_SCOPE_TYPES = new Set([
  ...FUNCTION_SCOPE_TYPES,
  "CatchClause",
  "ForOfStatement",
  "ForInStatement",
]);

type IdentNode = {
  type?: string;
  name?: string;
  argument?: { type?: string; name?: string };
  left?: { type?: string; name?: string };
  properties?: unknown[];
  elements?: unknown[];
};

function collectPatternNames(id: unknown, acc: Set<string>): void {
  if (!id || typeof id !== "object") return;
  const n = id as IdentNode;
  if (n.type === "Identifier" && n.name) acc.add(n.name);
  else if (n.type === "RestElement") collectPatternNames(n.argument, acc);
  else if (n.type === "AssignmentPattern") collectPatternNames(n.left, acc);
  else if (n.type === "ObjectPattern") {
    for (const p of n.properties ?? []) {
      const prop = p as { type?: string; value?: unknown; argument?: unknown };
      if (prop?.type === "RestElement") collectPatternNames(prop.argument, acc);
      else collectPatternNames(prop?.value, acc);
    }
  } else if (n.type === "ArrayPattern") {
    for (const el of n.elements ?? []) collectPatternNames(el, acc);
  }
}

/**
 * 臂内「自由写」绑定：赋值/mutator 标识符在赋值点未被臂内声明遮蔽。
 * 嵌套函数参数 / for-of 绑定 / catch 参数不得把外层自由写从 fork
 * 协议里剔除（P0-1）。
 */
/** AST 节点身份 → free-write / mutator-receiver 扫描结果（热路径去重） */
const freeAssignedCache = new WeakMap<object, string[]>();
const mutatorRecvCache = new WeakMap<object, Set<string>>();

function collectFreeAssignedNames(...nodes: Array<unknown>): string[] {
  const cachedParts: string[][] = [];
  const pending: object[] = [];
  for (const node of nodes) {
    if (node && typeof node === "object") {
      const hit = freeAssignedCache.get(node);
      if (hit) {
        cachedParts.push(hit);
        continue;
      }
      pending.push(node);
    }
  }
  if (pending.length === 0) {
    const merged = new Set<string>();
    for (const p of cachedParts) for (const n of p) merged.add(n);
    return [...merged];
  }
  const free = new Set<string>();
  const markFree = (name: string | undefined, shadowed: Set<string>): void => {
    if (name && name !== "undefined" && !shadowed.has(name)) free.add(name);
  };
  const walk = (node: unknown, shadowed: Set<string>): void => {
    if (!node || typeof node !== "object") return;
    const n = node as {
      type?: string;
      operator?: string;
      left?: unknown;
      right?: unknown;
      argument?: unknown;
      id?: unknown;
      param?: unknown;
      params?: unknown[];
      body?: unknown;
      declarations?: Array<{ id?: unknown }>;
      callee?: {
        type?: string;
        object?: unknown;
        property?: { type?: string; name?: string };
        computed?: boolean;
      };
      [k: string]: unknown;
    };

    let nextShadowed = shadowed;
    const pushShadow = (names: Iterable<string>): void => {
      const add: string[] = [];
      for (const name of names) {
        if (name && !nextShadowed.has(name)) add.push(name);
      }
      if (add.length === 0) return;
      nextShadowed = new Set(nextShadowed);
      for (const name of add) nextShadowed.add(name);
    };

    if (FUNCTION_SCOPE_TYPES.has(n.type as string)) {
      const bound = new Set<string>();
      collectPatternNames(n.id, bound);
      for (const p of n.params ?? []) collectPatternNames(p, bound);
      pushShadow(bound);
    } else if (n.type === "CatchClause") {
      const bound = new Set<string>();
      collectPatternNames(n.param, bound);
      pushShadow(bound);
    } else if (n.type === "ForOfStatement" || n.type === "ForInStatement") {
      const bound = new Set<string>();
      const left = n.left as
        | { type?: string; declarations?: Array<{ id?: unknown }>; name?: string }
        | undefined;
      if (left?.type === "VariableDeclaration") {
        for (const d of left.declarations ?? []) collectPatternNames(d.id, bound);
      } else {
        collectPatternNames(left, bound);
      }
      pushShadow(bound);
    }

    if (n.type === "AssignmentExpression") {
      const left = n.left as
        | { type?: string; name?: string; object?: unknown }
        | undefined;
      if (left?.type === "Identifier") markFree(left.name, nextShadowed);
      else if (left?.type === "MemberExpression") {
        let cur: { type?: string; object?: unknown; name?: string } | undefined =
          left as { type?: string; object?: unknown; name?: string };
        while (cur?.type === "MemberExpression") {
          cur = cur.object as { type?: string; object?: unknown; name?: string } | undefined;
        }
        if (cur?.type === "Identifier") markFree(cur.name, nextShadowed);
      }
    }
    if (n.type === "UpdateExpression") {
      const arg = n.argument as { type?: string; name?: string; object?: unknown } | undefined;
      if (arg?.type === "Identifier") markFree(arg.name, nextShadowed);
      else if (arg?.type === "MemberExpression") {
        let cur: { type?: string; object?: unknown; name?: string } | undefined =
          arg as { type?: string; object?: unknown; name?: string };
        while (cur?.type === "MemberExpression") {
          cur = cur.object as { type?: string; object?: unknown; name?: string } | undefined;
        }
        if (cur?.type === "Identifier") markFree(cur.name, nextShadowed);
      }
    }
    if (
      n.type === "CallExpression" &&
      n.callee?.type === "MemberExpression" &&
      n.callee.computed !== true &&
      n.callee.property?.type === "Identifier" &&
      isStatefulMethodName((n.callee.property as { name: string }).name)
    ) {
      const obj = n.callee.object as
        | { type?: string; name?: string; object?: unknown }
        | undefined;
      if (obj?.type === "Identifier") markFree(obj.name, nextShadowed);
      else if (obj?.type === "MemberExpression" || obj?.type === "ThisExpression") {
        let cur: { type?: string; object?: unknown; name?: string } | undefined = obj as never;
        while (cur?.type === "MemberExpression") {
          cur = cur.object as { type?: string; object?: unknown; name?: string } | undefined;
        }
        if (cur?.type === "Identifier") markFree(cur.name, nextShadowed);
      }
    }

    for (const key of Object.keys(n)) {
      if (key === "loc" || key === "start" || key === "end" || key === "range") continue;
      if (key === "callee" || key === "property" || key === "param" || key === "params") continue;
      const child = n[key];
      if (Array.isArray(child)) {
        if (
          n.type === "BlockStatement" ||
          n.type === "Program" ||
          n.type === "StaticBlock" ||
          n.type === "SwitchCase"
        ) {
          let blockShadow = nextShadowed;
          for (const stmt of child) {
            walk(stmt, blockShadow);
            const stmtNode = stmt as {
              type?: string;
              declarations?: Array<{ id?: unknown }>;
              id?: unknown;
            } | null;
            if (!stmtNode) continue;
            const declared = new Set<string>();
            if (stmtNode.type === "VariableDeclaration") {
              for (const d of stmtNode.declarations ?? []) collectPatternNames(d.id, declared);
            } else if (
              stmtNode.type === "FunctionDeclaration" ||
              stmtNode.type === "ClassDeclaration"
            ) {
              collectPatternNames(stmtNode.id, declared);
            }
            if (declared.size > 0) {
              if (blockShadow === nextShadowed) blockShadow = new Set(blockShadow);
              for (const name of declared) blockShadow.add(name);
            }
          }
          continue;
        }
        for (const item of child) walk(item, nextShadowed);
      } else if (child && typeof child === "object") {
        walk(child, nextShadowed);
      }
    }

    // 函数参数/体在扩展后的 shadow 下求值
    if (FUNCTION_SCOPE_TYPES.has(n.type as string) && n.body) {
      walk(n.body, nextShadowed);
    }
  };

  for (const node of pending) {
    walk(node, new Set());
  }
  const computed = [...free];
  for (const node of pending) freeAssignedCache.set(node, computed);
  const merged = new Set<string>(computed);
  for (const p of cachedParts) for (const n of p) merged.add(n);
  return [...merged];
}

/**
 * 抽象臂间需要 snapshot/join 的自由写绑定。
 * 仅在赋值点被臂内声明遮蔽的名字不进协议。
 */
function collectForkBindingNames(...nodes: Array<unknown>): string[] {
  return collectFreeAssignedNames(...nodes);
}

/** 语句是否以 break/return/throw/continue 终止（switch fall-through 用） */
function stmtCompletesControl(stmt: Statement | undefined | null): boolean {
  if (!stmt) return false;
  switch (stmt.type) {
    case "BreakStatement":
    case "ReturnStatement":
    case "ThrowStatement":
    case "ContinueStatement":
      return true;
    case "BlockStatement":
      return stmtCompletesControl(stmt.body[stmt.body.length - 1] as Statement);
    case "IfStatement":
      return (
        stmt.alternate != null &&
        stmtCompletesControl(stmt.consequent as Statement) &&
        stmtCompletesControl(stmt.alternate as Statement)
      );
    default:
      return false;
  }
}

/** 语句或块内是否出现 return/throw（决定 if 是否提升为 return $fork） */
function stmtReturns(stmt: Statement): boolean {
  if (stmt.type === "ReturnStatement" || stmt.type === "ThrowStatement") return true;
  if (stmt.type === "BlockStatement") return stmt.body.some(stmtReturns);
  if (stmt.type === "IfStatement") {
    return stmtReturns(stmt.consequent) && stmt.alternate != null && stmtReturns(stmt.alternate);
  }
  // switch：所有可达臂均 return/throw 且 **存在 default** 才视为终止
  // （无 default 时 no-match 会 fall-through，不得当终止 — P0-1）
  if (stmt.type === "SwitchStatement") {
    type Arm = { stmts: Statement[]; isDefault: boolean };
    const arms: Arm[] = [];
    for (const c of stmt.cases) {
      const testIsDefault = c.test === null || c.test === undefined;
      const last = arms[arms.length - 1];
      if (last && !last.isDefault && last.stmts.length === 0 && !testIsDefault) {
        last.stmts = c.consequent;
        continue;
      }
      if (
        last &&
        !last.isDefault &&
        !testIsDefault &&
        last.stmts.length > 0 &&
        c.consequent.length === 0
      ) {
        continue; // fall-through 空臂并入前一有体臂
      }
      arms.push({ stmts: c.consequent, isDefault: testIsDefault });
    }
    const armOk = (a: Arm): boolean => a.stmts.length > 0 && a.stmts.every(stmtReturns);
    const nonDefault = arms.filter((a) => !a.isDefault);
    const dflt = arms.find((a) => a.isDefault);
    if (dflt === undefined) return false; // 无 default：必然 fall-through
    return nonDefault.length > 0 && nonDefault.every(armOk) && armOk(dflt);
  }
  return false;
}

/**
 * 函数体语句序列：早退 if（`if (c) return X;` 无 else）位置敏感提升——
 * 首个该形态语句把「余下全部语句」并入 else 分支，产出
 * `return $fork(c, () => X, () => { …rest })`。抽象条件时
 * join(早退值, 余下值) 与 JS 控制流一致；语句级 $fork 会把 thunk 的
 * 返回值丢掉（早退全部静默失效——compareVersions 类链式卫语句的坑）。
 * 余下语句递归同规则，链式卫语句逐层嵌套 else。
 */
function transpileFnBodyStmts(stmts: Statement[], depth: number, opts: TranspileOptions): string {
  for (let i = 0; i < stmts.length; i++) {
    const stmt = stmts[i]!;
    if (stmt.type !== "IfStatement" || stmt.alternate != null) continue;
    if (!stmtReturns(stmt.consequent)) continue;
    const rest = stmts.slice(i + 1);
    if (rest.length === 0) continue;
    const head = stmts
      .slice(0, i)
      .map((s) => transpileStatement(s, depth, opts))
      .join("\n");
    const test = transpileExpression(stmt.test, opts);
    // P0.1：早退提升同样必须隔离臂间 mutator/普通绑定
    const recvSet = new Set<string>([
      ...collectForkBindingNames(stmt.consequent),
      ...collectForkBindingNames(stmt.test),
      ...rest.flatMap((r) => collectForkBindingNames(r)),
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
    const testRecvs = collectArrMutatorReceivers(stmt.test);
    const testRebinds = testRecvs.size
      ? emitArrMutatorRebinds(stmt.test as Node, opts, pad)
      : [];
    const cons = wrapArm(transpileBlockAsThunk(stmt.consequent, depth, opts), "fk1_");
    const altBody = transpileFnBodyStmts(rest, depth + 1, { ...opts, inLoop: opts.inLoop });
    const altThunk = `() => {\n${altBody}\n${pad}}`;
    const alt = wrapArm(altThunk, "fk2_");
    const inCtrl = (opts.inLoop ?? 0) > 0 || (opts.inTry ?? 0) > 0;
    const applyJoin = names.length ? forkJoinBindings(names, pad).join("\n") : "";
    if (names.length === 0) {
      const promoted = [
        ...testRebinds,
        inCtrl
          ? `${pad}$loopReturn($fork(${test}, ${cons}, ${alt}));`
          : `${pad}return $fork(${test}, ${cons}, ${alt});`,
      ].join("\n");
      return head ? `${head}\n${promoted}` : promoted;
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
    return head ? `${head}\n${promoted}` : promoted;
  }
  return stmts.map((s) => transpileStatement(s, depth, opts)).join("\n");
}

/** 递归解构：把 pattern 绑到 fromSrc（已是 Abs 表达式字符串） */
function emitDestructure(
  pattern: Node,
  fromSrc: string,
  kw: string,
  pad: string,
  opts: TranspileOptions,
  out: string[],
  tmpSeq: { n: number },
): void {
  if (pattern.type === "Identifier") {
    out.push(`${pad}${kw} ${pattern.name} = ${fromSrc};`);
    return;
  }
  if (pattern.type === "ObjectPattern") {
    const namedKeys: string[] = [];
    let restName: string | undefined;
    for (const prop of pattern.properties) {
      if (prop.type === "RestElement") {
        if (prop.argument.type === "Identifier") restName = prop.argument.name;
        continue;
      }
      if (prop.type !== "ObjectProperty") continue;
      const key = staticKeyOf(prop.key as { type?: string; name?: string; value?: unknown });
      if (key === null) continue;
      const keyLit = JSON.stringify(key);
      namedKeys.push(key);
      if (prop.value.type === "AssignmentPattern") {
        const def = transpileExpression(prop.value.right as Expression, opts);
        const left = prop.value.left;
        if (left.type === "Identifier") {
          out.push(
            `${pad}${kw} ${left.name} = $orDefault($get(${fromSrc}, ${keyLit}), () => ${def});`,
          );
        } else {
          // 嵌套 + 默认：const { a: { b } = {} } = o
          const t = `_n${tmpSeq.n++}`;
          out.push(`${pad}const ${t} = $orDefault($get(${fromSrc}, ${keyLit}), () => ${def});`);
          emitDestructure(left, t, kw, pad, opts, out, tmpSeq);
        }
        continue;
      }
      if (prop.value.type === "ObjectPattern" || prop.value.type === "ArrayPattern") {
        const t = `_n${tmpSeq.n++}`;
        out.push(`${pad}const ${t} = $get(${fromSrc}, ${keyLit});`);
        emitDestructure(prop.value, t, kw, pad, opts, out, tmpSeq);
        continue;
      }
      if (prop.value.type === "Identifier") {
        out.push(`${pad}${kw} ${prop.value.name} = $get(${fromSrc}, ${keyLit});`);
      }
    }
    if (restName) {
      out.push(
        `${pad}${kw} ${restName} = $objRest(${fromSrc}, ${JSON.stringify(namedKeys)});`,
      );
    }
    return;
  }
  if (pattern.type === "ArrayPattern") {
    let restName: string | undefined;
    let restAt = 0;
    pattern.elements.forEach((el, i) => {
      if (!el) return;
      if (el.type === "RestElement") {
        if (el.argument.type === "Identifier") {
          restName = el.argument.name;
          restAt = i;
        }
        return;
      }
      if (el.type === "AssignmentPattern") {
        const def = transpileExpression(el.right as Expression, opts);
        const idx = `$idx(${fromSrc}, $lit(${i}))`;
        if (el.left.type === "Identifier") {
          out.push(`${pad}${kw} ${el.left.name} = $orDefault(${idx}, () => ${def});`);
        } else {
          const t = `_n${tmpSeq.n++}`;
          out.push(`${pad}const ${t} = $orDefault(${idx}, () => ${def});`);
          emitDestructure(el.left, t, kw, pad, opts, out, tmpSeq);
        }
        return;
      }
      if (el.type === "ObjectPattern" || el.type === "ArrayPattern") {
        const t = `_n${tmpSeq.n++}`;
        out.push(`${pad}const ${t} = $idx(${fromSrc}, $lit(${i}));`);
        emitDestructure(el, t, kw, pad, opts, out, tmpSeq);
        return;
      }
      if (el.type === "Identifier") {
        out.push(`${pad}${kw} ${el.name} = $idx(${fromSrc}, $lit(${i}));`);
      }
    });
    if (restName) {
      out.push(`${pad}${kw} ${restName} = $arrRest(${fromSrc}, ${restAt});`);
    }
  }
}

/**
 * 函数参数签名 + 解构 prologue：
 * Identifier 直通；ObjectPattern/ArrayPattern/AssignmentPattern 用占位参数
 * `_p{i}` 接收，再在函数体首部 emitDestructure / $orDefault 绑定。
 * RestElement 返回 rest 名（FunctionDeclaration 由 arguments 绑定；arrow 直接 rest 形参）。
 */
function emitParamBinding(
  params: Node[],
  pad: string,
  opts: TranspileOptions,
): { sig: string[]; rest?: string; prologue: string[] } {
  const sig: string[] = [];
  const prologue: string[] = [];
  let rest: string | undefined;
  params.forEach((p, i) => {
    if (p.type === "Identifier") {
      sig.push(p.name);
      return;
    }
    if (p.type === "RestElement") {
      if (p.argument.type === "Identifier") {
        rest = p.argument.name;
        return;
      }
      const ph = `_rest${i}`;
      rest = ph;
      emitDestructure(p.argument, ph, "const", pad, opts, prologue, { n: 0 });
      return;
    }
    const ph = `_p${i}`;
    sig.push(ph);
    if (p.type === "AssignmentPattern") {
      const def = transpileExpression(p.right as Expression, opts);
      if (p.left.type === "Identifier") {
        prologue.push(`${pad}const ${p.left.name} = $orDefault(${ph}, () => ${def});`);
      } else {
        const t = `_pd${i}`;
        prologue.push(`${pad}const ${t} = $orDefault(${ph}, () => ${def});`);
        emitDestructure(p.left, t, "const", pad, opts, prologue, { n: 0 });
      }
      return;
    }
    if (p.type === "ObjectPattern" || p.type === "ArrayPattern") {
      emitDestructure(p, ph, "const", pad, opts, prologue, { n: 0 });
    }
  });
  return { sig, rest, prologue };
}

/** 收集语句/表达式里以 Identifier 为 receiver 的数组 mutator 名 */
function collectArrMutatorReceivers(node: unknown, acc = new Set<string>()): Set<string> {
  if (!node || typeof node !== "object") return acc;
  const hit = mutatorRecvCache.get(node as object);
  if (hit) {
    for (const n of hit) acc.add(n);
    return acc;
  }
  const local = new Set<string>();
  collectArrMutatorReceiversUncached(node, local);
  mutatorRecvCache.set(node as object, local);
  for (const n of local) acc.add(n);
  return acc;
}

function collectArrMutatorReceiversUncached(node: unknown, acc = new Set<string>()): Set<string> {
  if (!node || typeof node !== "object") return acc;
  const n = node as Record<string, unknown>;
  if (
    n.type === "FunctionExpression" ||
    n.type === "ArrowFunctionExpression" ||
    n.type === "ObjectMethod" ||
    n.type === "ClassMethod" ||
    n.type === "FunctionDeclaration"
  ) {
    return acc;
  }
  if (
    n.type === "CallExpression" &&
    (n.callee as { type?: string; object?: Node; property?: Node; computed?: boolean } | undefined)
      ?.type === "MemberExpression"
  ) {
    const callee = n.callee as { object?: Node; property?: Node; computed?: boolean };
    const propName =
      !callee.computed && callee.property?.type === "Identifier"
        ? (callee.property as { name: string }).name
        : undefined;
    if (propName && isStatefulMethodName(propName)) {
      const obj = callee.object;
      if (obj?.type === "Identifier") {
        acc.add((obj as { name: string }).name);
      } else if (obj?.type === "MemberExpression") {
        let cur: { type?: string; object?: { type?: string } } | undefined =
          obj as { type?: string; object?: { type?: string } };
        while (cur?.type === "MemberExpression") {
          cur = cur.object;
        }
        if (cur?.type === "Identifier") {
          acc.add((cur as unknown as { name: string }).name);
        }
      }
    }
  }
  for (const key of Object.keys(n)) {
    if (key === "loc" || key === "start" || key === "end" || key === "range") continue;
    const child = n[key];
    if (Array.isArray(child)) child.forEach((c) => collectArrMutatorReceiversUncached(c, acc));
    else if (child && typeof child === "object") collectArrMutatorReceiversUncached(child, acc);
  }
  return acc;
}

/** fork 臂 thunk：restore snapshot → 求值 → 仅 continue 臂重绑保存（带 ran 标志） */
function forkArmThunk(
  bodyLines: string[],
  outPrefix: string,
  names: string[],
): string {
  return [
    `() => {`,
    ...names.map((n) => `  ${n} = $copy(__fk0_${n});`),
    `  let __cont = true;`,
    `  try {`,
    ...bodyLines.map((l) => `    ${l}`),
    `  } catch (e) {`,
    `    if ($isForkExit(e)) __cont = false;`,
    `    throw e;`,
    `  } finally {`,
    `    if (__cont) {`,
    ...names.map((n) => `      __${outPrefix}${n} = ${n};`),
    ...names.map((n) => `      __${outPrefix}set_${n} = true;`),
    `    }`,
    `  }`,
    `}`,
  ].join("\n");
}

/** fork 绑定声明：snapshot（深拷贝——容器写已就地化，臂间必须状态隔离）+ 两臂槽位 + ran 标志 */
function forkBindingDecls(names: string[], pad = ""): string[] {
  return names.flatMap((n) => [
    `${pad}const __fk0_${n} = $copy(${n});`,
    `${pad}let __fk1_${n}; let __fk2_${n};`,
    `${pad}let __fk1_set_${n} = false; let __fk2_set_${n} = false;`,
  ]);
}

/** fork 后把各臂结束态 join 回绑定（仅 join **未**以 return/throw 退出的臂） */
function forkJoinBindings(names: string[], pad = ""): string[] {
  return names.map(
    (n) =>
      `${pad}${n} = (__fk1_set_${n} && __fk2_set_${n}) ? $join(__fk1_${n}, __fk2_${n}) : (__fk1_set_${n} ? __fk1_${n} : (__fk2_set_${n} ? __fk2_${n} : ${n}));`,
  );
}

/**
 * && / || / ?: 的表达式转译：test/left 恒求值；短路臂内的数组 mutator
 * 必须 arm 隔离（P0）。无 mutator 时退化为裸 $fork。
 *
 * shape:
 *   __test = <always-eval>;
 *   <always rebinds>;
 *   snapshot; $fork(__test, consArm, altArm); join bindings; return __r
 */
/**
 * catch 体是否可能 rethrow：任意深度语句位置出现 ThrowStatement 即视为
 * 可能（条件 throw 保守按可能算，与 evalTry 的 catchR.threw 口径一致）；
 * 不降入嵌套函数/箭头/类方法体（其 throw 不构成本 catch 的 rethrow）。
 */
function catchMayRethrow(handler: { body: Node }): boolean {
  const visit = (n: unknown): boolean => {
    if (!n || typeof n !== "object") return false;
    const o = n as { type?: string; [k: string]: unknown };
    if (o.type === "ThrowStatement") return true;
    if (
      o.type === "FunctionDeclaration" ||
      o.type === "FunctionExpression" ||
      o.type === "ArrowFunctionExpression" ||
      o.type === "ClassMethod" ||
      o.type === "ObjectMethod" ||
      o.type === "ClassDeclaration"
    ) {
      return false;
    }
    for (const key of Object.keys(o)) {
      if (key === "loc" || key === "start" || key === "end") continue;
      const v = o[key];
      if (Array.isArray(v)) {
        for (const item of v) if (visit(item)) return true;
      } else if (v && typeof v === "object") {
        if (visit(v)) return true;
      }
    }
    return false;
  };
  return visit(handler.body);
}

function transpileShortCircuitExpr(opts: TranspileOptions, parts: {
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
    const consExpr = parts.consSrc === "__test" ? parts.alwaysSrc : parts.consSrc;
    const altExpr = parts.altSrc === "__test" ? parts.alwaysSrc : parts.altSrc;
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
  return [
    `(() => {`,
    `  const __test = (${parts.alwaysSrc});`,
    ...alwaysRebinds.map((l) => `  ${l}`),
    ...(names.length ? forkBindingDecls(names, "  ") : []),
    `  const __r = $fork(${forkTest}, ${forkArmThunk(consLines, "fk1_", names)}, ${forkArmThunk(altLines, "fk2_", names)});`,
    ...forkJoinBindings(names, "  "),
    `  return __r;`,
    `})()`,
  ].join("\n");
}

/** 单语句/表达式体转译（body-fn 编译执行用；不入 run.ts 正则面） */
export function transpileBodyNode(node: Node, opts: TranspileOptions): string {
  if (isExpression(node as { type: string })) {
    return `return ${transpileExpression(node as Expression, opts)};`;
  }
  return transpileStatement(node as Statement, 1, opts);
}

function transpileStatement(stmt: Statement, depth: number, opts: TranspileOptions): string {
  const pad = indent(depth);
  switch (stmt.type) {
    case "ExportNamedDeclaration": {
      const decl = stmt.declaration;
      if (!decl) {
        // 保留合法 ESM 形态：run.ts 后处理改写为 __nudoExport（modules 表
        // 注入绑定）；真实 .mjs import 消费者直接吃标准 ESM 语义。
        if (depth !== 0) return `${pad}/* nested export specifiers skipped */`;
        const specs = stmt.specifiers
          .filter(
            (s): s is typeof s & {
              local: { type?: string; name?: string; value?: string };
              exported: { type?: string; name?: string; value?: string };
            } => "local" in s,
          )
          .map((s) => {
            const local = s.local.type === "Identifier" ? s.local.name : s.local.value;
            const exported =
              s.exported.type === "Identifier" ? s.exported.name : s.exported.value;
            return local === exported ? local : `${local} as ${exported}`;
          })
          .join(", ");
        if (stmt.source) {
          return `${pad}export { ${specs} } from ${JSON.stringify(stmt.source.value)};`;
        }
        return `${pad}export { ${specs} };`;
      }
      const inner = transpileStatement(decl as Statement, depth, opts);
      // 顶层 export const/let/class：保留 export 面（run.ts 收集进 exports，
      // 供 directive case 经 callTranspiledExport 求值；模块图依赖此表）
      if (depth === 0 && (decl.type === "VariableDeclaration" || decl.type === "ClassDeclaration") && !pad) {
        return `export ${inner}`;
      }
      return inner;
    }
    case "ExportAllDeclaration": {
      if (depth !== 0) return `${pad}/* nested export * skipped */`;
      return `${pad}export * from ${JSON.stringify(stmt.source.value)};`;
    }
    case "ImportDeclaration": {
      // 保留 import；run.ts 会改写为 __nudoBindImport
      const specs = stmt.specifiers
        .map((s) => {
          if (s.type === "ImportSpecifier") {
            const imported =
              s.imported.type === "Identifier" ? s.imported.name : String(s.imported);
            return imported === s.local.name ? imported : `${imported} as ${s.local.name}`;
          }
          if (s.type === "ImportDefaultSpecifier") return `default as ${s.local.name}`;
          if (s.type === "ImportNamespaceSpecifier") return `* as ${s.local.name}`;
          return "";
        })
        .filter(Boolean);
      if (specs.length === 0) {
        return `${pad}import ${JSON.stringify(stmt.source.value)};`;
      }
      return `${pad}import { ${specs.join(", ")} } from ${JSON.stringify(stmt.source.value)};`;
    }
    case "ExportDefaultDeclaration": {
      const d = stmt.declaration;
      if (d.type === "FunctionDeclaration" || d.type === "ClassDeclaration") {
        // 匿名默认函数/类合成名字（原 <anonymous fn skipped> 整条丢失）；
        // 输出 `function X {}` + `export default X;`——真实 ESM 与 run.ts
        // 后处理（→ __nudoExport("default", X)）都合法。
        const name =
          d.id?.name ?? (d.type === "FunctionDeclaration" ? "__nudoDefaultFn" : "__nudoDefaultClass");
        const named = d.id ? d : ({ ...d, id: { type: "Identifier", name } } as Statement);
        const inner = transpileStatement(named, depth + 1, opts);
        return `${inner}\n${pad}export default ${name};`;
      }
      return `${pad}export default ${transpileExpression(d as Expression, opts)};`;
    }
    case "FunctionDeclaration": {
      if (!stmt.id) return `${pad}// <anonymous fn skipped>`;
      // 嵌套函数声明不是 export 面；函数体是新边界，inLoop 必须归零
      const exportKw = depth === 0 ? "export " : "";
      const hasThis = fnBodyHasThis(stmt as { body?: Node | null });
      const fnOpts: TranspileOptions = {
        ...opts,
        inLoop: 0,
        inFunction: true,
        ...(hasThis ? { thisParam: "__this" } : {}),
      };
      const { sig, rest, prologue } = emitParamBinding(
        stmt.params as Node[],
        indent(depth + 2),
        fnOpts,
      );
      const named = sig;
      const paramsSig = rest ? [...named, `...${rest}`] : named;
      const params = paramsSig.join(", ");
      const thisPrologue = hasThis
        ? `${indent(depth + 2)}const __this = $rawThis(this);\n`
        : "";
      const bodyStmts =
        stmt.body.type === "BlockStatement"
          ? [...prologue, thisPrologue, transpileFnBodyStmts(stmt.body.body, depth + 2, fnOpts)]
              .filter(Boolean)
              .join("\n")
          : `${indent(depth + 2)}${thisPrologue.trim()}return ${transpileExpression(stmt.body as unknown as Expression, fnOpts)};`;
      const restBind = rest
        ? `${indent(depth + 1)}const ${rest} = arguments.length > ${named.length} ? $arr(Array.from(arguments).slice(${named.length})) : $arr([]);\n`
        : "";
      // function* → $gen 收集 yield
      if (stmt.generator) {
        return [
          `${pad}${exportKw}function ${stmt.id.name}(${named.join(", ")}) {`,
          restBind,
          `${indent(depth + 1)}return $gen(() => {`,
          bodyStmts,
          `${indent(depth + 1)}});`,
          `${pad}}`,
        ].join("\n");
      }
      if (stmt.async) {
        return [
          `${pad}${exportKw}function ${stmt.id.name}(${named.join(", ")}) {`,
          restBind,
          `${indent(depth + 1)}return $async(() => {`,
          bodyStmts,
          `${indent(depth + 1)}});`,
          `${pad}}`,
        ].join("\n");
      }
      return [
        `${pad}${exportKw}function ${stmt.id.name}(${named.join(", ")}) {`,
        restBind,
        bodyStmts,
        `${pad}}`,
      ].join("\n");
    }
    case "ReturnStatement": {
      const asVar = matchAsOverride(stmt as Node, opts);
      // C2.1：循环体内 return 不是「回调返回」，而是函数提前返回
      // try 内：先 drain 抽象 throwExits，有则 rethrow 让 catch 吸收；正常返回值进 loopExits 后由出口 join
      const prefix = (opts.inLoop ?? 0) > 0 ? "$loopReturn" : "return";
      const markExpr = opts.tryMarkName ?? "$tryCurrentMark()";
      const emitRet = (src: string, mutNodes?: Node | null): string => {
        const retRebinds = mutNodes ? emitArrMutatorRebinds(mutNodes, opts, pad) : [];
        if ((opts.inTry ?? 0) > 0) {
          return [
            `${pad}const __nudoRet = ${src};`,
            ...retRebinds,
            `${pad}{`,
            `${indent(depth + 1)}const __xs = $tryTakeSince(${markExpr});`,
            `${indent(depth + 1)}if (__xs.length) {`,
            `${indent(depth + 2)}$pushLoopExit(__nudoRet);`,
            `${indent(depth + 2)}$throw(__xs.reduce((a, b) => $join(a, b)));`,
            `${indent(depth + 1)}}`,
            `${indent(depth + 1)}${opts.tryRethrowCatch ? "$tryReleaseSoftCatch();" : opts.hasTryHandler === false ? "$tryReleaseSoftOut();" : "$tryDigestSoftCatch();"}`,
            `${pad}}`,
            `${pad}${prefix}(__nudoRet);`,
          ].join("\n");
        }
        if (retRebinds.length === 0) return `${pad}${prefix}(${src});`;
        return [
          `${pad}let __mutRet = ${src};`,
          ...retRebinds,
          `${pad}${prefix}(__mutRet);`,
        ].join("\n");
      };
      if (asVar) return emitRet(asVar);
      if (!stmt.argument) return emitRet(`$lit(undefined)`);
      const retSrc = transpileExpression(stmt.argument, opts);
      return emitRet(retSrc, stmt.argument as Node);
    }
    case "ThrowStatement": {
      const arg = stmt.argument ? transpileExpression(stmt.argument, opts) : "$lit(undefined)";
      return `${pad}$throw(${arg});`;
    }
    case "ExpressionStatement": {
      // C1.4：数组 mutator 语句重绑到**变更后容器**（$arrMutContainer），
      // 不得绑到 JS 返回值（pop 返回元素，会污染 receiver Abs）。
      // 表达式内 mutator：先求值（$invoke 只读容器），再重绑（P0 顺序）。
      const expr = stmt.expression as Expression;
      const exprRebinds = emitArrMutatorRebinds(expr, opts, pad);
      if (
        expr.type === "CallExpression" &&
        expr.callee.type === "MemberExpression" &&
        !expr.callee.computed &&
        expr.callee.property.type === "Identifier"
      ) {
        const methodName = (expr.callee.property as { name: string }).name;
        if (
          ["push", "unshift", "splice", "pop", "shift", "reverse", "sort"].includes(methodName)
        ) {
          const argSrcs = expr.arguments
            .map((a) =>
              a.type === "SpreadElement" ? "$lit(undefined)" : transpileExpression(a as Expression, opts),
            )
            .join(", ");
          const objNode = expr.callee.object as Node;
          // 标识符：直接重绑绑定名
          if (objNode.type === "Identifier") {
            const name = (objNode as { name: string }).name;
            return `${pad}${name} = $arrMutContainer(${name}, ${JSON.stringify(methodName)}, [${argSrcs}]);`;
          }
          // 成员路径（this.arr / obj.x）：读-改-写重绑根，禁止 `$get(...) = …`
          if (objNode.type === "MemberExpression" || objNode.type === "ThisExpression") {
            const path =
              objNode.type === "MemberExpression"
                ? memberPathOf(objNode as unknown as { object: Node; property: Node; computed: boolean }, opts)
                : null;
            if (path) {
              const recvSrc = readPathSrc(path);
              const mutSrc = `$arrMutContainer(${recvSrc}, ${JSON.stringify(methodName)}, [${argSrcs}])`;
              return `${pad}${path.rootSrc} = ${setPathSrc(path, mutSrc)};`;
            }
            // 根不可重绑（this 无 thisParam 等）：保持纯调用
            return `${pad}${transpileExpression(stmt.expression, opts)};`;
          }
        }
      }
      if (exprRebinds.length > 0) {
        return [
          `${pad}${transpileExpression(expr, opts)};`,
          ...exprRebinds,
        ].join("\n");
      }
      return `${pad}${transpileExpression(stmt.expression, opts)};`;
    }
    case "VariableDeclaration": {
      // const → let：成员/下标写经不可变 Abs 更新后需重绑根绑定
      const kw = "let";
      const asVar = matchAsOverride(stmt as Node, opts);
      const lines: string[] = [];
      let tmpSeq = 0;
      for (const d of stmt.declarations) {
        if (d.id.type === "Identifier") {
          // @nudo:as：覆盖整个声明语句的 init
          const init = asVar
            ? asVar
            : d.init
              ? transpileExpression(d.init, opts)
              : "$lit(undefined)";
          lines.push(`${pad}${kw} ${d.id.name} = ${init};`);
          // 顶层绑定表（checkSource varAbs / scanLiteralCalls 实参解析）
          if (depth === 0) {
            lines.push(`${pad}$recordBinding(${JSON.stringify(d.id.name)}, ${d.id.name});`);
          }
          // P1：表达式位置 mutator（`const x = a.pop()`）同样重绑容器
          if (d.init && !asVar) {
            lines.push(...emitArrMutatorRebinds(d.init as Node, opts, pad));
          }
          continue;
        }
        // 解构：先绑定 init 到临时，再逐项 $get / $idx
        if (!d.init) {
          lines.push(`${pad}// destructure without init`);
          continue;
        }
        const initSrc = transpileExpression(d.init, opts);
        const tmp = `_d${tmpSeq++}_${stmt.loc?.start.line ?? 0}`;
        lines.push(`${pad}const ${tmp} = ${initSrc};`);
        lines.push(...emitArrMutatorRebinds(d.init as Node, opts, pad));
        emitDestructure(d.id as Node, tmp, kw, pad, opts, lines, { n: 0 });
      }
      return lines.join("\n");
    }
    case "IfStatement": {
      const test = transpileExpression(stmt.test, opts);
      // 抽象分支：普通绑定 + 数组 mutator + 对象写根 都要 snapshot/join
      const recvSet = new Set<string>([
        ...collectForkBindingNames(stmt.consequent),
        ...collectForkBindingNames(stmt.alternate),
      ]);
      const testRecvs = collectArrMutatorReceivers(stmt.test);
      const testRebinds = testRecvs.size
        ? emitArrMutatorRebinds(stmt.test as Node, opts, pad)
        : [];
      const names = [...recvSet];
      const padIn = indent(depth + 1);
      // 块级作用域：同一函数内多个 if 都改 errors 时，__fk0_* 不得重复声明
      const padDecl = names.length > 0 ? padIn : pad;
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
      const consRaw = transpileBlockAsThunk(stmt.consequent, depth, {
        ...opts,
        conditionalFlow: (opts.conditionalFlow ?? 0) + 1,
      });
      const altRaw = stmt.alternate
        ? transpileBlockAsThunk(stmt.alternate, depth, {
            ...opts,
            conditionalFlow: (opts.conditionalFlow ?? 0) + 1,
          })
        : "undefined";
      const cons = wrapArm(consRaw, "fk1_");
      const alt = names.length
        ? wrapArm(altRaw === "undefined" ? "() => $lit(undefined)" : altRaw, "fk2_")
        : altRaw;
      const joinLines = names.length
        ? [...testRebinds, ...forkBindingDecls(names, padDecl)]
        : testRebinds;
      const applyJoin = names.length ? forkJoinBindings(names, padDecl).join("\n") : "";
      // 两分支都以 return/throw 退出时，$fork 即函数返回值
      // （循环/switch 臂内：用 $loopReturn 抛 NudoReturn，与早退语义一致）
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
              ? `${pad}$loopReturn($fork(${test}, ${cons}, ${alt}));`
              : `${pad}return $fork(${test}, ${cons}, ${alt});`,
          ].join("\n");
        }
        return [
          openBlock,
          ...joinLines,
          `${padDecl}const __fkR = $fork(${test}, ${cons}, ${alt});`,
          applyJoin,
          inCtrl ? `${padDecl}$loopReturn(__fkR);` : `${padDecl}return __fkR;`,
          closeBlock,
        ].join("\n");
      }
      return [
        openBlock,
        ...joinLines,
        `${padDecl}$fork(${test}, ${cons}, ${alt});`,
        applyJoin,
        closeBlock,
      ]
        .filter((l) => l !== null && l !== "")
        .join("\n");
    }
    case "ForStatement": {
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
              : `${pad}${transpileExpression(stmt.init as Expression, opts)};`;
        const testSrc = stmt.test ? transpileExpression(stmt.test, opts) : "$lit(true)";
        // 步进表达式只取副作用（写真实绑定）；状态线程是合成计数器。
        // i++/i-- 的后置值语义会丢自增写回（步进闭包内无语句级 rebind pass），
        // 与主路径同口径：标识符 Update 强制 `name = $add/$sub(name, 1)`。
        const stepPart = (u: Node): string => {
          const upd = u as { type?: string; operator?: string; argument?: { type?: string; name?: string }; expressions?: unknown[] };
          if (upd.type === "UpdateExpression" && upd.argument?.type === "Identifier" && upd.argument.name) {
            return `${upd.argument.name} = ${upd.operator === "++" ? "$add" : "$sub"}(${upd.argument.name}, $lit(1))`;
          }
          if (upd.type === "SequenceExpression") {
            return (upd.expressions ?? []).map((e) => stepPart(e as Node)).join(", ");
          }
          return transpileExpression(u as Expression, opts);
        };
        const updateSrc = stmt.update ? stepPart(stmt.update as Node) : null;
        const forBodyOpts: TranspileOptions = {
          ...opts,
          inLoop: (opts.inLoop ?? 0) + 1,
          loopLabel: undefined, // 标签属于本循环；体 opts 不得传给嵌套循环
        };
        const bodyStmts =
          stmt.body.type === "BlockStatement"
            ? stmt.body.body
                .map((s) => transpileStatement(s, depth + 2, forBodyOpts))
                .join("\n")
            : transpileStatement(stmt.body, depth + 2, forBodyOpts);
        const max = opts.maxLoopIters ?? 8;
        const assigned = new Set<string>();
        collectAssignedIds(stmt.body, assigned);
        collectAssignedIds(stmt.test, assigned);
        collectAssignedIds(stmt.update, assigned);
        collectArrMutatorReceivers(stmt.body, assigned);
        const names = [...assigned].filter((n) => n !== "undefined");
        const packSrc =
          names.length === 0
            ? null
            : `$obj({ ${names.map((n) => `${JSON.stringify(n)}: $copy(${n})`).join(", ")} })`;
        const unpackSrc =
          names.length === 0
            ? null
            : `(__lp) => { ${names.map((n) => `${n} = $get(__lp, ${JSON.stringify(n)});`).join(" ")} }`;
        const optsSrc = (() => {
          const extra = opts.loopLabel ? `label: ${JSON.stringify(opts.loopLabel)}` : "";
          if (!extra) return packSrc && unpackSrc
            ? `, { pack: () => ${packSrc}, unpack: ${unpackSrc} }`
            : "";
          return packSrc && unpackSrc
            ? `, { pack: () => ${packSrc}, unpack: ${unpackSrc}, ${extra} }`
            : `, { ${extra} }`;
        })();
        const stepSrc = updateSrc
          ? `(__n) => { ${updateSrc}; return $add(__n, $lit(1)); }`
          : `(__n) => $add(__n, $lit(1))`;
        return [
          initSrc,
          `${pad}// for (fallback: non-declaration init) → $for (bounded unroll, max=${max})`,
          `${pad}$for(`,
          `${indent(depth + 1)}$lit(0),`,
          `${indent(depth + 1)}(__n) => ${testSrc},`,
          `${indent(depth + 1)}${stepSrc},`,
          `${indent(depth + 1)}(__n) => {`,
          bodyStmts,
          `${indent(depth + 1)}  return __n;`,
          `${indent(depth + 1)}},`,
          `${indent(depth + 1)}${max}${optsSrc}`,
          `${pad});`,
        ]
          .filter((l) => l !== null && l !== "")
          .join("\n");
      }
      const initExpr =
        stmt.init && stmt.init.type === "VariableDeclaration" && stmt.init.declarations[0]?.init
          ? transpileExpression(stmt.init.declarations[0].init, opts)
          : "$lit(undefined)";
      const testSrc = stmt.test ? transpileExpression(stmt.test, opts) : "$lit(true)";
      // for 步进闭包需要**自增后的新值**作状态线程；不能走 UpdateExpression 的
      // 后置旧值语义（那会丢自增副作用）
      const updateSrc =
        stmt.update && stmt.update.type === "UpdateExpression" &&
        stmt.update.argument.type === "Identifier"
          ? `${stmt.update.argument.name} = ${stmt.update.operator === "++" ? "$add" : "$sub"}(${stmt.update.argument.name}, $lit(1))`
          : stmt.update
            ? transpileExpression(stmt.update, opts)
            : `$lit(undefined)`;
      const forBodyOpts: TranspileOptions = {
        ...opts,
        inLoop: (opts.inLoop ?? 0) + 1,
        loopLabel: undefined, // 标签属于本循环；体 opts 不得传给嵌套循环
      };
      const bodyStmts =
        stmt.body.type === "BlockStatement"
          ? stmt.body.body
              .map((s) => transpileStatement(s, depth + 2, forBodyOpts))
              .join("\n")
          : transpileStatement(stmt.body, depth + 2, forBodyOpts);
      const max = opts.maxLoopIters ?? 8;
      const assigned = new Set<string>();
      collectAssignedIds(stmt.body, assigned);
      collectAssignedIds(stmt.test, assigned);
      collectAssignedIds(stmt.update, assigned);
      collectArrMutatorReceivers(stmt.body, assigned);
      const names = [...assigned].filter((n) => n !== initName && n !== "undefined");
      const packSrc =
        names.length === 0
          ? null
          : `$obj({ ${names.map((n) => `${JSON.stringify(n)}: $copy(${n})`).join(", ")} })`;
      const unpackSrc =
        names.length === 0
          ? null
          : `(__lp) => { ${names.map((n) => `${n} = $get(__lp, ${JSON.stringify(n)});`).join(" ")} }`;
      const optsSrc = (() => {
        const extra = opts.loopLabel ? `label: ${JSON.stringify(opts.loopLabel)}` : "";
        if (!extra) return packSrc && unpackSrc
          ? `, { pack: () => ${packSrc}, unpack: ${unpackSrc} }`
          : "";
        return packSrc && unpackSrc
          ? `, { pack: () => ${packSrc}, unpack: ${unpackSrc}, ${extra} }`
          : `, { ${extra} }`;
      })();
      return [
        `${pad}// for → $for (bounded unroll, max=${max})`,
        `${pad}$for(`,
        `${indent(depth + 1)}${initExpr},`,
        `${indent(depth + 1)}(${initName}) => ${testSrc},`,
        `${indent(depth + 1)}(${initName}) => ${updateSrc},`,
        `${indent(depth + 1)}(${initName}) => {`,
        bodyStmts,
        `${indent(depth + 1)}  return ${initName};`,
        `${indent(depth + 1)}},`,
        `${indent(depth + 1)}${max}${optsSrc}`,
        `${pad});`,
      ].join("\n");
    }
    case "BlockStatement":
      // 块内同用早退提升：`{ if (c) return X; … }` 的 return 是函数级语义
      return transpileFnBodyStmts(stmt.body, depth, opts);
    case "SwitchStatement": {
      const disc = transpileExpression(stmt.discriminant as Expression, opts);
      type Arm = { tests: string[]; stmts: Statement[]; isDefault: boolean };

      // 1) 空 case 测试并入下一有体臂；default 独立
      const pre: Arm[] = [];
      let pendingTests: string[] = [];
      for (const c of stmt.cases) {
        const testSrc = c.test ? transpileExpression(c.test as Expression, opts) : null;
        if (testSrc === null) {
          if (pendingTests.length > 0 && c.consequent.length > 0) {
            pre.push({ tests: pendingTests, stmts: c.consequent, isDefault: false });
            pendingTests = [];
          }
          pre.push({ tests: [], stmts: c.consequent, isDefault: true });
          continue;
        }
        if (c.consequent.length === 0) {
          pendingTests.push(testSrc);
          continue;
        }
        pre.push({ tests: [...pendingTests, testSrc], stmts: c.consequent, isDefault: false });
        pendingTests = [];
      }
      if (pendingTests.length > 0) {
        pre.push({ tests: pendingTests, stmts: [], isDefault: false });
      }

      // 2) 非 break 贯穿：把后续臂体串进当前臂（JS 语义）
      const merged: Arm[] = pre.map((arm) => ({ ...arm, tests: [...arm.tests], stmts: [...arm.stmts] }));
      for (let i = 0; i < merged.length; i++) {
        const arm = merged[i]!;
        const body = [...arm.stmts];
        let j = i + 1;
        while (j < merged.length && !stmtCompletesControl(body[body.length - 1] as Statement)) {
          body.push(...merged[j]!.stmts);
          if (stmtCompletesControl(body[body.length - 1] as Statement)) break;
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
      const names = [...recvSet];
      // 源有 default 则每臂一槽；无 default 时多一个「no-match=快照」槽
      const nArms = merged.filter((a) => !a.isDefault).length + (defaultArm ? 1 : 0) + (defaultArm ? 0 : 1);
      const wrapArmThunk = (thunk: string, outIdx: number): string => {
        if (names.length === 0) return thunk;
        // 与 if-fork 同口径：return/throw 臂不写 continue 路径绑定
        return [
          `() => {`,
          ...names.map((n) => `${indent(depth + 1)}${n} = $copy(__sw0_${n});`),
          `${indent(depth + 1)}let __cont = true;`,
          `${indent(depth + 1)}try {`,
          `${indent(depth + 2)}return (${thunk})();`,
          `${indent(depth + 1)}} catch (e) {`,
          `${indent(depth + 2)}if ($isForkExit(e)) __cont = false;`,
          `${indent(depth + 2)}throw e;`,
          `${indent(depth + 1)}} finally {`,
          `${indent(depth + 2)}if (__cont) {`,
          ...names.map((n) => `${indent(depth + 3)}__sw${outIdx + 1}_${n} = ${n};`),
          ...names.map((n) => `${indent(depth + 3)}__sw${outIdx + 1}set_${n} = true;`),
          `${indent(depth + 2)}}`,
          `${indent(depth + 1)}}`,
          `}`,
        ].join("\n");
      };
      let armSeq = 0;
      for (const arm of merged) {
        const body =
          arm.stmts.length === 0
            ? ""
            : arm.stmts.map((s) => transpileStatement(s, depth + 2, armOpts)).join("\n");
        const rawThunk = `() => {\n${body}\n${indent(depth + 1)}}`;
        const thunk = wrapArmThunk(rawThunk, armSeq);
        armSeq++;
        const shared = arm.tests.length > 1 && !arm.isDefault;
        const runRef = shared ? `__swBody${bodyIdxBase + bodyIdx++}` : thunk;
        if (shared) {
          sharedBodyDecls.push(`${pad}const ${runRef} = ${thunk};`);
        }
        if (arm.isDefault) {
          defaultSrc = thunk;
        } else {
          for (const t of arm.tests) {
            caseLines.push(`{ test: ${t}, run: ${runRef} },`);
          }
        }
      }
      // 无 default：合成 no-match 臂，把快照写入 join 槽（抽象 disc 时参与 join）
      if (!defaultArm && names.length > 0) {
        defaultSrc = wrapArmThunk(`() => {\n${indent(depth + 2)}return $lit(undefined);\n${indent(depth + 1)}}`, armSeq);
      }
      switchBodySeq += Math.max(bodyIdx, 1);
      const dflt = defaultSrc ? `, ${defaultSrc}` : "";
      const discRebinds = collectArrMutatorReceivers(stmt.discriminant as Node).size
        ? emitArrMutatorRebinds(stmt.discriminant as Node, opts, pad)
        : [];
      const switchCall = `$switch(${disc}, [\n${caseLines.map((l) => indent(depth + 1) + l).join("\n")}\n${indent(depth + 1)}]${dflt})`;
      if (names.length === 0) {
        return [
          ...discRebinds,
          ...sharedBodyDecls,
          allReturn
            ? `${pad}return ${switchCall};`
            : `${pad}${switchCall};`,
        ].join("\n");
      }
      const decls = names.flatMap((n) => [
        `${pad}const __sw0_${n} = $copy(${n});`,
        ...Array.from({ length: Math.max(nArms, armSeq + (defaultArm ? 0 : 1)) }, (_, i) =>
          `${pad}let __sw${i + 1}_${n}; let __sw${i + 1}set_${n} = false;`,
        ),
      ]);
      const slotCount = Math.max(nArms, armSeq + (defaultArm ? 0 : 1));
      const joins = names.map((n) => {
        const slots = Array.from(
          { length: slotCount },
          (_, i) => `(__sw${i + 1}set_${n} ? __sw${i + 1}_${n} : null)`,
        );
        return `${pad}${n} = (() => { const __p = [${slots.join(",")}].filter((x) => x !== null); return __p.length === 0 ? ${n} : __p.reduce((a, b) => $join(a, b)); })();`;
      });
      // shared body 必须在声明 __sw0_* 的同一块内，否则闭包解析不到槽位绑定
      return [
        ...discRebinds,
        `${pad}{`,
        ...decls.map((l) => l.replace(new RegExp(`^${pad}`), `${pad}`)),
        ...sharedBodyDecls.map((l) =>
          l.startsWith(pad) ? `${pad}${l.slice(pad.length)}` : `${pad}${l}`,
        ),
        `${pad}const __swR = ${switchCall};`,
        ...joins,
        allReturn ? `${pad}return __swR;` : null,
        `${pad}}`,
      ]
        .filter((l): l is string => l !== null)
        .join("\n");
    }
    case "TryStatement": {
      const markName = `__nudoTm_${stmt.loc?.start.line ?? 0}`;
      const tryOpts: TranspileOptions = {
        ...opts,
        inTry: (opts.inTry ?? 0) + 1,
        tryMarkName: markName,
        hasTryHandler: !!stmt.handler,
        tryRethrowCatch: stmt.handler ? catchMayRethrow(stmt.handler) : false,
      };
      const tryBody =
        stmt.block.type === "BlockStatement"
          ? stmt.block.body.map((s) => transpileStatement(s, depth + 1, tryOpts)).join("\n")
          : transpileStatement(stmt.block as unknown as Statement, depth + 1, tryOpts);
      const lines = [
        `${pad}const ${markName} = $tryMark();`,
        `${pad}try {`,
        tryBody,
        `${pad}}`,
      ];
      const catchParam =
        stmt.handler?.param?.type === "Identifier"
          ? (stmt.handler.param as { name: string }).name
          : "e";
      const catchTmp = `__nudoE_${stmt.loc?.start.line ?? 0}`;
      const transpileCatchBody = (d: number, o: TranspileOptions): string =>
        !stmt.handler
          ? ""
          : stmt.handler.body.type === "BlockStatement"
            ? stmt.handler.body.body.map((s) => transpileStatement(s, d, o)).join("\n")
            : transpileStatement(stmt.handler.body as unknown as Statement, d, o);
      if (stmt.handler) {
        const catchBody = transpileCatchBody(depth + 1, opts);
        const softVar = `__soft_${markName}`;
        lines.push(`${pad}catch (${catchTmp}) {`);
        // NudoReturn 是控制流信号，不是 catch 绑定
        lines.push(`${indent(depth + 1)}$rethrowIfNudoReturn(${catchTmp});`);
        // soft：入口摘下、不立刻消化；catch 落出口 discard，rethrow orphan 上浮
        lines.push(`${indent(depth + 1)}const ${softVar} = $tryDetachSoftCatch();`);
        lines.push(`${indent(depth + 1)}const __xs_${markName} = $tryTakeSince(${markName});`);
        lines.push(`${indent(depth + 1)}__xs_${markName}.push($catchVal(${catchTmp}));`);
        lines.push(
          `${indent(depth + 1)}const ${catchParam} = __xs_${markName}.reduce((a, b) => $join(a, b));`,
        );
        lines.push(`${indent(depth + 1)}try {`);
        lines.push(catchBody);
        lines.push(`${indent(depth + 1)}} catch (__rethrow_${markName}) {`);
        lines.push(`${indent(depth + 2)}$tryOrphanSoft(${softVar});`);
        lines.push(`${indent(depth + 2)}throw __rethrow_${markName};`);
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
        const finBody =
          stmt.finalizer.type === "BlockStatement"
            ? stmt.finalizer.body
                .map((s) => transpileStatement(s, depth + 1, opts))
                .join("\n")
            : transpileStatement(stmt.finalizer as unknown as Statement, depth + 1, opts);
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
        const catchBody = transpileCatchBody(depth + 2, opts);
        lines.push(`${pad}{`);
        lines.push(`${indent(depth + 1)}const __post_${markName} = $tryTakeSince(${markName});`);
        lines.push(`${indent(depth + 1)}if (__post_${markName}.length) {`);
        lines.push(
          `${indent(depth + 2)}const ${catchParam} = __post_${markName}.reduce((a, b) => $join(a, b));`,
        );
        lines.push(
          catchBody
            .split("\n")
            .map((l) => (l ? `${indent(depth + 2)}${l.trimStart()}` : l))
            .join("\n"),
        );
        lines.push(`${indent(depth + 1)}}`);
        lines.push(`${pad}}`);
      } else {
        lines.push(`${pad}{`);
        lines.push(`${indent(depth + 1)}const __post_${markName} = $tryTakeSince(${markName});`);
        lines.push(`${indent(depth + 1)}if (__post_${markName}.length) {`);
        lines.push(`${indent(depth + 2)}$throw(__post_${markName}.reduce((a, b) => $join(a, b)));`);
        lines.push(`${indent(depth + 1)}}`);
        lines.push(`${pad}}`);
      }
      return lines.join("\n");
    }
    case "ForOfStatement":
    case "ForInStatement": {
      const isIn = stmt.type === "ForInStatement";
      // for-in：键序列由 $forInKeys 投影（整数键升序/字符串插入序/hole 跳过）
      const iter = isIn
        ? `$forInKeys(${transpileExpression(stmt.right as Expression, opts)})`
        : transpileExpression(stmt.right as Expression, opts);
      // for (const x of xs) / for (const [a,b] of xs)
      let bindName = "_item";
      if (stmt.left.type === "VariableDeclaration") {
        const decl = stmt.left.declarations[0];
        if (decl?.id.type === "Identifier") bindName = decl.id.name;
        else if (decl?.id.type === "ObjectPattern" || decl?.id.type === "ArrayPattern") {
          // 解构绑定：用临时 _item 再 destructure
          bindName = `_of${stmt.loc?.start.line ?? 0}`;
        }
      } else if (stmt.left.type === "Identifier") {
        bindName = stmt.left.name;
      }
      const bodyLines: string[] = [];
      if (
        stmt.left.type === "VariableDeclaration" &&
        stmt.left.declarations[0] &&
        (stmt.left.declarations[0].id.type === "ObjectPattern" ||
          stmt.left.declarations[0].id.type === "ArrayPattern")
      ) {
        emitDestructure(
          stmt.left.declarations[0].id as Node,
          bindName,
          "const",
          indent(depth + 2),
          opts,
          bodyLines,
          { n: 0 },
        );
      }
      const bodyOpts: TranspileOptions = {
        ...opts,
        inLoop: (opts.inLoop ?? 0) + 1,
        loopLabel: undefined,
      };
      const bodyStmts =
        stmt.body.type === "BlockStatement"
          ? stmt.body.body.map((s) => transpileStatement(s, depth + 2, bodyOpts)).join("\n")
          : transpileStatement(stmt.body, depth + 2, bodyOpts);
      const max = opts.maxLoopIters ?? 8;
      // 与 while/for 同协议：体内外层绑定 pack/unpack，抽象/空迭代出口可 join
      const assigned = new Set<string>();
      collectAssignedIds(stmt.body, assigned);
      collectArrMutatorReceivers(stmt.body, assigned);
      const names = [...assigned].filter((n) => n !== bindName && n !== "undefined");
      const loopOpts = opts.loopLabel ? `label: ${JSON.stringify(opts.loopLabel)}` : "";
      const optsSrc =
        names.length === 0
          ? loopOpts
            ? `, { ${loopOpts} }`
            : ""
          : `, { pack: () => $obj({ ${names.map((n) => `${JSON.stringify(n)}: $copy(${n})`).join(", ")} }), unpack: (__lp) => { ${names.map((n) => `${n} = $get(__lp, ${JSON.stringify(n)});`).join(" ")} }${loopOpts ? `, ${loopOpts}` : ""} }`;
      return [
        `${pad}$forOf(${iter}, (${bindName}, _i) => {`,
        ...bodyLines,
        bodyStmts,
        `${pad}}, ${max}${optsSrc});`,
      ].join("\n");
    }
    case "WhileStatement": {
      const test = transpileExpression(stmt.test, opts);
      const bodyOpts: TranspileOptions = {
        ...opts,
        inLoop: (opts.inLoop ?? 0) + 1,
        loopLabel: undefined,
      };
      const body =
        stmt.body.type === "BlockStatement"
          ? stmt.body.body.map((s) => transpileStatement(s, depth + 1, bodyOpts)).join("\n")
          : transpileStatement(stmt.body, depth + 1, bodyOpts);
      const max = opts.maxLoopIters ?? 8;
      // body/test 内被赋值的标识符 → pack/unpack，抽象条件出口可 join（P0 健全）
      const assigned = new Set<string>();
      collectAssignedIds(stmt.body, assigned);
      collectAssignedIds(stmt.test, assigned);
      const names = [...assigned].filter((n) => n !== "undefined");
      const loopOpts = opts.loopLabel ? `label: ${JSON.stringify(opts.loopLabel)}` : "";
      if (names.length === 0) {
        return [
          `${pad}// while → $whileSeq (bounded, max=${max})`,
          `${pad}$whileSeq(() => ${test}, () => {`,
          body,
          `${pad}}, ${max}${loopOpts ? `, { ${loopOpts} }` : ""});`,
        ].join("\n");
      }
      const packSrc = `$obj({ ${names.map((n) => `${JSON.stringify(n)}: $copy(${n})`).join(", ")} })`;
      const unpackSrc = `(__lp) => { ${names.map((n) => `${n} = $get(__lp, ${JSON.stringify(n)});`).join(" ")} }`;
      return [
        `${pad}// while → $whileSeq (instrumented bindings: ${names.join(", ")})`,
        `${pad}$whileSeq(() => ${test}, () => {`,
        body,
        `${pad}}, ${max}, { pack: () => ${packSrc}, unpack: ${unpackSrc}${loopOpts ? `, ${loopOpts}` : ""} });`,
      ].join("\n");
    }
    case "DoWhileStatement": {
      // do { body } while (test) ≡ body; while (test) { body }（有界、可 instrument）
      const test = transpileExpression(stmt.test, opts);
      const bodyOpts: TranspileOptions = {
        ...opts,
        inLoop: (opts.inLoop ?? 0) + 1,
        loopLabel: undefined,
      };
      const bodyStmts =
        stmt.body.type === "BlockStatement"
          ? stmt.body.body.map((s) => transpileStatement(s, depth + 1, bodyOpts)).join("\n")
          : transpileStatement(stmt.body, depth + 1, bodyOpts);
      const max = opts.maxLoopIters ?? 8;
      const assigned = new Set<string>();
      collectAssignedIds(stmt.body, assigned);
      collectAssignedIds(stmt.test, assigned);
      collectArrMutatorReceivers(stmt.body, assigned);
      const names = [...assigned].filter((n) => n !== "undefined");
      const packSrc =
        names.length === 0
          ? null
          : `$obj({ ${names.map((n) => `${JSON.stringify(n)}: $copy(${n})`).join(", ")} })`;
      const unpackSrc =
        names.length === 0
          ? null
          : `(__lp) => { ${names.map((n) => `${n} = $get(__lp, ${JSON.stringify(n)});`).join(" ")} }`;
      const loopOpts = opts.loopLabel ? `label: ${JSON.stringify(opts.loopLabel)}` : "";
      const optsSrc =
        packSrc && unpackSrc
          ? `, { pack: () => ${packSrc}, unpack: ${unpackSrc}${loopOpts ? `, ${loopOpts}` : ""} }`
          : loopOpts
            ? `, { ${loopOpts} }`
            : "";
      return [
        `${pad}// do-while → body + $whileSeq (bounded, max=${max})`,
        `{`,
        bodyStmts,
        `${indent(depth + 1)}$whileSeq(() => ${test}, () => {`,
        bodyStmts,
        `${indent(depth + 1)}}, ${max}${optsSrc});`,
        `${pad}}`,
      ].join("\n");
    }
    case "ClassDeclaration": {
      return transpileClass(stmt, depth, opts);
    }
    case "BreakStatement": {
      // switch 臂内无标签 break = 臂结束（fall-through 合并已按结构吸收）
      if (opts.inSwitchArm && !stmt.label) return `${pad}return;`;
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

/** class C extends P { ctor, methods } → $class(...) */
function transpileClass(
  stmt: {
    id?: { name: string } | null;
    body: { body: unknown[] };
    superClass?: { type: string; name?: string } | null;
  },
  depth: number,
  opts: TranspileOptions,
): string {
  const pad = indent(depth);
  const name = stmt.id?.name ?? "AnonymousClass";
  const superName =
    stmt.superClass?.type === "Identifier" ? stmt.superClass.name : undefined;
  const methods = stmt.body.body as Array<{
    type: string;
    key?: { type: string; name?: string; value?: unknown };
    params?: unknown[];
    body?: { type: string; body?: unknown[] };
    kind?: string;
    async?: boolean;
    static?: boolean;
    value?: unknown;
  }>;

  const ctorParts: string[] = [];
  const methodParts: string[] = [];
  const staticMethodParts: string[] = [];
  const staticFieldParts: string[] = [];
  const accessorDefs = new Map<string, { get?: string; set?: string }>();
  const staticAccessorDefs = new Map<string, { get?: string; set?: string }>();

  const paramsOf = (m: { params?: unknown[] }): string[] =>
    (m.params ?? []).map((p) => {
      const id = p as { type?: string; name?: string };
      return id?.type === "Identifier" && id.name ? id.name : "_";
    });

  const methodOpts: TranspileOptions = {
    ...opts,
    inLoop: 0,
    inTry: 0,
    inFunction: true,
    thisParam: "__this",
    className: name,
  };

  for (const m of methods) {
    // 静态字段 ClassProperty
    if (m.type === "ClassProperty" || m.type === "ClassPrivateProperty") {
      const fname =
        m.key?.type === "Identifier" ? m.key.name : m.key?.type === "StringLiteral" ? String(m.key.value) : null;
      if (fname && m.value) {
        const vsrc = transpileExpression(m.value as Expression, opts);
        staticFieldParts.push(`${indent(depth + 2)}${JSON.stringify(fname)}: ${vsrc},`);
      }
      continue;
    }
    if (m.type !== "ClassMethod" && m.type !== "ObjectMethod") continue;
    const mname =
      (m.key?.type === "Identifier"
        ? m.key.name
        : m.key?.type === "StringLiteral"
          ? String(m.key.value)
          : undefined) ?? "method";
    const params = paramsOf(m);
    const paramList = params.filter((p) => p !== "_").join(", ");
    // get/set 访问器：实例进 spec.accessors，静态进 spec.staticAccessors
    if (m.kind === "get" || m.kind === "set") {
      const accBodyOpts: TranspileOptions = { ...opts, inLoop: 0, inTry: 0, thisParam: "__this" };
      const accBodyStmts =
        m.body?.type === "BlockStatement"
          ? (m.body.body as Statement[])
              .map((s) => transpileStatement(s, depth + 3, accBodyOpts))
              .join("\n")
          : "";
      const target = m.static ? staticAccessorDefs : accessorDefs;
      const def = target.get(mname) ?? {};
      if (m.kind === "get") {
        def.get = `(__this) => {\n${accBodyStmts}\n${indent(depth + 3)}}`;
      } else {
        const vname = params.length > 0 && params[0] !== "_" ? params[0]! : "__v";
        def.set = `(__this, ${vname}) => {\n${accBodyStmts}\n${indent(depth + 4)}return __this;\n${indent(depth + 3)}}`;
      }
      target.set(mname, def);
      continue;
    }
    const bodyStmts =
      m.body?.type === "BlockStatement"
        ? (m.body.body as Statement[])
            .map((s) => transpileStatement(s, depth + 3, m.static ? opts : methodOpts))
            .join("\n")
        : "";
    if (m.static) {
      staticMethodParts.push(
        `${indent(depth + 3)}${mname}: (${paramList}) => {`,
        bodyStmts,
        `${indent(depth + 3)}},`,
      );
      continue;
    }
    if (m.kind === "constructor" || mname === "constructor") {
      ctorParts.push(
        `${indent(depth + 2)}ctor: (__this, ${paramList}) => {`,
        bodyStmts,
        `${indent(depth + 3)}return __this;`,
        `${indent(depth + 2)}},`,
      );
    } else if (m.async) {
      methodParts.push(
        `${indent(depth + 3)}${mname}: (__this, ${paramList}) => {`,
        `${indent(depth + 4)}return $async(() => {`,
        bodyStmts,
        `${indent(depth + 4)}});`,
        `${indent(depth + 3)}},`,
      );
    } else {
      methodParts.push(
        `${indent(depth + 3)}${mname}: (__this, ${paramList}) => {`,
        bodyStmts,
        `${indent(depth + 3)}},`,
      );
    }
  }

  const specLines: string[] = [];
  if (superName) {
    // 活引用而非名字字符串：class B extends A {} 在 A 声明前求值时
    // 触发 let TDZ ReferenceError（原生语义）；宿主全局（extends Map）按名解析
    specLines.push(`${indent(depth + 2)}extends: ${superName},`);
  }
  if (staticFieldParts.length) {
    specLines.push(`${indent(depth + 2)}statics: {`, ...staticFieldParts, `${indent(depth + 2)}},`);
  }
  if (staticMethodParts.length) {
    specLines.push(
      `${indent(depth + 2)}staticMethods: {`,
      ...staticMethodParts,
      `${indent(depth + 2)}},`,
    );
  }
  if (ctorParts.length) {
    specLines.push(...ctorParts);
  }
  if (methodParts.length) {
    specLines.push(`${indent(depth + 2)}methods: {`, ...methodParts, `${indent(depth + 2)}},`);
  }
  if (accessorDefs.size > 0) {
    const accParts: string[] = [];
    for (const [k, def] of accessorDefs) {
      const members: string[] = [];
      if (def.get) members.push(`${indent(depth + 4)}get: ${def.get},`);
      if (def.set) members.push(`${indent(depth + 4)}set: ${def.set},`);
      accParts.push(`${indent(depth + 3)}${JSON.stringify(k)}: {`, ...members, `${indent(depth + 3)}},`);
    }
    specLines.push(
      `${indent(depth + 2)}accessors: {`,
      ...accParts,
      `${indent(depth + 2)}},`,
    );
  }
  if (staticAccessorDefs.size > 0) {
    const accParts: string[] = [];
    for (const [k, def] of staticAccessorDefs) {
      const members: string[] = [];
      if (def.get) members.push(`${indent(depth + 4)}get: ${def.get},`);
      if (def.set) members.push(`${indent(depth + 4)}set: ${def.set},`);
      accParts.push(`${indent(depth + 3)}${JSON.stringify(k)}: {`, ...members, `${indent(depth + 3)}},`);
    }
    specLines.push(
      `${indent(depth + 2)}staticAccessors: {`,
      ...accParts,
      `${indent(depth + 2)}},`,
    );
  }

  return [
    // let：静态成员写 A.x = v 经 $set 不可变更新后需重绑类绑定
    `${pad}let ${name} = $class(${JSON.stringify(name)}, {`,
    ...specLines,
    `${pad}});`,
  ].join("\n");
}

function transpileBlockAsThunk(stmt: Statement, depth: number, opts: TranspileOptions): string {
  if (stmt.type === "BlockStatement") {
    const inner = transpileFnBodyStmts(stmt.body, depth + 1, opts);
    return `() => {\n${inner}\n${indent(depth)}}`;
  }
  if (stmt.type === "ReturnStatement") {
    const v = stmt.argument ? transpileExpression(stmt.argument, opts) : "$lit(undefined)";
    // C2.1：循环体内的 return 是函数提前返回，不是 thunk 的表达式值
    if ((opts.inLoop ?? 0) > 0) {
      return `() => { $loopReturn(${v}); }`;
    }
    return `() => ${v}`;
  }
  const one = transpileStatement(stmt, depth + 1, opts);
  return `() => {\n${one}\n${indent(depth)}}`;
}

function extractForInitName(init: Statement | Expression | null | undefined): string | null {
  if (!init || init.type !== "VariableDeclaration") return null;
  const d = init.declarations[0];
  return d?.id.type === "Identifier" ? d.id.name : null;
}

export function transpileExpression(expr: Expression, opts: TranspileOptions = {}): string {
  // @nudo:replace：节点源码文本匹配则换成注入变量
  const rep = matchReplacement(expr as Node, opts);
  if (rep) return rep;
  // ChainExpression 不在 Expression 联合里，先剥一层；Babel 8 将 Super 移出 Expression
  const anyExpr = expr as unknown as { type: string; expression?: Expression };
  if (anyExpr.type === "ChainExpression" && anyExpr.expression) {
    return transpileExpression(anyExpr.expression, opts);
  }
  if (anyExpr.type === "Super") {
    return `/* super */`;
  }
  switch (expr.type) {
    case "NumericLiteral":
    case "StringLiteral":
    case "BooleanLiteral":
      return `$lit(${JSON.stringify(expr.value)})`;
    case "BigIntLiteral":
      // JSON.stringify(bigint) 会抛；按字面量拼法输出（$lit(5n)）
      return `$lit(${String((expr as { value: bigint }).value)}n)`;
    case "NullLiteral":
      return `$lit(null)`;
    case "ClassExpression":
      // 类表达式值是构造器；类体未建模时给 fn 形状，不得折精确 undefined
      return `$classExpr()`;
    case "Identifier":
      if (expr.name === "undefined") return "$lit(undefined)";
      if (expr.name === "NaN") return "$lit(NaN)";
      if (expr.name === "Infinity") return "$lit(Infinity)";
      return expr.name;
    case "ThisExpression":
      // 顶层 this（无 thisParam 且不在函数体）：ESM 语义 this === undefined。
      // 读 → undefined；写（this.x = 1）经写路径 strict 语义硬抛 TypeError
      // （模块装载失败，与原生一致）。函数体 this 由 thisParam/降级处理。
      return opts.thisParam ?? "$lit(undefined)";
    case "NewExpression": {
      const callee = expr.callee;
      const cname =
        callee.type === "Identifier" ? callee.name : isExpression(callee) ? transpileExpression(callee, opts) : "$lit(undefined)";
      const args = expr.arguments
        .map((a) => (a.type === "SpreadElement" ? "$lit(undefined)" : transpileExpression(a as Expression, opts)))
        .join(", ");
      return `$new(${cname}, [${args}])`;
    }
    case "LogicalExpression": {
      const op = expr.operator;
      const lNode = expr.left as Node;
      const rNode = expr.right as Node;
      const l = transpileExpression(expr.left, opts);
      const r = transpileExpression(expr.right, opts);
      if (op === "??") {
        // nullish 合并：test = left 是否 nullish（不是 truthiness）
        return transpileShortCircuitExpr(opts, {
          alwaysNodes: [lNode],
          alwaysSrc: l,
          // 测试用 nullish；返回侧：nullish → right，否则 → left
          consSrc: r,
          consNodes: [rNode],
          altSrc: l,
          altNodes: [lNode],
          testSrc: `$nullishTest(${l})`,
        });
      }
      // && : test=left, cons=right, alt=left(已算)  || : test=left, cons=left, alt=right
      return op === "&&"
        ? transpileShortCircuitExpr(opts, {
            alwaysNodes: [lNode],
            alwaysSrc: l,
            consSrc: r,
            consNodes: [rNode],
            altSrc: "__test",
            altNodes: [],
          })
        : transpileShortCircuitExpr(opts, {
            alwaysNodes: [lNode],
            alwaysSrc: l,
            consSrc: "__test",
            consNodes: [],
            altSrc: r,
            altNodes: [rNode],
          });
    }
    case "ConditionalExpression": {
      const testNode = expr.test as Node;
      const consNode = expr.consequent as Node;
      const altNode = expr.alternate as Node;
      const test = transpileExpression(expr.test, opts);
      const c = transpileExpression(expr.consequent, opts);
      const a = transpileExpression(expr.alternate, opts);
      return transpileShortCircuitExpr(opts, {
        alwaysNodes: [testNode],
        alwaysSrc: test,
        consSrc: c,
        consNodes: [consNode],
        altSrc: a,
        altNodes: [altNode],
      });
    }
    case "RegExpLiteral": {
      return `$regex(${JSON.stringify(expr.pattern)}${expr.flags ? `, ${JSON.stringify(expr.flags)}` : ""})`;
    }
    case "BinaryExpression": {
      // instanceof 需右操作数的**类名**（不是值）：右操作数必须是标识符
      if (expr.operator === "instanceof") {
        const l = isExpression(expr.left) ? transpileExpression(expr.left, opts) : "$lit(undefined)";
        if (expr.right.type === "Identifier") {
          // 第三参传 RHS 值：@@hasInstance 派发需要（类名派发不读第三参）
          return `$instanceof(${l}, ${JSON.stringify(expr.right.name)}, ${expr.right.name})`;
        }
        // 非标识符右操作数（表达式/成员路径）：构造器值未知 → 抽象 boolean
        return `$instanceofNonIdent(${l})`;
      }
      const fn = BIN_OPS[expr.operator];
      if (!fn) return `/* unsupported ${expr.operator} */ $lit(undefined)`;
      const l = isExpression(expr.left) ? transpileExpression(expr.left, opts) : "$lit(undefined)";
      const r = isExpression(expr.right) ? transpileExpression(expr.right, opts) : "$lit(undefined)";
      return `${fn}(${l}, ${r})`;
    }
    case "UnaryExpression": {
      if (expr.operator === "delete") {
        // delete 的表达式值是布尔结果；容器写回由语句级 emitDeleteRebinds 负责
        const arg = expr.argument as Expression;
        if (arg.type === "MemberExpression") {
          const m = arg as unknown as {
            object: Node;
            property: Node;
            computed: boolean;
          };
          const keySrc = m.computed
            ? transpileExpression(m.property as Expression, opts)
            : `$lit(${JSON.stringify((m.property as { name: string }).name)})`;
          const path = memberPathOf(m, opts);
          const parentRead =
            path && path.layers.length >= 2
              ? readPrefix(path, path.layers.length - 2)
              : path
                ? path.rootSrc
                : transpileExpression(m.object as Expression, opts);
          return `$delRes(${parentRead}, ${keySrc})`;
        }
        return `/* delete ${(arg as { type?: string }).type ?? ""} */ $lit(undefined)`;
      }
      const arg = transpileExpression(expr.argument as Expression, opts);
      if (expr.operator === "-") return `$neg(${arg})`;
      if (expr.operator === "!") return `$not(${arg})`;
      if (expr.operator === "typeof") return `$typeof(${arg})`;
      if (expr.operator === "+") return `$toNumber(${arg})`;
      if (expr.operator === "~") return `$bitnot(${arg})`;
      if (expr.operator === "void") return `((${arg}), $lit(undefined))`;
      return `/* unary ${expr.operator} */ $lit(undefined)`;
    }
    case "UpdateExpression": {
      // i++/++i/i--/--i：前缀 = 新值；后缀表达式值为旧值，写回由语句级 rebind pass 完成
      const arg = expr.argument as Expression;
      const fn = expr.operator === "++" ? "$add" : "$sub";
      if (arg.type === "Identifier") {
        if (expr.prefix) return `${arg.name} = ${fn}(${arg.name}, $lit(1))`;
        return arg.name;
      }
      if (arg.type === "MemberExpression") {
        const m = arg as unknown as { object: Node; property: Node; computed: boolean };
        const path = memberPathOf(m, opts);
        if (path) {
          const readSrc = readPathSrc(path);
          // 前缀表达式的值是**新值**；容器写回由语句级 rebind pass 完成
          // （标识符前缀自包含 `n = $add(n, 1)`，值即新值，无此问题）
          if (expr.prefix) return `${fn}(${readSrc}, $lit(1))`;
          return readSrc;
        }
      }
      return `/* update ${expr.operator} */ $lit(undefined)`;
    }
    case "AwaitExpression": {
      const arg = transpileExpression(expr.argument as Expression, opts);
      return `$await(${arg})`;
    }
    case "YieldExpression": {
      const arg = expr.argument
        ? transpileExpression(expr.argument as Expression, opts)
        : "$lit(undefined)";
      return `$yield(${arg})`;
    }
    case "TemplateLiteral": {
      const quasis = expr.quasis;
      const exprs = expr.expressions;
      // `a${b}c` → $add($add($lit("a"), b), $lit("c"))
      let acc: string | null = null;
      for (let i = 0; i < quasis.length; i++) {
        const cooked = quasis[i]!.value.cooked ?? quasis[i]!.value.raw;
        const piece = `$lit(${JSON.stringify(cooked)})`;
        acc = acc === null ? piece : `$add(${acc}, ${piece})`;
        if (i < exprs.length) {
          const e = transpileExpression(exprs[i] as Expression, opts);
          acc = `$add(${acc}, ${e})`;
        }
      }
      return acc ?? `$lit("")`;
    }
    case "SequenceExpression":
      return expr.expressions.map((e) => transpileExpression(e, opts)).join(", ");
    case "ObjectExpression": {
      // 支持 { ...a, b: 1 } → $spread($spread(a, $obj({b:1})), ...)
      let acc: string | null = null;
      const props: string[] = [];
      const accRegs: Array<{ key: string; get?: string; set?: string }> = [];
      const flushProps = () => {
        if (props.length === 0) return;
        const obj = `$obj({ ${props.join(", ")} })`;
        acc = acc === null ? obj : `$spread(${acc}, ${obj})`;
        props.length = 0;
      };
      for (const prop of expr.properties) {
        if (prop.type === "SpreadElement") {
          flushProps();
          const arg = transpileExpression(prop.argument as Expression, opts);
          // 首个 spread 也必须产新对象：{...o} 别名 o 会泄漏 frozen/sealed
          // 不变性（Object.isFrozen({...frozen}) 假 true）、跳过 getter 调用、
          // 且 c={...o} 后 c.x=… 误写源对象（原生新对象互不影响）。
          acc = acc === null ? `$spread($obj({}), ${arg})` : `$spread(${acc}, ${arg})`;
          continue;
        }
        // C3.2：对象方法简写 → $fnVal（方法槽进 shape；闭包捕获外层 let）。
        // P1：ObjectMethod 的 this 由 $invoke 注入 receiver（bindThis），与 class 方法同轨。
        if (prop.type === "ObjectMethod") {
          flushProps();
          const mkey = (() => {
            const k = staticKeyOf(prop.key as { type?: string; name?: string; value?: unknown });
            if (k !== null) return JSON.stringify(k);
            // 计算键 [Symbol.X] → "@@X" 投影（镜像成员访问 m[Symbol.iterator]）
            return symbolKeyOf(prop.key as never);
          })();
          if (mkey === null) continue;
          const paramNames = (prop.params as Array<{ type: string; name?: string }>).map((p) =>
            p.type === "Identifier" && p.name ? p.name : "_a",
          );
          // 方法体是新的函数边界：inLoop/inTry 必须归零
          const methodOpts: TranspileOptions = { ...opts, inLoop: 0, inTry: 0, thisParam: "__this" };
          // get/set 访问器：注册进运行时侧表（$get/$set 派发；展开/assign 时调用）
          if (prop.kind === "get" || prop.kind === "set") {
            // 占位槽保键存在性（'x' in o / keys / assign 拷贝目标）；读写在 $get/$set 层派发
            props.push(`${mkey}: $lit(undefined)`);
            const bodySrc =
              prop.body.type === "BlockStatement"
                ? `{\n${prop.body.body.map((s) => transpileStatement(s, 1, methodOpts)).join("\n")}\n}`
                : transpileExpression(prop.body as unknown as Expression, methodOpts);
            if (prop.kind === "get") {
              accRegs.push({ key: mkey, get: `(__this) => ${bodySrc}` });
            } else {
              const vname = paramNames.length > 0 && paramNames[0] !== "_a" ? paramNames[0]! : "__v";
              accRegs.push({
                key: mkey,
                set: `(__this, ${vname}) => {\n${bodySrc}\nreturn __this;\n}`,
              });
            }
            continue;
          }
          const bodySrc =
            prop.body.type === "BlockStatement"
              ? `{\n${prop.body.body.map((s) => transpileStatement(s, 1, methodOpts)).join("\n")}\n}`
              : transpileExpression(prop.body as unknown as Expression, methodOpts);
          const bindParams = ["__this", ...paramNames];
          const fnValSrc = `$fnVal([${paramNames.map((p) => JSON.stringify(p)).join(", ")}], (${bindParams.join(", ")}) => ${bodySrc}, { bindThis: true })`;
          props.push(`${mkey}: ${fnValSrc}`);
          continue;
        }
        if (prop.type !== "ObjectProperty") continue;
        // 计算属性 { [expr]: v } → $setKey；[Symbol.X] 投影为 "@@X" 字符串槽
        if (prop.computed) {
          flushProps();
          const symK = symbolKeyOf(prop.key as never);
          const v = transpileExpression(prop.value as Expression, opts);
          const base = acc === null ? `$obj({})` : acc;
          if (symK !== null) {
            acc = `$set(${base}, ${symK}, ${v})`;
            continue;
          }
          const k = transpileExpression(prop.key as Expression, opts);
          acc = `$setKey(${base}, ${k}, ${v})`;
          continue;
        }
        const key = (() => {
          const k = staticKeyOf(prop.key as { type?: string; name?: string; value?: unknown });
          return k === null ? null : JSON.stringify(k);
        })();
        if (key === null) continue;
        // 方法型 FunctionExpression：与 ObjectMethod 同 this 绑定语义
        if (
          prop.value.type === "FunctionExpression" &&
          !(prop.value as { async?: boolean }).async
        ) {
          const fn = prop.value as unknown as {
            params: Array<{ type: string; name?: string }>;
            body: Node;
            generator?: boolean;
          };
          if (!fn.generator) {
            const paramNames = fn.params.map((p) =>
              p.type === "Identifier" && p.name ? p.name : "_a",
            );
            const methodOpts: TranspileOptions = { ...opts, inLoop: 0, thisParam: "__this" };
            const bodySrc =
              fn.body.type === "BlockStatement"
                ? `{\n${(fn.body as { body: Statement[] }).body.map((s) => transpileStatement(s, 1, methodOpts)).join("\n")}\n}`
                : transpileExpression(fn.body as unknown as Expression, methodOpts);
            const bindParams = ["__this", ...paramNames];
            props.push(
              `${key}: $fnVal([${paramNames.map((p) => JSON.stringify(p)).join(", ")}], (${bindParams.join(", ")}) => ${bodySrc}, { bindThis: true })`,
            );
            continue;
          }
        }
        const valSrc = transpileExpression(prop.value as Expression, opts);
        props.push(`${key}: ${valSrc}`);
      }
      flushProps();
      let result = acc ?? `$obj({})`;
      for (const r of accRegs) {
        result = `$objAccessor(${result}, ${r.key}, ${r.get ?? "null"}, ${r.set ?? "null"})`;
      }
      return result;
    }
    case "MemberExpression":
    case "OptionalMemberExpression": {
      const optional = (expr as { optional?: boolean }).optional === true;
      if (expr.computed) {
        const obj = transpileExpression(expr.object as Expression, opts);
        const key = expr.property;
        if (key.type === "StringLiteral") {
          return optional
            ? `$optionalGet(${obj}, ${JSON.stringify(key.value)})`
            : `$get(${obj}, ${JSON.stringify(key.value)})`;
        }
        if (key.type === "NumericLiteral") {
          return optional
            ? `$optionalGet(${obj}, ${JSON.stringify(String(key.value))})`
            : `$idx(${obj}, $lit(${key.value}))`;
        }
        // 宿主 Symbol 常量键（m[Symbol.iterator]）：投影为 "@@name" 字符串键，
        // runtime $get 对内建 brand 解析为可 typeof 的方法形状
        if (
          key.type === "MemberExpression" &&
          key.computed !== true &&
          key.object.type === "Identifier" &&
          key.object.name === "Symbol" &&
          key.property.type === "Identifier"
        ) {
          const symKey = JSON.stringify(`@@${key.property.name}`);
          return optional ? `$optionalGet(${obj}, ${symKey})` : `$get(${obj}, ${symKey})`;
        }
        if (isExpression(key)) {
          const k = transpileExpression(key, opts);
          return `$idx(${obj}, ${k})`;
        }
        return `/* computed member */ $lit(undefined)`;
      }
      if (expr.property.type !== "Identifier") {
        return `/* member */ $lit(undefined)`;
      }
      // o.length
      if (expr.property.name === "length") {
        return `$len(${transpileExpression(expr.object as Expression, opts)})`;
      }
      const recv = transpileExpression(expr.object as Expression, opts);
      const key = JSON.stringify(expr.property.name);
      return optional ? `$optionalGet(${recv}, ${key})` : `$get(${recv}, ${key})`;
    }
    case "ArrayExpression": {
      // [...a, b] → $concat；含 spread 时 hole 下标不可静态确定，保守置 undefined
      const hasSpread = expr.elements.some((el) => el?.type === "SpreadElement");
      if (!hasSpread) {
        const items: string[] = [];
        const holes: number[] = [];
        for (const el of expr.elements) {
          if (!el) {
            holes.push(items.length);
            items.push("$lit(undefined)");
            continue;
          }
          items.push(transpileExpression(el as Expression, opts));
        }
        return `$arrWithHoles([${items.join(", ")}], [${holes.join(", ")}])`;
      }
      let acc: string | null = null;
      for (const el of expr.elements) {
        if (!el) continue;
        let piece: string;
        if (el.type === "SpreadElement") {
          // 经 $concat 归一：字符串按 code points 拆、单元素 spread 也是数组
          piece = `$concat(${transpileExpression(el.argument as Expression, opts)}, $arr([]))`;
        } else {
          piece = `$arr([${transpileExpression(el, opts)}])`;
        }
        acc = acc === null ? piece : `$concat(${acc}, ${piece})`;
      }
      return acc ?? `$arr([])`;
    }
    case "AssignmentExpression": {
      // obj.field = v → $set；标识符赋值保持 JS 绑定（值是 Abs）
      // 复合赋值 s += v → s = $add(s, v)；成员/下标写以「读-改-写」链重绑根绑定
      // 逻辑赋值 ||= / &&= / ??= → 短路协议（P0-5）
      // 解构赋值 [a, b] = [b, a] / ({ p: x } = o)：RHS 先求值，逐项写回（IIFE 保表达式值 = RHS）
      if (expr.operator === "=" && (expr.left.type === "ArrayPattern" || expr.left.type === "ObjectPattern")) {
        const right = transpileExpression(expr.right, opts);
        const out: string[] = [];
        emitDestructure(expr.left as Node, "__d", "", "", opts, out, { n: 0 });
        return `((__d) => { ${out.join(" ")} return __d; })(${right})`;
      }
      const compoundFn = COMPOUND_OPS[expr.operator];
      const right = transpileExpression(expr.right, opts);
      const op = expr.operator;
      if (op === "||=" || op === "&&=" || op === "??=") {
        const rNode = expr.right as Node;
        const emitLogicalAssign = (targetSrc: string, setSrc: (val: string) => string): string => {
          if (op === "||=") {
            // truthy → keep left；falsy → rhs
            const sc = transpileShortCircuitExpr(opts, {
              alwaysNodes: [],
              alwaysSrc: targetSrc,
              consSrc: "__test",
              consNodes: [],
              altSrc: right,
              altNodes: [rNode],
            });
            return setSrc(sc);
          }
          if (op === "&&=") {
            // truthy → rhs；falsy → keep left
            const sc = transpileShortCircuitExpr(opts, {
              alwaysNodes: [],
              alwaysSrc: targetSrc,
              consSrc: right,
              consNodes: [rNode],
              altSrc: "__test",
              altNodes: [],
            });
            return setSrc(sc);
          }
          // ??= : nullish → rhs；否则 keep left
          const sc = transpileShortCircuitExpr(opts, {
            alwaysNodes: [],
            alwaysSrc: targetSrc,
            consSrc: right,
            consNodes: [rNode],
            altSrc: targetSrc,
            altNodes: [],
            testSrc: `$nullishTest(${targetSrc})`,
          });
          return setSrc(sc);
        };
        if (expr.left.type === "Identifier") {
          return emitLogicalAssign(expr.left.name, (val) => `${expr.left.type === "Identifier" ? (expr.left as { name: string }).name : ""} = ${val}`);
        }
        if (expr.left.type === "MemberExpression") {
          const m = expr.left as unknown as {
            object: Node;
            property: Node;
            computed: boolean;
          };
          const path = memberPathOf(m, opts);
          if (path) {
            return emitLogicalAssign(readPathSrc(path), (val) => {
              // 表达式值 = 写入的值；$set 返回容器不是 JS 语义
              return `((__v) => { ${path.rootSrc} = ${setPathSrc(path, "__v")}; return __v; })(${val})`;
            });
          }
        }
        return `/* assign ${op} */ $lit(undefined)`;
      }
      if (expr.left.type === "MemberExpression") {
        const m = expr.left as unknown as {
          object: Node;
          property: Node;
          computed: boolean;
        };
        const path = memberPathOf(m, opts);
        if (path) {
          const valSrc = compoundFn
            ? `${compoundFn}(${readPathSrc(path)}, ${right})`
            : right;
          // 表达式值 = 写入的值（JS 语义）；写回仍走不可变更新链
          return `((__v) => { ${path.rootSrc} = ${setPathSrc(path, "__v")}; return __v; })(${valSrc})`;
        }
        // 根不可重绑（如 foo().x = v）：保留旧纯表达式形态；
        // 表达式值 = 写入的值（$set/$idxSet 返回容器不是 JS 语义）
        if (!m.computed && m.property.type === "Identifier") {
          const obj = transpileExpression(m.object as Expression, opts);
          return `((__v) => (($set(${obj}, ${JSON.stringify(m.property.name)}, __v)), __v))(${right})`;
        }
        if (m.computed) {
          const obj = transpileExpression(m.object as Expression, opts);
          const k = m.property;
          if (k.type === "NumericLiteral") {
            return `((__v) => (($idxSet(${obj}, $lit(${k.value}), __v)), __v))(${right})`;
          }
          if (k.type === "StringLiteral") {
            return `((__v) => (($set(${obj}, ${JSON.stringify(k.value)}, __v)), __v))(${right})`;
          }
          if (isExpression(k)) {
            return `((__v) => (($idxSet(${obj}, ${transpileExpression(k, opts)}, __v)), __v))(${right})`;
          }
        }
        throw new NudoUnsupportedError(
          `assign-target`,
          expr.loc ? { line: expr.loc.start.line, column: expr.loc.start.column } : undefined,
        );
      }
      if (expr.left.type === "Identifier") {
        const name = expr.left.name;
        // 结构赋值记录（checkSource assign-mismatch 通道）：prev 读在写前；
        // conditional = 分支/循环体内（与 ast-eval assignFlowDepth 同口径——
        // structuralAssignIssues 跳过 conditional）。逻辑赋值（||= 等）短路
        // 分支在前已处理，不记录（与 ast-eval 早期返回同口径）。
        const cond = (opts.inLoop ?? 0) > 0 || (opts.conditionalFlow ?? 0) > 0;
        const locLine = expr.loc?.start.line ?? 0;
        const locCol = expr.loc?.start.column ?? 0;
        const valSrc = compoundFn ? `${compoundFn}(${name}, ${right})` : right;
        // 顶层绑定表跟重赋值（final 值语义；函数/箭头体不在顶层作用域）
        const bindSrc = !opts.inFunction
          ? ` $recordBinding(${JSON.stringify(name)}, __v);`
          : "";
        return `((__v) => { $assignRecord(${JSON.stringify(name)}, ${name}, __v, ${locLine}, ${locCol}, ${cond});${bindSrc} return ${name} = __v; })(${valSrc})`;
      }
      throw new NudoUnsupportedError(
        `assign-target`,
        expr.loc ? { line: expr.loc.start.line, column: expr.loc.start.column } : undefined,
      );
    }
    case "CallExpression":
    case "OptionalCallExpression": {
      const exprAny = expr as {
        type: string;
        callee: Node;
        arguments: unknown[];
        optional?: boolean;
      };
      const optionalCall = exprAny.type === "OptionalCallExpression" || exprAny.optional === true;
      const callee = expr.callee;
      // super() → __this = $super(__this, Child, [...])
      if (callee.type === "Super" && opts.thisParam && opts.className) {
        const args = expr.arguments
          .map((a) => (a.type === "SpreadElement" ? "$lit(undefined)" : transpileExpression(a as Expression, opts)))
          .join(", ");
        return `${opts.thisParam} = $super(${opts.thisParam}, ${JSON.stringify(opts.className)}, [${args}])`;
      }
      // super.method(args) → $invokeSuper(...)
      if (
        callee.type === "MemberExpression" &&
        !callee.computed &&
        callee.object.type === "Super" &&
        callee.property.type === "Identifier" &&
        opts.thisParam &&
        opts.className
      ) {
        const args = expr.arguments
          .map((a) => (a.type === "SpreadElement" ? "$lit(undefined)" : transpileExpression(a as Expression, opts)))
          .join(", ");
        return `$invokeSuper(${opts.thisParam}, ${JSON.stringify(opts.className)}, ${JSON.stringify(callee.property.name)}, [${args}])`;
      }
      // obj.method(args) / obj?.method(args) → $invoke / $optionalInvoke
      if (
        (callee.type === "MemberExpression" || callee.type === "OptionalMemberExpression") &&
        !callee.computed &&
        callee.property.type === "Identifier"
      ) {
        const recv = transpileExpression(callee.object as Expression, opts);
        const args = expr.arguments
          .map((a) => (a.type === "SpreadElement" ? "$lit(undefined)" : transpileExpression(a as Expression, opts)))
          .join(", ");
        const name = JSON.stringify(callee.property.name);
        const opt = optionalCall || (callee as { optional?: boolean }).optional === true;
        const loc = expr.loc;
        const locArg = loc ? `, [${loc.start.line}, ${loc.start.column}]` : "";
        // RegExp test/exec 的状态写回必须发生在**表达式内部**（元素顺序副作用：
        // [r.test(s), r.lastIndex] 原生第二个元素读到更新后的位置）。receiver 是
        // 本地绑定时内联「求值 + 写回」IIFE；语句级 emit 不再重复写回。
        if (
          !opt &&
          REGEX_STATEFUL_NAMES.has(callee.property.name) &&
          callee.object.type === "Identifier"
        ) {
          const recvName = (callee.object as { name: string }).name;
          return `(() => { const __v = $invoke(${recvName}, ${name}, [${args}]${locArg}); ${recvName} = $reStateCall(${recvName}, ${name}, [${args}]); return __v; })()`;
        }
        return opt
          ? `$optionalInvoke(${recv}, ${name}, [${args}])`
          : `$invoke(${recv}, ${name}, [${args}]${locArg})`;
      }
      // require("spec") → __nudoRequire("spec")
      if (
        callee.type === "Identifier" &&
        callee.name === "require" &&
        expr.arguments[0]?.type === "StringLiteral"
      ) {
        const spec = (expr.arguments[0] as { value: string }).value;
        return `__nudoRequire(${JSON.stringify(spec)})`;
      }
      // 标识符调用 → $callNamed（可采集 call@ + 实参 provenance）
      if (callee.type === "Identifier" && callee.name !== "undefined") {
        const argSrcs: string[] = [];
        const argLocSrcs: string[] = [];
        for (const a of expr.arguments) {
          if (a.type === "SpreadElement") {
            argSrcs.push("$lit(undefined)");
            argLocSrcs.push("null");
          } else {
            argSrcs.push(transpileExpression(a as Expression, opts));
            const al = (a as { loc?: { start: { line: number; column: number } } }).loc;
            argLocSrcs.push(al ? `[${al.start.line}, ${al.start.column}]` : "null");
          }
        }
        const loc = expr.loc;
        const locArg = loc ? `, [${loc.start.line}, ${loc.start.column}]` : "";
        const argLocArg = loc ? `, [${argLocSrcs.join(", ")}]` : "";
        return `$callNamed(${JSON.stringify(callee.name)}, ${callee.name}, [${argSrcs.join(", ")}]${locArg}${argLocArg})`;
      }
      const args = expr.arguments
        .map((a) =>
          a.type === "SpreadElement" ? `/* spread */` : transpileExpression(a as Expression, opts),
        )
        .join(", ");
      const c =
        callee.type === "Identifier"
          ? callee.name
          : isExpression(callee)
            ? transpileExpression(callee, opts)
            : "/* callee */";
      // 表达式 callee（add.bind(…)() / IIFE）：结果是 Abs fn，宿主裸调用无效——
      // 走 $call（Abs 一等函数调用）。Identifier 仍走宿主调用（函数声明/绑定）。
      if (callee.type !== "Identifier") {
        return `$call(${c}, [${args}])`;
      }
      return `${c}(${args})`;
    }
    case "ArrowFunctionExpression":
    case "FunctionExpression": {
      const fn = expr as {
        params: Node[];
        body: Node;
        async?: boolean;
      };
      const isArrow = expr.type === "ArrowFunctionExpression";
      // 函数声明/表达式有独立 this；箭头词法继承外层。仅非箭头且 body 含 this
      // 时注入宿主 this（$rawThis），并用 function 包装替代箭头（宿主 this 动态）
      const hasThis = !isArrow && fnBodyHasThis(fn);
      const { sig, rest, prologue } = emitParamBinding(fn.params, indent(1), opts);
      // 函数边界：return 不是循环提前返回
      const fnBodyOpts: TranspileOptions = {
        ...opts,
        inLoop: 0,
        inFunction: true,
        ...(hasThis ? { thisParam: "__this" } : {}),
      };
      const paramParts = rest ? [...sig, `...${rest}`] : sig;
      // 一等 fn Abs：参数名进 shape（bridge/dts 可展示）；
      // 异步 body 包 $async 保持 eff(promise) 语义（裸 JS async 会泄漏 Promise）。
      const nameList = `[${sig.map((p) => JSON.stringify(p)).join(", ")}]`;
      const thisPrologue = hasThis ? [`const __this = $rawThis(this);`] : [];
      if (fn.body.type === "BlockStatement") {
        const inner = [...prologue, ...thisPrologue, transpileFnBodyStmts((fn.body as { body: Statement[] }).body, 1, fnBodyOpts)].join("\n");
        if (hasThis) {
          const wrap = fn.async
            ? `function (${paramParts.join(", ")}) { return $async(() => {\n${inner}\n}); }`
            : `function (${paramParts.join(", ")}) {\n${inner}\n}`;
          return `$fnVal(${nameList}, ${wrap})`;
        }
        if (fn.async) {
          return `$fnVal(${nameList}, (${paramParts.join(", ")}) => $async(() => {\n${inner}\n}))`;
        }
        return `$fnVal(${nameList}, (${paramParts.join(", ")}) => {\n${inner}\n})`;
      }
      const bodySrc = transpileExpression(fn.body as Expression, fnBodyOpts);
      if (prologue.length > 0 || hasThis) {
        // 表达式体 + 模式参数/this 注入：提升为块体以容纳 prologue
        const rebinds = emitArrMutatorRebinds(fn.body as Expression, fnBodyOpts, "  ");
        const inner = [
          ...prologue,
          ...thisPrologue,
          ...rebinds.map((l) => `  ${l}`),
          `  return ${fn.async ? `$async(() => ${bodySrc})` : bodySrc};`,
        ].join("\n");
        if (hasThis) {
          const wrap = `function (${paramParts.join(", ")}) {\n${inner}\n}`;
          return `$fnVal(${nameList}, ${wrap})`;
        }
        return `$fnVal(${nameList}, (${paramParts.join(", ")}) => {\n${inner}\n})`;
      }
      // 表达式体：块体包裹跑语句级 rebind pass——`()=>n++` / `()=>a.push(1)`
      // 的写回此前静默丢失（表达式上下文无语句级扫描）
      const rebinds = emitArrMutatorRebinds(fn.body as Expression, fnBodyOpts, "  ");
      if (rebinds.length > 0) {
        const inner = [
          ...rebinds.map((l) => `  ${l}`),
          `  return ${fn.async ? `$async(() => ${bodySrc})` : bodySrc};`,
        ].join("\n");
        return `$fnVal(${nameList}, (${paramParts.join(", ")}) => {\n${inner}\n})`;
      }
      if (fn.async) {
        return `$fnVal(${nameList}, (${paramParts.join(", ")}) => $async(() => ${bodySrc}))`;
      }
      return `$fnVal(${nameList}, (${paramParts.join(", ")}) => ${bodySrc})`;
    }
    case "MetaProperty":
    case "ImportExpression":
      // import.meta / 动态 import()：原生语义未建模（Promise/URL 依赖宿主）——
      // 保守 unknown（与 ast-eval 对同类表达式处理对齐；此前抛 unsupported
      // 使含 import.meta 的 ESM 依赖整体回落解释路径）
      return "$unknown()";
    default:
      // 未 lowering 的表达式（JSX 等）：
      // 静默折 $lit(undefined) 是假精确——抛 unsupported 交消费方回落
      throw new NudoUnsupportedError(
        `expression:${expr.type}`,
        expr.loc ? { line: expr.loc.start.line, column: expr.loc.start.column } : undefined,
      );
  }
}

/** 解析 + transpile */
export function transpile(source: string, opts?: TranspileOptions): string {
  return transpileSource(source, opts);
}

function isExpression(n: { type: string }): n is Expression {
  return n.type !== "PrivateName" && !n.type.endsWith("Statement") && !n.type.endsWith("Declaration");
}


