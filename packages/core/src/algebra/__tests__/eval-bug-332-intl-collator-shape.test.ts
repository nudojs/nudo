/**
 * Bug 332 回归：`Intl.Collator` 的形状（构造器 fn 的 name 面 + 实例面）。
 *
 * 原生依据（node v26.10.0 实测，取证命令见文件末尾「取证」段）：
 *   typeof new Intl.Collator()   → "object"
 *   new Intl.Collator().name     → **undefined**（实例**没有** name 属性；
 *                                   "Collator" 是**构造器函数**
 *                                   `Intl.Collator.name`，不是实例的）
 *   Intl.Collator.name           → "Collator"（构造器函数的 name 属性）
 *   Intl.NumberFormat.name       → "NumberFormat"
 *   Intl.DateTimeFormat.name     → "DateTimeFormat"
 *   Intl.Locale.name             → "Locale"
 *   typeof new Intl.Collator().compare → "function"（实例继承原型上的
 *                                   brand check 访问器）
 *
 * 修前：Intl 子构造器的 fn **name** 面折**限定名**（"Intl.Collator"）——
 * 原生是**子构造器名**（"Collator"）⇒ 对 `Intl.Collator.name` 给出
 * **自信的错值**。修法（`builtins/error/intl.ts` 的 `makeIntlCtorAbs`）：
 * fn shape.name 是 $new 的**派发键**（不能改），改走**自有 name 槽**。
 *
 * 报告勘误（**勿照抄报告**）：原始报告把「原生 `Intl.Collator.name` 是
 * "Collator"」写成了 `new Intl.Collator().name`——**实例上根本没有 name
 * 属性**（原生是 undefined）。本文件按**原生**分别钉：实例 `.name` → undefined，
 * 构造器 `Intl.Collator.name` → "Collator"。
 *
 * 引擎当前：`makeIntlCtorAbs` 覆盖的 NumberFormat / DateTimeFormat 已按
 * 原生给 "NumberFormat" / "DateTimeFormat" ✅；**但**经「命名空间成员」
 * 通道投影的 Collator / Locale 等**未覆盖**（仍给限定名）。
 * 「命名空间成员」那条按「原生期望 + TODO(族05)」用 `it.fails` 钉住
 * （**旗标口径**：引擎修好后 `it.fails` 会翻红，提醒摘掉旗标并进主门禁
 * ——同 `check-recall-gold.test.ts` 的 it.fails 口径）。
 * 实例方法面那条（`typeof new Intl.Collator().compare` ⇒ "function"）已由
 * **族 65 · 第 4 条**收口（core 的 `BUILTIN_BRAND_METHODS` 补
 * "Intl.Collator"）⇒ 旗标已摘、断言转正。
 *
 * 取证（原生 oracle）：
 *   node -e 'const c=new Intl.Collator();
 *     console.log(typeof c, c.name, Intl.Collator.name, Intl.NumberFormat.name,
 *       typeof c.compare)'
 */
import { describe, it, expect } from "vitest";
import { formatShape, litValue } from "@nudojs/core";
import { call, throwsError } from "./eval-helpers.ts";

const wrap = (body: string) => `export function f() { ${body} }`;

describe("Bug 332 — Intl.Collator 的形状", () => {
  it("typeof new Intl.Collator() → \"object\"（原生同款）", () => {
    const r = call(wrap(`return typeof new Intl.Collator();`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "object" });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });

  it("new Intl.Collator() 是 Intl.Collator 品牌实例（不是 undefined / 伪名）", () => {
    const r = call(wrap(`return new Intl.Collator();`), "f");
    expect(formatShape(r.result)).toBe("Intl.Collator");
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });

  it("new Intl.Collator().name → undefined（**实例**没有 name 属性——报告的 \"Collator\" 是勘误）", () => {
    // node v26.10.0：new Intl.Collator().name === undefined
    // （"Collator" 是**构造器函数** Intl.Collator.name，见下一组断言）
    const r = call(wrap(`return new Intl.Collator().name;`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: undefined });
  });

  it("new Intl.Collator(\"en\").name → undefined（带 locale 参数同款）", () => {
    const r = call(wrap(`return new Intl.Collator("en").name;`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: undefined });
  });

  it("typeof Intl.Collator → \"function\"（构造器面的 typeof 不回归）", () => {
    const r = call(wrap(`return typeof Intl.Collator;`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "function" });
  });
});

describe("Bug 332 — 构造器 fn 的 name 面（原生是**子构造器名**，非限定名）", () => {
  it("Intl.NumberFormat.name → \"NumberFormat\"（已建模子构造器：原生同款）", () => {
    const r = call(wrap(`return Intl.NumberFormat.name;`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "NumberFormat" });
  });

  it("Intl.DateTimeFormat.name → \"DateTimeFormat\"（已建模子构造器：原生同款）", () => {
    const r = call(wrap(`return Intl.DateTimeFormat.name;`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "DateTimeFormat" });
  });

  it("Intl.Collator.name → \"Collator\"（原生同款：非限定名）", () => {
    // Bug 332 收口：Intl 子构造器的**内部派发键**（"Intl.Collator"）只留在
    // shape.name（原型 brand 路由要它），读面剥掉 "Intl." 前缀 ⇒ 原生
    // `fn.name` 投影（非限定名）。
    const r = call(wrap(`return Intl.Collator.name;`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "Collator" });
  });

  it("Intl.Locale.name → \"Locale\"（原生同款：非限定名）", () => {
    const r = call(wrap(`return Intl.Locale.name;`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "Locale" });
  });
});

describe("Bug 332 — 实例方法面（未建模子构造器）", () => {
  it("typeof new Intl.Collator().compare → \"function\"（族 65 第 4 条已建模）", () => {
    // 原生：typeof new Intl.Collator().compare === "function"
    //   （实例继承 Intl.Collator.prototype 上的方法）
    // 族 65 · 第 4 条：`BUILTIN_BRAND_METHODS` 补 "Intl.Collator"
    // （compare / resolvedOptions）⇒ 实例方法面折精确 "function"
    // （此前是 unknown 域——imprecise 但 sound）。
    const r = call(wrap(`return typeof new Intl.Collator().compare;`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "function" });
  });

  it("new Intl.Collator().compare(\"a\", \"b\")：不抛（原生返回 -1 / 1，不抛）", () => {
    const r = call(wrap(`return new Intl.Collator().compare("a", "b");`), "f");
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });
});
