import { describe, it, expect } from "vitest";
import { types as hostTypes } from "node:util";
import { formatShape, unknown } from "@nudojs/core";
import { checkNode, memberNames, slotOfAbs } from "./env-bug-1044-1049-helpers.ts";
import { envMember, callSite } from "./env-bug-s3-helpers.ts";

/**
 * 族 15 · BUG-257 — `util.types` 是**封闭对象**且只建模 **8** 个谓词，
 * 宿主上有 **43** 个（缺 35，含 `isMap` / `isSet` / `isProxy` /
 * `isWeakMap` / `isUint8Array` …）⇒ 缺的成员读出 **exact `undefined`**
 * ⇒ `types.isMap(new Map())` 被判「确定抛 TypeError」⇒ L2 门禁假红（exit 1）。
 *
 * 修法：按宿主成员集补齐（全部 `(value) => boolean`）+ 宿主实测护栏。
 *
 * 反向钉：删掉任一补上的谓词 ⇒ 差分断言必挂。
 */
describe("Bug 257 — util.types models every host predicate", () => {
  it("host oracle: the predicates in question exist and return true", () => {
    expect(hostTypes.isMap(new Map())).toBe(true);
    expect(hostTypes.isSet(new Set())).toBe(true);
    expect(hostTypes.isDate(new Date())).toBe(true);
    expect(Object.keys(hostTypes).length).toBeGreaterThanOrEqual(43);
  });

  it("the env member set covers every host util.types predicate", () => {
    const declared = new Set(memberNames(envMember("node:util", "types")));
    const missing = Object.keys(hostTypes).filter((k) => !declared.has(k));
    expect(missing, `util.types is missing: ${missing.join(", ")}`).toEqual([]);
  });

  it("types.isMap applies to boolean and never throws", () => {
    const isMap = slotOfAbs(envMember("node:util", "types"), "isMap")!;
    const r = callSite(isMap, [unknown]);
    expect(formatShape(r.value!)).toBe("boolean");
    expect(r.exits).toEqual([]);
  });

  it("types.isMap(...) via the module face applies cleanly", () => {
    const types = envMember("node:util", "types");
    const names = memberNames(types);
    expect(names).toContain("isMap");
    expect(names).toContain("isSet");
    expect(names).toContain("isDate");
    // 每个补上的谓词都是 (any) => boolean
    for (const name of ["isMap", "isSet", "isProxy", "isWeakMap", "isUint8Array"]) {
      const slot = (types.shape as { slots: Record<string, { value: { shape: { k: string } } }> })
        .slots[name]!;
      expect(slot.value.shape.k, `util.types.${name} must be a fn`).toBe("fn");
    }
  });
});
