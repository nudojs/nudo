/**
 * dts 公共入口：AnalysisResult → dts；模块面投影 wrapper。
 *
 * 实现已拆到 dts-function-emit / dts-module-assembly / dts-surface-module；
 * 本文件只做模块面接线与投影上下文建立。
 */
import type { Abs } from "@nudojs/core";
import type { AnalysisResult, FunctionAnalysis } from "../analyzer.ts";
import {
  dropLedgerLines,
  pushDrop,
  withDtsContext,
} from "./dts-context.ts";
import type { DtsDrop } from "./dts-type.ts";
import { brandScopeOf } from "./dts-brand-scope.ts";
import { projectFunctionDts } from "./dts-function-emit.ts";
import { projectModuleDtsInner } from "./dts-module-assembly.ts";
import { dtsModuleSurface } from "./dts-surface-module.ts";
import type { DtsModuleSurface } from "./dts-ir.ts";
import type {
  DtsContractFace,
  DtsFunctionProjection,
} from "./dts-signature.ts";

export function generateDts(result: AnalysisResult): string {
  // 无模块面（没有源文本）：CJS 槽 / 别名绑定这类**没有声明级稳定名**的绑定
  // 不进模块级声明面（历史行为：只在 infer/JSON 面出现）；类方法沿用历史
  // `Class_method` 投影（#494 口径——类声明要一次一类，只有模块面合成能保证）。
  const entries: Array<{ fn: FunctionAnalysis; projection: DtsFunctionProjection }> = [];
  for (const fn of result.functions) {
    if (fn.noDeclaration && !/^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/.test(fn.name)) continue;
    entries.push({ fn, projection: projectFunctionDts(fn) });
  }
  const mod = projectModuleDts(undefined, entries);
  return mod.lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// 模块导出面（dts 投影面：导出名 / 类声明 / 再导出）
//
// 模块面 = 源文件的**导出面**：哪些名字被导出、导出名是什么、类长什么样、
// 再导出到哪。dts 投影必须按**导出名**声明（Bug 515）：局部绑定名 ≠ 导出名
// （`export { internal as publicName }` 的导出名是 publicName；
// `export default function f` 的导出名是 default）。
//
// 类成员（`C.m`）**不是**模块级导出（Bug 518/550）：模块级没有 `C_m` 这个
// 名字——成员收进 `declare class C { … }`（一次一类）。
//
// 再导出（`export * from` / `export {x} from`）按原样发射（Bug 939）：产物的
// 导出面必须与源模块一致，否则消费方 import 直接 TS2305。
// ---------------------------------------------------------------------------

/** AST 节点最小形状（Babel AST 的鸭子类型——不引 @babel/types） */


/** 标识符名（Identifier / StringLiteral——Babel 的 `export { x as "a-b" }`） */


/** 顶层 `const x = <字符串/数字字面量>` 的稳定值（BUG-385，按源码 memo）。 */




/**
 * BUG-119：类成员**计算键**的静态名（`["a" + "b"]` / `` [`x${"y"}`] ``）。
 * 只折静态可判的字符串拼接/模板；动态键（变量 / 成员表达式）返回 undefined
 * （不猜 ⇒ 不假造成员）。旧实现只认 Identifier/StringLiteral ⇒ 整条成员丢失。
 */


/**
 * 变量声明模式里的**全部绑定名**（Bug 63）。`export const { a, b } = src` /
 * `export const [c, ...rest] = arr` 的 `id` 是 ObjectPattern / ArrayPattern，
 * 旧扫描只读 `surfaceName(d.id)`（恒 undefined）⇒ 这些运行时真实存在的导出
 * 在 dts 面整体缺席（消费端 TS2305）。覆盖 Identifier / RestElement /
 * AssignmentPattern / 嵌套模式。
 */


/**
 * 对象字面量成员函数的源码注解（BUG-157）——只收**静态键**的箭头 / 函数
 * 表达式与方法简写。注解原文在这里不做可解析性判定：采集期 `typeNames` 尚未
 * 收齐（模块级 interface / type 声明在值扫描之后），判定推迟到发射期。
 */


/**
 * BUG-263：对象字面量里**用户符号**计算键的源码名（`{ [tag]: 1 }` ⇒ `["tag"]`）。
 *
 * Abs 的槽键是引擎内部 id（`@@sym#N`），没有到源码绑定名的反查通道；按
 * 属性出现序收集即可与 Abs 槽序一一对应（well-known symbol 由既有映射处理，
 * 不参与本表）。嵌套对象递归展开，保证渲染顺序一致。
 */


/**
 * 初始化器形状 → TS 类型串（Bug 62 的 CJS 值导出 / default 表达式兜底）。
 * 比 `classFieldTypeOfInit` 完整：对象逐成员投影、数组按元素 join ⇒ 消费端
 * `import { obj, arr }` 拿到的不是 `object` / `unknown[]` 这种会 TS2322 的
 * 宽类型。只映射字面量形状，表达式一律 unknown（声明面不猜求值结果）。
 */


/**
 * 函数字面量 → TS 函数类型（BUG-356）：保留源码形参 / 返回注解。
 *
 * 旧实现的类字段分支硬编码 `(a0: unknown) => unknown` —— 注解就在 AST 上却
 * 从不读取；同一注解在具名对象字面量通道是正确的。
 */


/** `new X<…>()` → `X<…>`（内建泛型缺实参时补占位，避免 TS2314，BUG-254）。 */


/** 节点是否被 `as const` / `<const>` 冻结（BUG-077 / BUG-140） */


/** 初始化器**内部**（任意深度）是否有 `as const` 断言 */


/**
 * `as const` 冻结子树 → TS 字面量类型（与 `tsc --declaration` 同口径）。
 *
 * `as const` 的操作数受 TS 限制（只允许字面量表达式），所以按 AST 渲染是
 * 可靠的、不需要求值：字面量保精度、对象逐槽 `readonly`、数组成
 * `readonly [ … ]`。
 */


/** 数组元素位：联合 / 带空格的类型要加括号（`(readonly [1, 2])[]`） */


/**
 * 初始化器类型（BUG-140 的嵌套 `as const` 档）：逐层按「该子树是否冻结」投影。
 *
 * `nested = { x: [1, 2] as const }` 的绑定本身不是 `as const`（对象未冻结）
 * ⇒ 外层属性不是 `readonly`，内层数组是 `readonly [1, 2]`。只有这种「外层
 * 可变、内层冻结」的形态需要走这里；顶层 `as const` 仍走既有只读通道。
 *
 * **拿不准就不投影**（返回 undefined ⇒ 调用方回落到分析面的观测 Abs）：
 * 展开 / 计算键 / 方法 / 访问器 / 数组展开这些形态按源码逐槽枚举会**丢键**
 * 或把元素域算错（旧实现静默跳过 ⇒ `{ ["a"]: [1, 2] as const }` 变成
 * `Record<string, never>`、`{ ...base, … }` 丢掉 `b`、getter 丢掉 `g`）。
 */


/** 形参名列表（Identifier / RestElement / AssignmentPattern / 模式 → argN） */

/**
 * BUG-193：形参默认值 → 类型证据（TS 声明面同口径）。
 *
 * `function f(x = 1)` 在 tsc `--declaration` 里是 `f(x?: number)`：默认值
 * **初始值**是类型证据。分析面入口 Abs 不携带默认值（`f()` 的 entry@ 实参
 * 是 any）⇒ dts 形参位曾落 `unknown`。这里从源码 `AssignmentPattern` 的
 * 初始值静态定型（只收字面量形状；标识符 / 调用一律不猜），按位返回。
 *
 * 显式注解位不采集（`tsParamAnnotation` 是更高一档证据）；无任何证据时返回
 * undefined（调用方沿用既有回落）。
 */


/** 单个形参默认值的静态类型（无证据 ⇒ undefined；见 `defaultParamTypeTexts`） */


/** 类成员节点 → 其函数节点（estree MethodDefinition.value / Babel ClassMethod） */


/**
 * Bug 49：`MemberExpression` → 点号限定名（`NS.Base` → `"NS.Base"`）。
 * 只用于**超类子句**（`extends NS.Base`）；`surfaceName` 保持原口径不动，
 * 避免影响导出名 / 成员键 / CJS 检测等其它调用点。
 */


/** 类型形参声明节点 → 子句原文（`<T, U = string>`）；无 source / 节点 ⇒ undefined。 */


/** 超类类型实参实例化节点 → 各实参的源码原文（`extends Base<string>` ⇒ `["string"]`）。 */


/** 节点上的 TS 类型注解 → 清洗后的类型文本（`: T` 的 T）。 */


/**
 * 「该类型名在产物里可解析」——**唯一**判据（ADR §4 D6 / BUG-005）。
 *
 * 产物自带三类声明，加上环境内建：
 *   ① 本地类（`declare class`）与本地 `interface` / `type` 原文镜像；
 *   ② 会补 `import type` 的导入名；
 *   ③ TS 内建 token 与运行时全局构造器名（`Date` / `Error` / `URL` …）。
 *
 * 此前形参注解与字段注解各写一套（前者漏了 ①，后者连 ② 也没有）⇒ 同一个
 * 本地 `Point` 在形参位被丢成 `unknown`，在类字段位连导入名都不放行。
 */


/**
 * Bug 44：字段的类型注解只有**引用都在产物里可解析**时才放行。
 * 私有类型名（`Hidden` / 未导入名）落进 .d.ts 会 TS2304 ⇒ 回落 `unknown`
 * （与模块级注解的安全降级同口径）。
 */


/**
 * BUG-130：模块级值声明注解的放行判据（与形参 / 字段同口径）。
 * 引用到产物里不可解析的类型名 ⇒ 不采用（回落观测），并点名首个不可解析名。
 */


/** Bug 88：类体 `TSIndexSignature` → ambient 声明文本（`[key: string]: …;`）。 */


/**
 * BUG-175：把同名**无体声明**合并到实现条目上（`overloads`），无实现时
 * 合并到首条声明上（抽象 / ambient 重载集）——保持源码顺序、去掉重复条目。
 *
 * 合并后发射侧只发 `overloads`（= 源码声明集），**不发实现签名**：实现的
 * 形参注解通常是 `any`，混进重载集就是额外 catch-all 重载（消费方传入 tsc
 * 会拒绝的实参也编译通过）。
 */


/**
 * 类声明面扫描（实例方法 / 静态方法 / 构造器形参 / 类型形参 / 超类）。
 *
 * `isResolvable` = 「该名字在产物里可解析」判据（本地类 / import / TS 全局名）：
 * 只有可解析的超类名才进产物（`extends Unknown` 会产出 TS2304）。
 */


/**
 * enum 成员初始化器 → **常量值**（BUG-190 + 数值链修正）。
 *
 * 只折 TS 允许的「常量 enum 表达式」：字面量 / 负数 / 模板 / 前序成员引用 /
 * 算术 / 位运算 / 字符串拼接。其余（调用、成员访问、外部变量）⇒ undefined：
 * 声明面不猜求值结果，也**绝不**把不可渲染的初始化器当成「无初始化器」去
 * 自增（`enum E { A = 1, B = val() }` 的 B 不是 2）。
 *
 * 返回 `number | string`，由调用方渲染成 TS 字面量文本。
 */


/** 折出的常量值 → enum 初始化器文本（`String(-0)` 与 tsc 一致为 `0`） */


/**
 * 类字段公开类型 = **唯一优先级格**（ADR §4 D2）：声明 > 观测。
 *
 * - `declared`：源码类型注解。mutable 字段的公开类型**不得窄于**注解——
 *   `z: number | null = 1` 若发射成 `number`，消费方按注解写 `null` 就 TS2322
 *   （BUG-014）。这是不可靠的说法：注解允许的值，产物必须允许。
 * - `observed`：初始化器形状（无注解时才用；仍不猜表达式）。
 * - 否则 `unknown`（不是「无类型」，是「未观测到」）。
 */


/** 初始化器形状 → 基类型（供 `classFieldType` 与 default 表达式投影复用）。 */


/** 源码片段（`keepTs` 的 AST 上类型注解仍在 ⇒ 直接切原文；越界 ⇒ undefined） */


/** 形参的类型注解文本（`: T`；无注解 ⇒ 空串） */


/**
 * namespace 成员形参（ambient 上下文：**默认值非法** ⇒ `a = 1` 降成 `a?: T`）。
 * 解构形参在 ambient 里无法平移到声明位 ⇒ 记 `argN: unknown`（不假造类型）。
 */


/**
 * Bug 76：namespace 内的 `export class` 按 **ambient 声明体**渲染成员。
 *
 * 旧实现无条件发 `export class C {}`（理由：ambient 类体不允许初始化器 /
 * 方法实现）——但声明体（`v: number; m(): number;`）在 ambient 上下文完全
 * 合法，被一并丢掉 ⇒ 消费端 `new NS.C().v` TS2339 而运行时成员都在。
 */


/**
 * namespace 成员声明行（BUG-191）：让 `.d.ts` 的 `NS` 与源导出面同形。
 *
 * 只渲染**有运行时值**的成员（const/let/var/function/class/enum/嵌套 namespace）
 * 与可镜像的类型成员（interface / type 别名，直接切源码原文——类型是 erasable 的，
 * 原文进 ambient 上下文合法）。class 只发空体：ambient 类体不允许初始化器 /
 * 方法实现，切原文会让整份产物编译不过（TS1039）。
 */


/** namespace 体 → 成员行（`namespace A.B` 的尾段挂在嵌套 TSModuleDeclaration 上） */


/** 模块面 dts 投影结果 */

export interface DtsModuleProjection {
  /** .d.ts 行（模块级声明 + 类声明 + 再导出） */
  lines: string[];
  /** 各导出的参数位（CLI 的 unknown 提示用） */
  params: Array<{ name: string; type: string }>;
}

/**
 * 模块面 dts 投影：逐函数投影 + 模块面 → 一份 .d.ts。
 * - 类成员收进 `declare class C { … }`（模块级不再有 `C_m` 导出）
 * - 再导出面（`export * from` / `export {x} from`）按原样发射
 * - brand 引用（类实例类型）补类声明（否则 TS2304）
 * - brand 引用的类若来自**别的模块**（本模块 import 进来的）⇒ 补
 *   `import type { C } from "…";`（Bug 233：否则产物里那个类名从未声明 ⇒
 *   消费方 tsc TS2304）
 * - 产物里**无法解析**的类名（既没本地声明、也没 import、也不是 TS 全局类型名）
 *   ⇒ 降级为 unknown，并在产物头部留**降级台账**（可诊断）
 */
/**
 * 模块面合成的**分析面补充证据**（函数入口之外的事实：模块级绑定 Abs）。
 *
 * `values`（BUG-190）：`export const/let/var` / `enum` 的类型来源。
 *
 * 注：类实例 brand **不能**从这里取 —— 分析面 `bindings` 里的 `class C` 绑定是
 * **构造器面**的 brand（实例形状只有 `name`），不是实例形状；类体字段改由源码面
 * 采集（`DtsClassSurface.instanceFields`，BUG-151）。
 */
export interface DtsModuleExtras {
  /** 模块级值声明的类型来源（本地名 → Abs；分析面的 `bindings`） */
  values?: ReadonlyMap<string, Abs>;
}

export function projectModuleDts(
  surface: DtsModuleSurface | undefined,
  entries: ReadonlyArray<{
    fn: FunctionAnalysis;
    projection: DtsFunctionProjection;
    contract?: DtsContractFace;
  }>,
  extras?: DtsModuleExtras,
): DtsModuleProjection {
  // Bug 233：类字段声明（brand 实例形状）也要在 brand 解析口径内渲染。
  const drops: DtsDrop[] = [];
  const proj = withDtsContext(
    {
      brandScope: brandScopeOf(surface),
      onDrop: (drop) => pushDrop(drops, drop),
    },
    () => projectModuleDtsInner(surface, entries, extras),
  );
  if (drops.length === 0) return proj;
  return { ...proj, lines: [...dropLedgerLines(drops), ...proj.lines] };
}



/**
 * 类声明的超类子句（BUG-151）：` extends A`；基类是泛型 ⇒ 补 `unknown`
 * 实参（TS2314：泛型基类缺类型实参会让整份产物编译不过；`unknown` 是 TS
 * 的 top，2026-11-06 归一后产物里不再出现语义为「无约束」的 `any`）。
 */
/**
 * 沿 `extends` 链收集**继承来的**静态成员名（BUG-070）。
 *
 * 只收**本模块**里能查到的基类（分析面沿 `superClass` 登记继承方法时同样只
 * 走本地类）；基类自己 override 的方法按 ES 语义以最近一层为准——这里取并集
 * 即可，因为「子类 own 实例方法同名」会在调用方（`staticOnly`）里把该名字剔掉。
 */


/**
 * BUG-194：类型参数字面替换（`get(): T` + `{T → number}` ⇒ `get(): number`）。
 *
 * 只替换**类型位置**的整词出现：限定名后半段（`A.T`）与对象类型的属性键
 * （`{ T: number }`）不动。基类 own 方法的声明行是在基类作用域里算出来的，
 * 落到子类必须按 `extends Base<…>` 的实参代入。
 */


/** 成员在某个类的源码面里的访问修饰符（实例 / 静态方法；查不到 ⇒ undefined）。 */


/**
 * BUG-194 / BUG-228：**继承来的实例方法**的声明视图。
 *
 * 分析面把基类 own 方法按子类名登记（Bug 64：未导出基类的方法也是子类公共
 * 面的一部分），dts 会把它当子类 own 成员发射——但（a）基类的类型实参从未
 * 代入（`Box<number>.get(): T` 变 `unknown` ⇒ 产物自身 TS2416）；（b）
 * `private` / `protected` 一律丢失（TS2415 / 消费方假绿）。这里沿 `extends`
 * 链取**声明类**的签名行，累积代入类型实参，并带回源码面修饰符。
 *
 * `lines === undefined` 表示该成员**不得重发**（private：TS 要求同一个私有
 * 声明，子类重发即 TS2415）。
 */




/**
 * 对象字面量成员函数的源码注解叠加（BUG-157）：**只补缺**——形参位没有
 * Abs 证据时才填；返回位只在观测没有返回类型时填。
 *
 * 求值面的 fn Abs 只有形参名（成员未调用 ⇒ 无外延证据），注解是唯一声明面
 * 证据；调用点观测到的返回类型优先（观测是事实）。
 */


/** brand 实例形状 → 字段声明（排除方法名——方法进类体，不进字段） */


/** Abs 树里的 brand（类实例类型）收集：类名 → brand Abs */
/**
 * BUG-054：Abs 里出现的 brand 类名集合（值声明的实例类型 ⇒ 产物要能解析该类）。
 */
