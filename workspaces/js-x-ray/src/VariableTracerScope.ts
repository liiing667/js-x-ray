// Import Third-party Dependencies
import { type ESTree } from "meriyah";

// Import Internal Dependencies
import {
  getParamNames,
  getVariableDeclarationIdentifiers
} from "./estree/index.ts";
import { walk } from "./walker/index.ts";

export type TracerScopeKind = "function" | "block";

export interface TracerScope<T = unknown> {
  kind: TracerScopeKind;
  /**
   * Aliases to traced identifiers declared directly in this scope
   * @example const r = require; // "r" is an alias scoped to its declaration
   */
  aliases: Map<string, T>;
  /**
   * Names declared in this scope (params, hoisted vars, let/const/class
   * and function declarations) that shadow any outer traced identifier
   */
  shadows: Set<string>;
  /**
   * Return value assignments to traced identifiers declared in this scope
   */
  assignedReturnValues: Map<string, string>;
  start: ESTree.Position;
  end: ESTree.Position;
}

export function isPositionBefore(
  a: ESTree.Position,
  b: ESTree.Position
): boolean {
  return a.line < b.line || (a.line === b.line && a.column < b.column);
}

export function isWithinScope(
  position: ESTree.Position,
  scope: Pick<TracerScope, "start" | "end">
): boolean {
  return !isPositionBefore(position, scope.start) &&
    isPositionBefore(position, scope.end);
}

function isFunctionNode(
  node: ESTree.Node
): node is ESTree.FunctionDeclaration | ESTree.FunctionExpression | ESTree.ArrowFunctionExpression {
  return node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression";
}

function* collectDeclaredNames(
  id: ESTree.Node
): IterableIterator<string> {
  for (const { name } of getVariableDeclarationIdentifiers(id as any)) {
    yield name;
  }
}

function collectHoistedVarNames(
  body: ESTree.Node
): string[] {
  const names: string[] = [];

  walk(body, {
    enter(node) {
      if (isFunctionNode(node)) {
        /*
         * Do not cross function boundaries: var declarations are
         * hoisted to the nearest function scope only.
         */
        this.skip();

        return;
      }
      if (node.type === "VariableDeclaration" && node.kind === "var") {
        for (const declarator of node.declarations) {
          names.push(...collectDeclaredNames(declarator.id));
        }
      }
    }
  });

  return names;
}

function collectBlockDeclaredNames(
  node: ESTree.BlockStatement
): string[] {
  const names: string[] = [];

  for (const statement of node.body) {
    if (statement.type === "VariableDeclaration" && statement.kind !== "var") {
      for (const declarator of statement.declarations) {
        names.push(...collectDeclaredNames(declarator.id));
      }
    }
    else if (
      (statement.type === "FunctionDeclaration" || statement.type === "ClassDeclaration") &&
      statement.id !== null
    ) {
      names.push(statement.id.name);
    }
  }

  return names;
}

function collectFunctionDeclaredNames(
  node: ESTree.FunctionDeclaration | ESTree.FunctionExpression | ESTree.ArrowFunctionExpression
): Set<string> {
  const declaredNames = new Set<string>(getParamNames(node.params));
  if (node.type === "FunctionExpression" && node.id !== null) {
    declaredNames.add(node.id.name);
  }
  if (node.body) {
    for (const name of collectHoistedVarNames(node.body)) {
      declaredNames.add(name);
    }
  }

  return declaredNames;
}

function collectForStatementDeclaredNames(
  init: ESTree.Node | null
): string[] {
  if (init?.type !== "VariableDeclaration" || init.kind === "var") {
    return [];
  }

  return init.declarations.flatMap(
    (declarator) => [...collectDeclaredNames(declarator.id)]
  );
}

/**
 * Create a tracer scope for scope-creating nodes (functions, blocks,
 * catch clauses and loops), pre-populated with the names they declare
 * (including hoisted ones). Returns null for any other node.
 */
export function createTracerScope(
  node: ESTree.Node
): TracerScope | null {
  if (!node.loc) {
    return null;
  }

  let kind: TracerScopeKind;
  let declaredNames: Iterable<string>;

  if (isFunctionNode(node)) {
    kind = "function";
    declaredNames = collectFunctionDeclaredNames(node);
  }
  else if (node.type === "BlockStatement") {
    kind = "block";
    declaredNames = collectBlockDeclaredNames(node);
  }
  else if (node.type === "CatchClause") {
    kind = "block";
    declaredNames = node.param ? [...collectDeclaredNames(node.param)] : [];
  }
  else if (node.type === "ForStatement") {
    kind = "block";
    declaredNames = collectForStatementDeclaredNames(node.init);
  }
  else if (node.type === "ForInStatement" || node.type === "ForOfStatement") {
    kind = "block";
    declaredNames = collectForStatementDeclaredNames(node.left);
  }
  else {
    return null;
  }

  return {
    kind,
    aliases: new Map(),
    shadows: new Set(declaredNames),
    assignedReturnValues: new Map(),
    start: node.loc.start,
    end: node.loc.end
  };
}
