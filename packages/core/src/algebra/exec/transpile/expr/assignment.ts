/**
 * 赋值族发射（expr 按域拆分之一；主分派在 ./transpile.ts）。
 *
 * 不变量：
 * - 赋值表达式值 = 写入的值（JS 语义；$set/$idxSet 返回容器不是）；
 * - 成员写以「读-改-写」链重绑根绑定（member-path 不可变更新链）；根不可
 *   重绑（foo().x = v）保留旧纯表达式形态；
 * - 逻辑赋值走 ./short-circuit.ts 短路协议，不可写回目标 unsupported
 *   （fail-closed sound）；
 * - const 绑定再赋值 → $throwConstAssign()（strict/ESM TypeError）；
 * - 标识符赋值记 $assignRecord（checkSource assign-mismatch 通道），prev
 *   读在写前。
 */
import type { Expression, Node, AssignmentExpression } from "@babel/types";
import type { TranspileOptions } from "../types.ts";
import { isExpression, symbolKeyOf, privateNameKeySrc, isConstAssignTarget, withClassNameHint } from "../helpers.ts";
import { COMPOUND_OPS } from "../ops.ts";
import { NudoUnsupportedError } from "../../unsupported.ts";
import { emitDestructure } from "../emit.ts";
import { memberPathOf, readPathSrc, setPathSrc } from "../member-path.ts";
import { emitTranspileExpression as transpileExpression } from "../transpile-dispatch.ts";
import { transpileShortCircuitExpr } from "./short-circuit.ts";
/**
 * 赋值族：解构赋值、逻辑赋值（||=//&&=/??=）、memberPath 不可变更新链写回、
 * super 写（静态/实例/home object）、标识符赋值与 const 守卫。
 */
export function transpileAssignmentExpr(
  expr:
    | AssignmentExpression,
  opts: TranspileOptions = {},
): string {
  switch (expr.type) {
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
      // Bug 133：NamedEvaluation——`K = class {}`（左值是**标识符**）以绑定名
      // 为类名；成员左值（`o.K = class {}`）不取名（原生同名）。
      const right = transpileExpression(
        expr.right,
        expr.left.type === "Identifier"
          ? withClassNameHint(opts, expr.right, (expr.left as { name: string }).name)
          : opts,
      );
      const op = expr.operator;
      if (op === "||=" || op === "&&=" || op === "??=") {
        const rNode = expr.right as Node;
        /**
         * 逻辑赋值的短路 fork（标识符臂）。
         *
         * 标识符臂的写回是「写同一个值」（truthy → 保留原值 / falsy → 写
         * right），对数据绑定不可观测——保持既有形态（写回在 fork 之外）。
         * const 绑定另有分支（真写入抛 TypeError）。
         */
        const identFork = (targetSrc: string): string => {
          if (op === "||=") {
            // truthy → keep left；falsy → rhs
            return transpileShortCircuitExpr(opts, {
              alwaysNodes: [],
              alwaysSrc: targetSrc,
              consSrc: "__test",
              consNodes: [],
              altSrc: right,
              altNodes: [rNode],
            });
          }
          if (op === "&&=") {
            // truthy → rhs；falsy → keep left
            return transpileShortCircuitExpr(opts, {
              alwaysNodes: [],
              alwaysSrc: targetSrc,
              consSrc: right,
              consNodes: [rNode],
              altSrc: "__test",
              altNodes: [],
            });
          }
          // ??= : nullish → rhs；否则 keep left
          // Bug 134：test / alt 引用左操作数的**单次求值绑定**（leftRef）——
          // 不得各自再发一份左操作数源码（成员读 / getter 跑两次）。
          return transpileShortCircuitExpr(opts, {
            alwaysNodes: [],
            alwaysSrc: targetSrc,
            consSrc: right,
            consNodes: [rNode],
            altOf: (leftRef) => `$removeNullish(${leftRef})`,
            altNodes: [],
            testOf: (leftRef) => `$nullishTest(${leftRef})`,
          });
        };
        /**
         * 逻辑赋值的短路 fork（成员臂）——Bug 138。
         *
         * 原生语义：只有**实际写入的分支**发生 PutValue——`o.a ||= 2` 在
         * 左侧为真值时**不写**（不触发 setter、只读访问器不抛）。
         *
         * 修前写回包在整个 fork 结果之外（`setSrc(sc)`）——「保留原值」臂
         * 也照样走一次 $set：只读访问器假抛 TypeError（门禁假红）、带 setter
         * 的属性 setter 被多调一次。
         *
         * 修法：写回下沉到**写入臂**内，「保留原值」臂只返回读值；写回根
         * 进 fork 绑定集（extraBindingNames）——臂内写经 fork 绑定-join
         * 协议收口（两臂都跑时不得让后跑臂覆盖先跑臂的写）。
         */
        const memberFork = (
          targetSrc: string,
          targetNode: Node,
          rootName: string | null,
          writeArm: (val: string) => string,
        ): string => {
          const common = {
            alwaysNodes: [] as Array<Node | null | undefined>,
            alwaysSrc: targetSrc,
            leftNode: targetNode,
            ...(rootName ? { extraBindingNames: [rootName] } : {}),
          };
          if (op === "||=") {
            // truthy → 保留原值（**不写**）；falsy → 写 right
            return transpileShortCircuitExpr(opts, {
              ...common,
              consSrc: "__test",
              consNodes: [],
              altSrc: writeArm(right),
              altNodes: [rNode],
            });
          }
          if (op === "&&=") {
            // truthy → 写 right；falsy → 保留原值（**不写**）
            return transpileShortCircuitExpr(opts, {
              ...common,
              consSrc: writeArm(right),
              consNodes: [rNode],
              altSrc: "__test",
              altNodes: [],
            });
          }
          // ??= : nullish → 写 right；非 nullish → 保留原值（**不写**）
          return transpileShortCircuitExpr(opts, {
            ...common,
            consSrc: writeArm(right),
            consNodes: [rNode],
            altOf: (leftRef) => `$removeNullish(${leftRef})`,
            altNodes: [],
            testOf: (leftRef) => `$nullishTest(${leftRef})`,
          });
        };
        if (expr.left.type === "Identifier") {
          // 逻辑赋值真正写入 const 绑定 → TypeError。
          // 短路（保持原值）不抛；无法判定时保守抛（可能写入）。
          if (isConstAssignTarget((expr.left as { name: string }).name, opts)) {
            const lhs = (expr.left as { name: string }).name;
            // ||= 仅当左侧真值时跳过写；&&= 仅当假值时跳过；??= 仅当非 nullish 时跳过
            const skipsWrite =
              op === "||="
                ? `$litTruth(${lhs}) === true`
                : op === "&&="
                  ? `$litTruth(${lhs}) === false`
                  : `$litTruth($nullishTest(${lhs})) === false`;
            return `((${lhs}) => { if (!(${skipsWrite})) $throwConstAssign(); return ${lhs}; })(${lhs})`;
          }
          const lhs = (expr.left as { name: string }).name;
          return `${lhs} = ${identFork(lhs)}`;
        }
        if (expr.left.type === "MemberExpression") {
          const m = expr.left as unknown as {
            object: Node;
            property: Node;
            computed: boolean;
          };
          const path = memberPathOf(m, opts);
          if (path) {
            const rootName = writeBackRootName(m, opts);
            return memberFork(
              readPathSrc(path),
              expr.left as unknown as Node,
              rootName,
              // 表达式值 = 写入的值；$set 返回容器不是 JS 语义
              (val) => `((__v) => { ${path.rootTarget} = ${setPathSrc(path, "__v")}; return __v; })(${val})`,
            );
          }
          // Bug 80：this.#x ||= v / &&= / ??=——memberPathOf 对 PrivateName
          // 返回 null，此前落 assign:||= unsupported 令整模块 fail-closed。
          // 复用短路协议：读 $get(obj,"#x")，短路写落同一混淆键槽
          //（与下方普通/复合私有名赋值分支同口径）
          if (!m.computed && m.property.type === "PrivateName") {
            const key = privateNameKeySrc(
              m.property as { id?: { name?: string }; name?: string },
            );
            if (key !== null) {
              const obj = transpileExpression(m.object as Expression, opts);
              // 私有名槽是**就地**写（$set 不重绑根）——无 fork 绑定可收口；
              // 写臂内就地写、保留臂不写（Bug 138：只读访问器不得假抛）。
              return memberFork(
                `$get(${obj}, ${key})`,
                expr.left as unknown as Node,
                null,
                (val) => `((__v) => (($set(${obj}, ${key}, __v)), __v))(${val})`,
              );
            }
          }
        }
        // 逻辑赋值不可写回目标（如 foo().x ||= v）：折 undefined 是假精确
        throw new NudoUnsupportedError(
          `assign:${op}`,
          expr.loc ? { line: expr.loc.start.line, column: expr.loc.start.column } : undefined,
        );
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
          return `((__v) => { ${path.rootTarget} = ${setPathSrc(path, "__v")}; return __v; })(${valSrc})`;
        }
        // R5：静态方法体 super.k = v（staticSuperSrc + thisParam + className
        // 同时在）——SetSuper 静态面：父类静态 setter 派发，数据字段/缺槽
        // → 接收者（this = 调用类值）自有写。此前落通用 $set(父类) 把写
        // 错挂到父类槽（原生 CreateDataProperty on this）。复合赋值读沿
        // 父类静态面（super.x += 5 读 A.x、写 B.x）。
        if (
          m.object.type === "Super" &&
          opts.staticSuperSrc &&
          opts.thisParam &&
          opts.className
        ) {
          const keySrc = m.computed
            ? transpileExpression(m.property as Expression, opts)
            : `$lit(${JSON.stringify((m.property as { name: string }).name)})`;
          const setCall = `$setSuperStatic(${opts.thisParam}, ${JSON.stringify(opts.className)}, ${keySrc}, __v)`;
          // 复合读沿父类静态面（$get 收字符串键；计算键经 $idx 收 Abs）
          const readSrc = m.computed
            ? `$idx(${opts.staticSuperSrc}, ${keySrc})`
            : `$get(${opts.staticSuperSrc}, ${JSON.stringify((m.property as { name: string }).name)})`;
          const valSrc = compoundFn ? `${compoundFn}(${readSrc}, ${right})` : right;
          return `((__v) => ((${setCall}), __v))(${valSrc})`;
        }
        // Bug 55：super.k = v / super[k] = v（实例方法/构造器）——此前裸发
        // `/* super */` 注释哨兵（$set(, "x", v)）→ 宿主硬 SyntaxError。
        // SetSuper：父类原型链 setter 派发，无 setter → 接收者写；对象
        // 字面量方法（无 className）走 home object 面 $setSuperObj。静态
        // 方法体不拦截（静态面在上方 R5 分支处理）。
        if (m.object.type === "Super" && !opts.staticSuperSrc) {
          const recv = opts.thisParam ?? "__this";
          const keySrc = m.computed
            ? transpileExpression(m.property as Expression, opts)
            : `$lit(${JSON.stringify((m.property as { name: string }).name)})`;
          const setCall = opts.className
            ? `$setSuper(${recv}, ${JSON.stringify(opts.className)}, ${keySrc}, __v)`
            : `$setSuperObj(${recv}, ${keySrc}, __v)`;
          // 复合赋值（super.x += 5）：读-改-写——读沿 super 链（$getSuper）
          const readSrc = opts.className
            ? `$getSuper(${recv}, ${JSON.stringify(opts.className)}, ${keySrc})`
            : `$getSuperObj(${recv}, ${keySrc})`;
          const valSrc = compoundFn ? `${compoundFn}(${readSrc}, ${right})` : right;
          return `((__v) => ((${setCall}), __v))(${valSrc})`;
        }
        // 根不可重绑（如 foo().x = v）：保留旧纯表达式形态；
        // 表达式值 = 写入的值（$set/$idxSet 返回容器不是 JS 语义）
        if (!m.computed && m.property.type === "PrivateName") {
          // Bug 78：this.#x = v → "#x" 混淆键槽写；Bug 81：复合赋值
          // （this.#x += 1）此前无视 compoundFn 直发右值（假精确），修为
          // 读-改-写（镜像 memberPath 臂）；逻辑赋值已在上方对不可重绑
          // 目标抛 unsupported（fail-closed sound），不落本分支
          const obj = transpileExpression(m.object as Expression, opts);
          const key = privateNameKeySrc(
            m.property as { id?: { name?: string }; name?: string },
          );
          if (!key) {
            throw new NudoUnsupportedError(
              `assign-target`,
              expr.loc ? { line: expr.loc.start.line, column: expr.loc.start.column } : undefined,
            );
          }
          const cur = `$get(${obj}, ${key})`;
          const valSrc = compoundFn ? `${compoundFn}(${cur}, ${right})` : right;
          return `((__v) => (($set(${obj}, ${key}, __v)), __v))(${valSrc})`;
        }
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
            // [Symbol.X] = v → "@@X" 字符串槽写（镜像成员读 / 对象字面量计算键
            // 的投影口径——`ai[Symbol.asyncIterator] = fn` 必须落成可识别槽，
            // 否则 for await 的异步可迭代性不可见，Bug 13）
            const symK = symbolKeyOf(k as unknown as Parameters<typeof symbolKeyOf>[0]);
            if (symK !== null) {
              // Bug 73：symbol 键投影写打 Slot.symbolKey 标记（JSON 枚举面不可见）
              return `((__v) => (($set(${obj}, ${symK}, __v, { symbolKey: true })), __v))(${right})`;
            }
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
        // const 绑定再赋值：strict/ESM 下 Assignment to constant variable
        if (isConstAssignTarget(name, opts)) {
          return `$throwConstAssign()`;
        }
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
  }
}

/**
 * 成员路径**写回根**的自由变量名——逻辑赋值的写入臂在臂内改写根绑定，
 * 根必须进 fork 绑定集（fork 绑定-join 协议）才不会被另一臂的写覆盖。
 *
 * `this` 根取 transpile 的 this 形参名；`arguments` 根取 argsBinding；
 * 普通标识符取其名；不可重绑的根（调用结果 / new 表达式）返回 null。
 */
function writeBackRootName(
  m: { object: Node; property: Node; computed: boolean },
  opts: TranspileOptions,
): string | null {
  let cur: Node = m as unknown as Node;
  while (cur.type === "MemberExpression") {
    cur = (cur as unknown as { object: Node }).object;
  }
  if (cur.type === "Identifier") {
    const name = (cur as unknown as { name: string }).name;
    if (name === "arguments") return opts.argsBinding ?? null;
    return name;
  }
  if (cur.type === "ThisExpression") return opts.thisParam ?? null;
  return null;
}
