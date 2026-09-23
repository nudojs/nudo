/**
 * 提升前置化：求值前从函数体 AST 静态归纳形参提升决策与 HOF 产品，
 * 与求值期挂载点（① receiver-arr ② direct-call-fn ③ callback-fn +
 * for-of iteratee）同口径——source 序到达优先（首提升赢）、refine/已有
 * 具体形状拒绝提升（contract-first）、fn 应用点才记 HofSite。
 *
 * 扫描范围：函数体语句/表达式（含内联箭头/函数表达式体——回调执行期
 * 同样携带 hofCollect；不含嵌套函数声明体——独立执行单元）。
 * α 编号按求值顺序（receiver 先于实参、reduce 先 acc 后 item）与
 * 运行时 ctx.freshSeq 一致。
 */
import type { Node } from "@babel/types";
import type { Abs, Shape } from "./abs.ts";
import { abs } from "./abs.ts";
import type { Term } from "./term.ts";
import { v as termVar } from "./term.ts";
import type { HofSite, RelSource } from "./hof.ts";

const HOF_ARR_METHODS = new Set(["map", "filter", "reduce", "flatMap"]);

export type PromoteScanResult = {
  /** param → 提升后形状（求值前预绑定） */
  promotedShapes: Map<string, Shape>;
  fnRels: Map<string, { abs: Abs; source: RelSource }>;
  entryShapes: Map<string, { abs: Abs; source: RelSource }>;
  sites: HofSite[];
};

type Ctx = {
  params: ReadonlySet<string>;
  /** param → typeParam term id（α 复用白名单；paramTypes 的 term 用） */
  paramTermId: Map<string, string>;
  /** param → 当前形状（到达优先；起始 = typeParam 值） */
  shapes: Map<string, Abs>;
  /** param → 提升后形状（求值前预绑定） */
  promotedShapes: Map<string, Shape>;
  /** 作用域化局部绑定 term（for-of 循环变量 ← 提升元素），α 复用来源 */
  localTerms: Map<string, Term>;
  freshSeq: { n: number };
  alphaIds: Set<string>;
  fnRels: Map<string, { abs: Abs; source: RelSource }>;
  entryShapes: Map<string, { abs: Abs; source: RelSource }>;
  sites: HofSite[];
};

function alphaOfTerm(t: Term | undefined, ctx: Ctx): Term {
  if (t?.op === "var" && ctx.alphaIds.has(t.id)) return t;
  ctx.freshSeq.n += 1;
  const id = `T${ctx.freshSeq.n}`;
  ctx.alphaIds.add(id);
  return termVar(id);
}

/** site argTerms：原值 term（局部绑定/参数引用→其 α；字面量→lit；其余 var "_"） */
function rawTermOf(arg: Node | undefined, ctx: Ctx): Term {
  if (arg?.type === "Identifier") {
    const lt = ctx.localTerms.get(arg.name);
    if (lt) return lt;
    if (ctx.paramTermId.has(arg.name)) {
      return termVar(ctx.paramTermId.get(arg.name)!);
    }
  }
  if (arg?.type === "NumericLiteral") return { op: "lit", value: arg.value } as Term;
  if (arg?.type === "StringLiteral") return { op: "lit", value: arg.value } as Term;
  if (arg?.type === "BooleanLiteral") return { op: "lit", value: arg.value } as Term;
  return { op: "var", id: "_" };
}

/** paramTypes 的 term：αOf 语义（局部绑定/参数引用复用 α；其余 fresh α——含字面量） */
function alphaTermOf(arg: Node | undefined, ctx: Ctx): Term {
  if (arg?.type === "Identifier") {
    const lt = ctx.localTerms.get(arg.name);
    if (lt) return lt;
    if (ctx.paramTermId.has(arg.name)) {
      return termVar(ctx.paramTermId.get(arg.name)!);
    }
  }
  return alphaOfTerm(undefined, ctx);
}

/** 到达优先写形状 + 产品（与 hof.promoteParamShape 同口径；
 *  recordSite=false = 调用方自己记 site（direct-call/callback）） */
function promoteShape(
  ctx: Ctx,
  param: string,
  shape: Shape,
  loc?: { line: number; column: number },
  recordSite = true,
): void {
  const prev = ctx.shapes.get(param);
  if (!prev) return;
  if (prev.shape.k !== "any" && prev.shape.k !== "unknown") return;
  const next: Abs = { shape, term: prev.term, pred: prev.pred, conf: "path" };
  ctx.shapes.set(param, next);
  ctx.promotedShapes.set(param, shape);
  if (shape.k === "fn") {
    if (!ctx.fnRels.has(param) && !ctx.entryShapes.has(param)) {
      ctx.fnRels.set(param, { abs: { ...next }, source: "promote" });
    }
    if (recordSite) {
      ctx.sites.push({
        param,
        argTerms: [],
        result: shape.returnType ?? next,
        loc,
      });
    }
  } else {
    if (!ctx.fnRels.has(param) && !ctx.entryShapes.has(param)) {
      ctx.entryShapes.set(param, { abs: { ...next }, source: "promote" });
    }
  }
}

/** 形参 any → arr(自身 term 元素)（挂载点①/for-of 共用） */
function promoteAsArr(ctx: Ctx, name: string, loc?: { line: number; column: number }): void {
  if (!ctx.params.has(name)) return;
  const prev = ctx.shapes.get(name);
  if (!prev) return;
  if (prev.shape.k !== "any" && prev.shape.k !== "unknown") return;
  const element = prev.term
    ? abs(prev.shape, prev.term, prev.pred, "path")
    : abs({ k: "any" }, undefined, undefined, "path");
  promoteShape(ctx, name, { k: "arr", element }, loc);
}

/** 挂载点②：形参直接调用 → fn(paramTypes=α(arg), returnType=B:param) */
function promoteAsFn(ctx: Ctx, name: string, args: Node[], loc?: { line: number; column: number }): void {
  if (!ctx.params.has(name)) return;
  const prev = ctx.shapes.get(name);
  if (!prev) return;
  if (prev.shape.k !== "any" && prev.shape.k !== "unknown") {
    // 已有形状：只记 HofSite（result = returnType，不是整个 fn Abs）
    if (prev.shape.k === "fn") {
      ctx.sites.push({
        param: name,
        argTerms: args.map((a) => rawTermOf(a, ctx)),
        result: prev.shape.returnType ?? prev,
        loc,
      });
    }
    return;
  }
  const beta = termVar(`B:${name}`);
  const paramTypes = args.map((a) => abs({ k: "any" }, alphaTermOf(a, ctx), undefined, "path"));
  const ret = abs({ k: "any" }, beta, undefined, "path");
  const fnShape: Shape = {
    k: "fn",
    params: args.map((_, i) => `x${i}`),
    paramTypes,
    returnType: ret,
  };
  promoteShape(ctx, name, fnShape, loc, false);
  ctx.sites.push({
    param: name,
    argTerms: args.map((a) => rawTermOf(a, ctx)),
    result: ret,
    loc,
  });
}

/** 挂载点③：HOF 回调实参是形参 → fn 形状按方法名 */
function promoteCb(
  ctx: Ctx,
  cbName: string,
  method: string,
  argTerms: Term[],
  loc?: { line: number; column: number },
): void {
  if (!ctx.params.has(cbName)) return;
  const prev = ctx.shapes.get(cbName);
  if (!prev) return;
  if (prev.shape.k !== "any" && prev.shape.k !== "unknown") return;
  let paramTypes: Abs[];
  let returnType: Abs;
  if (method === "filter") {
    paramTypes = argTerms.map((t) => abs({ k: "any" }, t, undefined, "path"));
    returnType = abs({ k: "prim", type: "boolean" }, undefined, undefined, "path");
  } else {
    // map / flatMap / reduce / 默认
    paramTypes = argTerms.map((t) => abs({ k: "any" }, t, undefined, "path"));
    returnType = abs({ k: "any" }, termVar(`B:${cbName}`), undefined, "path");
  }
  const fnShape: Shape = {
    k: "fn",
    params: argTerms.map((_, i) => `x${i}`),
    paramTypes,
    returnType,
  };
  promoteShape(ctx, cbName, fnShape, loc, false);
  ctx.sites.push({
    param: cbName,
    argTerms,
    result: returnType,
    loc,
  });
}

function locOf(n: Node | null | undefined): { line: number; column: number } | undefined {
  const l = (n as { loc?: { start: { line: number; column: number } } }).loc;
  return l ? { line: l.start.line, column: l.start.column } : undefined;
}

function visit(node: Node | null | undefined, ctx: Ctx): void {
  if (!node || typeof node !== "object") return;
  const n = node as { type: string; [k: string]: unknown };
  // 嵌套函数声明体：独立执行单元，不参与本函数提升
  if (n.type === "FunctionDeclaration" || n.type === "ClassDeclaration") return;
  switch (n.type) {
    case "CallExpression": {
      const callee = n.callee as { type?: string; object?: Node; property?: Node; computed?: boolean };
      const args = (n.arguments as Node[]) ?? [];
      if (callee.type === "MemberExpression" && callee.computed !== true) {
        const prop = callee.property as { type?: string; name?: string };
        const method = prop?.name;
        if (method) {
          // 挂载点①：receiver 是形参 + HOF 方法名 → arr
          if (callee.object?.type === "Identifier" && HOF_ARR_METHODS.has(method)) {
            promoteAsArr(ctx, (callee.object as { name: string }).name, locOf(node));
          }
          // 挂载点③：回调实参是形参（receiver 不要求是形参——
          // makeArr().map(cb) 同样提升 cb，元素 term 落 fresh α）
          if (HOF_ARR_METHODS.has(method)) {
            const cb = args[0];
            if (cb?.type === "Identifier" && ctx.params.has(cb.name)) {
              const elemTerm =
                callee.object?.type === "Identifier" && ctx.paramTermId.has((callee.object as { name: string }).name)
                  ? termVar(ctx.paramTermId.get((callee.object as { name: string }).name)!)
                  : alphaOfTerm(undefined, ctx);
              if (method === "reduce") {
                promoteCb(ctx, cb.name, "reduce", [alphaTermOf(args[1], ctx), elemTerm], locOf(node));
              } else {
                promoteCb(ctx, cb.name, method, [elemTerm], locOf(node));
              }
            }
          }
        }
      } else if (callee.type === "Identifier") {
        promoteAsFn(ctx, (callee as { name: string }).name, args, locOf(node));
      }
      break;
    }
    case "ForOfStatement": {
      const right = n.right as Node | undefined;
      let saved: Term | undefined;
      let bindName: string | undefined;
      if (right?.type === "Identifier" && ctx.paramTermId.has((right as { name: string }).name)) {
        promoteAsArr(ctx, (right as { name: string }).name, locOf(node));
        const left = n.left as
          | { type?: string; declarations?: Array<{ id?: { name?: string } }>; name?: string }
          | undefined;
        const bind =
          left?.type === "VariableDeclaration"
            ? left.declarations?.[0]?.id?.name
            : left?.type === "Identifier"
              ? left.name
              : undefined;
        if (bind) {
          bindName = bind;
          saved = ctx.localTerms.get(bind);
          ctx.localTerms.set(bind, termVar(ctx.paramTermId.get((right as { name: string }).name)!));
        }
      }
      // 手动遍历子节点（body 内 direct-call 可见循环变量绑定），不落 generic walk
      for (const key of Object.keys(n)) {
        if (key === "loc" || key === "start" || key === "end") continue;
        const v = n[key];
        if (Array.isArray(v)) {
          for (const item of v) {
            if (item && typeof item === "object" && "type" in (item as object)) visit(item as Node, ctx);
          }
        } else if (v && typeof v === "object" && "type" in (v as object)) {
          visit(v as Node, ctx);
        }
      }
      if (bindName !== undefined) {
        if (saved !== undefined) ctx.localTerms.set(bindName, saved);
        else ctx.localTerms.delete(bindName);
      }
      return;
    }
    default:
      break;
  }
  // 遍历子节点（含分支双臂、内联箭头/函数表达式体）
  for (const key of Object.keys(n)) {
    if (key === "loc" || key === "start" || key === "end") continue;
    const v = n[key];
    if (Array.isArray(v)) {
      for (const item of v) {
        if (item && typeof item === "object" && "type" in (item as object)) visit(item as Node, ctx);
      }
    } else if (v && typeof v === "object" && "type" in (v as object)) {
      visit(v as Node, ctx);
    }
  }
}

export function scanPromotions(
  body: Node,
  params: string[],
  paramTermIds: string[],
  initialShapes: Map<string, Abs>,
): PromoteScanResult {
  const res: PromoteScanResult = {
    promotedShapes: new Map(),
    fnRels: new Map(),
    entryShapes: new Map(),
    sites: [],
  };
  const ctx: Ctx = {
    params: new Set(params),
    paramTermId: new Map(params.map((p, i) => [p, paramTermIds[i] ?? `A${i + 1}`])),
    shapes: new Map(initialShapes),
    promotedShapes: res.promotedShapes,
    localTerms: new Map(),
    freshSeq: { n: 0 },
    alphaIds: new Set(paramTermIds),
    fnRels: res.fnRels,
    entryShapes: res.entryShapes,
    sites: res.sites,
  };
  visit(body, ctx);
  return res;
}
