/**
 * 运算符/条件族发射（expr 按域拆分之一；主分派在 ./transpile.ts）。
 *
 * 不变量：
 * - &&/||/??/三元经 ./short-circuit.ts 的 $fork 臂隔离协议（mutator 重绑 +
 *   nullish/typeof/判别/关系守卫臂剪影）；
 * - typeof 是唯一豁免 unresolvable reference 的读取上下文（JS 层 typeof 守卫，
 *   自由 arguments 特判短路）；
 * - i++/i-- 走 $updateAdd/$updateSub（不得走 $add 字符串拼接臂），后缀表达式
 *   值 = ToNumeric 旧值且必须在表达式内立刻写回；
 * - 成员自增/删除走 member-path 的路径计划（Bug 136/190）：计算键只求值一次、
 *   引用先于 RHS、[[Set]] 只落末层（中间层只取值）；
 * - delete 成员目标经 ./optional-chain.ts 的链式 delete 发射，非成员目标
 *   unsupported（不得假精确 undefined）；
 * - 顶层逗号序列整体加括号（嵌套位裸发射撕裂宿主结构）。
 */
import type {
  Expression,
  Node,
  LogicalExpression,
  ConditionalExpression,
  BinaryExpression,
  UnaryExpression,
  UpdateExpression,
  AwaitExpression,
  YieldExpression,
  SequenceExpression,
} from "@babel/types";
import type { TranspileOptions } from "../types.ts";
import { nullishGuardsOf, typeGuardOf, discriminantGuardsOf, relGuardOf } from "../stmt-predicates.ts";
import { isExpression, privateNameKeySrc, isConstAssignTarget } from "../helpers.ts";
import { BIN_OPS } from "../ops.ts";
import { NudoUnsupportedError } from "../../unsupported.ts";
import { memberPathOf, memberDeleteIfe, memberReadModifyWriteIfe } from "../member-path.ts";
import { emitTranspileExpression as transpileExpression } from "../transpile-dispatch.ts";
import { transpileShortCircuitExpr } from "./short-circuit.ts";
import { chainNeedsShortCircuit, flattenChain, emitDeleteChainFrom } from "./optional-chain.ts";
/**
 * 运算符/条件族：&&/||/??、三元、二元、一元（含 delete/typeof）、自增自减、await/yield、逗号序列。
 * 短路臂守卫剪影与 stmt.ts IfStatement 同源。
 */
export function transpileOperatorExpr(
  expr:
    | LogicalExpression
    | ConditionalExpression
    | BinaryExpression
    | UnaryExpression
    | UpdateExpression
    | AwaitExpression
    | YieldExpression
    | SequenceExpression,
  opts: TranspileOptions = {},
): string {
  switch (expr.type) {
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
          // 测试用 nullish；返回侧：nullish → right，否则 → left 的**非 nullish 部分**
          // （索引访问/可选字段的左值常携带 undefined 臂，不去则 ?? 的 alt 仍含 undefined）
          // Bug 134：test / alt 一律引用左操作数的**单次求值绑定**（leftRef），
          // 不得各自再发一份左操作数源码（getter / 调用 / 计算键跑两次）。
          consSrc: r,
          consNodes: [rNode],
          altOf: (leftRef) => `$removeNullish(${leftRef})`,
          altNodes: [lNode],
          testOf: (leftRef) => `$nullishTest(${leftRef})`,
        });
      }
      // && : test=left, cons=right, alt=left(已算)  || : test=left, cons=left, alt=right
      // nullish 守卫（issue #97 / #118 v3 多名）：&& 的右侧在 left 真值下
      // 求值——left 各守卫的 cons 事实（含 `(a != null && b != null)` 复合、
      // `(m = f())` 赋值即守卫）全部适用；|| 的右侧在 left 假值下求值——
      // 各守卫的 alt 事实适用（`!p || …` / `p == null || …`）。
      // typeof 类型守卫（Bug 23）同口径：右臂按 left 守卫的臂语义绑匹配/补集。
      const leftGuards = nullishGuardsOf(expr.left);
      const andTypeGuard = typeGuardOf(expr.left);
      const leftDiscGuards = discriminantGuardsOf(expr.left);
      return op === "&&"
        ? transpileShortCircuitExpr(opts, {
            alwaysNodes: [lNode],
            alwaysSrc: l,
            consSrc: r,
            consNodes: [rNode],
            altSrc: "__test",
            altNodes: [],
            narrowGuards: leftGuards.filter((g) => g.arm === "cons"),
            typeGuard: andTypeGuard,
            discGuards: leftDiscGuards.filter((g) => g.arm === "cons"),
          })
        : transpileShortCircuitExpr(opts, {
            alwaysNodes: [lNode],
            alwaysSrc: l,
            consSrc: "__test",
            consNodes: [],
            altSrc: r,
            altNodes: [rNode],
            narrowGuards: leftGuards.filter((g) => g.arm === "alt"),
            typeGuard: andTypeGuard,
            discGuards: leftDiscGuards.filter((g) => g.arm === "alt"),
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
        // 三元的 nullish/typeof 守卫臂收窄（issue #97：`p === null ? -1 : p.major`；
        // Bug 23：`typeof v === "string" ? v + "!" : 0`；#118 v3/#120：多名复合
        // `obj == null || node.p == null ? … : node.p.name` 一臂多事实）；
        // 判别等值守卫（issue #126）：`node.type === 'TL' ? node.quasis[0] : null`
        narrowGuards: nullishGuardsOf(expr.test),
        typeGuard: typeGuardOf(expr.test),
        discGuards: discriminantGuardsOf(expr.test),
        // 关系守卫（Bug 1）：`x >= 0 ? x : 0` 事实臂影子重绑
        relGuard: relGuardOf(expr.test),
      });
    }
    case "BinaryExpression": {
      // instanceof 需右操作数的**类名**（不是值）：右操作数必须是标识符
      if (expr.operator === "instanceof") {
        const l = isExpression(expr.left) ? transpileExpression(expr.left, opts) : "$lit(void 0)";
        if (expr.right.type === "Identifier") {
          // 第三参传 RHS 值（$absVal 收形）：@@hasInstance 派发 + 原生
          // 非对象 RHS 校验（null/undefined/prim → definite TypeError）
          return `$instanceof(${l}, ${JSON.stringify(expr.right.name)}, $absVal(${expr.right.name}))`;
        }
        // 非标识符右操作数（表达式/成员路径）：RHS 值一并传入做非对象校验；
        // 构造器值未知 → 抽象 boolean
        const r = isExpression(expr.right) ? transpileExpression(expr.right, opts) : "$lit(void 0)";
        return `$instanceofNonIdent(${l}, ${r})`;
      }
      // Bug 80：#x in o —— PrivateName 被 isExpression 排除，通用路径会把
      // 左操作数折 $lit(void 0) 再当字符串键查询（假精确）。私有名左操作数
      // → "#x" 混淆键直发 $in（与成员读同口径；接收者非对象硬抛 / brand
      // 槽 presence 判定由运行期 $in 收口，无需重复 brand 校验）
      if (expr.operator === "in" && expr.left.type === "PrivateName") {
        const key = privateNameKeySrc(
          expr.left as unknown as { id?: { name?: string }; name?: string },
        );
        if (!key) {
          throw new NudoUnsupportedError(
            `binary:in-private`,
            expr.loc ? { line: expr.loc.start.line, column: expr.loc.start.column } : undefined,
          );
        }
        // $in 键参数是 Abs（正常 "x" in o 走 $lit 表达式路径）——私有名
        // 字面量同样包 $lit，propertyKeyOf 才能折出 "#x" 字符串键
        return `$in($lit(${key}), ${transpileExpression(expr.right, opts)})`;
      }
      const fn = BIN_OPS[expr.operator];
      if (!fn) {
        // 未映射二元运算符：抛 unsupported 交消费方回落（不得假精确 undefined）
        throw new NudoUnsupportedError(
          `binary:${expr.operator}`,
          expr.loc ? { line: expr.loc.start.line, column: expr.loc.start.column } : undefined,
        );
      }
      const l = isExpression(expr.left) ? transpileExpression(expr.left, opts) : "$lit(void 0)";
      const r = isExpression(expr.right) ? transpileExpression(expr.right, opts) : "$lit(void 0)";
      return `${fn}(${l}, ${r})`;
    }
    case "UnaryExpression": {
      if (expr.operator === "delete") {
        // delete 的表达式值是布尔结果；容器写回由语句级 emitDeleteRebinds 负责
        const arg = expr.argument as Expression;
        const argType = (arg as { type?: string }).type;
        if (argType === "MemberExpression" || argType === "OptionalMemberExpression") {
          // Bug 60：可选链 delete（delete o?.a）——?. 命中 nullish 时短路
          // 返回 true（剩余链不求值），非 nullish 臂才 $delRes；此前
          // OptionalMemberExpression 不在处理面 → unsupported 假抛/unknown
          if (chainNeedsShortCircuit(arg as Node)) {
            const flat = flattenChain(arg, opts);
            const delSrc = flat && emitDeleteChainFrom(flat.hops, 0, flat.baseSrc);
            if (delSrc !== undefined) return delSrc;
            // 链含 call/invoke 等不可删除中缀 → 维持 unsupported fail-closed
            throw new NudoUnsupportedError(
              `delete:${argType}`,
              expr.loc ? { line: expr.loc.start.line, column: expr.loc.start.column } : undefined,
            );
          }
          const m = arg as unknown as {
            object: Node;
            property: Node;
            computed: boolean;
          };
          const path = memberPathOf(m, opts);
          // Bug 176：删除在**求值点**发生（自包含 IIFE）——父对象与键各只
          // 求值一次（Bug 136 的 delete 键双求值同解），删除（$del）与布尔值
          // （$delRes）**同点**产出 ⇒ 同一条表达式里排在 delete 之后的读看到
          // **变更后**的状态（原生语义），不再被推迟到整条语句之后。
          // 注：Proxy 的 deleteProperty 陷阱派发唯一在 $delRes（Bug 172），
          // $del 只做删除（陷阱在场时靶不动）⇒ 陷阱恰好派发一次。
          // 写回（品牌类实例的不可变更新）同点完成：可重绑根才写。
          // Bug 190：删除只作用在**持有末层键的那个对象**上——中间层不再写回
          // 根（原生不对中间层做 [[Set]]：访问器中间层不得被写）。
          if (path) {
            return memberDeleteIfe(path);
          }
          // 根不可重绑（foo().x）：父对象与键各一次，无写回
          const keySrc = m.computed
            ? transpileExpression(m.property as Expression, opts)
            : `$lit(${JSON.stringify((m.property as { name: string }).name)})`;
          const parentRead = transpileExpression(m.object as Expression, opts);
          return `(() => { const __nudoDelP = ${parentRead}; const __nudoDelK = ${keySrc}; const __nudoDelD = $del(__nudoDelP, __nudoDelK); return $delRes(__nudoDelP, __nudoDelK); })()`;
        }
        // 非成员目标的 delete 未 lowering：值应为 boolean，折 undefined 是假精确
        throw new NudoUnsupportedError(
          `delete:${(arg as { type?: string }).type ?? ""}`,
          expr.loc ? { line: expr.loc.start.line, column: expr.loc.start.column } : undefined,
        );
      }
      const arg = transpileExpression(expr.argument as Expression, opts);
      if (expr.operator === "-") return `$neg(${arg})`;
      if (expr.operator === "!") return `$not(${arg})`;
      // typeof 是唯一豁免 unresolvable reference 的读取上下文：未声明标识符
      // 原生返回 "undefined" 不抛 ReferenceError（Bug 14）。裸 `$typeof(x)` 会
      // 先求值实参 → 沙箱 ReferenceError 假 may-throw。用 JS 层 typeof 守卫：
      // 未声明/值为 undefined → "undefined" 字面量；TDZ（let 后读）仍由沙箱
      // 抛 ReferenceError（原生 typeof 不豁免 TDZ）。
      if (expr.operator === "typeof") {
        if ((expr.argument as Node).type === "Identifier") {
          // 自由 `arguments`（无 argsBinding）同 Bug 14 未声明标识符豁免：
          // 原生 typeof 折 "undefined" 不抛（下方 JS 守卫对 $throwFreeArguments()
          // 调用源无效——先特判短路）
          if (
            (expr.argument as { name?: string }).name === "arguments" &&
            !opts.argsBinding
          ) {
            return `$lit("undefined")`;
          }
          return `typeof ${arg} === "undefined" ? $lit("undefined") : $typeof(${arg})`;
        }
        return `$typeof(${arg})`;
      }
      if (expr.operator === "+") return `$toNumber(${arg})`;
      if (expr.operator === "~") return `$bitnot(${arg})`;
      if (expr.operator === "void") return `((${arg}), $lit(void 0))`;
      // 未 lowering 的一元运算符：抛 unsupported 交消费方回落（不得假精确 undefined）
      throw new NudoUnsupportedError(
        `unary:${expr.operator}`,
        expr.loc ? { line: expr.loc.start.line, column: expr.loc.start.column } : undefined,
      );
    }
    case "UpdateExpression": {
      // i++/++i/i--/--i：ES 规范 oldValue = ToNumeric(GetValue(lvalue))，
      // newValue = oldValue ± 1（1 随 numeric type：number→1 / bigint→1n）。
      // 不得走 $add/$sub 的字符串拼接臂（`"5"++` 原生 6，拼接会得 "51"）。
      // 前缀 = 新值（自包含写回）；后缀表达式值为旧值，
      // 但**必须在表达式内立刻写回**——否则同表达式后续读到未自增的旧值
      // （`x++ + x` 原生 11，语句级延迟写回会折成 10）。
      // 后缀缓存 ToNumeric 旧值：不得用 `(x=x+1, x-1)` 还原
      // （2^53+1 舍回 2^53，减 1 得 2^53-1，丢旧值）。
      const arg = expr.argument as Expression;
      const fn = expr.operator === "++" ? "$updateAdd" : "$updateSub";
      if (arg.type === "Identifier") {
        // const 绑定自增/自减：Assignment to constant variable
        if (isConstAssignTarget(arg.name, opts)) {
          return `$throwConstAssign()`;
        }
        if (expr.prefix) return `${arg.name} = ${fn}(${arg.name})`;
        return `((__old) => (${arg.name} = ${fn}(__old), __old))($toNumeric(${arg.name}))`;
      }
      if (arg.type === "MemberExpression") {
        const m = arg as unknown as { object: Node; property: Node; computed: boolean };
        const path = memberPathOf(m, opts);
        if (path) {
          // Bug 155：成员目标**自包含**——原生 `o.p++` 是**一次 Get + 一次
          // Put**。此前拆成「表达式位求值」+「语句级 rebind 写回」两段，两段
          // 各自独立发了一次 readPathSrc ⇒ **读了两遍**（getter 跑两次；有状态
          // getter 第二次读到不同值 → 连返回值也错）。
          // 修法：读一次、写回下沉到表达式内（语句级 rebind pass 不再补写）。
          // 前缀：值 = 新值；后缀：值 = 旧值（ToNumeric 后），写回用同一旧值。
          // Bug 136：计算键**只求值一次**（键绑临时量，读/写共用同一绑定）。
          // Bug 190：[[Set]] 只落末层（中间层不再写回根——原生不做中间层 Put）。
          if (expr.prefix) {
            // 前缀：$updateAdd/$updateSub 内部已 ToNumeric（旧值）
            return memberReadModifyWriteIfe(path, { newValueOf: (old) => `${fn}(${old})` });
          }
          // 后缀：表达式值 = ToNumeric 旧值（原生 oldValue 口径）
          return memberReadModifyWriteIfe(path, {
            newValueOf: (old) => `${fn}(${old})`,
            toNumericOld: true,
            valueIsOld: true,
          });
        }
        // Bug 80：this.#x++ / C.#n++——memberPathOf 对 PrivateName 返回
        // null，此前落 update:++ unsupported 令整模块 fail-closed。镜像
        // assignment.ts 私有名复合赋值的读-改-写（"#x" 混淆键槽）：前缀值
        // = 新值；后缀缓存 ToNumeric 旧值且表达式内立刻写回（标识符后缀
        // 同口径）。语句级 rebind pass 只处理 memberPath 命中形——无双重写回
        if (!m.computed && m.property.type === "PrivateName") {
          const key = privateNameKeySrc(m.property as { id?: { name?: string }; name?: string });
          if (key !== null) {
            const obj = transpileExpression(m.object as Expression, opts);
            const cur = `$get(${obj}, ${key})`;
            if (expr.prefix) {
              return `((__v) => (($set(${obj}, ${key}, __v)), __v))(${fn}(${cur}))`;
            }
            return `((__old) => (($set(${obj}, ${key}, ${fn}(__old))), __old))($toNumeric(${cur}))`;
          }
        }
      }
      // 不可写回目标（如 foo().x++ / super.x++ / 解构怪形 / 可选链更新）：
      // 静默折 undefined 是假精确——抛 unsupported 交消费方回落
      throw new NudoUnsupportedError(
        `update:${expr.operator}`,
        expr.loc ? { line: expr.loc.start.line, column: expr.loc.start.column } : undefined,
      );
    }
    case "AwaitExpression": {
      const arg = transpileExpression(expr.argument as Expression, opts);
      // Bug 201：async 体内的 await = **真挂起点**——发射 `yield`（宿主生成器
      // 挂起），被等待值由 `$asyncGen` 的续体解析（promise → inner /
      // 拒绝 → throw / 悬挂 → unsettled 面）。await 之后的语句因此**不在
      // 调用点内联跑完**（原生：恢复点是微任务）。
      //
      // 非 async 体（原生语法错误路径）保留 `$await` 兜底。
      if (opts.inAsyncBody) return `(yield ${arg})`;
      return `$await(${arg})`;
    }
    case "YieldExpression": {
      // Bug 82：yield* expr ≠ yield expr——读 Babel 的 delegate 标志：
      // 委托 = GetIterator 校验 + 逐元素 yield（元素，不是整个可迭代值），
      // 表达式值 = 内层迭代器 return 值（保守 unknown）。yield* 语法必有实参。
      // Bug 52：try 上下文位随 yield 点发射（$yield 第二实参；0 不发射，
      // 保持既有输出面不变）
      const yctx = opts.yieldTryCtx ?? 0;
      const yctxArg = yctx !== 0 ? `, ${yctx}` : "";
      if (expr.delegate) {
        return `$yieldStar(${transpileExpression(expr.argument as Expression, opts)}${yctxArg})`;
      }
      const arg = expr.argument
        ? transpileExpression(expr.argument as Expression, opts)
        : "$lit(void 0)";
      return `$yield(${arg}${yctxArg})`;
    }
    case "SequenceExpression":
      // 顶层逗号序列必须整体加括号：任何嵌套位（对象属性值 / 数组元素 /
      // 调用实参 / thunk）裸发射都会撕裂宿主结构——对象字面量里后续项被
      // 解析成新属性的键 → new Function SyntaxError（TS 降级产物的
      // [(_A = new WeakMap(), …, "key")] 计算键正是该形态），数组里变成
      // 额外元素。括号在语句位（(a, b);）与实参位均合法，统一包裹。
      return `(${expr.expressions.map((e) => transpileExpression(e, opts)).join(", ")})`;
  }
}
