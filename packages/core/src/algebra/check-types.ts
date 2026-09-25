/**
 * CheckOptions — 从 check.ts 拆出的纯类型，打断 check ↔ check-memo/may-throw 环。
 * 实现不得 import check.ts；check.ts re-export 本类型以保持公共面。
 */
import type { Abs } from "./abs.ts";
import type { AbsModuleExports } from "./abs-modules.ts";
import type { RunTranspiledOptions } from "./exec/run.ts";

/**
 * check 选项：core 不碰 fs；host 用 loadModule 喂 require 目标源码。
 */
export type CheckOptions = {
  /** 相对/绝对 require 说明符 → 模块源码；undefined = 解析失败 */
  loadModule?: (spec: string, fromFile: string) => string | undefined;
  /** 当前文件路径（供 loadModule 解析相对 spec） */
  fromFile?: string;
  /**
   * 侧车 ambient 绑定开关（host 从 package.json#nudo.contract.autoBind
   * 解析后下传；默认 true）。false = check/LSP 执法路径不自动加载侧车
   * （§2.2「整体关闭」承诺覆盖 CI 门禁，不只是打印路径）。
   */
  autoBind?: boolean;
  /**
   * 项目根（host 从 findProjectConfig 下传）：树外侧车不 ambient 绑定。
   * undefined = 不限（node_modules 仍拦）。
   */
  projectDir?: string;
  /**
   * L2 入口 may-throw 执法档（design-cli-semantics §3）。
   * error（默认）| warning | off。仅作用于 export/default/CJS 入口函数。
   */
  entryThrows?: "error" | "warning" | "off";
  /** L2 --ignore-throws：按 throws 类型名过滤；不吞 L1 */
  ignoreThrows?: string[];
  /** 宿主已求值的依赖导出表（specifier → AbsModuleExports）；
   *  B 与解释路径共用——import/require 按表解析（CLI 经
   *  evalAbsModuleGraph 计算后下传） */
  modules?: Record<string, AbsModuleExports | Record<string, unknown>>;
  /**
   * B run 注入包（modules/mocks/envGlobals/replacements/as）——透传
   * runTranspiled（generalize / L2 / 记录通道 / drift 同源）。memo 键按
   * 内容指纹（非对象身份）。
   */
  inject?: RunTranspiledOptions;
  /**
   * `@nudo:skip [returnsExpr]`（host 用 parser 解析后下传）：函数名 → 声明的
   * 返回 Abs（null = 未声明）。命中函数不评估 body：签名按声明返回上屏
   * （无声明 → any，不产生 unknown-inference 噪音）；返回契约仍按声明执法；
   * 入口 may-throw（L2）不评估。调用点参数义务（scan）不受影响。
   */
  skips?: ReadonlyMap<string, Abs | null>;
};
