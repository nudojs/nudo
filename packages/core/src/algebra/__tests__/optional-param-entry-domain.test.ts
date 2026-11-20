/**
 * TS 可选形参 `x?: T` 的**入口域**与「无守卫成员访问」的抛错口径。
 *
 * TS 语义：可选形参的绑定类型是 `T | undefined`（省略实参 ⇒ undefined）。
 * 分析层此前只把 `?` 用于元数（`optionalParams`），入口 Abs 仍只读类型文本
 * ⇒ 域不含 undefined ⇒ `x.toFixed()` 被当成总函数（`check` 假绿），而同一
 * 文件里零参调用点 `g()` 已被折成 `never throws TypeError` —— 两个观察面
 * 互相打脸；等价拼写 `x: number | undefined` 反而正确警告。
 *
 * 修法两处：
 * - generalize.ts 的入口域并 `undefined`（`withOptionalUndefined`）；
 * - 调用面的 union 派发对**入口声明域**的 nullish 成员记账
 *   （`noteNullishMemberThrows`）：`memberLikelyHasMethod` 对 nullish 返回
 *   false，而既有的 prim / fn 记账只认 prim / fn 接收者 ⇒ `number |
 *   undefined` 的 undefined 臂抛错被吞。派生槽读（守卫测试式里的
 *   `m[1].trim()` / `node.name.trim()`）不在此列——它们的 undefined 臂是
 *   issue #136 接收者事实的原料，凭 `isEntryDomainAbs` 分流。
 *
 * 断言钉「可选拼写 == `| undefined` 拼写」这一不变量，并钉「声明入口域
 * 记 throws / 派生槽读不记」的两面区分。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { l2Count, sidecarOpts } from "./nudo-constraints.ts";

const OPTIONAL = `export function g(x?: number) { return x.toFixed(); }
export function h(x?: string) { return x.toUpperCase(); }
export function k(x: number | undefined) { return x.toFixed(); }
export function req(x: number) { return x.toFixed(); }
export function guarded(x?: number) { return x === undefined ? "none" : x.toFixed(); }
`;

const CLASS_OPTIONAL = `export class K {
  constructor(v?: number) { this.v = v ?? 0; }
  v: number;
  m(x?: number) { return x.toFixed(); }
  n(x?: number) { return x?.toFixed() ?? "none"; }
}
`;

/** 派生槽读 + 守卫测试式：槽值 `string | undefined`，调用在测试式里 */
const GUARD_SIDE = `
export const contentShape = string();
export const strArr = array(string());
export const nodeShape = shape({ name: string().optional() });
`;
const GUARD_IMP = `/// @nudo:import { contentShape, strArr, nodeShape } from "./std208pin.nudo.js"\n`;
const guardOpts = sidecarOpts("std208pin", GUARD_SIDE);

const DERIVED_MEMBER_GUARD = `/**
 * @nudo:contract node nodeShape
 */
export function dotRecv(node) {
  if (node.name.trim().length > 0) return node.name;
  return "-";
}
`;

const DERIVED_INDEX_GUARD = `/**
 * @nudo:contract content contentShape
 * @nudo:contract return strArr
 */
export function rg(content) {
  const out = [];
  const re = /x(.*?)y/g;
  let m;
  while ((m = re.exec(content))) {
    if (m[1].trim().length > 0) out.push(m[1]);
  }
  return out;
}
`;

/** 同形状，但 undefined 臂来自**入口声明**（无守卫测试式） */
const DECLARED_DOMAIN_ONLY = `export function g(x?: number) { return x.toFixed(); }
export function k(x: number | undefined) { return x.toFixed(); }
`;

function sig(r: ReturnType<typeof checkSource>, name: string) {
  const found = r.signatures.find((s) => s.name === name);
  expect(found, `signature ${name} missing`).toBeDefined();
  return found!;
}

describe("TS 可选形参的入口域", () => {
  it("BUG-208 `x?: T` 的入口域含 undefined，未守卫成员访问与 `T | undefined` 拼写同结论（都记 may-throw）", () => {
    const r = checkSource("/t/optional-domain.ts", OPTIONAL, pTrue);

    expect(sig(r, "g").paramTypes).toEqual(["number | undefined"]);
    expect(sig(r, "h").paramTypes).toEqual(["string | undefined"]);
    expect(sig(r, "k").paramTypes).toEqual(["number | undefined"]);

    // 同一函数体的可选 / 显式 union 两种拼写必须给出同一结论
    expect(l2Count(r, "g")).toBe(1);
    expect(l2Count(r, "k")).toBe(1);
    expect(l2Count(r, "h")).toBe(1);

    // 负控制：必选形参不凭空多出 undefined 臂；显式守卫后恢复 total
    expect(sig(r, "req").paramTypes).toEqual(["number"]);
    expect(l2Count(r, "req")).toBe(0);
    expect(l2Count(r, "guarded")).toBe(0);
  });

  it("BUG-208 类方法 / 构造器形参同口径：可选域含 undefined，未守卫的成员访问记 may-throw", () => {
    const r = checkSource("/t/optional-class.ts", CLASS_OPTIONAL, pTrue);

    expect(sig(r, "K").paramTypes).toEqual(["number | undefined"]);
    expect(sig(r, "K.m").paramTypes).toEqual(["number | undefined"]);
    expect(sig(r, "K.n").paramTypes).toEqual(["number | undefined"]);

    expect(l2Count(r, "K.m")).toBe(1);
    // 构造器用 `?? 0`、K.n 用可选链 ⇒ 都保持 total
    expect(l2Count(r, "K")).toBe(0);
    expect(l2Count(r, "K.n")).toBe(0);
  });

  it("BUG-208 两面区分：守卫测试式里的派生槽读（node.name / m[1]）不记入口 may-throw，声明入口域（x?: T / T | undefined）记", () => {
    // 派生成员读：接收者事实（issue #136）在 cons/alt 两臂窄化；测试式
    // 本身不把槽的 undefined 臂算成入口可能抛（否则守卫窄化回归假红）。
    const member = checkSource(
      "/t/derived-member-guard.js",
      GUARD_IMP + DERIVED_MEMBER_GUARD,
      pTrue,
      guardOpts,
    );
    expect(sig(member, "dotRecv").display).toBe('string | "-"');
    expect(l2Count(member, "dotRecv")).toBe(0);
    expect(member.summary.errors).toBe(0);

    const index = checkSource(
      "/t/derived-index-guard.js",
      GUARD_IMP + DERIVED_INDEX_GUARD,
      pTrue,
      guardOpts,
    );
    expect(l2Count(index, "rg")).toBe(0);
    expect(index.summary.errors).toBe(0);
    expect(sig(index, "rg").display).not.toMatch(/throws/);

    // 对照：同一 `prim ∪ lit undefined` 形状，但 undefined 臂来自**入口
    // 声明**（调用方可达）⇒ 未守卫成员访问必须进 throws 域（BUG-208）。
    const declared = checkSource("/t/declared-domain-only.ts", DECLARED_DOMAIN_ONLY, pTrue);
    expect(sig(declared, "g").paramTypes).toEqual(["number | undefined"]);
    expect(l2Count(declared, "g")).toBe(1);
    expect(l2Count(declared, "k")).toBe(1);
    expect(declared.summary.errors).toBe(2);
  });
});
