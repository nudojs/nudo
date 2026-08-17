import type { TypeValue } from "@nudojs/core";

export function generateGuardFunction(name: string, tv: TypeValue): string {
  const body = generateGuardBody(tv, "data");
  return `export function ${name}(data) {\n  return ${body};\n}`;
}

function generateGuardBody(tv: TypeValue, varName: string): string {
  switch (tv.kind) {
    case "literal": {
      if (tv.value === null) return `${varName} === null`;
      if (tv.value === undefined) return `${varName} === undefined`;
      return `${varName} === ${JSON.stringify(tv.value)}`;
    }
    case "primitive":
      return `typeof ${varName} === '${tv.type}'`;
    case "refined":
      return generateGuardBody(tv.base, varName);
    case "object": {
      const checks = [`typeof ${varName} === 'object'`, `${varName} !== null`];
      for (const [key, val] of Object.entries(tv.properties)) {
        checks.push(generateGuardBody(val, `${varName}.${key}`));
      }
      return checks.join(" && ");
    }
    case "array":
      return `Array.isArray(${varName}) && ${varName}.every(item => ${generateGuardBody(tv.element, "item")})`;
    case "tuple": {
      const checks = [`Array.isArray(${varName})`, `${varName}.length === ${tv.elements.length}`];
      tv.elements.forEach((el, i) => {
        checks.push(generateGuardBody(el, `${varName}[${i}]`));
      });
      return checks.join(" && ");
    }
    case "union": {
      const members = tv.members.map((m) => generateGuardBody(m, varName));
      return `(${members.join(" || ")})`;
    }
    case "never":
      return "false";
    case "unknown":
      return "true";
    case "function":
      return `typeof ${varName} === 'function'`;
    case "promise":
      return `${varName} instanceof Promise`;
    case "instance":
      return `${varName} instanceof ${tv.className}`;
  }
}
