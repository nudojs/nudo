/**
 * TranspileOptions — B 路径 transpile 的调用方选项面。
 */
import type { Node } from "@babel/types";

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
};
