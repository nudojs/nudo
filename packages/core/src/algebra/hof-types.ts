/**
 * 共享纯类型结点（AstEnv / HofSite / RelSource）。
 *
 * 这些类型曾形成 ast-env ↔ hof ↔ abs-fn 的类型环（ast-env 引 HOF collector
 * 类型，hof/abs-fn 引 AstEnv）。抽到本叶模块（只依赖 abs/term/babel，不回指
 * ast-env/hof/abs-fn）后，三个消费方都从这里取类型，环即断。
 *
 * 稳定导入路径不变：ast-env.ts 重导出 AstEnv，hof.ts 重导出 HOF 两类型。
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

export type AstEnv = {
  vars: Map<string, Abs>;
  /** 用户函数：name → { params, body } */
  fns: Map<
    string,
    {
      params: string[];
      body: Node;
      async?: boolean;
      kind?: string;
      /**
       * Bug 399：逐位「可省略」标记（与 `params` 同下标，`true` = 该位有
       * 默认值 / 带 `?` / 是 rest）⇒ 必选元数不再靠名字后缀猜。
       */
      optionalParams?: boolean[];
      /**
       * 源码面严格性（strict mode code → true；sloppy → false）：ESM 源 ∨
       * `"use strict"` 序言（`code-text.ts#sourceIsStrict`），strict 代码区内
       * 词法继承，class 方法体恒 true。env 条目被包装成 Abs fn
       * （`absFunction`）时透传为 `AbsFnImpl.strict`，供 body 编译单元发射
       * `"use strict";`。按**源面严格性**判定，不按函数猜。
       */
      strict?: boolean;
    }
  >;
  /** class 表（旁路，withVar 必须保留） */
  classes?: Map<string, unknown>;
  /** 当前正在求值的方法所属类名（super.x() 从它的父类派发） */
  currentOwner?: string;
};
