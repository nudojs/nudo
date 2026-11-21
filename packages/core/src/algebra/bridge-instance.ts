/**
 * 类方法桥的**实例构造**（值域 `generalize.ts` 与证据域
 * `check-may-throw.ts` 共用）。
 *
 * 类方法签名/throws 推断要先造实例再 `$invoke`，而构造实参一律补 any ⇒
 * 构造器体内的强制转换必产 TypeError。**构造器的行为不得污染方法体**：
 *
 * - 值域（Bug 1093）：构造器抛 ⇒ 异常逃出 ⇒ 方法签名退 unknown + 误导的
 *   info 级 `nudo:opaque-result`（把「构造器必抛」谎报成「推断失败」）。
 * - 证据域（Bug 1070）：构造器软效果/硬抛被归因给方法 ⇒ error 级
 *   `nudo:entry-may-throw` 假红。
 *
 * 口径：构造器**仍要跑**（方法体读 `this.<字段>` 需要构造器写入的槽值；
 * 跳过构造器会把字段读退成 unknown ⇒ 方法体自己的证据也丢），但证据域在
 * **独立 may-throw 会话**里跑（`isolate` 参数 = `runWithMayThrowSession`，
 * 值域不传）。硬抛 ⇒ 退到**裸实例**（跳过构造器）继续求值方法体 ⇒ 方法体
 * 自身的推断/证据照常产出（闸门不整体关掉）。
 *
 * BUG-259：**抽象类**的具体方法（模板方法）在合法 TS 里只能在实现了抽象
 * 钩子的子类实例上调用；见证面却直接 `new A()`（TS 禁止）⇒ `this.m()` 读
 * 不到抽象方法槽 ⇒ 假 TypeError（值域折 `never`、证据域记
 * `nudo:entry-may-throw`）。抽象方法声明由 `strip-types` 留在类节点的
 * 不可枚举旁路上（`nudoAbstractMethods`）——这里按表补**声明返回域**的
 * 桩槽：`this.m()` total、返回声明域（与 dts 的 `use(): number` 同源）。
 */

import type { Abs } from "./abs.ts";
import { abs, unknown as unknownAbs } from "./abs.ts";
import { absFunction } from "./abs-fn.ts";
import { $new } from "./exec/class.ts";
import { abstractMethodsOfClassNode, type NudoAbstractMethod } from "../strip-types.ts";
import {
  absTypeForTsTypeText,
  namedTypeTextsForSource,
  resolveNamedTypeText,
} from "./contract/ts-type-shape.ts";
import type { File } from "@babel/types";

/** 类引用（ClassDeclaration / 类表达式）的最小结构面 */
export type ClassLikeNode = {
  type?: string;
  id?: { name?: string };
  abstract?: unknown;
  body?: { body?: unknown[] };
  superClass?: unknown;
};

/**
 * 源码 AST 里的类节点：直接声明 / `export class` / `export default class`
 * / **`export { C }` 的裸 `class C {}` 语句** / **`const C = class {…}` 类表达式**。
 *
 * BUG-359：旧遍历只认「有 `declaration` 属性的语句 + `ClassDeclaration`」——
 * 裸 `ClassDeclaration` 没有 `declaration` 字段、类表达式的 `init.type` 是
 * `ClassExpression` ⇒ 非直接导出类整类漏掉 ⇒ 构造器形参表为空（`new C(1)`
 * 假 `nudo:arg-count`、参数属性 `this.x` 失域）。类表口径与
 * `scan-top-functions` / generalize 的类表（Bug 61）一致。
 */
export function classNodeForName(
  file: Pick<File, "program">,
  clsName: string,
): ClassLikeNode | undefined {
  for (const stmt of file.program.body as unknown[]) {
    const s = stmt as { type?: string; declaration?: unknown };
    const decl: unknown =
      s.type === "ExportNamedDeclaration" || s.type === "ExportDefaultDeclaration"
        ? s.declaration
        : stmt;
    const c = decl as ClassLikeNode | undefined;
    if (!c || typeof c !== "object") continue;
    if (
      c.type === "ClassDeclaration" &&
      (c.id?.name === clsName || (clsName === "default" && !c.id?.name))
    ) {
      return c;
    }
    if (c.type === "VariableDeclaration") {
      for (const d of (c as unknown as {
        declarations?: Array<{ id?: { name?: string }; init?: ClassLikeNode }>;
      }).declarations ?? []) {
        if (d.id?.name === clsName && d.init?.type === "ClassExpression") return d.init;
      }
    }
  }
  return undefined;
}

/** 抽象方法桩：调用不抛、返回声明域（与 dts 的声明面同源）。 */
function abstractMethodStubAbs(stub: NudoAbstractMethod, source?: string): Abs {
  const named = source ? namedTypeTextsForSource(source) : undefined;
  const ret =
    absTypeForTsTypeText(resolveNamedTypeText(stub.returnTypeText, named)) ?? unknownAbs;
  const params = Array.from({ length: stub.arity }, (_, i) => `_a${i}`);
  return absFunction(params, { apply: () => ret }, { ctor: false, returnType: ret });
}

/**
 * 给见证实例补抽象方法槽（`this.m()` 在具体方法体里 total）。
 *
 * 只补**缺失**槽（子类 / 已实现的方法不动）；实例内层不是 obj（裸实例的
 * unknown 内层）⇒ 原样返回（那里成员读本就不产假抛）。
 */
function withAbstractMethodStubs(inst: Abs, clsNode: ClassLikeNode | undefined, source?: string): Abs {
  if (!clsNode || inst.shape.k !== "brand") return inst;
  const stubs = abstractMethodsOfClassNode(clsNode);
  if (stubs.length === 0) return inst;
  const inner = inst.shape.shape;
  if (inner.shape.k !== "obj") return inst;
  let slots: typeof inner.shape.slots | undefined;
  for (const stub of stubs) {
    if (inner.shape.slots[stub.name] !== undefined) continue;
    slots ??= { ...inner.shape.slots };
    slots[stub.name] = { value: abstractMethodStubAbs(stub, source) };
  }
  if (slots === undefined) return inst;
  return abs(
    { ...inst.shape, shape: abs({ ...inner.shape, slots }, inner.term, inner.pred, inner.conf) },
    inst.term,
    inst.pred,
    inst.conf,
  );
}

/**
 * 裸实例（跳过构造器）：brand 名取**类值**的 brand 名（类值即 brand ⇒
 * 导出槽兜底 / `export default class` 同口径）。
 *
 * **内层是 unknown，不是空 obj**（Bug 1096）：构造器抛 ⇒ 构造器写过的字段
 * **不可知**（不是「确定不存在」）⇒ 空 obj 会把 `this.v` 折成**确定的
 * undefined**（自信的错值：真实是构造器写入的值）⇒ 连带 `this.v.toFixed()`
 * 在**虚构实例**上抛 TypeError ⇒ 方法签名被折成 `never`（谎称「该方法必
 * 抛、恒返回 never」）+ error 级 `nudo:entry-may-throw`（假红，直接卡 CI）。
 * 内层 unknown ⇒ 字段读 = unknown（不可知）⇒ 成员调用不产 may-throw ⇒
 * 签名不折 never（兜底实例的 TypeError 不得决定方法签名）。
 */
export function bareInstanceOf(clsAbs: Abs, clsName: string): Abs {
  const name =
    clsAbs.shape.k === "brand" && clsAbs.shape.name.length > 0
      ? clsAbs.shape.name
      : clsName;
  return abs(
    {
      k: "brand",
      name,
      shape: abs({ k: "unknown" }, undefined, undefined, "partial"),
    },
    undefined,
    undefined,
    "path",
  );
}

/**
 * 构造实例；构造器抛 ⇒ 裸实例兜底（方法体仍被求值）。
 *
 * @param isolate 证据域传 `runWithMayThrowSession`（构造器的软效果/帧栈不进
 *   外层收集域）；值域不传（无会话语义）。
 * @param abstractCtx BUG-259：类节点 / 源码（补抽象方法桩）。缺省 ⇒ 旧行为。
 */
export function instanceForMethodBridge(
  clsAbs: Abs,
  clsName: string,
  ctorArgs: Abs[],
  isolate?: <T>(body: () => T) => T,
  abstractCtx?: { file?: Pick<File, "program">; source?: string },
): Abs {
  let inst: Abs;
  try {
    inst = isolate ? isolate(() => $new(clsAbs, ctorArgs)) : $new(clsAbs, ctorArgs);
  } catch {
    inst = bareInstanceOf(clsAbs, clsName);
  }
  const clsNode = abstractCtx?.file ? classNodeForName(abstractCtx.file, clsName) : undefined;
  return withAbstractMethodStubs(inst, clsNode, abstractCtx?.source);
}
