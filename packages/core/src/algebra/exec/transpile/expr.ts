/**
 * 表达式发射：transpileExpression / transpileShortCircuitExpr。
 */
import type { Expression, Node, Statement } from "@babel/types";
import type { TranspileOptions } from "./types.ts";
import {
  isExpression,
  matchReplacement,
  fnBodyHasThis,
  fnBodyHasOwnArguments,
  indent,
  litToStringOf,
  staticKeyOf,
  symbolKeyOf,
  paramDisplayNames,
  methodBindNames,
  collectFreeAssignedNames,
  collectForkBindingNames,
  foldRequireSpecArg,
} from "./helpers.ts";
import { BIN_OPS, COMPOUND_OPS, isStatefulMethodName, REGEX_STATEFUL_NAMES } from "./ops.ts";
import { NudoUnsupportedError } from "../unsupported.ts";
import {
  emitArrMutatorRebinds,
  emitDestructure,
  emitParamBinding,
  emitParamBindingFromArgs,
  forkArmThunk,
  forkBindingDecls,
  forkJoinBindings,
} from "./emit.ts";
import { memberPathOf, readPathSrc, setPathSrc, readPrefix, setParentPathSrc } from "./member-path.ts";
import {
  bindTranspileExpression,
  bindTranspileShortCircuit,
} from "./transpile-dispatch.ts";
import {
  transpileStatement,
  transpileFnBodyStmts,
  transpileBlockAsThunk,
  emitFnBlockBody,
  withImplicitReturn,
} from "./stmt.ts";

export function transpileShortCircuitExpr(opts: TranspileOptions, parts: {
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
      if (expr.name === "arguments") {
        // 词法外层 arguments：仅非箭头函数体**直接**引用时建 argsBinding；
        // 箭头沿该绑定继承。无绑定（模块顶层 / 仅嵌套箭头引用）→ 诚实 unknown
        // （差分 harness 外层是箭头 IIFE，native 为 ReferenceError；投影外层
        // arguments 会假精确）。
        return opts.argsBinding ?? "$unknown()";
      }
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
            return symbolKeyOf(prop.key as unknown as Parameters<typeof symbolKeyOf>[0]);
          })();
          if (mkey === null) continue;
          const displayNames = paramDisplayNames(prop.params);
          const bindNames = methodBindNames(prop.params);
          // 方法体是新的函数边界：inLoop/inTry 必须归零；直接引用 arguments 时建槽
          const mHasArgs = fnBodyHasOwnArguments({ body: prop.body as Node });
          const methodOpts: TranspileOptions = {
            ...opts,
            inLoop: 0,
            inTry: 0,
            thisParam: "__this",
            argsBinding: mHasArgs ? "__nudoArgs" : undefined,
          };
          // get/set 访问器：注册进运行时侧表（$get/$set 派发；展开/assign 时调用）
          if (prop.kind === "get" || prop.kind === "set") {
            // 占位槽保键存在性（'x' in o / keys / assign 拷贝目标）；读写在 $get/$set 层派发
            props.push(`${mkey}: $lit(undefined)`);
            if (prop.kind === "get") {
              const bodySrc = `{\n${emitFnBlockBody(prop.body, 1, methodOpts)}\n}`;
              accRegs.push({ key: mkey, get: `(__this) => ${bodySrc}` });
            } else {
              // setter 尾部 return __this——implicitReturn 关闭
              const vname = bindNames.length > 0 && bindNames[0] !== "_a" ? bindNames[0]!.replace(/^\.\.\./, "") : "__v";
              accRegs.push({
                key: mkey,
                set: `(__this, ${vname}) => {\n${emitFnBlockBody(prop.body, 1, methodOpts, { implicitReturn: false })}\nreturn __this;\n}`,
              });
            }
            continue;
          }
          let mBodyInner = emitFnBlockBody(prop.body, 1, methodOpts);
          let mParams = ["__this", ...bindNames];
          if (mHasArgs) {
            const bound = emitParamBindingFromArgs(prop.params as Node[], "  ", methodOpts, "__nudoArgs");
            mBodyInner = [
              `  let __nudoArgs = $arguments(__margs);`,
              ...bound.prologue,
              mBodyInner,
            ].join("\n");
            mParams = ["__this", "...__margs"];
          }
          const bodySrc = `{\n${mBodyInner}\n}`;
          const fnValSrc = `$fnVal([${displayNames.map((p) => JSON.stringify(p)).join(", ")}], (${mParams.join(", ")}) => ${bodySrc}, { bindThis: true })`;
          props.push(`${mkey}: ${fnValSrc}`);
          continue;
        }
        if (prop.type !== "ObjectProperty") continue;
        // 计算属性 { [expr]: v } → $setKey；[Symbol.X] 投影为 "@@X" 字符串槽
        if (prop.computed) {
          flushProps();
          const symK = symbolKeyOf(prop.key as unknown as Parameters<typeof symbolKeyOf>[0]);
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
            const displayNames = paramDisplayNames(fn.params);
            const bindNames = methodBindNames(fn.params);
            const mHasArgs = fnBodyHasOwnArguments({ body: fn.body });
            const methodOpts: TranspileOptions = {
              ...opts,
              inLoop: 0,
              thisParam: "__this",
              argsBinding: mHasArgs ? "__nudoArgs" : undefined,
            };
            let mBodyInner = emitFnBlockBody(fn.body, 1, methodOpts);
            let mParams = ["__this", ...bindNames];
            if (mHasArgs) {
              const bound = emitParamBindingFromArgs(fn.params as Node[], "  ", methodOpts, "__nudoArgs");
              mBodyInner = [
                `  let __nudoArgs = $arguments(__margs);`,
                ...bound.prologue,
                mBodyInner,
              ].join("\n");
              mParams = ["__this", "...__margs"];
            }
            const bodySrc = `{\n${mBodyInner}\n}`;
            props.push(
              `${key}: $fnVal([${displayNames.map((p) => JSON.stringify(p)).join(", ")}], (${mParams.join(", ")}) => ${bodySrc}, { bindThis: true })`,
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
        // conditional = 分支/循环体内（structuralAssignIssues 跳过 conditional）。
        // 逻辑赋值（||= 等）短路分支在前已处理，不记录。
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
      // require.resolve(spec) → 静态说明符字面量（模块身份；非宿主绝对路径）
      // 必须在 obj.method $invoke 分支之前（否则 require.resolve 被吃成 $invoke）
      if (
        callee.type === "MemberExpression" &&
        !callee.computed &&
        callee.object.type === "Identifier" &&
        callee.object.name === "require" &&
        callee.property.type === "Identifier" &&
        callee.property.name === "resolve"
      ) {
        const spec = foldRequireSpecArg(expr.arguments[0]);
        if (spec !== undefined) return `$lit(${JSON.stringify(spec)})`;
        // 动态 resolve：诚实 unknown（不假装某条路径）
        return "$unknown()";
      }
      // require(spec)：可折叠说明符 → __nudoRequire；真动态 → 诚实 unknown
      //（不走 $callNamed("require", …)——那会把未声明 require 当全局调用炸掉）
      if (callee.type === "Identifier" && callee.name === "require") {
        const spec = foldRequireSpecArg(expr.arguments[0]);
        if (spec !== undefined) return `__nudoRequire(${JSON.stringify(spec)})`;
        return "$unknown()";
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
        const calleeRef = opts.lenientGlobals
          ? `(typeof ${callee.name} !== "undefined" ? ${callee.name} : undefined)`
          : callee.name;
        return `$callNamed(${JSON.stringify(callee.name)}, ${calleeRef}, [${argSrcs.join(", ")}]${locArg}${argLocArg})`;
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
      // 非箭头且体直接引用 arguments：建独立 tuple 槽。箭头不建槽（沿外层
      // argsBinding；无绑定 → $unknown()，见 Identifier 分支）。
      const hasArgs = !isArrow && fnBodyHasOwnArguments(fn);
      const { sig, rest, prologue } = emitParamBinding(fn.params, indent(1), opts);
      // 函数边界：return 不是循环提前返回；非箭头清掉外层 argsBinding
      const fnBodyOpts: TranspileOptions = {
        ...opts,
        inLoop: 0,
        inFunction: true,
        ...(hasThis ? { thisParam: "__this" } : {}),
        ...(isArrow ? {} : { argsBinding: hasArgs ? "__nudoArgs" : undefined }),
      };
      const paramParts = rest ? [...sig, `...${rest}`] : sig;
      // 一等 fn Abs：参数名进 shape（bridge/dts 可展示）——用展示名（含 rest/默认参），
      // 不是宿主绑定 sig（默认参是 `_p{i}` 占位，rest 不在 sig 里）。
      // 异步 body 包 $async 保持 eff(promise) 语义（裸 JS async 会泄漏 Promise）。
      const nameList = `[${paramDisplayNames(fn.params).map((p) => JSON.stringify(p)).join(", ")}]`;
      const thisPrologue = hasThis ? [`const __this = $rawThis(this);`] : [];
      // FunctionExpression 无宿主 this 时编成箭头（无真实 arguments）——需要
      // arguments 时改收 `(...__allArgs)`，从 $arguments 槽绑定形参（strict 独立）。
      const useArgsSlot = hasArgs && !hasThis;
      let argsSlotPrologue: string[] = [];
      let argsParamParts = paramParts;
      if (useArgsSlot) {
        const bound = emitParamBindingFromArgs(fn.params, "  ", fnBodyOpts, "__nudoArgs");
        argsSlotPrologue = [`  let __nudoArgs = $arguments(__allArgs);`, ...bound.prologue];
        argsParamParts = ["...__allArgs"];
      } else if (hasArgs && hasThis) {
        // 真实 function 包装：宿主 arguments 直接投影
        argsSlotPrologue = [`  let __nudoArgs = $arguments(arguments);`];
      }
      const allPrologue = useArgsSlot
        ? [...argsSlotPrologue, ...thisPrologue]
        : [...prologue, ...thisPrologue, ...argsSlotPrologue];
      if (fn.body.type === "BlockStatement") {
        const inner = withImplicitReturn(
          fn.body,
          [...allPrologue, transpileFnBodyStmts((fn.body as { body: Statement[] }).body, 1, fnBodyOpts)].join("\n"),
          1,
        );
        if (hasThis) {
          const wrap = fn.async
            ? `function (${argsParamParts.join(", ")}) { return $async(() => {\n${inner}\n}); }`
            : `function (${argsParamParts.join(", ")}) {\n${inner}\n}`;
          return `$fnVal(${nameList}, ${wrap})`;
        }
        if (fn.async) {
          return `$fnVal(${nameList}, (${argsParamParts.join(", ")}) => $async(() => {\n${inner}\n}))`;
        }
        return `$fnVal(${nameList}, (${argsParamParts.join(", ")}) => {\n${inner}\n})`;
      }
      const bodySrc = transpileExpression(fn.body as Expression, fnBodyOpts);
      if (allPrologue.length > 0 || hasThis) {
        // 表达式体 + 模式参数/this 注入：提升为块体以容纳 prologue
        const rebinds = emitArrMutatorRebinds(fn.body as Expression, fnBodyOpts, "  ");
        const inner = [
          ...allPrologue,
          ...rebinds.map((l) => `  ${l}`),
          `  return ${fn.async ? `$async(() => ${bodySrc})` : bodySrc};`,
        ].join("\n");
        if (hasThis) {
          const wrap = `function (${argsParamParts.join(", ")}) {\n${inner}\n}`;
          return `$fnVal(${nameList}, ${wrap})`;
        }
        return `$fnVal(${nameList}, (${argsParamParts.join(", ")}) => {\n${inner}\n})`;
      }
      // 表达式体：块体包裹跑语句级 rebind pass——`()=>n++` / `()=>a.push(1)`
      // 的写回此前静默丢失（表达式上下文无语句级扫描）
      const rebinds = emitArrMutatorRebinds(fn.body as Expression, fnBodyOpts, "  ");
      if (rebinds.length > 0) {
        const inner = [
          ...rebinds.map((l) => `  ${l}`),
          `  return ${fn.async ? `$async(() => ${bodySrc})` : bodySrc};`,
        ].join("\n");
        return `$fnVal(${nameList}, (${argsParamParts.join(", ")}) => {\n${inner}\n})`;
      }
      if (fn.async) {
        return `$fnVal(${nameList}, (${argsParamParts.join(", ")}) => $async(() => ${bodySrc}))`;
      }
      return `$fnVal(${nameList}, (${argsParamParts.join(", ")}) => ${bodySrc})`;
    }
    case "MetaProperty":
      // import.meta → { url: string }（宿主 URL 非字面量）
      return "$importMeta()";
    case "ImportExpression": {
      // import(spec) → Promise<open module namespace>
      const specSrc = transpileExpression(expr.source as Expression, opts);
      return `$dynamicImport(${specSrc})`;
    }
    case "JSXElement":
    case "JSXFragment":
      // JSX 未 lowering：显式 unknown（不假精确 undefined），文件其余
      // 构造保持 B-hosted——不再整文件 fail-closed
      return "$unknown()";
    default:
      // 未 lowering 的表达式：
      // 静默折 $lit(undefined) 是假精确——抛 unsupported 交消费方回落
      throw new NudoUnsupportedError(
        `expression:${expr.type}`,
        expr.loc ? { line: expr.loc.start.line, column: expr.loc.start.column } : undefined,
      );
  }
}

// Register leaf dispatch so stmt/emit/member-path need not import this module.
bindTranspileExpression(transpileExpression);
bindTranspileShortCircuit(transpileShortCircuitExpr);
