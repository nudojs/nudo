/**
 * 族 29 S1 共享探针（web env 声明面 → 引擎诊断 / 签名）。
 *
 * 只用 `@nudojs/core` 的 `checkSource` + 本包自己的 `defineEnv()`
 * （不引 `@nudojs/service`——那是 service→env 的反向依赖）。
 * `collectEnvGlobals(["web"])` 的结果 ≡ `{...defineEnv().globals}`
 * （`packages/service/src/evaluator/env-loader.ts:506-515`：applyEnvDefinition
 *  把 `def.globals` 原样搬进 allGlobals）。
 */
import { checkSource, pTrue, resetGeneralizeMemo } from "@nudojs/core";
import type { Abs } from "@nudojs/core";
import { defineEnv } from "../web.ts";

export type WebIssue = { code: string; severity: string; message: string };

export type WebCheck = {
  issues: WebIssue[];
  /** error 级诊断的 code 列表（默认门禁只看 error） */
  errorCodes: string[];
  /** 入口 may-throw 记的品牌（如 "TypeError" / "RangeError" / "InvalidCharacterError"） */
  throwBrands: string[];
  /** 入口签名展示（`f() => …` 的右半） */
  signatures: Array<{ name: string; display: string }>;
};

let seq = 0;

/** web env 的全局表（≡ service 侧 `collectEnvGlobals(["web"])`）。 */
export function webEnvGlobals(): Record<string, Abs> {
  return { ...defineEnv().globals };
}

/**
 * 跑一遍 `checkSource`。
 *
 * @param src       源码（不含 `/// @nudo:env web` 指令——由本函数补）
 * @param withEnv   true = 注入 web env 全局（env 声明路径）；false = 宿主回落路径
 */
export function checkWeb(src: string, withEnv = true): WebCheck {
  resetGeneralizeMemo();
  seq += 1;
  // memo 键不含 inject.envGlobals ⇒ 同源不同 env 必须换 filePath，否则串味。
  const filePath = `/t/env-s1-${withEnv ? "env" : "host"}-${seq}.js`;
  const source = withEnv ? `/// @nudo:env web\n${src}` : src;
  const inject = withEnv ? { envGlobals: webEnvGlobals() } : undefined;
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

/** 单一入口函数的签名展示（右半，如 "undefined  #exact"）。 */
export function displayOf(out: WebCheck, name = "f"): string {
  const s = out.signatures.find((x) => x.name === name);
  if (!s) throw new Error(`no signature for ${name}: ${JSON.stringify(out.signatures)}`);
  return s.display;
}

/** env 全局表里的某个对象型全局的槽位 Abs（缺槽 ⇒ undefined）。 */
export function slotOf(globalName: string, ...path: string[]): Abs | undefined {
  const globals = webEnvGlobals();
  let cur: Abs | undefined = globals[globalName];
  for (const k of path) {
    if (!cur) return undefined;
    if (cur.shape.k === "brand") cur = cur.shape.shape as Abs | undefined;
    if (!cur || cur.shape.k !== "obj") return undefined;
    cur = cur.shape.slots[k]?.value;
  }
  return cur;
}

/**
 * 构造器全局的**实例面**槽位（envFn 的 `shape.returnType` 上的槽）。
 * 例：`instanceSlotOf("Response", "status")` ⇒ Response 实例的 status 槽。
 */
export function instanceSlotOf(globalName: string, ...path: string[]): Abs | undefined {
  const g = webEnvGlobals()[globalName];
  if (!g || g.shape.k !== "fn") return undefined;
  const rt = (g.shape as { returnType?: Abs }).returnType;
  if (!rt) return undefined;
  return slotOfAbs(rt, ...path);
}

function slotOfAbs(root: Abs, ...path: string[]): Abs | undefined {
  let cur: Abs | undefined = root;
  for (const k of path) {
    if (!cur) return undefined;
    if (cur.shape.k === "brand") cur = cur.shape.shape as Abs | undefined;
    if (!cur || cur.shape.k !== "obj") return undefined;
    cur = cur.shape.slots[k]?.value;
  }
  return cur;
}

/** env 全局表里某个 fn 形全局的 `shape.ctor` 标志。 */
export function ctorFlagOf(globalName: string): boolean | undefined {
  const g = webEnvGlobals()[globalName];
  if (!g || g.shape.k !== "fn") return undefined;
  return (g.shape as { ctor?: boolean }).ctor;
}
