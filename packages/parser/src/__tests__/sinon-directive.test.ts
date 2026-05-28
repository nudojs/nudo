import { describe, it, expect } from "vitest";
import { parse, extractDirectives, type MockDirective } from "../index.ts";

describe("Sinon Expression Support", () => {
  describe("sinon.stub()", () => {
    it("parses sinon.stub()", () => {
      const code = `
// @nudo:mock fetch = sinon.stub()
function getData() {
  return fetch("/api/data");
}
`;
      const ast = parse(code);
      const directives = extractDirectives(ast);
      expect(directives.length).toBe(1);

      const mockDirectives = directives[0].directives.filter(
        (d): d is MockDirective => d.kind === "mock"
      );
      expect(mockDirectives.length).toBe(1);
      expect(mockDirectives[0].name).toBe("fetch");
      expect(mockDirectives[0].sinonExpr).toBeDefined();
      expect(mockDirectives[0].sinonExpr!.type).toBe("stub");
    });

    it("parses sinon.stub().returns()", () => {
      const code = `
// @nudo:mock fetch = sinon.stub().returns({ data: "test" })
function getData() {
  return fetch("/api/data");
}
`;
      const ast = parse(code);
      const directives = extractDirectives(ast);
      const mockDirectives = directives[0].directives.filter(
        (d): d is MockDirective => d.kind === "mock"
      );
      expect(mockDirectives[0].sinonExpr).toBeDefined();
      expect(mockDirectives[0].sinonExpr!.type).toBe("stub");
      expect(mockDirectives[0].sinonExpr!.returnValue).toBeDefined();
    });

    it("parses sinon.stub().resolves()", () => {
      const code = `
// @nudo:mock fetch = sinon.stub().resolves({ data: "test" })
function getData() {
  return fetch("/api/data");
}
`;
      const ast = parse(code);
      const directives = extractDirectives(ast);
      const mockDirectives = directives[0].directives.filter(
        (d): d is MockDirective => d.kind === "mock"
      );
      expect(mockDirectives[0].sinonExpr).toBeDefined();
      expect(mockDirectives[0].sinonExpr!.type).toBe("stub");
      expect(mockDirectives[0].sinonExpr!.resolvedValue).toBeDefined();
    });

    it("parses sinon.stub().rejects()", () => {
      const code = `
// @nudo:mock fetch = sinon.stub().rejects(new Error("fail"))
function getData() {
  return fetch("/api/data");
}
`;
      const ast = parse(code);
      const directives = extractDirectives(ast);
      const mockDirectives = directives[0].directives.filter(
        (d): d is MockDirective => d.kind === "mock"
      );
      expect(mockDirectives[0].sinonExpr).toBeDefined();
      expect(mockDirectives[0].sinonExpr!.type).toBe("stub");
      expect(mockDirectives[0].sinonExpr!.rejectedValue).toBeDefined();
    });
  });

  describe("sinon.spy()", () => {
    it("parses sinon.spy()", () => {
      const code = `
// @nudo:mock handler = sinon.spy()
function processEvent(handler) {
  handler("event");
}
`;
      const ast = parse(code);
      const directives = extractDirectives(ast);
      const mockDirectives = directives[0].directives.filter(
        (d): d is MockDirective => d.kind === "mock"
      );
      expect(mockDirectives[0].sinonExpr).toBeDefined();
      expect(mockDirectives[0].sinonExpr!.type).toBe("spy");
    });
  });

  describe("sinon.mock()", () => {
    it("parses sinon.mock()", () => {
      const code = `
// @nudo:mock service = sinon.mock()
function useService(service) {
  service.doSomething();
}
`;
      const ast = parse(code);
      const directives = extractDirectives(ast);
      const mockDirectives = directives[0].directives.filter(
        (d): d is MockDirective => d.kind === "mock"
      );
      expect(mockDirectives[0].sinonExpr).toBeDefined();
      expect(mockDirectives[0].sinonExpr!.type).toBe("mock");
    });
  });

  describe("Complex sinon chains", () => {
    it("parses sinon.stub().onFirstCall().returns()", () => {
      const code = `
// @nudo:mock fetch = sinon.stub().onFirstCall().returns({ data: "first" })
function getData() {
  return fetch("/api/data");
}
`;
      const ast = parse(code);
      const directives = extractDirectives(ast);
      const mockDirectives = directives[0].directives.filter(
        (d): d is MockDirective => d.kind === "mock"
      );
      expect(mockDirectives[0].sinonExpr).toBeDefined();
      expect(mockDirectives[0].sinonExpr!.type).toBe("stub");
      expect(mockDirectives[0].sinonExpr!.returnValue).toBeDefined();
    });

    it("parses sinon.stub().onSecondCall().returns()", () => {
      const code = `
// @nudo:mock fetch = sinon.stub().onSecondCall().returns({ data: "second" })
function getData() {
  return fetch("/api/data");
}
`;
      const ast = parse(code);
      const directives = extractDirectives(ast);
      const mockDirectives = directives[0].directives.filter(
        (d): d is MockDirective => d.kind === "mock"
      );
      expect(mockDirectives[0].sinonExpr).toBeDefined();
      expect(mockDirectives[0].sinonExpr!.type).toBe("stub");
      expect(mockDirectives[0].sinonExpr!.returnValue).toBeDefined();
    });

    it("parses sinon.stub().onCall(n).returns()", () => {
      const code = `
// @nudo:mock fetch = sinon.stub().onCall(5).returns({ data: "fifth" })
function getData() {
  return fetch("/api/data");
}
`;
      const ast = parse(code);
      const directives = extractDirectives(ast);
      const mockDirectives = directives[0].directives.filter(
        (d): d is MockDirective => d.kind === "mock"
      );
      expect(mockDirectives[0].sinonExpr).toBeDefined();
      expect(mockDirectives[0].sinonExpr!.type).toBe("stub");
      expect(mockDirectives[0].sinonExpr!.returnValue).toBeDefined();
    });

    it("parses sinon.stub().withArgs().returns()", () => {
      const code = `
// @nudo:mock fetch = sinon.stub().withArgs("/api/data").returns({ data: "test" })
function getData() {
  return fetch("/api/data");
}
`;
      const ast = parse(code);
      const directives = extractDirectives(ast);
      const mockDirectives = directives[0].directives.filter(
        (d): d is MockDirective => d.kind === "mock"
      );
      expect(mockDirectives[0].sinonExpr).toBeDefined();
      expect(mockDirectives[0].sinonExpr!.type).toBe("stub");
      expect(mockDirectives[0].sinonExpr!.returnValue).toBeDefined();
    });

    it("parses sinon.stub().callsFake()", () => {
      const code = `
// @nudo:mock fetch = sinon.stub().callsFake((url) => ({ data: url }))
function getData() {
  return fetch("/api/data");
}
`;
      const ast = parse(code);
      const directives = extractDirectives(ast);
      const mockDirectives = directives[0].directives.filter(
        (d): d is MockDirective => d.kind === "mock"
      );
      expect(mockDirectives[0].sinonExpr).toBeDefined();
      expect(mockDirectives[0].sinonExpr!.type).toBe("stub");
      expect(mockDirectives[0].sinonExpr!.returnValue).toBeDefined();
    });
  });
});
