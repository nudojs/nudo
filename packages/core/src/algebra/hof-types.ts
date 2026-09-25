/**
 * 共享纯类型结点（AstEnv / HofCollectCtx / HofSite / RelSource）。
 *
 * 这些类型曾形成 ast-env ↔ hof ↔ abs-fn 的类型环（ast-env 引 HofCollectCtx，
 * hof/abs-fn 引 AstEnv）。抽到本叶模块（只依赖 abs/term/babel，不回指
 * ast-env/hof/abs-fn）后，三个消费方都从这里取类型，环即断。
 *
 * 稳定导入路径不变：ast-env.ts 重导出 AstEnv，hof.ts 重导出 HOF 三类型。
 */
import type { Node } from "@babel/types";
import type { Abs } from "./abs.ts";
import type { Term } from "./term.ts";

/**
 * 关系来源标记：P4 豁免与 diagnostics 依赖它，禁止隐式猜。
 * - promote：使用驱动提升（generalize symbolic / instantiate 局部）
 * - refine：@nudo:contract 契约
 * - relationFn：harvest/mock/测试直接写入 fnRels 时的预留来源（P4 error 路径）
 */
export type RelSource = "promote" | "refine" | "relationFn";

export type HofSite = {
  /** 形参名（函数形参） */
  param: string;
  /** 输入侧 term：实参的 term（element 的 var/lit/app）；map 1 个、reduce 2 个 */
  argTerms: Term[];
  /** 输出侧：归纳出的返回 Abs */
  result: Abs;
  /** 源位置，便于 diagnostics */
  loc?: { line: number; column: number };
};

/**
 * run 局部 collector（与 Phi 并列，不进 Φ 合并）。
 * symbolic 一次跑：安装并沉淀到 PolyFn；instantiate 重跑：装 throwaway
 * 副本——形状提升仍生效，结果不写回共享状态（见 generalize.ts run()）。
 */
export type HofCollectCtx = {
  /** 本次归纳的形参名集合（身份判定用） */
  paramNames: ReadonlySet<string>;
  /** 本次 typeParams 的 α id 集合（term 复用白名单） */
  alphaIds: Set<string>;
  /** fresh α 计数 */
  freshSeq: { n: number };
  sites: HofSite[];
  fnRels: Map<string, { abs: Abs; source: RelSource }>;
  entryShapes: Map<string, { abs: Abs; source: RelSource }>;
};

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
