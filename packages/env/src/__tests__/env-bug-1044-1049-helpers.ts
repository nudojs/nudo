/**
 * 族 35 · 片 S1 共享探针（node env 声明面 → 引擎诊断 / 签名 + 宿主实测护栏）。
 *
 * 只用 `@nudojs/core` 的 `checkSource` + 本包自己的 `defineEnv()`
 * （不引 `@nudojs/service`——那是 service→env 的反向依赖）。
 *
 * web 侧**复用**族 29 S1 的共享探针（`./env-bug-s1-helpers.ts` 的
 * `checkWeb` / `slotOf` / `displayOf`），本文件只补 node 侧与宿主实测。
 */
import { execFileSync } from "node:child_process";
import { checkSource, pTrue, resetGeneralizeMemo } from "@nudojs/core";
import type { Abs } from "@nudojs/core";
import { defineEnv } from "../node.ts";

export type NodeIssue = { code: string; severity: string; message: string };

export type NodeCheck = {
  issues: NodeIssue[];
  /** error 级诊断的 code 列表（默认门禁只看 error） */
  errorCodes: string[];
  /** 入口 may-throw 记的品牌（如 "TypeError"） */
  throwBrands: string[];
  /** 入口签名展示（`f() => …` 的右半） */
  signatures: Array<{ name: string; display: string }>;
};

let seq = 0;

/** node env 的全局表（≡ service 侧 `collectEnvGlobals(["node"])`）。 */
export function nodeEnvGlobals(): Record<string, Abs> {
  return { ...defineEnv().globals };
}

/**
 * 跑一遍 `checkSource`（node env 口径）。
 *
 * @param src     源码（不含 `/// @nudo:env node` 指令——由本函数补）
 * @param withEnv true = 注入 node env 全局（env 声明路径）
 */
export function checkNode(src: string, withEnv = true): NodeCheck {
  resetGeneralizeMemo();
  seq += 1;
  // memo 键不含 inject.envGlobals ⇒ 同源不同 env 必须换 filePath，否则串味。
  const filePath = `/t/env-s1-1044-${withEnv ? "env" : "host"}-${seq}.js`;
  const source = withEnv ? `/// @nudo:env node\n${src}` : src;
  const inject = withEnv ? { envGlobals: nodeEnvGlobals() } : undefined;
  const r = checkSource(filePath, source, pTrue, inject ? { inject } : {});
  const issues = r.issues.map((i) => ({
    code: i.code,
    severity: i.severity,
    message: i.message,
  }));
  return {
    issues,
    errorCodes: issues.filter((i) => i.severity === "error").map((i) => i.code),
    throwBrands: issues
      .map((i) => /may throw ([A-Za-z]+)/.exec(i.message)?.[1])
      .filter((x): x is string => x !== undefined),
    signatures: r.signatures.map((s) => ({ name: s.name, display: s.display })),
  };
}

/** 沿 obj / brand 链取槽位 Abs（缺槽 ⇒ undefined）。 */
export function slotOfAbs(root: Abs | undefined, ...path: string[]): Abs | undefined {
  let cur = root;
  for (const k of path) {
    if (!cur) return undefined;
    if (cur.shape.k === "brand") cur = (cur.shape as { shape?: Abs }).shape;
    if (!cur || cur.shape.k !== "obj") return undefined;
    cur = (cur.shape as { slots: Record<string, { value: Abs }> }).slots[k]?.value;
  }
  return cur;
}

/** node env 全局表里的某个对象型全局的槽位 Abs（缺槽 ⇒ undefined）。 */
export function nodeSlotOf(globalName: string, ...path: string[]): Abs | undefined {
  return slotOfAbs(nodeEnvGlobals()[globalName], ...path);
}

/** obj / brand 面的成员名（brand 取内层 obj 的槽名；非 obj ⇒ []）。 */
export function memberNames(a: Abs | undefined): string[] {
  if (!a) return [];
  if (a.shape.k === "brand") return memberNames((a.shape as { shape?: Abs }).shape);
  if (a.shape.k !== "obj") return [];
  return Object.keys((a.shape as { slots: Record<string, unknown> }).slots ?? {});
}

/** fn 形的返回类型（`shape.returnType`）。 */
export function returnTypeOf(a: Abs | undefined): Abs | undefined {
  if (!a || a.shape.k !== "fn") return undefined;
  return (a.shape as { returnType?: Abs }).returnType;
}

/** env 全局表里某个 fn 形全局的**静态面**槽位（`shape.slots`）。 */
export function staticSlotOf(globalName: string, slotName: string): Abs | undefined {
  const g = nodeEnvGlobals()[globalName];
  if (!g || g.shape.k !== "fn") return undefined;
  const slots = (g.shape as { slots?: Record<string, { value: Abs }> }).slots;
  return slots?.[slotName]?.value;
}

/** node env 全局表里某个 fn 形全局的**实例面**（`shape.returnType`）。 */
export function instanceFaceOf(globalName: string): Abs | undefined {
  return returnTypeOf(nodeEnvGlobals()[globalName]);
}

/**
 * 宿主实测：在**真 node**（当前进程）上枚举某对象的**原型**成员名
 * （去掉 `constructor`）——`Object.getOwnPropertyNames(Object.getPrototypeOf(v))`。
 */
export function hostProtoMembers(expr: string): string[] {
  return hostMembers(expr, true);
}

/**
 * 宿主实测：在**真 node**（当前进程）上枚举某对象的**自有**成员名
 * （去掉 `constructor`）——`Object.getOwnPropertyNames(v)`。
 */
export function hostOwnMembers(expr: string): string[] {
  return hostMembers(expr, false);
}

function hostMembers(expr: string, viaProto: boolean): string[] {
  const script = viaProto
    ? `const v = ${expr}; console.log(JSON.stringify(Object.getOwnPropertyNames(Object.getPrototypeOf(v)).filter((n) => n !== "constructor")));`
    : `const v = ${expr}; console.log(JSON.stringify(Object.getOwnPropertyNames(v).filter((n) => n !== "constructor")));`;
  const out = execFileSync(process.execPath, ["-e", script], { encoding: "utf-8" });
  return JSON.parse(out.trim()) as string[];
}
