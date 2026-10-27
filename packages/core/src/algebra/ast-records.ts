/**
 * Abs 域记录类型面（ast-eval 执行器删除后保留）。
 * 运行时记录由 eval 通道（EvalCallRecord/$assignRecord）产生；此处的类型是
 * checkSource drift / 结构赋值诊断的共享形状，仍被 check.ts 等消费。
 */
import type { Abs } from "./abs.ts";

/** Abs 域调用记录（eval 通道 EvalCallRecord 的同形投影） */
export type AbsCallRecord = {
  fnName: string;
  args: Abs[];
  result: Abs;
  callLoc?: { line: number; column: number };
  threw?: boolean;
};

/** Abs 域赋值记录（eval 通道 $assignRecord 的同形投影） */
export type AbsAssignRecord = {
  name: string;
  prev?: Abs;
  next: Abs;
  line?: number;
  column?: number;
  /** 分支/循环体内发生：可变绑定在路径上取并集是合法 JS，不参与结构检查 */
  conditional?: boolean;
  /**
   * 写目标是**函数形参**（不是 let/const/var 声明绑定）。
   *
   * JS 形参没有声明类型——分析面看到的 `prev` 是**本次调用实参**的形状，
   * 不是绑定的声明的域。真实代码里「归一化形参」是常规写法：
   * `global(globals) { globals = [].concat(globals); … }`（yargs）在某个
   * 调用点上传入 `"_"` 时，`prev = "_"`、`next = ["_"]` ⇒ 结构检查判
   * 「arr ⊭ prim string」**假阳性**（形参的真实域是 `string | string[]`）。
   * ⇒ 形参重赋值不参与 `nudo:assign-mismatch`（该通道只对**有声明值的绑定**
   * 负义务；调用点实参的形状义务归契约 / `nudo:arg-structure` 通道）。
   */
  paramBinding?: boolean;
};
