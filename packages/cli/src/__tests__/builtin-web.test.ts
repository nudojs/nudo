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

describe("Built-in fetch API", () => {
  it("fetch(url) should return Promise<Response>", () => {
    const results = runTest(`
// @nudo:case "fetch" ()
function fn() {
  return fetch("https://example.com");
}
`);
    expect(results[0].result).toContain("Promise");
    expect(results[0].result).toContain("Response");
  });

  it("await fetch(url) should return Response instance", () => {
    const results = runTest(`
// @nudo:case "await-fetch" ()
async function fn() {
  const response = await fetch("https://example.com");
  return response;
}
`);
    expect(results[0].result).toContain("Response");
  });
});

describe("Built-in Response API", () => {
  it("new Response() should return Response instance", () => {
    const results = runTest(`
// @nudo:case "new-response" ()
function fn() {
  const response = new Response();
  return response;
}
`);
    expect(results[0].result).toContain("Response");
  });

  it("response.ok should return boolean", () => {
    const results = runTest(`
// @nudo:case "ok" ()
function fn() {
  const response = new Response();
  return response.ok;
}
`);
    expect(results[0].result).toBe("boolean");
  });

  it("response.status should return number", () => {
    const results = runTest(`
// @nudo:case "status" ()
function fn() {
  const response = new Response();
  return response.status;
}
`);
    expect(results[0].result).toBe("number");
  });

  it("response.statusText should return string", () => {
    const results = runTest(`
// @nudo:case "statusText" ()
function fn() {
  const response = new Response();
  return response.statusText;
}
`);
    expect(results[0].result).toBe("string");
  });

  it("response.url should return string", () => {
    const results = runTest(`
// @nudo:case "url" ()
function fn() {
  const response = new Response();
  return response.url;
}
`);
    expect(results[0].result).toBe("string");
  });

  it("response.type should return string", () => {
    const results = runTest(`
// @nudo:case "type" ()
function fn() {
  const response = new Response();
  return response.type;
}
`);
    expect(results[0].result).toBe("string");
  });

  it("response.redirected should return boolean", () => {
    const results = runTest(`
// @nudo:case "redirected" ()
function fn() {
  const response = new Response();
  return response.redirected;
}
`);
    expect(results[0].result).toBe("boolean");
  });

  it("response.json() should return Promise<unknown>", () => {
    const results = runTest(`
// @nudo:case "json" ()
function fn() {
  const response = new Response();
  return response.json();
}
`);
    expect(results[0].result).toBe("Promise<unknown>");
  });

  it("response.text() should return Promise<string>", () => {
    const results = runTest(`
// @nudo:case "text" ()
function fn() {
  const response = new Response();
  return response.text();
}
`);
    expect(results[0].result).toBe("Promise<string>");
  });

  it("response.arrayBuffer() should return Promise<unknown>", () => {
    const results = runTest(`
// @nudo:case "arrayBuffer" ()
function fn() {
  const response = new Response();
  return response.arrayBuffer();
}
`);
    expect(results[0].result).toBe("Promise<unknown>");
  });

  it("response.blob() should return Promise<unknown>", () => {
    const results = runTest(`
// @nudo:case "blob" ()
function fn() {
  const response = new Response();
  return response.blob();
}
`);
    expect(results[0].result).toBe("Promise<unknown>");
  });
});

describe("Built-in Headers API", () => {
  it("new Headers() should return Headers instance", () => {
    const results = runTest(`
// @nudo:case "new-headers" ()
function fn() {
  const headers = new Headers();
  return headers;
}
`);
    expect(results[0].result).toContain("Headers");
  });

  it("headers.get() should return string | null", () => {
    const results = runTest(`
// @nudo:case "get" ()
function fn() {
  const headers = new Headers();
  return headers.get("content-type");
}
`);
    expect(results[0].result).toContain("string");
    expect(results[0].result).toContain("null");
  });

  it("headers.has() should return boolean", () => {
    const results = runTest(`
// @nudo:case "has" ()
function fn() {
  const headers = new Headers();
  return headers.has("content-type");
}
`);
    expect(results[0].result).toBe("boolean");
  });

  it("headers.set() should return undefined", () => {
    const results = runTest(`
// @nudo:case "set" ()
function fn() {
  const headers = new Headers();
  return headers.set("content-type", "application/json");
}
`);
    expect(results[0].result).toBe("undefined");
  });

  it("headers.delete() should return undefined", () => {
    const results = runTest(`
// @nudo:case "delete" ()
function fn() {
  const headers = new Headers();
  return headers.delete("content-type");
}
`);
    expect(results[0].result).toBe("undefined");
  });

  it("headers.append() should return undefined", () => {
    const results = runTest(`
// @nudo:case "append" ()
function fn() {
  const headers = new Headers();
  return headers.append("content-type", "text/plain");
}
`);
    expect(results[0].result).toBe("undefined");
  });
});

describe("Built-in FormData API", () => {
  it("new FormData() should return FormData instance", () => {
    const results = runTest(`
// @nudo:case "new-formdata" ()
function fn() {
  const formData = new FormData();
  return formData;
}
`);
    expect(results[0].result).toContain("FormData");
  });

  it("formData.get() should return string | null", () => {
    const results = runTest(`
// @nudo:case "get" ()
function fn() {
  const formData = new FormData();
  return formData.get("name");
}
`);
    expect(results[0].result).toContain("string");
    expect(results[0].result).toContain("null");
  });

  it("formData.has() should return boolean", () => {
    const results = runTest(`
// @nudo:case "has" ()
function fn() {
  const formData = new FormData();
  return formData.has("name");
}
`);
    expect(results[0].result).toBe("boolean");
  });

  it("formData.set() should return undefined", () => {
    const results = runTest(`
// @nudo:case "set" ()
function fn() {
  const formData = new FormData();
  return formData.set("name", "value");
}
`);
    expect(results[0].result).toBe("undefined");
  });

  it("formData.delete() should return undefined", () => {
    const results = runTest(`
// @nudo:case "delete" ()
function fn() {
  const formData = new FormData();
  return formData.delete("name");
}
`);
    expect(results[0].result).toBe("undefined");
  });

  it("formData.append() should return undefined", () => {
    const results = runTest(`
// @nudo:case "append" ()
function fn() {
  const formData = new FormData();
  return formData.append("name", "value");
}
`);
    expect(results[0].result).toBe("undefined");
  });
});

describe("Built-in AbortController API", () => {
  it("new AbortController() should return AbortController instance", () => {
    const results = runTest(`
// @nudo:case "new-abort-controller" ()
function fn() {
  const controller = new AbortController();
  return controller;
}
`);
    expect(results[0].result).toContain("AbortController");
  });

  it("controller.signal should return unknown", () => {
    const results = runTest(`
// @nudo:case "signal" ()
function fn() {
  const controller = new AbortController();
  return controller.signal;
}
`);
    expect(results[0].result).toBe("unknown");
  });

  it("controller.abort() should return undefined", () => {
    const results = runTest(`
// @nudo:case "abort" ()
function fn() {
  const controller = new AbortController();
  return controller.abort();
}
`);
    expect(results[0].result).toBe("undefined");
  });
});
