/**
 * 赋值族发射（expr 按域拆分之一；主分派在 ./transpile.ts）。
 *
 * 不变量：
 * - 赋值表达式值 = 写入的值（JS 语义；$set/$idxSet 返回容器不是）；
 * - **求值顺序 = 原生**（Bug 136）：引用（对象 + 各层键 + 中间层取值）先求值，
 *   RHS 后求值；计算键只求值一次（读/写共用同一绑定）；
 * - **[[Set]] 只落末层**（Bug 190）：中间层只取值，不写回根（原生不对中间层
 *   做 [[Set]]——访问器中间层不得被写）；根不可重绑（foo().x = v）保留旧纯
 *   表达式形态（对象/键作 IIFE 实参 ⇒ 仍先于 RHS）；
 * - 逻辑赋值走 ./short-circuit.ts 短路协议，不可写回目标 unsupported
 *   （fail-closed sound）；
 * - const 绑定再赋值 → $throwConstAssign()（strict/ESM TypeError）；
 * - 标识符赋值记 $assignRecord（checkSource assign-mismatch 通道），prev
 *   读在写前。
 */
import type { Expression, Node, AssignmentExpression } from "@babel/types";
import type { TranspileOptions } from "../types.ts";
import { isExpression, symbolKeyOf, privateNameKeySrc, isConstAssignTarget, withClassNameHint, internalTmpName, internalTmpNameSet } from "../helpers.ts";
import { COMPOUND_OPS } from "../ops.ts";
import { NudoUnsupportedError } from "../../unsupported.ts";
import { emitDestructure } from "../emit.ts";
import { memberPathOf, readPathSrc, memberWriteIfe, memberReadModifyWriteIfe } from "../member-path.ts";
import { emitTranspileExpression as transpileExpression } from "../transpile-dispatch.ts";
import { transpileShortCircuitExpr } from "./short-circuit.ts";
/**
 * 赋值族：解构赋值、逻辑赋值（||=//&&=/??=）、memberPath 不可变更新链写回、
 * super 写（静态/实例/home object）、标识符赋值与 const 守卫。
 */
/**
 * Bug 1151-c：赋值 IIFE 形参载体（**基名**）——实际名经 `internalTmpName`
 * 分配（避开用户标识符词形）。
 *
 * 赋值 IIFE 形态 `((__v) => {…return ${name} = __v; })(${valSrc})`——
 * **IIFE 体内求值用户表达式**（写目标 `${name}` / super 的计算键 `${keySrc}`）
 * ⇒ 写死名 `__v` 会**遮蔽**用户同名绑定 ⇒
 * - **写目标被吃掉**：`let __v = 1; __v = 5;` ⇒ 体内 `__v = __v` 写的是
 *   形参 ⇒ 用户绑定**根本没被写回**（原生 5 / 引擎 1 ⇒ 自信错值 ⇒ 假绿）；
 * - **super 计算键被吃掉**：`super[__v] = 1` ⇒ 键表达式被内插进 IIFE 体内
 *   ⇒ 读到形参（= 赋值）而非用户绑定（原生 "5" / 引擎 "1"）。
 *
 * 口径与 Bug 1058/1059 / 1127 / 1146 / 1149 / 1151-a **同款**
 * （`userIdentInfoOf(opts)` = 源文本词形 ∪ `opts.userIdents`；撞名加 `_k`
 * 后缀）⇒ **无碰撞时基名原样返回 ⇒ 产物逐字不变**。
 *
 * ⚠ **实参面不遮蔽**：IIFE 实参（`${valSrc}`）在 IIFE **作用域外**求值 ⇒
 * RHS 读用户同名绑定不受影响 ⇒ 实参位**保持原样**（不重命名、不改语义）。
 */
const ASSIGN_V_BASE = "__v";

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
      // Bug 1151-c：赋值 IIFE 形参载体避开用户标识符（写目标 / super 计算键
      // 在 IIFE **体内**求值 ⇒ 写死名会遮蔽用户同名绑定 ⇒ 自信错值）。
      const assignV = internalTmpName(ASSIGN_V_BASE, opts);
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
              // Bug 190：写回只落**末层**（中间层是访问器时不得写回根——
              // 原生写的是 getter 返回的对象，绝不对访问器层做 [[Set]]）。
              (val) => memberWriteIfe(path, val),
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
                (val) => `((${assignV}) => (($set(${obj}, ${key}, ${assignV})), ${assignV}))(${val})`,
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
          // Bug 136：引用（根 + 各层键 + 中间层取值）**先**求值、RHS **后**
          // 求值（原生顺序：EvaluatePropertyAccess → GetValue → RHS → PutValue）；
          // 计算键只求值一次（读/写共用同一绑定）。
          // Bug 190：[[Set]] 只落**末层**——中间层只取值，不再写回根
          // （原生不对中间层做 [[Set]]：访问器中间层不得被写）。
          if (compoundFn) {
            // 复合赋值：读-改-写（旧值读在 RHS 之前——原生 GetValue → RHS）
            return memberReadModifyWriteIfe(path, {
              newValueOf: (old) => `${compoundFn}(${old}, ${right})`,
            });
          }
          // 表达式值 = 写入的值（JS 语义）
          return memberWriteIfe(path, right);
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
          const setCall = `$setSuperStatic(${opts.thisParam}, ${JSON.stringify(opts.className)}, ${keySrc}, ${assignV})`;
          // 复合读沿父类静态面（$get 收字符串键；计算键经 $idx 收 Abs）
          const readSrc = m.computed
            ? `$idx(${opts.staticSuperSrc}, ${keySrc})`
            : `$get(${opts.staticSuperSrc}, ${JSON.stringify((m.property as { name: string }).name)})`;
          const valSrc = compoundFn ? `${compoundFn}(${readSrc}, ${right})` : right;
          return `((${assignV}) => ((${setCall}), ${assignV}))(${valSrc})`;
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
            ? `$setSuper(${recv}, ${JSON.stringify(opts.className)}, ${keySrc}, ${assignV})`
            : `$setSuperObj(${recv}, ${keySrc}, ${assignV})`;
          // 复合赋值（super.x += 5）：读-改-写——读沿 super 链（$getSuper）
          const readSrc = opts.className
            ? `$getSuper(${recv}, ${JSON.stringify(opts.className)}, ${keySrc})`
            : `$getSuperObj(${recv}, ${keySrc})`;
          const valSrc = compoundFn ? `${compoundFn}(${readSrc}, ${right})` : right;
          return `((${assignV}) => ((${setCall}), ${assignV}))(${valSrc})`;
        }
        // 根不可重绑（如 foo().x = v）：保留旧纯表达式形态；
        // 表达式值 = 写入的值（$set/$idxSet 返回容器不是 JS 语义）
        //
        // Bug 136：对象表达式与计算键**先于 RHS** 求值（原生顺序：对象 →
        // 键 → RHS）——对象/键作 IIFE 实参（外层作用域求值），RHS 落体内。
        //
        // 注：私有名臂（this.#x）**保留旧形态**——对象恒为 `this`（无副作用，
        // 顺序不可观测），且旧形态被 eval-class-body 的形状断言钉住
        // （"复合赋值是 read-modify-write，私有名键一致"）。
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
          return `((${assignV}) => (($set(${obj}, ${key}, ${assignV})), ${assignV}))(${valSrc})`;
        }
        // Bug 1127：内部临时名（`__nudoMpObj` / `__nudoMpKey` / `__nudoMpVal` /
        // `__nudoMpOld`）**避开用户标识符**——本 IIFE 在**自身作用域**里求值
        // RHS（用户表达式）⇒ 写死名会遮蔽用户同名绑定（读成引擎临时量 ⇒
        // 自信的错值；同名 `const` ⇒ TDZ ReferenceError）。
        // 口径同 Bug 1058/1059（`internalTmpNameSet` = 源文本词形 ∪
        // `opts.userIdents` 避让 + `_k` 后缀）⇒ 无碰撞时基名原样返回。
        const mpNames = internalTmpNameSet(
          ["__nudoMpObj", "__nudoMpKey", "__nudoMpVal", "__nudoMpOld"],
          opts,
        );
        const mpObj = mpNames[0]!;
        const mpKey = mpNames[1]!;
        const mpVal = mpNames[2]!;
        const mpOld = mpNames[3]!;
        if (!m.computed && m.property.type === "Identifier") {
          const obj = transpileExpression(m.object as Expression, opts);
          const key = JSON.stringify(m.property.name);
          if (!compoundFn) {
            return `((${mpObj}) => { const ${mpVal} = ${right}; ($set(${mpObj}, ${key}, ${mpVal})); return ${mpVal}; })(${obj})`;
          }
          // 族 57 第 8 条：复合赋值（`mk().x += 2`）此前**丢 compoundFn** ⇒
          // 只发右值（表达式值 = 2，原生 3）。改为读-改-写：对象**只求值
          // 一次**（IIFE 实参——原生 mk() 只调一次），旧值读 → RHS → 写
          // （原生 GetValue → RHS → PutValue 序）。旧值不可判时 $add 折
          // unknown（**不把「判不准」升级成确定值**）。
          return `((${mpObj}) => { const ${mpOld} = $get(${mpObj}, ${key}); const ${mpVal} = ${compoundFn}(${mpOld}, ${right}); ($set(${mpObj}, ${key}, ${mpVal})); return ${mpVal}; })(${obj})`;
        }
        if (m.computed) {
          const obj = transpileExpression(m.object as Expression, opts);
          const k = m.property;
          if (k.type === "NumericLiteral") {
            if (!compoundFn) {
              return `((${mpObj}) => { const ${mpVal} = ${right}; ($idxSet(${mpObj}, $lit(${k.value}), ${mpVal})); return ${mpVal}; })(${obj})`;
            }
            // 族 57 第 8 条同款：复合赋值读-改-写（读 $idx / 写 $idxSet）
            return `((${mpObj}) => { const ${mpOld} = $idx(${mpObj}, $lit(${k.value})); const ${mpVal} = ${compoundFn}(${mpOld}, ${right}); ($idxSet(${mpObj}, $lit(${k.value}), ${mpVal})); return ${mpVal}; })(${obj})`;
          }
          if (k.type === "StringLiteral") {
            const key = JSON.stringify(k.value);
            if (!compoundFn) {
              return `((${mpObj}) => { const ${mpVal} = ${right}; ($set(${mpObj}, ${key}, ${mpVal})); return ${mpVal}; })(${obj})`;
            }
            return `((${mpObj}) => { const ${mpOld} = $get(${mpObj}, ${key}); const ${mpVal} = ${compoundFn}(${mpOld}, ${right}); ($set(${mpObj}, ${key}, ${mpVal})); return ${mpVal}; })(${obj})`;
          }
          if (isExpression(k)) {
            // [Symbol.X] = v → "@@X" 字符串槽写（镜像成员读 / 对象字面量计算键
            // 的投影口径——`ai[Symbol.asyncIterator] = fn` 必须落成可识别槽，
            // 否则 for await 的异步可迭代性不可见，Bug 13）
            const symK = symbolKeyOf(k as unknown as Parameters<typeof symbolKeyOf>[0]);
            if (symK !== null) {
              // Bug 73：symbol 键投影写打 Slot.symbolKey 标记（JSON 枚举面不可见）
              if (!compoundFn) {
                return `((${mpObj}) => { const ${mpVal} = ${right}; ($set(${mpObj}, ${symK}, ${mpVal}, { symbolKey: true })); return ${mpVal}; })(${obj})`;
              }
              return `((${mpObj}) => { const ${mpOld} = $get(${mpObj}, ${symK}, { symbolKey: true }); const ${mpVal} = ${compoundFn}(${mpOld}, ${right}); ($set(${mpObj}, ${symK}, ${mpVal}, { symbolKey: true })); return ${mpVal}; })(${obj})`;
            }
            // 计算键只求值一次（IIFE 实参）且先于 RHS（原生顺序）
            if (!compoundFn) {
              return `((${mpObj}, ${mpKey}) => { const ${mpVal} = ${right}; ($idxSet(${mpObj}, ${mpKey}, ${mpVal})); return ${mpVal}; })(${obj}, ${transpileExpression(k, opts)})`;
            }
            // 族 57 第 8 条同款：复合赋值读-改-写（键仍只求值一次）
            return `((${mpObj}, ${mpKey}) => { const ${mpOld} = $idx(${mpObj}, ${mpKey}); const ${mpVal} = ${compoundFn}(${mpOld}, ${right}); ($idxSet(${mpObj}, ${mpKey}, ${mpVal})); return ${mpVal}; })(${obj}, ${transpileExpression(k, opts)})`;
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
          ? ` $recordBinding(${JSON.stringify(name)}, ${assignV});`
          : "";
        return `((${assignV}) => { $assignRecord(${JSON.stringify(name)}, ${name}, ${assignV}, ${locLine}, ${locCol}, ${cond});${bindSrc} return ${name} = ${assignV}; })(${valSrc})`;
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
