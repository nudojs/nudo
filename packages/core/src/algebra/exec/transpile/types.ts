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
  /** 分支/循环体内深度（赋值记录 conditional 标记；inLoop 也计入） */
  conditionalFlow?: number;
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
   * 当前词法作用域可见的 const 绑定名（用户层再赋值须 TypeError）。
   * 成员/下标写对根的内部重绑不在用户赋值路径，不走此表。
   */
  constNames?: ReadonlySet<string>;
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
};
