/**
 * AstEnv：抽象求值环境类型。
 * 独立成文件：hof/language/leq/abs-fn/abs-modules 等消费方只依赖此类型，
 * 不必再为拿一个类型 import ast-eval 巨石（TS 模块环）。
 * ast-eval.ts 对本类型做兼容 re-export，外部消费路径不变。
 */

import type { Node } from "@babel/types";
import type { Abs } from "./abs.ts";
import type { HofCollectCtx } from "./hof.ts";

export type AstEnv = {
  vars: Map<string, Abs>;
  /** 用户函数：name → { params, body } */
  fns: Map<string, { params: string[]; body: Node; async?: boolean; kind?: string }>;
  /** class 表（旁路，withVar 必须保留） */
  classes?: Map<string, unknown>;
  /** 当前正在求值的方法所属类名（super.x() 从它的父类派发） */
  currentOwner?: string;
  /** P2：generalize symbolic 跑的 HOF collector（run 局部，不进 Φ） */
  hofCollect?: HofCollectCtx;
};
