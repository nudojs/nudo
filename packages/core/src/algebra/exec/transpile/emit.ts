/**
 * 模式解构 / 形参绑定 / 数组 mutator 重绑 / fork 臂 thunk。
 * 发射时经 transpile-dispatch 调 transpileExpression（避免与 expr.ts 成环）。
 */
import type { Statement, Expression, Node } from "@babel/types";
import type { TranspileOptions } from "./types.ts";
import { emitTranspileExpression } from "./transpile-dispatch.ts";
import { isExpression, foldRequireSpecArg, staticKeyOf } from "./helpers.ts";
import { ARR_MUTATOR_NAMES } from "./ops.ts";
import { memberPathOf, readPathSrc, setPathSrc, readPrefix, setParentPathSrc } from "./member-path.ts";

export function emitArrMutatorRebinds(
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
              ? emitTranspileExpression(a as Expression, opts)
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
            : emitTranspileExpression(a, opts),
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
          ? emitTranspileExpression(m.property as Expression, opts)
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

export function emitDestructure(
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
        const def = emitTranspileExpression(prop.value.right as Expression, opts);
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
        const def = emitTranspileExpression(el.right as Expression, opts);
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
export function emitParamBinding(
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
      const def = emitTranspileExpression(p.right as Expression, opts);
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

/**
 * 从 `$arguments` 槽（`__nudoArgs`）绑定形参——FunctionExpression 走
 * `(...__allArgs)` 收齐全量实参时用。Identifier/默认参/解构/rest 与
 * emitParamBinding 同语义，但读 `$idx(__nudoArgs, i)` 而不是 JS 形参。
 * 返回 rest 名与 prologue；namedCount 供 $arrRest 切片。
 */
export function emitParamBindingFromArgs(
  params: Node[],
  pad: string,
  opts: TranspileOptions,
  argsSrc: string,
): { prologue: string[]; rest?: string; namedCount: number } {
  const prologue: string[] = [];
  let rest: string | undefined;
  let namedCount = 0;
  params.forEach((p, i) => {
    if (p.type === "RestElement") {
      if (p.argument.type === "Identifier") {
        rest = p.argument.name;
      } else {
        rest = `_rest${i}`;
        emitDestructure(p.argument, rest, "const", pad, opts, prologue, { n: 0 });
      }
      return;
    }
    namedCount++;
    const idxSrc = `$idx(${argsSrc}, $lit(${i}))`;
    if (p.type === "Identifier") {
      prologue.push(`${pad}let ${p.name} = ${idxSrc};`);
      return;
    }
    if (p.type === "AssignmentPattern") {
      const def = emitTranspileExpression(p.right as Expression, opts);
      if (p.left.type === "Identifier") {
        prologue.push(`${pad}let ${p.left.name} = $orDefault(${idxSrc}, () => ${def});`);
      } else {
        const t = `_pd${i}`;
        prologue.push(`${pad}let ${t} = $orDefault(${idxSrc}, () => ${def});`);
        emitDestructure(p.left, t, "const", pad, opts, prologue, { n: 0 });
      }
      return;
    }
    if (p.type === "ObjectPattern" || p.type === "ArrayPattern") {
      emitDestructure(p, idxSrc, "let", pad, opts, prologue, { n: 0 });
    }
  });
  if (rest) {
    prologue.push(`${pad}let ${rest} = $arrRest(${argsSrc}, ${namedCount});`);
  }
  return { prologue, rest, namedCount };
}

/** 收集语句/表达式里以 Identifier 为 receiver 的数组 mutator 名 */

export function forkArmThunk(
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
export function forkBindingDecls(names: string[], pad = ""): string[] {
  return names.flatMap((n) => [
    `${pad}const __fk0_${n} = $copy(${n});`,
    `${pad}let __fk1_${n}; let __fk2_${n};`,
    `${pad}let __fk1_set_${n} = false; let __fk2_set_${n} = false;`,
  ]);
}

/** fork 后把各臂结束态 join 回绑定（仅 join **未**以 return/throw 退出的臂） */
export function forkJoinBindings(names: string[], pad = ""): string[] {
  return names.map(
    (n) =>
      `${pad}${n} = (__fk1_set_${n} && __fk2_set_${n}) ? $join(__fk1_${n}, __fk2_${n}) : (__fk1_set_${n} ? __fk1_${n} : (__fk2_set_${n} ? __fk2_${n} : ${n}));`,
  );
}

/**
 * 可选 require 模式：`try { m = require(A); } catch { m = require(B); }`
 * 两侧说明符都可常量折叠时返回 [A, B]（优先成功侧）；否则 null（走诚实 try/catch）。
 */
export function matchOptionalRequire(stmt: {
  block?: unknown;
  handler?: { body?: unknown } | null;
}): { name: string; specs: [string, string]; locLine: number; locCol: number } | null {
  const takeAssign = (bodyNode: unknown): { name: string; spec: string } | null => {
    if (!bodyNode || typeof bodyNode !== "object") return null;
    const b = bodyNode as { type?: string; body?: unknown[]; expression?: unknown };
    let expr: unknown;
    if (b.type === "BlockStatement") {
      if (!Array.isArray(b.body) || b.body.length !== 1) return null;
      const s = b.body[0] as { type?: string; expression?: unknown } | undefined;
      if (!s || s.type !== "ExpressionStatement") return null;
      expr = s.expression;
    } else if (b.type === "ExpressionStatement") {
      expr = b.expression;
    } else {
      return null;
    }
    const a = expr as {
      type?: string;
      operator?: string;
      left?: { type?: string; name?: string };
      right?: {
        type?: string;
        callee?: { type?: string; name?: string };
        arguments?: unknown[];
      };
    } | null;
    if (!a || a.type !== "AssignmentExpression" || a.operator !== "=") return null;
    if (a.left?.type !== "Identifier" || !a.left.name) return null;
    const call = a.right;
    if (!call || call.type !== "CallExpression") return null;
    if (call.callee?.type !== "Identifier" || call.callee.name !== "require") return null;
    const spec = foldRequireSpecArg(call.arguments?.[0]);
    if (spec === undefined) return null;
    return { name: a.left.name, spec };
  };
  if (!stmt.block || !stmt.handler) return null;
  const tryA = takeAssign(stmt.block);
  const catchA = takeAssign(stmt.handler.body);
  if (!tryA || !catchA || tryA.name !== catchA.name) return null;
  const loc = (stmt as { loc?: { start: { line: number; column: number } } }).loc;
  return {
    name: tryA.name,
    specs: [tryA.spec, catchA.spec],
    locLine: loc?.start.line ?? 0,
    locCol: loc?.start.column ?? 0,
  };
}

/**
 * catch 体是否可能 rethrow：任意深度语句位置出现 ThrowStatement 即视为
 * 可能（条件 throw 保守按可能算，与 evalTry 的 catchR.threw 口径一致）；
 * 不降入嵌套函数/箭头/类方法体（其 throw 不构成本 catch 的 rethrow）。
 */
export function catchMayRethrow(handler: { body: Node }): boolean {
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
