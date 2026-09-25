/**
 * check 门禁纯函数：profile × entryThrows × ignoreThrows 解析矩阵。
 */
import { describe, it, expect } from "vitest";
import {
  checkGateFromConfig,
  isEntryThrowsMode,
  isGateProfile,
  mergeIgnoreThrows,
  parseIgnoreThrows,
  parseWhatIfBindings,
  profileEntryThrows,
  resolveEntryThrows,
  validateGateFlags,
  type EntryThrowsMode,
  type GateProfile,
} from "../check-gate-config.ts";

describe("parseIgnoreThrows", () => {
  it("undefined → undefined", () => {
    expect(parseIgnoreThrows(undefined)).toBeUndefined();
  });

  it("empty string → undefined", () => {
    expect(parseIgnoreThrows("")).toBeUndefined();
  });

  it("single name", () => {
    expect(parseIgnoreThrows("TypeError")).toEqual(["TypeError"]);
  });

  it("comma list splits and trims", () => {
    expect(parseIgnoreThrows("TypeError, RangeError ,,  EvalError")).toEqual([
      "TypeError",
      "RangeError",
      "EvalError",
    ]);
  });

  it("array form flattens commas", () => {
    expect(parseIgnoreThrows(["A,B", "C"])).toEqual(["A", "B", "C"]);
  });

  it("only commas → undefined", () => {
    expect(parseIgnoreThrows(",, ,")).toBeUndefined();
  });

  it("array of empty → undefined", () => {
    expect(parseIgnoreThrows(["  ", ""])).toBeUndefined();
  });
});

describe("isGateProfile / isEntryThrowsMode", () => {
  it.each(["adoption", "strict"] as const)("accepts %s", (p) => {
    expect(isGateProfile(p)).toBe(true);
  });

  it.each(["bogus", "Strict", "ADOPTION", "", "error"])("rejects %s", (p) => {
    expect(isGateProfile(p)).toBe(false);
    expect(isGateProfile(undefined)).toBe(false);
  });

  it.each(["error", "warning", "off"] as const)("accepts %s", (m) => {
    expect(isEntryThrowsMode(m)).toBe(true);
  });

  it.each(["warn", "Error", "on", "", "none"])("rejects %s", (m) => {
    expect(isEntryThrowsMode(m)).toBe(false);
    expect(isEntryThrowsMode(undefined)).toBe(false);
  });
});

describe("profileEntryThrows", () => {
  it("adoption → warning", () => {
    expect(profileEntryThrows("adoption")).toBe("warning");
  });
  it("strict → error", () => {
    expect(profileEntryThrows("strict")).toBe("error");
  });
});

describe("checkGateFromConfig", () => {
  it("null / undefined / empty → {}", () => {
    expect(checkGateFromConfig(null)).toEqual({});
    expect(checkGateFromConfig(undefined)).toEqual({});
    expect(checkGateFromConfig({})).toEqual({});
  });

  it("valid profile + entryThrows", () => {
    expect(
      checkGateFromConfig({ check: { profile: "adoption", entryThrows: "off" } }),
    ).toEqual({ profile: "adoption", entryThrows: "off" });
  });

  it("invalid values are dropped", () => {
    expect(
      checkGateFromConfig({ check: { profile: "bogus", entryThrows: "warn" } }),
    ).toEqual({});
  });

  it("non-string values are dropped", () => {
    expect(
      checkGateFromConfig({ check: { profile: 1, entryThrows: ["error"] } }),
    ).toEqual({});
  });

  it("check: null → {}", () => {
    expect(checkGateFromConfig({ check: null })).toEqual({});
  });

  it("only profile set", () => {
    expect(checkGateFromConfig({ check: { profile: "strict" } })).toEqual({
      profile: "strict",
    });
  });

  it("only entryThrows set", () => {
    expect(checkGateFromConfig({ check: { entryThrows: "warning" } })).toEqual({
      entryThrows: "warning",
    });
  });
});

describe("resolveEntryThrows matrix (profile × entryThrows)", () => {
  const modes: EntryThrowsMode[] = ["error", "warning", "off"];
  const profiles: GateProfile[] = ["adoption", "strict"];
  const undefMode: EntryThrowsMode | undefined = undefined;
  const undefProfile: GateProfile | undefined = undefined;

  it("CLI entryThrows beats everything", () => {
    for (const e of modes) {
      for (const p of profiles) {
        for (const pe of modes) {
          for (const pp of profiles) {
            expect(
              resolveEntryThrows(
                { entryThrows: e, profile: p },
                { entryThrows: pe, profile: pp },
                "error",
              ),
            ).toBe(e);
          }
        }
      }
    }
  });

  it("CLI profile beats pkg entryThrows and pkg profile", () => {
    for (const p of profiles) {
      for (const pe of modes) {
        for (const pp of profiles) {
          expect(
            resolveEntryThrows(
              { profile: p },
              { entryThrows: pe, profile: pp },
              "error",
            ),
          ).toBe(profileEntryThrows(p));
        }
      }
    }
  });

  it("pkg entryThrows beats pkg profile and default", () => {
    for (const pe of modes) {
      for (const pp of profiles) {
        for (const def of modes) {
          expect(resolveEntryThrows({}, { entryThrows: pe, profile: pp }, def)).toBe(pe);
        }
      }
    }
  });

  it("pkg profile beats default", () => {
    for (const pp of profiles) {
      for (const def of modes) {
        expect(resolveEntryThrows({}, { profile: pp }, def)).toBe(profileEntryThrows(pp));
      }
    }
  });

  it("falls back to pkgEntryNormalized default", () => {
    for (const def of modes) {
      expect(resolveEntryThrows({}, {}, def)).toBe(def);
    }
    expect(resolveEntryThrows({ entryThrows: undefMode, profile: undefProfile }, {}, "off")).toBe(
      "off",
    );
  });

  it("adoption defaults to warning, strict to error (spot)", () => {
    expect(resolveEntryThrows({ profile: "adoption" }, {}, "error")).toBe("warning");
    expect(resolveEntryThrows({ profile: "strict" }, {}, "warning")).toBe("error");
  });
});

describe("mergeIgnoreThrows", () => {
  it("no CLI list → pkg list as-is (identity)", () => {
    const pkg = ["TypeError"];
    expect(mergeIgnoreThrows(undefined, pkg)).toBe(pkg);
    expect(mergeIgnoreThrows([], pkg)).toBe(pkg);
  });

  it("empty pkg + CLI list → CLI list", () => {
    expect(mergeIgnoreThrows(["RangeError"], [])).toEqual(["RangeError"]);
  });

  it("union with de-dup (CLI wins order after pkg)", () => {
    expect(mergeIgnoreThrows(["B", "C"], ["A", "B"])).toEqual(["A", "B", "C"]);
  });

  it("both empty → empty", () => {
    expect(mergeIgnoreThrows([], [])).toEqual([]);
  });
});

describe("validateGateFlags", () => {
  it("both valid → null", () => {
    expect(validateGateFlags({ entryThrows: "off", profile: "adoption" })).toBeNull();
    expect(validateGateFlags({})).toBeNull();
    expect(validateGateFlags({ entryThrows: undefined, profile: undefined })).toBeNull();
  });

  it("invalid entryThrows message", () => {
    expect(validateGateFlags({ entryThrows: "warn" })).toBe(
      "Invalid --entry-throws value: warn (expected: error | warning | off)",
    );
  });

  it("invalid profile message", () => {
    expect(validateGateFlags({ profile: "bogus" })).toBe(
      "Invalid --profile value: bogus (expected: adoption | strict)",
    );
  });

  it("entryThrows error reported before profile", () => {
    expect(validateGateFlags({ entryThrows: "x", profile: "y" })).toMatch(/entry-throws/);
  });
});

describe("parseWhatIfBindings", () => {
  it("name without type → any", () => {
    expect(parseWhatIfBindings(["raw"])).toEqual([{ name: "raw", type: "any" }]);
  });

  it("name:type split on first colon", () => {
    expect(parseWhatIfBindings(["raw:string"])).toEqual([{ name: "raw", type: "string" }]);
    expect(parseWhatIfBindings(["m:a:b"])).toEqual([{ name: "m", type: "a:b" }]);
  });

  it("empty type after colon", () => {
    expect(parseWhatIfBindings(["x:"])).toEqual([{ name: "x", type: "" }]);
  });

  it("multiple bindings", () => {
    expect(parseWhatIfBindings(["a:number", "b"])).toEqual([
      { name: "a", type: "number" },
      { name: "b", type: "any" },
    ]);
  });
});
