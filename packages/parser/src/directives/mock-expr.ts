import type { MockHelper } from "@nudojs/core";
import { absFunction, mock, spy, stub } from "@nudojs/core";
import { parseAbsExpr } from "./case-arg.ts";
import { parseArrowFunctionExpr, splitTopLevelArgs } from "./expr-scan.ts";
import type { SinonExpression } from "./types.ts";

export function parseSinonExpr(expr: string): SinonExpression | null {
  const s = expr.trim();

  // Match sinon.stub().returns(value)
  const stubReturnsMatch = s.match(/^sinon\.stub\(\)\.returns\((.+)\)$/);
  if (stubReturnsMatch) {
    return {
      type: "stub",
      returnValue: parseAbsExpr(stubReturnsMatch[1].trim()),
    };
  }

  // Match sinon.stub().resolves(value)
  const stubResolvesMatch = s.match(/^sinon\.stub\(\)\.resolves\((.+)\)$/);
  if (stubResolvesMatch) {
    return {
      type: "stub",
      resolvedValue: parseAbsExpr(stubResolvesMatch[1].trim()),
    };
  }

  // Match sinon.stub().rejects(value)
  const stubRejectsMatch = s.match(/^sinon\.stub\(\)\.rejects\((.+)\)$/);
  if (stubRejectsMatch) {
    return {
      type: "stub",
      rejectedValue: parseAbsExpr(stubRejectsMatch[1].trim()),
    };
  }

  // Match sinon.stub().onFirstCall().returns(value)
  const onFirstCallReturnsMatch = s.match(/^sinon\.stub\(\)\.onFirstCall\(\)\.returns\((.+)\)$/);
  if (onFirstCallReturnsMatch) {
    return {
      type: "stub",
      returnValue: parseAbsExpr(onFirstCallReturnsMatch[1].trim()),
    };
  }

  // Match sinon.stub().onSecondCall().returns(value)
  const onSecondCallReturnsMatch = s.match(/^sinon\.stub\(\)\.onSecondCall\(\)\.returns\((.+)\)$/);
  if (onSecondCallReturnsMatch) {
    return {
      type: "stub",
      returnValue: parseAbsExpr(onSecondCallReturnsMatch[1].trim()),
    };
  }

  // Match sinon.stub().onThirdCall().returns(value)
  const onThirdCallReturnsMatch = s.match(/^sinon\.stub\(\)\.onThirdCall\(\)\.returns\((.+)\)$/);
  if (onThirdCallReturnsMatch) {
    return {
      type: "stub",
      returnValue: parseAbsExpr(onThirdCallReturnsMatch[1].trim()),
    };
  }

  // Match sinon.stub().onCall(n).returns(value)
  const onCallReturnsMatch = s.match(/^sinon\.stub\(\)\.onCall\(\d+\)\.returns\((.+)\)$/);
  if (onCallReturnsMatch) {
    return {
      type: "stub",
      returnValue: parseAbsExpr(onCallReturnsMatch[1].trim()),
    };
  }

  // Match sinon.stub().withArgs(args).returns(value)
  const withArgsReturnsMatch = s.match(/^sinon\.stub\(\)\.withArgs\(.+\)\.returns\((.+)\)$/);
  if (withArgsReturnsMatch) {
    return {
      type: "stub",
      returnValue: parseAbsExpr(withArgsReturnsMatch[1].trim()),
    };
  }

  // Match sinon.stub().callsFake(fn)
  const callsFakeMatch = s.match(/^sinon\.stub\(\)\.callsFake\((.+)\)$/);
  if (callsFakeMatch) {
    // For callsFake, we try to parse the function as an arrow function
    const arrowFn = parseArrowFunctionExpr(callsFakeMatch[1].trim());
    if (arrowFn) {
      return {
        type: "stub",
        returnValue: absFunction(arrowFn.params, {
          body: arrowFn.body,
        }),
      };
    }
    return { type: "stub" };
  }

  // Match sinon.stub().returns(value).onFirstCall().returns(otherValue)
  // This is a complex chain - we'll just use the first .returns() value
  const complexChainMatch = s.match(/^sinon\.stub\(\)\.returns\((.+)\)\./);
  if (complexChainMatch) {
    return {
      type: "stub",
      returnValue: parseAbsExpr(complexChainMatch[1].trim()),
    };
  }

  // Match sinon.stub() (no chaining)
  if (s === "sinon.stub()") {
    return { type: "stub" };
  }

  // Match sinon.spy()
  if (s === "sinon.spy()") {
    return { type: "spy" };
  }

  // Match sinon.mock()
  if (s === "sinon.mock()") {
    return { type: "mock" };
  }

  return null;
}

export function parseNudoMockExpr(expr: string): MockHelper | null {
  // BUG-014 同族：sinon 前缀剥离改迭代。原尾递归对 `sinon.`×N 实参每层一帧，
  // 恶意超长前缀以 RangeError 打穿 extractDirectives。顶部一次性剥净等价：
  // 下方所有分支锚定 `^stub\(` / `^spy\(` / `^mock\(` 或精确匹配，无一能匹配
  // `sinon.` 开头的串，先剥后试与逐层剥试结果一致。
  let s = expr.trim();
  while (s.startsWith("sinon.")) s = s.slice("sinon.".length);

  // Match stub().returns(value).onFirstCall()
  const stubReturnsOnFirstMatch = s.match(/^stub\(\)\.returns\((.+)\)\.onFirstCall\(\)$/);
  if (stubReturnsOnFirstMatch) {
    const helper = stub.returns(parseAbsExpr(stubReturnsOnFirstMatch[1].trim()));
    helper.onFirstCallValue = helper.returnValue;
    return helper;
  }

  // Match stub().returns(value).onSecondCall()
  const stubReturnsOnSecondMatch = s.match(/^stub\(\)\.returns\((.+)\)\.onSecondCall\(\)$/);
  if (stubReturnsOnSecondMatch) {
    return stub.returns(parseAbsExpr(stubReturnsOnSecondMatch[1].trim()));
  }

  // Match stub().returns(value).onCall(n)
  const stubReturnsOnCallMatch = s.match(/^stub\(\)\.returns\((.+)\)\.onCall\(\d+\)$/);
  if (stubReturnsOnCallMatch) {
    return stub.returns(parseAbsExpr(stubReturnsOnCallMatch[1].trim()));
  }

  // Match stub().callsFake((args) => body)
  const stubCallsFakeMatch = s.match(/^stub\(\)\.callsFake\((.+)\)$/);
  if (stubCallsFakeMatch) {
    const arrowFn = parseArrowFunctionExpr(stubCallsFakeMatch[1].trim());
    if (arrowFn) {
      return stub.callsFake({ params: arrowFn.params, body: arrowFn.body, async: false });
    }
    return { kind: "mock-helper" };
  }

  // Match stub().withArgs(args).returns(value)
  const stubWithArgsMatch = s.match(/^stub\(\)\.withArgs\((.+)\)\.returns\((.+)\)$/);
  if (stubWithArgsMatch) {
    const retVal = parseAbsExpr(stubWithArgsMatch[2].trim());
    const argsStr = stubWithArgsMatch[1].trim();
    const args = splitTopLevelArgs(argsStr).map((a) => parseAbsExpr(a));
    // 返回值只挂在 withArgs 分支上（sinon 语义：实参匹配才返回），不设全局
    // returnValue —— 否则未命中调用会错误复用链返回值
    const helper: MockHelper = { kind: "mock-helper" };
    helper.withArgsCases = [{ args, returnValue: retVal }];
    return helper;
  }

  // Match stub().onFirstCall().returns(value) —— 链在 returns 上取值
  const stubOnFirstReturnsMatch = s.match(/^stub\(\)\.onFirstCall\(\)\.returns\((.+)\)$/);
  if (stubOnFirstReturnsMatch) {
    return stub.returns(parseAbsExpr(stubOnFirstReturnsMatch[1].trim()));
  }

  // Match stub().onFirstCall(value) —— 无 returnValue 时 Abs 作默认返回
  // [^()]* 避免把 onFirstCall().returns(...) 的尾链吞进实参
  const stubOnFirstValueMatch = s.match(/^stub\(\)\.onFirstCall\(([^()]*)\)$/);
  if (stubOnFirstValueMatch && stubOnFirstValueMatch[1].trim() !== "") {
    const helper: MockHelper = { kind: "mock-helper" };
    helper.onFirstCallValue = parseAbsExpr(stubOnFirstValueMatch[1].trim());
    return helper;
  }

  // Match spy().returns(value)
  const spyReturnsMatch = s.match(/^spy\(\)\.returns\((.+)\)$/);
  if (spyReturnsMatch) {
    return spy.returns(parseAbsExpr(spyReturnsMatch[1].trim()));
  }

  // Match stub().resolves(value).onFirstCall()
  const stubResolvesOnFirstMatch = s.match(/^stub\(\)\.resolves\((.+)\)\.onFirstCall\(\)$/);
  if (stubResolvesOnFirstMatch) {
    return stub.resolves(parseAbsExpr(stubResolvesOnFirstMatch[1].trim()));
  }

  // Match stub().returns(value)
  const stubReturnsMatch = s.match(/^stub\(\)\.returns\((.+)\)$/);
  if (stubReturnsMatch) {
    return stub.returns(parseAbsExpr(stubReturnsMatch[1].trim()));
  }

  // Match stub().resolves(value)
  const stubResolvesMatch = s.match(/^stub\(\)\.resolves\((.+)\)$/);
  if (stubResolvesMatch) {
    return stub.resolves(parseAbsExpr(stubResolvesMatch[1].trim()));
  }

  // Match stub().rejects(value)
  const stubRejectsMatch = s.match(/^stub\(\)\.rejects\((.+)\)$/);
  if (stubRejectsMatch) {
    return stub.rejects(parseAbsExpr(stubRejectsMatch[1].trim()));
  }

  // Match stub()
  if (s === "stub()") {
    return stub();
  }

  // Match spy()
  if (s === "spy()") {
    return spy();
  }

  // Match mock()
  if (s === "mock()") {
    return mock();
  }

  return null;
}
