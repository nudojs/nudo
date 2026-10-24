/**
 * Bug 422 —— `@nudo:import` 的**空载荷**被**静默丢弃**（零诊断），而同一条
 * 指令的**其它**未识别形态有 `nudo:contract-syntax` 警告。
 *
 * 根因（core 文本扫描通道）：空载荷在 `nudoImportPayloads` 这一层就被丢弃
 * （连 payload 都没产出）⇒ 畸形扫描器**永远看不到它** ⇒ 「标签命中但载荷
 * 为空」**零诊断**。
 *
 * 本钉锁：标签命中但载荷为空 ⇒ 产出一条**可诊断的载荷**（`malformed`），
 * 让既有的 `nudo:contract-syntax` 通道自然接管。
 */
import { describe, it, expect } from "vitest";
import {
  extractNudoImportRecords,
  parseNudoImportPayload,
  scanMalformedNudoImports,
} from "../directive-scan.ts";

describe("Bug 422: empty @nudo:import payload is diagnosable", () => {
  it("bare tag is reported as a malformed import", () => {
    expect(scanMalformedNudoImports(`/// @nudo:import\n`)).toEqual(["malformed"]);
  });

  it("bare tag with trailing blank is reported as a malformed import", () => {
    expect(scanMalformedNudoImports(`/// @nudo:import \n`)).toEqual(["malformed"]);
  });

  it("empty payload produces no import record (only a diagnostic)", () => {
    expect(extractNudoImportRecords(`/// @nudo:import\n`)).toEqual([]);
  });

  it("empty payload is malformed at the grammar level too", () => {
    expect(parseNudoImportPayload("")).toBe("malformed");
    expect(parseNudoImportPayload("   ")).toBe("malformed");
  });

  it("valid and other malformed forms keep their behaviour (control)", () => {
    expect(scanMalformedNudoImports(`/// @nudo:import { a } from "./x.nudo.js"\n`)).toEqual([]);
    expect(scanMalformedNudoImports(`/// @nudo:import ./nope.js\n`)).toEqual(["malformed"]);
  });
});
