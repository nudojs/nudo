import { describe, it, expect } from "vitest";
import { parse } from "../parse.ts";
import {
  asProgram,
  programBody,
  asIdentifier,
  asExpression,
  asAssignmentExpression,
  asMemberExpression,
  nameOrStringValue,
  identifierName,
  getDeclarations,
  getDeclaratorInit,
  getDeclaratorId,
  getFirstDeclaratorId,
  getExportDeclaration,
  unwrapExport,
  getExportSpecifiers,
  exportSpecifierLocalName,
  exportSpecifierExportedName,
  getExpressionStatementExpression,
  fnOrClassIdName,
  classIdName,
  fnOrClassIdLoc,
  memberPropertyKey,
  memberObjectName,
  memberPropertyName,
  isModuleExportsMember,
  getClassMembers,
  classMemberKeyName,
  classMemberKey,
  classInstanceMethods,
  methodFunctionNode,
  paramDisplayName,
  paramName,
  unwrapDefaultExport,
} from "../ast-guards.ts";

function stmts(src: string) {
  return programBody(parse(src));
}

describe("asProgram / programBody", () => {
  it("unwraps File to its Program", () => {
    const ast = parse("const x = 1;");
    const program = asProgram(ast);
    expect(program?.type).toBe("Program");
    expect(program?.body).toHaveLength(1);
  });

  it("accepts a bare Program node", () => {
    const program = asProgram(parse("1;").program);
    expect(program?.type).toBe("Program");
  });

  it("returns undefined / empty body for non-program nodes", () => {
    const expr = stmts("1;")[0];
    expect(asProgram(expr)).toBeUndefined();
    expect(programBody(expr)).toEqual([]);
  });
});

describe("identifier / expression narrowers", () => {
  it("asIdentifier narrows Identifier only", () => {
    const [s] = stmts("foo;");
    const expr = getExpressionStatementExpression(s)!;
    expect(asIdentifier(expr)?.name).toBe("foo");
    expect(asIdentifier(s)).toBeUndefined();
  });

  it("asExpression accepts expressions and rejects statements", () => {
    const [s] = stmts("foo();");
    expect(asExpression(getExpressionStatementExpression(s))?.type).toBe("CallExpression");
    expect(asExpression(s)).toBeUndefined();
  });

  it("asAssignmentExpression narrows assignment chains", () => {
    const [s] = stmts("a = 1;");
    const expr = getExpressionStatementExpression(s)!;
    expect(asAssignmentExpression(expr)?.type).toBe("AssignmentExpression");
    expect(asAssignmentExpression(expr?.right)).toBeUndefined();
  });

  it("asMemberExpression narrows member access", () => {
    const [s] = stmts("module.exports;");
    const expr = getExpressionStatementExpression(s)!;
    expect(asMemberExpression(expr)?.type).toBe("MemberExpression");
    expect(asMemberExpression(s)).toBeUndefined();
  });
});

describe("nameOrStringValue / identifierName", () => {
  it("reads Identifier name and StringLiteral value", () => {
    const [s] = stmts('({ a: 1, "b": 2 });');
    const obj = getExpressionStatementExpression(s)!;
    if (obj.type !== "ObjectExpression") throw new Error("expected object");
    const p1 = obj.properties[0];
    const p2 = obj.properties[1];
    if (p1.type !== "ObjectProperty" || p2.type !== "ObjectProperty") throw new Error("expected props");
    expect(nameOrStringValue(p1.key)).toBe("a");
    expect(nameOrStringValue(p2.key)).toBe("b");
    expect(identifierName(p1.key)).toBe("a");
    expect(identifierName(p2.key)).toBeUndefined();
  });
});

describe("declarations", () => {
  it("getDeclarations / first declarator id+init", () => {
    const [s] = stmts("const f = () => {};");
    const decls = getDeclarations(s);
    expect(decls).toHaveLength(1);
    expect(getFirstDeclaratorId(s)?.name).toBe("f");
    expect(getDeclaratorId(decls[0])?.name).toBe("f");
    expect(getDeclaratorInit(decls[0])?.type).toBe("ArrowFunctionExpression");
  });

  it("returns empty/undefined for non-declaration nodes", () => {
    const [s] = stmts("f();");
    expect(getDeclarations(s)).toEqual([]);
    expect(getFirstDeclaratorId(s)).toBeUndefined();
    expect(getDeclaratorInit(getDeclarations(s)[0])).toBeUndefined();
  });
});

describe("export unwrapping", () => {
  it("unwrapExport marks named/default exports", () => {
    const named = stmts("export function f() {}")[0];
    const defaultExp = stmts("export default function g() {}")[0];
    const plain = stmts("function h() {}")[0];
    expect(unwrapExport(named)).toMatchObject({ exported: true });
    expect((unwrapExport(named).declaration as { type: string }).type).toBe("FunctionDeclaration");
    expect(unwrapExport(defaultExp).exported).toBe(true);
    expect(unwrapExport(plain)).toEqual({ declaration: plain, exported: false });
  });

  it("getExportDeclaration returns the inner declaration", () => {
    const named = stmts("export const x = 1;")[0];
    expect(getExportDeclaration(named)?.type).toBe("VariableDeclaration");
    expect(getExportDeclaration(stmts("const x = 1;")[0])).toBeUndefined();
  });

  it("getExportSpecifiers lists named-export specifiers", () => {
    const body = stmts("const a = 1, c = 2; export { a as b, c };");
    const s = body.find((x) => x.type === "ExportNamedDeclaration")!;
    const specs = getExportSpecifiers(s);
    expect(specs).toHaveLength(2);
    expect(exportSpecifierLocalName(specs[0])).toBe("a");
    expect(exportSpecifierExportedName(specs[0])).toBe("b");
    expect(exportSpecifierLocalName(specs[1])).toBe("c");
    expect(exportSpecifierExportedName(specs[1])).toBe("c");
    expect(getExportSpecifiers(stmts("1;")[0])).toEqual([]);
  });

  it("export specifier names handle string module names", () => {
    const body = stmts('const a = 1; export { a as "str-name" };');
    const s = body.find((x) => x.type === "ExportNamedDeclaration")!;
    const spec = getExportSpecifiers(s)[0];
    if (spec.type !== "ExportSpecifier") throw new Error("expected specifier");
    expect(exportSpecifierLocalName(spec)).toBe("a");
    expect(exportSpecifierExportedName(spec)).toBe("str-name");
    expect(nameOrStringValue(spec.exported)).toBe("str-name");
  });
});

describe("function / class ids", () => {
  it("fnOrClassIdName and classIdName", () => {
    expect(fnOrClassIdName(stmts("function foo() {}")[0])).toBe("foo");
    expect(fnOrClassIdName(stmts("class Bar {}")[0])).toBe("Bar");
    expect(fnOrClassIdName(stmts("(() => {})();")[0])).toBeUndefined();
    expect(classIdName(stmts("class Bar {}")[0])).toBe("Bar");
    expect(classIdName(stmts("function foo() {}")[0])).toBeUndefined();
  });

  it("fnOrClassIdLoc falls back to undefined when anonymous", () => {
    const named = stmts("function foo() {}")[0];
    expect(fnOrClassIdLoc(named)).toBeTruthy();
    const anon = stmts("(() => {})();")[0];
    const call = getExpressionStatementExpression(anon)!;
    if (call.type !== "CallExpression") throw new Error("expected call");
    expect(fnOrClassIdLoc(call.callee)).toBeUndefined();
  });
});

describe("member access", () => {
  it("reads module.exports shape", () => {
    const [s] = stmts("module.exports = 1;");
    const assign = getExpressionStatementExpression(s)!;
    if (assign.type !== "AssignmentExpression") throw new Error("expected assignment");
    const target = asMemberExpression(assign.left)!;
    expect(memberObjectName(target)).toBe("module");
    expect(memberPropertyName(target)).toBe("exports");
    expect(isModuleExportsMember(target)).toBe(true);
    expect(memberPropertyKey(target)).toBe("exports");
  });

  it("rejects computed members and non-module objects", () => {
    const [s] = stmts('module["exports"] = 1;');
    const assign = getExpressionStatementExpression(s)!;
    if (assign.type !== "AssignmentExpression") throw new Error("expected assignment");
    const target = asMemberExpression(assign.left)!;
    expect(memberPropertyName(target)).toBeUndefined();
    expect(isModuleExportsMember(target)).toBe(false);
    expect(memberPropertyKey(target)).toBeNull();

    const [s2] = stmts("exports.x = 1;");
    const assign2 = getExpressionStatementExpression(s2)!;
    if (assign2.type !== "AssignmentExpression") throw new Error("expected assignment");
    const target2 = asMemberExpression(assign2.left)!;
    expect(memberObjectName(target2)).toBe("exports");
    expect(isModuleExportsMember(target2)).toBe(false);
  });

  it("memberPropertyKey reads non-computed Identifier keys; computed → null", () => {
    const body = stmts("obj.foo; obj[baz];");
    const [a, c] = body.map((st) => asMemberExpression(getExpressionStatementExpression(st)));
    expect(memberPropertyKey(a!)).toBe("foo");
    expect(memberPropertyKey(c!)).toBeNull();
  });
});

describe("class members", () => {
  const src = `
    class C {
      m() {}
      get g() { return 1; }
      static s() {}
      p = 1;
    }
  `;
  it("getClassMembers lists the class body", () => {
    const members = getClassMembers(stmts(src)[0]);
    expect(members.length).toBeGreaterThanOrEqual(4);
    expect(getClassMembers(stmts("1;")[0])).toEqual([]);
  });

  it("classInstanceMethods keeps only non-static methods", () => {
    const methods = classInstanceMethods(stmts(src)[0]);
    expect(methods.map((m) => m.name)).toEqual(["m"]);
    expect(methods[0].node.type).toBe("ClassMethod");
  });

  it("classMemberKeyName / classMemberKey read the key", () => {
    const members = getClassMembers(stmts(src)[0]);
    const m = members.find((x) => classMemberKeyName(x) === "m")!;
    expect(classMemberKeyName(m)).toBe("m");
    expect(classMemberKey(m)?.type).toBe("Identifier");
  });

  it("methodFunctionNode unwraps ESTree MethodDefinition value", () => {
    const estree = {
      type: "MethodDefinition",
      kind: "method",
      static: false,
      key: { type: "Identifier", name: "m" },
      value: { type: "FunctionExpression", params: [] },
    };
    const methods = classInstanceMethods({
      type: "ClassDeclaration",
      id: { type: "Identifier", name: "C" },
      body: { type: "ClassBody", body: [estree] },
    } as never);
    expect(methods).toHaveLength(1);
    expect(methods[0].name).toBe("m");
    expect(methods[0].node.type).toBe("FunctionExpression");
    expect(methodFunctionNode(estree as never)?.type).toBe("FunctionExpression");
  });
});

describe("paramDisplayName / paramName", () => {
  it("labels identifiers, rest params, and fallbacks", () => {
    const [s] = stmts("function f(a, ...rest) {}");
    if (s.type !== "FunctionDeclaration") throw new Error("expected fn");
    const [a, rest] = s.params;
    expect(paramDisplayName(a)).toBe("a");
    expect(paramDisplayName(rest)).toBe("...rest");
    expect(paramDisplayName(null)).toBe("_");
    expect(paramName(a)).toBe("a");
    expect(paramName(rest)).toBe("rest");
    expect(paramName(null)).toBeUndefined();
  });

  it("keeps historical ...undefined for non-identifier rest arguments", () => {
    const [s] = stmts("function f(...[a]) {}");
    if (s.type !== "FunctionDeclaration") throw new Error("expected fn");
    expect(paramDisplayName(s.params[0])).toBe("...undefined");
    expect(paramName(s.params[0])).toBeUndefined();
  });

  it("labels assignment patterns and other params as _", () => {
    const [s] = stmts("function f(a = 1) {}");
    if (s.type !== "FunctionDeclaration") throw new Error("expected fn");
    expect(paramDisplayName(s.params[0])).toBe("_");
  });
});

describe("unwrapDefaultExport", () => {
  it("passes through callables and unwraps { default }", () => {
    const fn = () => 1;
    expect(unwrapDefaultExport(fn)).toBe(fn);
    expect(unwrapDefaultExport({ default: fn })).toBe(fn);
  });
});
