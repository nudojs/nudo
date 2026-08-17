import { describe, it, expect } from "vitest";
import { parse, extractDirectives, type CaseDirective } from "@nudojs/parser";
import { typeValueToString, createEnvironment, T } from "@nudojs/core";
import { evaluateFunctionFull } from "../evaluator.js";

function runTest(source: string): { name: string; caseName: string; result: string }[] {
  const ast = parse(source);
  const directives = extractDirectives(ast);
  const env = createEnvironment();
  const results: { name: string; caseName: string; result: string }[] = [];

  for (const fn of directives) {
    const caseDirectives = fn.directives.filter((d): d is CaseDirective => d.kind === "case");
    for (const dir of caseDirectives) {
      const result = evaluateFunctionFull(fn.node, dir.args, env);
      results.push({ name: fn.name, caseName: dir.name, result: typeValueToString(result.value) });
    }
  }
  return results;
}

describe("Built-in URL API", () => {
  it("new URL(str) should return URL instance", () => {
    const results = runTest(`
// @nudo:case "new-url" ()
function fn() {
  const url = new URL("https://example.com/path?q=1#hash");
  return url;
}
`);
    expect(results[0].result).toContain("URL");
  });

  it("url.href should return string", () => {
    const results = runTest(`
// @nudo:case "href" ()
function fn() {
  const url = new URL("https://example.com/path");
  return url.href;
}
`);
    expect(results[0].result).toBe("string");
  });

  it("url.origin should return string", () => {
    const results = runTest(`
// @nudo:case "origin" ()
function fn() {
  const url = new URL("https://example.com/path");
  return url.origin;
}
`);
    expect(results[0].result).toBe("string");
  });

  it("url.protocol should return string", () => {
    const results = runTest(`
// @nudo:case "protocol" ()
function fn() {
  const url = new URL("https://example.com/path");
  return url.protocol;
}
`);
    expect(results[0].result).toBe("string");
  });

  it("url.host should return string", () => {
    const results = runTest(`
// @nudo:case "host" ()
function fn() {
  const url = new URL("https://example.com/path");
  return url.host;
}
`);
    expect(results[0].result).toBe("string");
  });

  it("url.hostname should return string", () => {
    const results = runTest(`
// @nudo:case "hostname" ()
function fn() {
  const url = new URL("https://example.com/path");
  return url.hostname;
}
`);
    expect(results[0].result).toBe("string");
  });

  it("url.port should return string", () => {
    const results = runTest(`
// @nudo:case "port" ()
function fn() {
  const url = new URL("https://example.com:8080/path");
  return url.port;
}
`);
    expect(results[0].result).toBe("string");
  });

  it("url.pathname should return string", () => {
    const results = runTest(`
// @nudo:case "pathname" ()
function fn() {
  const url = new URL("https://example.com/path?q=1");
  return url.pathname;
}
`);
    expect(results[0].result).toBe("string");
  });

  it("url.search should return string", () => {
    const results = runTest(`
// @nudo:case "search" ()
function fn() {
  const url = new URL("https://example.com/path?q=1");
  return url.search;
}
`);
    expect(results[0].result).toBe("string");
  });

  it("url.hash should return string", () => {
    const results = runTest(`
// @nudo:case "hash" ()
function fn() {
  const url = new URL("https://example.com/path#section");
  return url.hash;
}
`);
    expect(results[0].result).toBe("string");
  });

  it("url.username should return string", () => {
    const results = runTest(`
// @nudo:case "username" ()
function fn() {
  const url = new URL("https://user@example.com/path");
  return url.username;
}
`);
    expect(results[0].result).toBe("string");
  });

  it("url.password should return string", () => {
    const results = runTest(`
// @nudo:case "password" ()
function fn() {
  const url = new URL("https://user:pass@example.com/path");
  return url.password;
}
`);
    expect(results[0].result).toBe("string");
  });

  it("url.toString() should return string", () => {
    const results = runTest(`
// @nudo:case "toString" ()
function fn() {
  const url = new URL("https://example.com/path");
  return url.toString();
}
`);
    expect(results[0].result).toBe("string");
  });
});

describe("Built-in URLSearchParams API", () => {
  it("new URLSearchParams() should return URLSearchParams instance", () => {
    const results = runTest(`
// @nudo:case "new-params" ()
function fn() {
  const params = new URLSearchParams();
  return params;
}
`);
    expect(results[0].result).toContain("URLSearchParams");
  });

  it("params.get() should return string | null", () => {
    const results = runTest(`
// @nudo:case "get" ()
function fn() {
  const params = new URLSearchParams();
  return params.get("key");
}
`);
    expect(results[0].result).toContain("string");
    expect(results[0].result).toContain("null");
  });

  it("params.has() should return boolean", () => {
    const results = runTest(`
// @nudo:case "has" ()
function fn() {
  const params = new URLSearchParams();
  return params.has("key");
}
`);
    expect(results[0].result).toBe("boolean");
  });

  it("params.set() should return undefined", () => {
    const results = runTest(`
// @nudo:case "set" ()
function fn() {
  const params = new URLSearchParams();
  return params.set("key", "value");
}
`);
    expect(results[0].result).toBe("undefined");
  });

  it("params.delete() should return undefined", () => {
    const results = runTest(`
// @nudo:case "delete" ()
function fn() {
  const params = new URLSearchParams();
  return params.delete("key");
}
`);
    expect(results[0].result).toBe("undefined");
  });

  it("params.append() should return undefined", () => {
    const results = runTest(`
// @nudo:case "append" ()
function fn() {
  const params = new URLSearchParams();
  return params.append("key", "value");
}
`);
    expect(results[0].result).toBe("undefined");
  });

  it("params.toString() should return string", () => {
    const results = runTest(`
// @nudo:case "toString" ()
function fn() {
  const params = new URLSearchParams();
  return params.toString();
}
`);
    expect(results[0].result).toBe("string");
  });

  it("params.getAll() should return string[]", () => {
    const results = runTest(`
// @nudo:case "getAll" ()
function fn() {
  const params = new URLSearchParams();
  return params.getAll("key");
}
`);
    expect(results[0].result).toBe("string[]");
  });
});
