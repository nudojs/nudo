/**
 * B 路径 transpile：JS AST → 可在 Node 上执行的抽象值程序（源码字符串）。
 * 运算符改为 $add/$sub/…；if 改为 $fork；for 改为 $for。
 * 值类型是 Abs；副作用与模块仍由 host mock/注入。
 */

import type { File, Expression, Statement, Node } from "@babel/types";
import { parseSource } from "../parse-source.ts";

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
};

function matchAsOverride(stmt: Node, opts: TranspileOptions): string | null {
  if (!opts.asOverrides?.length || !stmt.loc) return null;
  const line = stmt.loc.start.line;
  for (const a of opts.asOverrides) {
    if (line >= a.stmtStart && line <= a.stmtEnd) return a.varName;
  }
  return null;
}

function normWs(s: string): string {
  return s.replace(/\s+/g, "");
}

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
};

/** 复合赋值 → 二元运行时（标识符与成员路径统一走读-改-写） */
const COMPOUND_OPS: Record<string, string> = {
  "+=": "$add",
  "-=": "$sub",
  "*=": "$mul",
  "/=": "$div",
  "%=": "$mod",
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

export function transpileSource(source: string, opts: TranspileOptions = {}): string {
  const file = parseSource(source);
  return transpileFile(file, { ...opts, source: opts.source ?? source });
}

export function transpileFile(file: File, opts: TranspileOptions = {}): string {
  const runtime = opts.runtimeImport ?? "@nudojs/core/exec";
  const lines: string[] = [
    `// nudo B-path transpile — values are Abs; operators are overloaded calls`,
    `import { $add, $sub, $mul, $div, $mod, $neg, $typeof, $not, $eq, $ne, $eqLoose, $neLoose, $lt, $le, $gt, $ge, $join, $lit, $fork, $for, $forIter, $obj, $get, $set, $while, $whileSeq, $arr, $arrMutContainer, $idx, $idxSet, $len, $call, $throw, $loopReturn, $class, $new, $invoke, $invokeSuper, $super, $async, $await, $asyncReturn, $orDefault, $callNamed, $optionalGet, $optionalInvoke, $spread, $concat, $forOf, $catchVal, $switch, $staticInvoke, $setKey, $gen, $yield, $fnVal, $regex, $rethrowIfNudoReturn } from ${JSON.stringify(runtime)};`,
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

/** 语句或块内是否出现 return/throw（决定 if 是否提升为 return $fork） */
function stmtReturns(stmt: Statement): boolean {
  if (stmt.type === "ReturnStatement" || stmt.type === "ThrowStatement") return true;
  if (stmt.type === "BlockStatement") return stmt.body.some(stmtReturns);
  if (stmt.type === "IfStatement") {
    return stmtReturns(stmt.consequent) && stmt.alternate != null && stmtReturns(stmt.alternate);
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
    const cons = transpileBlockAsThunk(stmt.consequent, depth, opts);
    const altBody = transpileFnBodyStmts(rest, depth + 1, opts);
    const promoted =
      `${indent(depth)}return $fork(${test}, ${cons}, () => {\n` +
      `${altBody}\n` +
      `${indent(depth)}});`;
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
    for (const prop of pattern.properties) {
      if (prop.type !== "ObjectProperty") continue;
      if (prop.key.type !== "Identifier" && prop.key.type !== "StringLiteral") continue;
      const key =
        prop.key.type === "Identifier" ? prop.key.name : String(prop.key.value);
      const keyLit = JSON.stringify(key);
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
    return;
  }
  if (pattern.type === "ArrayPattern") {
    pattern.elements.forEach((el, i) => {
      if (!el) return;
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

function transpileStatement(stmt: Statement, depth: number, opts: TranspileOptions): string {
  const pad = indent(depth);
  switch (stmt.type) {
    case "ExportNamedDeclaration": {
      const decl = stmt.declaration;
      if (!decl) return `${pad}/* export specifiers skipped */`;
      const inner = transpileStatement(decl as Statement, depth, opts);
      // 顶层 export const/let：保留 export 面（run.ts 收集进 exports，
      // 供 directive case 经 callTranspiledExport 求值）
      if (depth === 0 && decl.type === "VariableDeclaration" && !pad) {
        return `export ${inner}`;
      }
      return inner;
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
        const inner = transpileStatement(d as Statement, depth, opts);
        return inner.replace(/^(\s*)export function /, "$1export default function ");
      }
      return `${pad}export default ${transpileExpression(d as Expression, opts)};`;
    }
    case "FunctionDeclaration": {
      if (!stmt.id) return `${pad}// <anonymous fn skipped>`;
      // 嵌套函数声明不是 export 面；函数体是新边界，inLoop 必须归零
      const exportKw = depth === 0 ? "export " : "";
      const fnOpts: TranspileOptions = { ...opts, inLoop: 0 };
      const { sig, rest, prologue } = emitParamBinding(
        stmt.params as Node[],
        indent(depth + 2),
        fnOpts,
      );
      const named = sig;
      const paramsSig = rest ? [...named, `...${rest}`] : named;
      const params = paramsSig.join(", ");
      const bodyStmts =
        stmt.body.type === "BlockStatement"
          ? [...prologue, transpileFnBodyStmts(stmt.body.body, depth + 2, fnOpts)].join("\n")
          : `${indent(depth + 2)}return ${transpileExpression(stmt.body as unknown as Expression, fnOpts)};`;
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
      const prefix = (opts.inLoop ?? 0) > 0 ? "$loopReturn" : "return";
      if (asVar) return `${pad}${prefix}(${asVar});`;
      if (!stmt.argument) return `${pad}${prefix}($lit(undefined));`;
      return `${pad}${prefix}(${transpileExpression(stmt.argument, opts)});`;
    }
    case "ThrowStatement": {
      const arg = stmt.argument ? transpileExpression(stmt.argument, opts) : "$lit(undefined)";
      return `${pad}$throw(${arg});`;
    }
    case "ExpressionStatement": {
      // C1.4：数组 mutator 语句重绑到**变更后容器**（$arrMutContainer），
      // 不得绑到 JS 返回值（pop 返回元素，会污染 receiver Abs）
      const expr = stmt.expression as Expression;
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
        emitDestructure(d.id as Node, tmp, kw, pad, opts, lines, { n: 0 });
      }
      return lines.join("\n");
    }
    case "IfStatement": {
      const test = transpileExpression(stmt.test, opts);
      const cons = transpileBlockAsThunk(stmt.consequent, depth, opts);
      const alt = stmt.alternate ? transpileBlockAsThunk(stmt.alternate, depth, opts) : "undefined";
      // 两分支都以 return/throw 退出时，$fork 即函数返回值
      if (
        stmtReturns(stmt.consequent) &&
        stmt.alternate !== undefined &&
        stmt.alternate !== null &&
        stmtReturns(stmt.alternate)
      ) {
        return `${pad}return $fork(${test}, ${cons}, ${alt});`;
      }
      return `${pad}$fork(${test}, ${cons}, ${alt});`;
    }
    case "ForStatement": {
      const initName = extractForInitName(stmt.init);
      if (!initName) return `${pad}// unsupported for-init; use \`let i = …\``;
      const initExpr =
        stmt.init && stmt.init.type === "VariableDeclaration" && stmt.init.declarations[0]?.init
          ? transpileExpression(stmt.init.declarations[0].init, opts)
          : "$lit(undefined)";
      const testSrc = stmt.test ? transpileExpression(stmt.test, opts) : "$lit(true)";
      const updateSrc = stmt.update ? transpileExpression(stmt.update, opts) : `$lit(undefined)`;
      const forBodyOpts: TranspileOptions = {
        ...opts,
        inLoop: (opts.inLoop ?? 0) + 1,
      };
      const bodyStmts =
        stmt.body.type === "BlockStatement"
          ? stmt.body.body
              .map((s) => transpileStatement(s, depth + 2, forBodyOpts))
              .join("\n")
          : transpileStatement(stmt.body, depth + 2, forBodyOpts);
      const max = opts.maxLoopIters ?? 8;
      // MVP：经典单变量计数循环（状态 = 计数器 Abs）
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
        `${indent(depth + 1)}${max}`,
        `${pad});`,
      ].join("\n");
    }
    case "BlockStatement":
      // 块内同用早退提升：`{ if (c) return X; … }` 的 return 是函数级语义
      return transpileFnBodyStmts(stmt.body, depth, opts);
    case "SwitchStatement": {
      // switch (d) { case 1: … case 2: … default: … } → $switch
      const disc = transpileExpression(stmt.discriminant as Expression, opts);
      // 合并 fall-through：无语句的 case 与下一有语句 case 同体
      type Arm = { tests: string[]; stmts: Statement[]; isDefault: boolean };
      const arms: Arm[] = [];
      for (const c of stmt.cases) {
        const testSrc = c.test
          ? transpileExpression(c.test as Expression, opts)
          : null;
        if (testSrc === null) {
          arms.push({ tests: [], stmts: c.consequent, isDefault: true });
        } else if (
          arms.length > 0 &&
          !arms[arms.length - 1]!.isDefault &&
          arms[arms.length - 1]!.stmts.length === 0
        ) {
          // fall-through：把 test 并入空臂，并填入本 case 的语句
          const last = arms[arms.length - 1]!;
          last.tests.push(testSrc);
          last.stmts = c.consequent;
        } else {
          arms.push({ tests: [testSrc], stmts: c.consequent, isDefault: false });
        }
      }
      // 再合并：连续 case 测试共享同一语句列表（case 2: case 3: body）
      const merged: Arm[] = [];
      for (const arm of arms) {
        if (
          merged.length > 0 &&
          merged[merged.length - 1]!.stmts === arm.stmts &&
          !arm.isDefault
        ) {
          merged[merged.length - 1]!.tests.push(...arm.tests);
        } else {
          merged.push({ ...arm, tests: [...arm.tests] });
        }
      }
      const caseLines: string[] = [];
      let defaultSrc: string | null = null;
      for (const arm of merged) {
        const body =
          arm.stmts.map((s) => transpileStatement(s, depth + 2, opts)).join("\n") ||
          `${indent(depth + 2)}return $lit(undefined);`;
        const thunk = `() => {\n${body}\n${indent(depth + 1)}}`;
        if (arm.isDefault) {
          defaultSrc = thunk;
        } else {
          // 多 test 共享体：任一命中（具体值）；抽象时 $switch 会跑全部 case 体并 join
          for (const t of arm.tests) {
            caseLines.push(`{ test: ${t}, run: ${thunk} },`);
          }
        }
      }
      const dflt = defaultSrc ? `, ${defaultSrc}` : "";
      return [
        `${pad}return $switch(${disc}, [`,
        ...caseLines.map((l) => indent(depth + 1) + l),
        `${indent(depth + 1)}]${dflt});`,
      ].join("\n");
    }
    case "TryStatement": {
      const tryBody =
        stmt.block.type === "BlockStatement"
          ? stmt.block.body.map((s) => transpileStatement(s, depth + 1, opts)).join("\n")
          : transpileStatement(stmt.block, depth + 1, opts);
      const lines = [`${pad}try {`, tryBody, `${pad}}`];
      if (stmt.handler) {
        const param =
          stmt.handler.param?.type === "Identifier" ? stmt.handler.param.name : "e";
        const catchTmp = `__nudoE_${stmt.loc?.start.line ?? 0}`;
        const catchBody =
          stmt.handler.body.type === "BlockStatement"
            ? stmt.handler.body.body
                .map((s) => transpileStatement(s, depth + 1, opts))
                .join("\n")
            : transpileStatement(stmt.handler.body, depth + 1, opts);
        lines.push(`${pad}catch (${catchTmp}) {`);
        // 控制流信号：NudoReturn 不是 catch 绑定，必须透传
        lines.push(`${indent(depth + 1)}$rethrowIfNudoReturn(${catchTmp});`);
        lines.push(`${indent(depth + 1)}const ${param} = $catchVal(${catchTmp});`);
        lines.push(catchBody);
        lines.push(`${pad}}`);
      }
      if (stmt.finalizer) {
        const finBody =
          stmt.finalizer.type === "BlockStatement"
            ? stmt.finalizer.body.map((s) => transpileStatement(s, depth + 1, opts)).join("\n")
            : transpileStatement(stmt.finalizer, depth + 1, opts);
        lines.push(`${pad}finally {`);
        lines.push(finBody);
        lines.push(`${pad}}`);
      }
      return lines.join("\n");
    }
    case "ForOfStatement": {
      const iter = transpileExpression(stmt.right as Expression, opts);
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
      };
      const bodyStmts =
        stmt.body.type === "BlockStatement"
          ? stmt.body.body.map((s) => transpileStatement(s, depth + 2, bodyOpts)).join("\n")
          : transpileStatement(stmt.body, depth + 2, bodyOpts);
      const max = opts.maxLoopIters ?? 8;
      return [
        `${pad}$forOf(${iter}, (${bindName}, _i) => {`,
        ...bodyLines,
        bodyStmts,
        `${pad}}, ${max});`,
      ].join("\n");
    }
    case "WhileStatement": {
      const test = transpileExpression(stmt.test, opts);
      const bodyOpts: TranspileOptions = {
        ...opts,
        inLoop: (opts.inLoop ?? 0) + 1,
      };
      const body =
        stmt.body.type === "BlockStatement"
          ? stmt.body.body.map((s) => transpileStatement(s, depth + 1, bodyOpts)).join("\n")
          : transpileStatement(stmt.body, depth + 1, bodyOpts);
      const max = opts.maxLoopIters ?? 8;
      // 顺序形态：body 内对 JS let 赋值即状态；抽象条件靠预算
      return [
        `${pad}// while → $whileSeq (bounded, max=${max})`,
        `${pad}$whileSeq(() => ${test}, () => {`,
        body,
        `${pad}}, ${max});`,
      ].join("\n");
    }
    case "ClassDeclaration": {
      return transpileClass(stmt, depth, opts);
    }
    default:
      return `${pad}/* skip ${stmt.type} */`;
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

  const paramsOf = (m: { params?: unknown[] }): string[] =>
    (m.params ?? []).map((p) => {
      const id = p as { type?: string; name?: string };
      return id?.type === "Identifier" && id.name ? id.name : "_";
    });

  const methodOpts: TranspileOptions = {
    ...opts,
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
      m.key?.type === "Identifier" ? m.key.name : m.key?.type === "StringLiteral" ? String(m.key.value) : "method";
    const params = paramsOf(m);
    const paramList = params.filter((p) => p !== "_").join(", ");
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
    specLines.push(`${indent(depth + 2)}extends: ${JSON.stringify(superName)},`);
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

  return [
    `${pad}const ${name} = $class(${JSON.stringify(name)}, {`,
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
  // ChainExpression 不在 Expression 联合里，先剥一层
  const anyExpr = expr as unknown as { type: string; expression?: Expression };
  if (anyExpr.type === "ChainExpression" && anyExpr.expression) {
    return transpileExpression(anyExpr.expression, opts);
  }
  switch (expr.type) {
    case "NumericLiteral":
    case "StringLiteral":
    case "BooleanLiteral":
      return `$lit(${JSON.stringify(expr.value)})`;
    case "NullLiteral":
      return `$lit(null)`;
    case "Identifier":
      if (expr.name === "undefined") return "$lit(undefined)";
      return expr.name;
    case "ThisExpression":
      return opts.thisParam ?? "$lit(undefined)";
    case "Super":
      return `/* super */`;
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
      const l = transpileExpression(expr.left, opts);
      const r = transpileExpression(expr.right, opts);
      return op === "&&"
        ? `$fork(${l}, () => ${r}, () => ${l})`
        : `$fork(${l}, () => ${l}, () => ${r})`;
    }
    case "ConditionalExpression": {
      const test = transpileExpression(expr.test, opts);
      const c = transpileExpression(expr.consequent, opts);
      const a = transpileExpression(expr.alternate, opts);
      return `$fork(${test}, () => ${c}, () => ${a})`;
    }
    case "RegExpLiteral": {
      return `$regex(${JSON.stringify(expr.pattern)}${expr.flags ? `, ${JSON.stringify(expr.flags)}` : ""})`;
    }
    case "BinaryExpression": {
      const fn = BIN_OPS[expr.operator];
      if (!fn) return `/* unsupported ${expr.operator} */ $lit(undefined)`;
      const l = isExpression(expr.left) ? transpileExpression(expr.left, opts) : "$lit(undefined)";
      const r = isExpression(expr.right) ? transpileExpression(expr.right, opts) : "$lit(undefined)";
      return `${fn}(${l}, ${r})`;
    }
    case "UnaryExpression": {
      const arg = transpileExpression(expr.argument as Expression, opts);
      if (expr.operator === "-") return `$neg(${arg})`;
      if (expr.operator === "!") return `$not(${arg})`;
      if (expr.operator === "typeof") return `$typeof(${arg})`;
      if (expr.operator === "+") return arg;
      return `/* unary ${expr.operator} */ $lit(undefined)`;
    }
    case "UpdateExpression": {
      // i++/++i/i--/--i：按前缀语义重绑（$for step 只取副作用；表达值场景罕见）
      const arg = expr.argument as Expression;
      if (arg.type === "Identifier") {
        const fn = expr.operator === "++" ? "$add" : "$sub";
        return `${arg.name} = ${fn}(${arg.name}, $lit(1))`;
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
          acc = acc === null ? arg : `$spread(${acc}, ${arg})`;
          continue;
        }
        // C3.2：对象方法简写 → $fnVal（方法槽进 shape；闭包捕获外层 let）
        if (prop.type === "ObjectMethod") {
          flushProps();
          const mkey =
            prop.key.type === "Identifier"
              ? JSON.stringify(prop.key.name)
              : prop.key.type === "StringLiteral"
                ? JSON.stringify(prop.key.value)
                : null;
          if (mkey === null) continue;
          const paramNames = (prop.params as Array<{ type: string; name?: string }>).map((p) =>
            p.type === "Identifier" && p.name ? p.name : "_a",
          );
          // 方法体是新的函数边界：inLoop 必须归零，否则 return 泄漏成 $loopReturn
          const methodOpts: TranspileOptions = { ...opts, inLoop: 0 };
          const bodySrc =
            prop.body.type === "BlockStatement"
              ? `{\n${prop.body.body.map((s) => transpileStatement(s, 1, methodOpts)).join("\n")}\n}`
              : transpileExpression(prop.body as unknown as Expression, methodOpts);
          const fnValSrc = `$fnVal([${paramNames.map((p) => JSON.stringify(p)).join(", ")}], (${paramNames.join(", ")}) => ${bodySrc})`;
          props.push(`${mkey}: ${fnValSrc}`);
          continue;
        }
        if (prop.type !== "ObjectProperty") continue;
        // 计算属性 { [expr]: v } → $setKey
        if (prop.computed) {
          flushProps();
          const k = transpileExpression(prop.key as Expression, opts);
          const v = transpileExpression(prop.value as Expression, opts);
          const base = acc === null ? `$obj({})` : acc;
          acc = `$setKey(${base}, ${k}, ${v})`;
          continue;
        }
        const key =
          prop.key.type === "Identifier"
            ? JSON.stringify(prop.key.name)
            : prop.key.type === "StringLiteral"
              ? JSON.stringify(prop.key.value)
              : null;
        if (key === null) continue;
        const valSrc = transpileExpression(prop.value as Expression, opts);
        props.push(`${key}: ${valSrc}`);
      }
      flushProps();
      return acc ?? `$obj({})`;
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
      // [...a, b] → $concat
      let acc: string | null = null;
      for (const el of expr.elements) {
        if (!el) continue;
        let piece: string;
        if (el.type === "SpreadElement") {
          piece = transpileExpression(el.argument as Expression, opts);
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
      const compoundFn = COMPOUND_OPS[expr.operator];
      const right = transpileExpression(expr.right, opts);
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
          const writeSrc = setPathSrc(path, valSrc);
          return `${path.rootSrc} = ${writeSrc}`;
        }
        // 根不可重绑（如 foo().x = v）：保留旧纯表达式形态
        if (!m.computed && m.property.type === "Identifier") {
          const obj = transpileExpression(m.object as Expression, opts);
          return `$set(${obj}, ${JSON.stringify(m.property.name)}, ${right})`;
        }
        if (m.computed) {
          const obj = transpileExpression(m.object as Expression, opts);
          const k = m.property;
          if (k.type === "NumericLiteral") {
            return `$idxSet(${obj}, $lit(${k.value}), ${right})`;
          }
          if (k.type === "StringLiteral") {
            return `$set(${obj}, ${JSON.stringify(k.value)}, ${right})`;
          }
          if (isExpression(k)) {
            return `$idxSet(${obj}, ${transpileExpression(k, opts)}, ${right})`;
          }
        }
        return `/* assign */ $lit(undefined)`;
      }
      if (expr.left.type === "Identifier") {
        if (compoundFn) {
          return `${expr.left.name} = ${compoundFn}(${expr.left.name}, ${right})`;
        }
        return `${expr.left.name} = ${right}`;
      }
      return compoundFn ? `/* assign ${expr.operator} */ $lit(undefined)` : `/* assign */ $lit(undefined)`;
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
      return `${c}(${args})`;
    }
    case "ArrowFunctionExpression":
    case "FunctionExpression": {
      const fn = expr as {
        params: Node[];
        body: Node;
        async?: boolean;
      };
      const { sig, rest, prologue } = emitParamBinding(fn.params, indent(1), opts);
      // 函数边界：return 不是循环提前返回
      const fnBodyOpts: TranspileOptions = { ...opts, inLoop: 0 };
      const paramParts = rest ? [...sig, `...${rest}`] : sig;
      // 一等 fn Abs：参数名进 shape（bridge/dts 可展示）；
      // 异步 body 包 $async 保持 eff(promise) 语义（裸 JS async 会泄漏 Promise）。
      const nameList = `[${sig.map((p) => JSON.stringify(p)).join(", ")}]`;
      if (fn.body.type === "BlockStatement") {
        const inner = [...prologue, transpileFnBodyStmts((fn.body as { body: Statement[] }).body, 1, fnBodyOpts)].join("\n");
        if (fn.async) {
          return `$fnVal(${nameList}, (${paramParts.join(", ")}) => $async(() => {\n${inner}\n}))`;
        }
        return `$fnVal(${nameList}, (${paramParts.join(", ")}) => {\n${inner}\n})`;
      }
      const bodySrc = transpileExpression(fn.body as Expression, fnBodyOpts);
      if (prologue.length > 0) {
        // 表达式体 + 模式参数：提升为块体以容纳解构 prologue
        const thunk = fn.async ? `$async(() => ${bodySrc})` : bodySrc;
        return `$fnVal(${nameList}, (${paramParts.join(", ")}) => {\n${prologue.join("\n")}\n  return ${thunk};\n})`;
      }
      if (fn.async) {
        return `$fnVal(${nameList}, (${paramParts.join(", ")}) => $async(() => ${bodySrc}))`;
      }
      return `$fnVal(${nameList}, (${paramParts.join(", ")}) => ${bodySrc})`;
    }
    default:
      return `/* ${expr.type} */ $lit(undefined)`;
  }
}

/** 解析 + transpile */
export function transpile(source: string, opts?: TranspileOptions): string {
  return transpileSource(source, opts);
}

function isExpression(n: { type: string }): n is Expression {
  return n.type !== "PrivateName" && !n.type.endsWith("Statement") && !n.type.endsWith("Declaration");
}
