import type { Node } from "@babel/types";
import traverse from "@babel/traverse";
import type { SymbolInfo, ReferenceInfo, SymbolTable, SourceLocation } from "@nudojs/service";

function locFromNode(node: Node): SourceLocation {
  return {
    start: { line: node.loc?.start.line ?? 1, column: node.loc?.start.column ?? 0 },
    end: { line: node.loc?.end.line ?? 1, column: node.loc?.end.column ?? 0 },
  };
}

export function buildSymbolTable(ast: Node, uri: string): SymbolTable {
  const definitions = new Map<string, SymbolInfo>();
  const references: ReferenceInfo[] = [];

  const traverseFn = (typeof traverse === "function" ? traverse : (traverse as any).default) as typeof traverse;

  try {
    traverseFn(ast, {
      // Collect definitions
      FunctionDeclaration(path) {
        if (path.node.id) {
          definitions.set(path.node.id.name, {
            name: path.node.id.name,
            kind: "function",
            loc: locFromNode(path.node.id),
            uri,
          });
        }
      },
      VariableDeclarator(path) {
        if (path.node.id.type === "Identifier") {
          definitions.set(path.node.id.name, {
            name: path.node.id.name,
            kind: "variable",
            loc: locFromNode(path.node.id),
            uri,
          });
        }
      },
      ClassDeclaration(path) {
        if (path.node.id) {
          definitions.set(path.node.id.name, {
            name: path.node.id.name,
            kind: "class",
            loc: locFromNode(path.node.id),
            uri,
          });
        }
      },
      // Collect references
      Identifier(path) {
        // Skip definition sites
        if (path.parentPath?.node.type === "FunctionDeclaration" && path.parentPath.node.id === path.node) return;
        if (path.parentPath?.node.type === "VariableDeclarator" && path.parentPath.node.id === path.node) return;
        if (path.parentPath?.node.type === "ClassDeclaration" && path.parentPath.node.id === path.node) return;

        references.push({
          name: path.node.name,
          loc: locFromNode(path.node),
          uri,
        });
      },
    });
  } catch {
    // traverse may fail on partial ASTs
  }

  return { definitions, references };
}

export function findDefinition(
  symbolTable: SymbolTable,
  name: string,
): SymbolInfo | null {
  return symbolTable.definitions.get(name) ?? null;
}

export function findReferences(
  symbolTable: SymbolTable,
  name: string,
): ReferenceInfo[] {
  return symbolTable.references.filter((r) => r.name === name);
}

export function findIdentifierAtPosition(ast: Node, line: number, column: number): string | null {
  let found: string | null = null;
  const traverseFn = (typeof traverse === "function" ? traverse : (traverse as any).default) as typeof traverse;

  try {
    traverseFn(ast, {
      Identifier(path) {
        const loc = path.node.loc;
        if (!loc) return;
        if (
          loc.start.line === line &&
          loc.start.column <= column &&
          loc.end.column >= column
        ) {
          found = path.node.name;
          path.stop();
        }
      },
    });
  } catch {
    // ignore
  }
  return found;
}
