/**
 * TranspileOptions — 求值引擎 transpile 的调用方选项面。
 */
import type { Node } from "@babel/types";

export type TranspileOptions = {
  /** 运行时 import 说明符 */
  runtimeImport?: string;
  maxLoopIters?: number;
  /** 方法/函数体内 this 的绑定名（transpile class 时注入） */
  thisParam?: string;
  /** 当前类名（super 派发用） */
  className?: string;
  /**
   * Bug 133：类表达式的 **NamedEvaluation 名**（`const K = class {}` → "K"）。
   * 只对**本表达式自身**生效——类体内的嵌套类表达式拿不到该名（原生内层
   * 仍是无名类）；类自身的名字（`class Named {}`）优先于绑定名。
   */
  classNameHint?: string;
  /**
   * 静态方法体内 super 的接收者源（父类构造器——extends 表达式经
   * classSpecOf 前移计算注入）。super.x / super.m() / super[k] 落通用
   * $get/$invoke 路径（Super 节点直接发此源），消除 super 哨兵注释
   * 逸出（Bug 14）。
   */
  staticSuperSrc?: string;
  /** 原始源码（@nudo:replace 按节点文本匹配） */
  source?: string;
  /** 替换表：归一化目标文本 → 注入变量名；可选语句范围 */
  replacements?: Array<{
    target: string;
    varName: string;
    /**
     * 仅该**节点**范围内生效——字符区间 `[stmtStart, stmtEnd)`
     * （Babel 节点的 start/end 偏移），**不是行号**：Bug 166 修法把
     * 「行号窗口」改成「AST 节点身份」，行号窗口会泄漏进嵌套/同行的
     * 其它子表达式。
     */
    stmtStart?: number;
    stmtEnd?: number;
  }>;
  /** @nudo:as：覆盖紧随语句的 init / return（stmtStart/stmtEnd = 字符区间，
   *  语义同上——按节点身份定位，不按行号） */
  asOverrides?: Array<{ varName: string; stmtStart: number; stmtEnd: number }>;
  /** 循环嵌套深度（>0 时 return → $loopReturn，C2.1） */
  inLoop?: number;
  /** 循环体/switch 臂内：无标签 break 语义分别为跳出循环信号 / 臂结束 return */
  inSwitchArm?: boolean;
  /** 标签循环名（`outer: for …`）：传给 $for/$whileSeq/$forOf 供信号匹配 */
  loopLabel?: string;
  /** 宽松全局：标识符调用 callee 未声明 → undefined（$callNamed 保守
   *  unknown），模块不因 ReferenceError 中断——调用点发现的 exec 采集用
   * （测试框架 it/describe/test 等未注入全局） */
  lenientGlobals?: boolean;
  /** try 嵌套深度（>0 时 return 前 drain throwExits，使 catch 能吸收抽象 throw） */
  inTry?: number;
  /** 当前 try 的 mark 变量名（return drain 用；避免全局栈顶污染） */
  tryMarkName?: string;
  /** 当前 try 是否带 catch handler（soft may-throw digest/release 分支） */
  hasTryHandler?: boolean;
  /** 当前 try 的 catch 体是否可能 rethrow（正常路径 soft 效果 release 而非 digest） */
  tryRethrowCatch?: boolean;
  /** yield 点 try 上下文位（Bug 52）：进入 try 块/catch 体时按位 OR——
   *  1 = 外层任一 try 带 finally，2 = 外层任一 try 带 catch（数值与
   *  runtime/control.ts 的 YIELD_TRY_FINALLY / YIELD_TRY_CATCH 同步）；
   *  R1a catch 事实位（16/32/64）描述**最近** enclosing catch：16 = 含
   *  return，32 = 含 yield，64 = 可能 rethrow 进外层 catch（结局不可分类）。
   *  发射为 $yield/$yieldStar 第二实参；函数/方法体边界重置为 0。 */
  yieldTryCtx?: number;
  /** 分支/循环体内深度（赋值记录 conditional 标记；inLoop 也计入） */
  conditionalFlow?: number;
  /**
   * 当前处在 **async 函数体**内（Bug 201）。
   *
   * async 体内的 `await` 是**真挂起点**：发射 `yield <operand>`（宿主生成器
   * 挂起），由 `$asyncGen` 驱动恢复 ⇒ await 之后的语句不在调用点内联跑完
   * （原生：恢复点是微任务）。
   *
   * 函数/方法体边界重置：async 体 ⇒ true；**非** async 体 ⇒ false（嵌套
   * 同步函数不得继承——它不是生成器，`yield` 会是语法错误）。
   */
  inAsyncBody?: boolean;
  /**
   * 当前 async 体内**需发挂起门**的 `for await` 语句节点（节点身份）。
   *
   * Bug 201：原生 `for await` 每轮一个 await；引擎既有建模是同步驱动 ⇒
   * 生成器级发**整循环一个**挂起门（循环前 `yield`）。只有落在**生成器级**
   * 位置（生成器体内联）的 for await 才能发门——分支臂/循环体里的 for await
   * 是宿主 thunk（`yield` 会是语法错误）⇒ 由 async-plan 判定排除。
   *
   * 键 = 源偏移量（`String(node.start)`）——转译侧会**浅拷贝**语句节点
   * （completeElseChains / flattenEarlyReturnBlocks）⇒ 节点身份不稳定，
   * 源偏移量在拷贝间稳定。
   */
  asyncForAwaitGates?: ReadonlySet<string>;
  /** 函数/箭头体内（顶层绑定表只收顶层作用域） */
  inFunction?: boolean;
  /**
   * 当前词法作用域的 `arguments` 绑定名（非箭头函数 prologue 里 `$arguments(...)`）。
   * 箭头沿外层继承；无绑定（模块顶层 / 仅嵌套箭头引用）→ Identifier 分支折 $unknown()。
   */
  argsBinding?: string;
  /**
   * 解构临时名单调计数器（`_d`/`_n`；transpileFile 创建，全模块共享）。
   * 此前 `_d${seq}_${line}` 依赖源行号唯一化——同一行两条解构（压缩/单行
   * 风格）重名 → 重复 `const` 声明 → 整模块 SyntaxError fail-closed；
   * emitDestructure 的 `_n` 嵌套临时每语句重置，同样撞车。计数器与行号
   * 解耦，跨语句/跨 prologue 单调。
   */
  destrTmpSeq?: { n: number };
  /**
   * try 临时名单调计数器（`__nudoTm_`/`__nudoE_`；transpileFile /
   * transpileBodyNode 创建，单次转译输出内共享）。此前按源行号命名——
   * 同一作用域同一行两个 try（压缩/生成代码）重名 → 重复 `const` 声明 →
   * `new Function` SyntaxError 整模块 fail-closed；计数器与行号解耦
   * （含 loc 缺失 `?? 0` 的碰撞），跨语句单调。
   */
  tryTmpSeq?: { n: number };
  /**
   * 当前词法作用域可见的 const 绑定名（用户层再赋值须 TypeError）。
   * 成员/下标写对根的内部重绑不在用户赋值路径，不走此表。
   */
  constNames?: ReadonlySet<string>;
  /**
   * **调用方补给的**用户标识符词形集（Bug 1058 避让的补充来源）。
   *
   * `internalTmpName` 的避让集 = `userIdentInfo(opts.source).names`（源文本
   * 词形）∪ 本集合。用于**没有源文本**的转译单元——`exec/body-fn.ts` 的
   * body 编译路径（`transpileBodyNode(impl.body, …)` 原先传空 opts ⇒ 无
   * source ⇒ 避让集恒空 ⇒ 引擎内部临时名与用户标识符相撞 ⇒ 产物非法 JS
   * ⇒ 整模块 fail-closed）。该路径的调用方从 **AST** 收标识符词形
   * （body 内全部 Identifier + 形参名）补进来。
   */
  userIdents?: ReadonlySet<string>;
  /**
   * 本作用域已提升到函数体顶部的 var 名（Bug 21）：块内 `var x = init`
   * 改发赋值 `x = init`（绑定由顶部 `let x = $lit(void 0)` 提供）。
   * 函数/方法体边界由 transpileFnBodyStmts 重算替换。
   */
  hoistedVarNames?: ReadonlySet<string>;
  /**
   * `export var x`（模块顶层）：保持声明面（host ESM export 收集依赖
   * 声明语句），此类名字从提升集扣除、不发改赋值。
   */
  keepVarDecl?: boolean;
  /**
   * issue #165：文件含 `@nudo:assume` 引理——transpileFile 顶层对源文本
   * 做一次 includes 判定后置位。文件级快速门：无引理的文件不进锚定收集，
   * 发射产物逐字节不变（零插桩开销）。
   */
  assumeDirectiveFile?: boolean;
  /**
   * issue #165：待锚定的 declarator AST 节点集合（按对象身份匹配）——
   * 函数体**直接子语句** VariableDeclaration 中带 init 的 Identifier
   * declarator。发射位对命中者把 init 包 `$assumeAnchor(init, name)`
   *（SSA：@nudo:assume 引理作用于绑定值，从定义点到作用域尾）。嵌套块 /
   * for-init / 解构不收；嵌套函数体在自身边界重算（并集外层集合）。
   * 运行时护栏（premise 不含该名的 le 原子则直通原值）见
   * exec/runtime/ops.ts。
   */
  anchorDeclNodes?: ReadonlySet<object>;
  /**
   * 节点级 Abs 记录插桩（hover 重放用）：Identifier 值读与
   * 静态成员读的转译输出包 `$nodoPos(<src>, line, column)`，
   * 运行时把 (行, 列) → Abs 记入活跃的位置 collector（无收
   * 集器时 no-op 直通）。默认关——热路径（check/模块图）不
   * 承担插桩开销；仅 replayFnAbsNodes 重放开。
   */
  recordPositions?: boolean;
};
