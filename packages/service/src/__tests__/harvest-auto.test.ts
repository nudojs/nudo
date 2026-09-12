import { describe, it, expect } from "vitest";
import { barePackageName, collectBarePackages } from "../harvest-auto.ts";

describe("barePackageName", () => {
  it("keeps simple package names", () => {
    expect(barePackageName("ms")).toBe("ms");
    expect(barePackageName("lodash/fp")).toBe("lodash");
  });

  it("keeps scoped packages", () => {
    expect(barePackageName("@types/node")).toBe("@types/node");
    expect(barePackageName("@babel/parser")).toBe("@babel/parser");
  });

  it("rejects relative / absolute / node builtins", () => {
    expect(barePackageName("./a.js")).toBeUndefined();
    expect(barePackageName("../b")).toBeUndefined();
    expect(barePackageName("/abs/path")).toBeUndefined();
    expect(barePackageName("node:fs")).toBeUndefined();
  });
});

describe("collectBarePackages", () => {
  it("extracts import and require specs", () => {
    const src = `
import ms from "ms";
import { join } from "path";
const x = require("lodash/fp");
import fs from "node:fs";
import local from "./local.js";
`;
    const pkgs = collectBarePackages(src);
    expect(pkgs).toContain("ms");
    expect(pkgs).toContain("path");
    expect(pkgs).toContain("lodash");
    expect(pkgs).not.toContain("node:fs");
    expect(pkgs).not.toContain("./local.js");
  });

  it("returns empty for unparsable source", () => {
    expect(collectBarePackages("function (")).toEqual([]);
  });
});
