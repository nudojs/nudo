/**
 * Bug 415 —— 文件级 `@nudo:mock-module 'x' from './y.js'`（**单引号**）被
 * **静默丢弃**：无 mock、无诊断、门禁绿灯。
 *
 * 根因（core 载荷文法）：`parseMockModulePayload` 的两条正则**硬编码双引号**
 * ⇒ 单引号载荷两条都不匹配 ⇒ 返回 `undefined` ⇒ 上游（parser
 * `collectFileDirectives`）**既不落诊断也不落记录** ⇒ 指令静默蒸发
 * （mock 不生效、门禁照常绿）。
 *
 * 本钉锁：单引号 / 混合引号都必须被认（与函数级 `@nudo:mock x from 'path'`
 * 同口径）；真正畸形的载荷仍被拒（零假阳性）。
 */
import { describe, it, expect } from "vitest";
import {
  extractMockModuleRecords,
  parseMockModulePayload,
} from "../directive-scan.ts";

describe("Bug 415: @nudo:mock-module payload accepts single quotes", () => {
  it("single-quoted full form is parsed", () => {
    expect(parseMockModulePayload("'axios' from './mocks/v-axios.js'")).toEqual({
      source: "axios",
      fromPath: "./mocks/v-axios.js",
    });
  });

  it("single-quoted named form is parsed", () => {
    expect(parseMockModulePayload("'axios' { a, b } from './mocks/v-axios.js'")).toEqual({
      source: "axios",
      names: ["a", "b"],
      fromPath: "./mocks/v-axios.js",
    });
  });

  it("mixed quote kinds are parsed (source and path may differ)", () => {
    expect(parseMockModulePayload(`"axios" from './mocks/v-axios.js'`)).toEqual({
      source: "axios",
      fromPath: "./mocks/v-axios.js",
    });
    expect(parseMockModulePayload(`'axios' from "./mocks/v-axios.js"`)).toEqual({
      source: "axios",
      fromPath: "./mocks/v-axios.js",
    });
  });

  it("double-quoted form keeps working (control)", () => {
    expect(parseMockModulePayload(`"axios" from "./mocks/v-axios.js"`)).toEqual({
      source: "axios",
      fromPath: "./mocks/v-axios.js",
    });
  });

  it("file-level extraction keeps the single-quoted record (was silently dropped)", () => {
    expect(
      extractMockModuleRecords(
        `/// @nudo:mock-module 'axios' from './415-mock.js'\nimport axios from "axios";\n`,
      ),
    ).toEqual([{ source: "axios", fromPath: "./415-mock.js" }]);
  });

  it("several single-quoted records all survive (no silent drop of any)", () => {
    expect(
      extractMockModuleRecords(
        `/// @nudo:mock-module 'axios' from './m.js'\n/// @nudo:mock-module "vue" from "./m.js"\n`,
      ).map((r) => r.source),
    ).toEqual(["axios", "vue"]);
  });

  it("malformed payloads are still rejected (zero false positives)", () => {
    expect(parseMockModulePayload("axios from ./m.js")).toBeUndefined();
    expect(parseMockModulePayload(`"axios"`)).toBeUndefined();
    expect(parseMockModulePayload(`"axios" from`)).toBeUndefined();
  });
});
