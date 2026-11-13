// Import Node.js Dependencies
import { EventEmitter } from "node:events";

// Import Third-party Dependencies
import { type ESTree } from "meriyah";

// Import Internal Dependencies
import {
  extractLogicalExpression,
  getCallExpressionArguments,
  getCallExpressionIdentifier,
  getMemberExpressionIdentifier,
  getVariableDeclarationIdentifiers,
  isCallExpression,
  isStringLiteral,
  toLiteral
} from "./estree/index.ts";
import {
  createTracerScope,
  isWithinScope,
  type TracerScope
} from "./VariableTracerScope.ts";
import {
  getSubMemberExpressionSegments,
  isEvilIdentifierPath,
  isNeutralCallable,
  makePrefixRemover,
  notNullOrUndefined,
  stripNodePrefix
} from "./utils/index.ts";

// CONSTANTS
const kGlobalIdentifiersToTrace = new Set([
  "globalThis",
  "global",
  "root",
  "GLOBAL",
  "window"
]);
const kGlobalIdentifiersRemover = makePrefixRemover(kGlobalIdentifiersToTrace);
const kRequirePatterns = new Set([
  "require",
  "require.resolve",
  "require.main",
  "process.mainModule.require",
  "process.getBuiltinModule"
]);
const kUnsafeGlobalCallExpression = new Set(["eval", "Function"]);

export interface DataIdentifierOptions {
  /**
   * If true, removes global identifier prefixes (globalThis, window, etc.)
   * @default false
   * @example "globalThis.require" becomes "require"
   */
  removeGlobalIdentifier?: boolean;
}

export interface SourceTraced {
  /**
   * If true, assignments to other variables will also be traced
   * @default false
   * @example const r = require; // 'r' will also be traced
   */
  followConsecutiveAssignment?: boolean;

  /**
   * If true, return values assigned to variables will be traced
   * @default false
   * @example const result = someTracedFunction();
   */
  followReturnValueAssignement?: boolean;

  /**
   * Module name to associate with this traced identifier
   * Used to track if the module has been imported
   * @default null
   */
  moduleName?: string | null;

  /**
   * Human-readable name for this traced identifier
   * @default identifierOrMemberExpr
   */
  name?: string;
}

export interface AssignmentMemory {
  /**
   * Type of assignment:
   * - "AliasBinding": Direct variable assignment (const x = require)
   * - "ReturnValueAssignment": Assignment from function return (const x = require())
   */
  type: "AliasBinding" | "ReturnValueAssignment";

  /**
   * Name of the variable that received the assignment
   */
  name: string;
}

export interface Traced extends Required<SourceTraced> {
  identifierOrMemberExpr: string;
  assignmentMemory: AssignmentMemory[];
}

export interface TracedIdentifierReport {
  /**
   * Human-readable name of the traced identifier
   */
  name: string;

  /**
   * Full identifier or member expression being traced
   * @example "process.mainModule.require"
   */
  identifierOrMemberExpr: string;

  /**
   * History of assignments made to this traced identifier
   */
  assignmentMemory: AssignmentMemory[];
}

interface Payload {
  name: string;
  identifierOrMemberExpr: string;
  id: string;
  location: ESTree.SourceLocation | null | undefined;
}

export interface AssignmentEventPayload extends Payload { }

export interface ReturnValueEventPayload extends Payload {
  arguments: ESTree.Expression[];
  node: ESTree.CallExpression | ESTree.NewExpression;
}

export interface ImportEventPayload {
  moduleName: string;
  value: string;
  location: ESTree.SourceLocation | null | undefined;
}

export interface LiteralIdentifier {
  value: string;
  type: "Literal" | "TemplateLiteral";
}

export class VariableTracer extends EventEmitter {
  static AssignmentEvent = Symbol("AssignmentEvent");
  static ImportEvent = Symbol("ImportEvent");
  static ReturnValueEvent = Symbol("ReturnValueEvent");

  // PUBLIC PROPERTIES
  literalIdentifiers = new Map<string, LiteralIdentifier>();
  /**
   * Resolves an identifier assigned an object literal back to its ObjectExpression node.
   * @example
   * const opts = { useOnlyCustomLevels: true };
   * pino(opts); // "opts" resolves via objectIdentifiers
   */
  objectIdentifiers = new Map<string, ESTree.ObjectExpression>();
  importedModules = new Set<string>();

  // PRIVATE PROPERTIES
  #traced = new Map<string, Traced>();
  /**
   * Names registered through trace() (require, eval, module names...).
   * Unlike aliases, patterns are global and cannot be shadowed by
   * local declarations.
   */
  #tracedPatterns = new Set<string>();
  #variablesRefToGlobal = new Set<string>();
  #neutralCallable = new Set<string>();
  #assignedReturnValueToTraced = new Map<string, string>();
  #scopes: TracerScope<Traced>[] = [];
  #declarationKind: ESTree.VariableDeclaration["kind"] | "import" | null = null;

  debug() {
    console.log(this.#traced);
  }

  resolveLiteralIdentifier = (name: string): string | null => (
    this.literalIdentifiers.get(name)?.value ?? null
  );

  /**
   * Resolve a traced identifier through the lexical scope chain.
   * A name declared in an inner scope shadows any outer traced alias.
   * Traced patterns (require, eval...) are global and never shadowed.
   */
  #lookupTraced(
    identifierOrMemberExpr: string
  ): Traced | undefined {
    for (let i = this.#scopes.length - 1; i >= 0; i--) {
      const scope = this.#scopes[i];
      const alias = scope.aliases.get(identifierOrMemberExpr);
      if (alias !== undefined) {
        return alias;
      }
      if (
        scope.shadows.has(identifierOrMemberExpr) &&
        !this.#tracedPatterns.has(identifierOrMemberExpr)
      ) {
        return undefined;
      }
    }

    return this.#traced.get(identifierOrMemberExpr);
  }

  #lookupAssignedReturnValue(
    name: string
  ): string | undefined {
    for (let i = this.#scopes.length - 1; i >= 0; i--) {
      const scope = this.#scopes[i];
      const assigned = scope.assignedReturnValues.get(name);
      if (assigned !== undefined) {
        return assigned;
      }
      if (scope.shadows.has(name)) {
        return undefined;
      }
    }

    return this.#assignedReturnValueToTraced.get(name);
  }

  #hasTraced(
    identifierOrMemberExpr: string
  ): boolean {
    return this.#lookupTraced(identifierOrMemberExpr) !== undefined;
  }

  /**
   * Select the scope in which a new declaration must be registered:
   * - var declarations hoist to the nearest function scope
   * - let/const declarations belong to the innermost (block) scope
   * - import declarations and top-level declarations belong to the root
   */
  #selectDeclarationScope(): TracerScope<Traced> | null {
    if (this.#declarationKind === "var") {
      for (let i = this.#scopes.length - 1; i >= 0; i--) {
        if (this.#scopes[i].kind === "function") {
          return this.#scopes[i];
        }
      }

      return null;
    }
    if (this.#declarationKind === "import") {
      return null;
    }

    return this.#scopes.length > 0 ?
      this.#scopes[this.#scopes.length - 1] :
      null;
  }

  #registerTracedAlias(
    name: string,
    tracedVariant: Traced
  ): boolean {
    const scope = this.#selectDeclarationScope();
    if (scope === null) {
      if (this.#traced.has(name)) {
        return false;
      }
      this.#traced.set(name, tracedVariant);

      return true;
    }
    if (scope.aliases.has(name)) {
      return false;
    }
    scope.shadows.delete(name);
    scope.aliases.set(name, tracedVariant);

    return true;
  }

  #registerAssignedReturnValue(
    name: string,
    tracedFullIdentifierName: string
  ): void {
    const scope = this.#selectDeclarationScope();
    if (scope === null) {
      this.#assignedReturnValueToTraced.set(name, tracedFullIdentifierName);

      return;
    }
    scope.shadows.delete(name);
    scope.assignedReturnValues.set(name, tracedFullIdentifierName);
  }

  /**
   * Synchronize the lexical scope stack with the walked node:
   * scopes whose range does not contain the node are popped, and
   * scope-creating nodes (functions, blocks, catch, loops) push a
   * new scope pre-populated with their declared (hoisted) names.
   */
  #syncScopes(
    node: ESTree.Node
  ): void {
    const { loc } = node;
    if (loc) {
      while (
        this.#scopes.length > 0 &&
        !isWithinScope(loc.start, this.#scopes[this.#scopes.length - 1])
      ) {
        this.#scopes.pop();
      }

      const scope = createTracerScope(node);
      if (scope !== null) {
        this.#scopes.push(scope as TracerScope<Traced>);
      }
    }
  }

  enableDefaultTracing() {
    [...kRequirePatterns]
      .forEach((pattern) => this.trace(pattern, { followConsecutiveAssignment: true, name: "require" }));

    return this
      .trace("eval")
      .trace("Function")
      .trace("atob", { followConsecutiveAssignment: true });
  }

  /**
   * @example
   * new VariableTracer()
   *  .trace("require", { followConsecutiveAssignment: true })
   *  .trace("process.mainModule")
   */
  trace(
    identifierOrMemberExpr: string,
    options: SourceTraced = {}
  ) {
    const {
      followConsecutiveAssignment = false,
      followReturnValueAssignement = false,
      moduleName = null,
      name = identifierOrMemberExpr
    } = options;

    this.#traced.set(identifierOrMemberExpr, {
      name,
      identifierOrMemberExpr,
      followConsecutiveAssignment,
      followReturnValueAssignement,
      assignmentMemory: [],
      moduleName
    });
    this.#tracedPatterns.add(identifierOrMemberExpr);

    if (identifierOrMemberExpr.includes(".")) {
      for (const expr of getSubMemberExpressionSegments(identifierOrMemberExpr)) {
        if (!this.#traced.has(expr)) {
          this.trace(expr, {
            followConsecutiveAssignment: true,
            name,
            moduleName
          });
        }
      }
    }

    return this;
  }

  getDataFromIdentifier(
    identifierOrMemberExpr: string,
    options: DataIdentifierOptions = {}
  ): null | TracedIdentifierReport {
    const { removeGlobalIdentifier = false } = options;
    if (removeGlobalIdentifier) {
      // eslint-disable-next-line no-param-reassign
      identifierOrMemberExpr = kGlobalIdentifiersRemover(identifierOrMemberExpr);
    }

    const isMemberExpr = identifierOrMemberExpr.includes(".");

    let tracedIdentifier = this.#lookupTraced(identifierOrMemberExpr);
    if (isMemberExpr && tracedIdentifier === undefined) {
      const [segment] = identifierOrMemberExpr.split(".");
      const tracedSegment = this.#lookupTraced(segment);
      if (tracedSegment !== undefined) {
        const memberExprSuffix = identifierOrMemberExpr.slice(segment.length);
        const finalIdentifier = `${tracedSegment.identifierOrMemberExpr}${memberExprSuffix}`;
        tracedIdentifier = this.#lookupTraced(finalIdentifier);
      }

      if (tracedIdentifier === undefined) {
        return null;
      }
    }
    else if (tracedIdentifier === undefined) {
      return null;
    }

    if (!this.#isTracedIdentifierImportedAsModule(tracedIdentifier)) {
      return null;
    }

    const assignmentMemory = this.#traced.get(tracedIdentifier.name)?.assignmentMemory ?? [];

    return {
      name: tracedIdentifier.name,
      identifierOrMemberExpr: tracedIdentifier.identifierOrMemberExpr,
      assignmentMemory
    };
  }

  #getTracedName(
    identifierOrMemberExpr: string
  ): string | null {
    return this.#lookupTraced(identifierOrMemberExpr)?.name ?? null;
  }

  #isTracedIdentifierImportedAsModule(
    id: Traced
  ): boolean {
    return id.moduleName === null || this.importedModules.has(id.moduleName);
  }

  #declareNewAssignment(
    identifierOrMemberExpr: string,
    id: ESTree.Identifier
  ) {
    const tracedVariant = this.#lookupTraced(identifierOrMemberExpr);

    /*
     * We return if required module has not been imported
     * It mean the assigment has no relation with the required tracing
     */
    if (
      typeof tracedVariant === "undefined" ||
      !this.#isTracedIdentifierImportedAsModule(tracedVariant)
    ) {
      return;
    }

    const newIdentiferName = id.name;

    const assignmentEventPayload = {
      name: tracedVariant.name,
      identifierOrMemberExpr: tracedVariant.identifierOrMemberExpr,
      id: newIdentiferName,
      location: id.loc
    };
    this.emit(VariableTracer.AssignmentEvent, assignmentEventPayload);
    this.emit(tracedVariant.identifierOrMemberExpr, assignmentEventPayload);

    if (tracedVariant.followConsecutiveAssignment) {
      const isRegistered = this.#registerTracedAlias(newIdentiferName, tracedVariant);
      if (isRegistered) {
        this.#traced.get(tracedVariant.name)!.assignmentMemory.push({
          type: "AliasBinding",
          name: newIdentiferName
        });
      }
    }
  }

  #isGlobalVariableIdentifier(
    identifierName: string
  ): boolean {
    return kGlobalIdentifiersToTrace.has(identifierName) ||
      this.#variablesRefToGlobal.has(identifierName);
  }

  /**
   * Search alternative for the given MemberExpression parts
   *
   * @example
   * const { process: aName } = globalThis;
   * const boo = aName.mainModule.require; // alternative: process.mainModule.require
   */
  #searchForMemberExprAlternative(
    parts: string[] = []
  ): string[] {
    return parts.flatMap((identifierName) => {
      const tracedVariant = this.#lookupTraced(identifierName);
      if (tracedVariant !== undefined) {
        return tracedVariant.identifierOrMemberExpr;
      }

      /**
       * If identifier is global then we can eliminate the value from MemberExpr
       *
       * globalThis.process === process;
       */
      if (this.#isGlobalVariableIdentifier(identifierName)) {
        return [];
      }

      return identifierName;
    });
  }

  #autoTraceId(
    id: ESTree.Identifier | ESTree.ObjectPattern,
    prefix: string | null = null
  ): void {
    for (const { name, assignmentId } of getVariableDeclarationIdentifiers(id)) {
      const identifierOrMemberExpr = typeof prefix === "string" ? `${prefix}.${name}` : name;

      if (this.#hasTraced(identifierOrMemberExpr)) {
        this.#declareNewAssignment(identifierOrMemberExpr, assignmentId);
      }
    }
  }

  #reverseAtob(
    node: ESTree.CallExpression,
    id: ESTree.Identifier
  ) {
    const callExprArguments = getCallExpressionArguments(
      node,
      {
        externalIdentifierLookup: this.resolveLiteralIdentifier
      }
    );
    if (callExprArguments === null) {
      return;
    }

    const callExprArgumentNode = callExprArguments.at(0);
    if (typeof callExprArgumentNode === "string") {
      this.literalIdentifiers.set(
        id.name,
        {
          value: Buffer.from(callExprArgumentNode, "base64").toString(),
          type: "Literal"
        }
      );
    }
  }

  #walkImportDeclaration(
    node: ESTree.ImportDeclaration
  ): void {
    const moduleName = stripNodePrefix(node.source.value)
      .replace(/\/promises$/, "");
    if (!this.#traced.has(moduleName)) {
      return;
    }

    this.importedModules.add(moduleName);

    this.emit(VariableTracer.ImportEvent, {
      moduleName,
      value: node.source.value,
      location: node.loc
    });

    // import * as boo from "crypto";
    if (node.specifiers[0].type === "ImportNamespaceSpecifier") {
      const importNamespaceNode = node.specifiers[0];
      this.#declareNewAssignment(moduleName, importNamespaceNode.local);

      return;
    }

    // import boo from "crypto";
    if (node.specifiers[0].type === "ImportDefaultSpecifier") {
      const importDefaultNode = node.specifiers[0];
      this.#declareNewAssignment(moduleName, importDefaultNode.local);

      return;
    }

    // import { createHash } from "crypto";
    const importSpecifiers = node.specifiers
      .filter((specifierNode) => specifierNode.type === "ImportSpecifier");
    for (const specifier of importSpecifiers) {
      if (specifier.imported.type !== "Identifier") {
        continue;
      }
      const fullImportedName = `${moduleName}.${specifier.imported.name}`;

      if (this.#traced.has(fullImportedName)) {
        this.#declareNewAssignment(fullImportedName, specifier.imported);
      }
    }
  }

  #walkRequireCallExpression(
    node: ESTree.CallExpression,
    id: ESTree.Identifier | ESTree.ObjectPattern
  ): void {
    const moduleNameLiteral = node.arguments
      .find((argumentNode) => isStringLiteral(argumentNode)
        && this.#traced.has(stripNodePrefix(argumentNode.value))) as ESTree.Literal | undefined;
    if (!moduleNameLiteral) {
      return;
    }
    const moduleName = stripNodePrefix(moduleNameLiteral.value);
    this.importedModules.add(moduleName);

    this.emit(VariableTracer.ImportEvent, {
      moduleName,
      value: moduleNameLiteral.value,
      location: moduleNameLiteral.loc
    });

    switch (id.type) {
      case "Identifier":
        this.#declareNewAssignment(moduleName, id);
        break;
      case "ObjectPattern": {
        this.#autoTraceId(id, moduleName);

        break;
      }
    }
  }

  #walkVariableDeclaratorInitialization(
    variableDeclaratorNode: ESTree.VariableDeclarator,
    childNode: ESTree.Node | null = variableDeclaratorNode.init
  ): void {
    if (childNode === null) {
      return;
    }
    const { id } = variableDeclaratorNode;
    if (id.type !== "Identifier") {
      return;
    }

    switch (childNode.type) {
      // let foo = "10"; <-- "foo" is the key and "10" the value
      case "Literal": {
        this.literalIdentifiers.set(id.name, {
          value: String(childNode.value),
          type: childNode.type
        });
        break;
      }
      // const x = `hello ${name}`; "x" is the key and "hello ${0}" the value
      case "TemplateLiteral": {
        this.literalIdentifiers.set(id.name, {
          value: toLiteral(childNode),
          type: childNode.type
        });
        break;
      }

      /**
       * import os from "node:os";
       *
       * const foo = {
       *    host: os.hostname(), <-- Property
       *    ...{ bar: "hello world"} <-- SpreadElement
       * };
       * ^ ObjectExpression
       */
      case "ObjectExpression": {
        /*
         * Only record top-level assignments (`const x = {...}`) so consumers
         * can resolve "x" back to its object shape, e.g. `pino(x)`.
         */
        if (childNode === variableDeclaratorNode.init) {
          this.objectIdentifiers.set(id.name, childNode);
        }

        for (const property of childNode.properties) {
          let node: ESTree.Node | null = null;
          if (property.type === "Property") {
            node = property.value;
          }
          else if (property.type === "SpreadElement") {
            node = property.argument;
          }

          node && this.#walkVariableDeclaratorInitialization(
            variableDeclaratorNode,
            node
          );
        }
        break;
      }

      case "ArrayExpression": {
        for (const element of childNode.elements) {
          this.#walkVariableDeclaratorInitialization(
            variableDeclaratorNode,
            element
          );
        }
        break;
      }

      case "SpreadElement": {
        this.#walkVariableDeclaratorInitialization(
          variableDeclaratorNode,
          childNode.argument
        );
        break;
      }

      /**
       * const g = eval("this");
       * const g = Function("return this")();
       */
      case "NewExpression":
      case "CallExpression": {
        const fullIdentifierPath = getCallExpressionIdentifier(childNode);
        if (fullIdentifierPath === null) {
          break;
        }

        const tracedFullIdentifierName = this.#getTracedName(fullIdentifierPath) ?? fullIdentifierPath;
        const [identifierName] = fullIdentifierPath.split(".");

        let tracedVariant = this.#lookupTraced(tracedFullIdentifierName);
        if (tracedVariant === undefined) {
          const alternativeMemberExprParts = this.#searchForMemberExprAlternative(
            tracedFullIdentifierName.split(".")
          );
          const alternativeMemberExprFullname = alternativeMemberExprParts.join(".");
          tracedVariant = this.#lookupTraced(alternativeMemberExprFullname);
        }

        if (tracedVariant?.followReturnValueAssignement) {
          tracedVariant.assignmentMemory.push({
            type: "ReturnValueAssignment",
            name: id.name
          });
          const returnValueEventPayload = {
            name: tracedVariant.name,
            identifierOrMemberExpr: tracedVariant.identifierOrMemberExpr,
            id: id.name,
            location: id.loc,
            arguments: childNode.arguments,
            node: childNode
          };
          this.emit(VariableTracer.ReturnValueEvent, returnValueEventPayload);
          if (tracedVariant.followConsecutiveAssignment) {
            this.#registerAssignedReturnValue(id.name, tracedFullIdentifierName);
          }
        }
        if (childNode.type !== "CallExpression") {
          break;
        }
        // const id = Function.prototype.call.call(require, require, "http");
        if (this.#neutralCallable.has(identifierName) || isEvilIdentifierPath(fullIdentifierPath)) {
          // TODO: make sure we are walking on a require CallExpr here ?
          this.#walkRequireCallExpression(childNode, id);
        }
        else if (kUnsafeGlobalCallExpression.has(identifierName)) {
          this.#variablesRefToGlobal.add(id.name);
        }
        /*
         * const foo = require("crypto");
         * const bar = require.call(null, "crypto");
         */
        else if (kRequirePatterns.has(identifierName)) {
          this.#walkRequireCallExpression(childNode, id);
        }
        else if (tracedFullIdentifierName === "atob") {
          this.#reverseAtob(childNode, id);
        }

        break;
      }

      // const r = require
      case "Identifier": {
        const identifierName = childNode.name;
        if (this.#hasTraced(identifierName)) {
          this.#declareNewAssignment(identifierName, id);
        }
        else if (this.#isGlobalVariableIdentifier(identifierName)) {
          this.#variablesRefToGlobal.add(id.name);
        }

        const tracedFullIdentifierName = this.#lookupAssignedReturnValue(childNode.name);
        if (tracedFullIdentifierName !== undefined) {
          const tracedVariant = this.#lookupTraced(tracedFullIdentifierName)!;
          tracedVariant.assignmentMemory.push({
            type: "ReturnValueAssignment",
            name: id.name
          });
          this.#registerAssignedReturnValue(id.name, tracedFullIdentifierName);
        }

        break;
      }

      // process.mainModule and require.resolve
      case "MemberExpression": {
        // Example: ["process", "mainModule"]
        const memberExprParts = [
          ...getMemberExpressionIdentifier(
            childNode,
            {
              externalIdentifierLookup: this.resolveLiteralIdentifier
            }
          )
        ];
        const memberExprFullname = memberExprParts.join(".");

        // Function.prototype.call
        if (isNeutralCallable(memberExprFullname)) {
          this.#neutralCallable.add(id.name);
        }
        else if (this.#hasTraced(memberExprFullname)) {
          this.#declareNewAssignment(memberExprFullname, id);
        }
        else {
          const alternativeMemberExprParts = this.#searchForMemberExprAlternative(memberExprParts);
          const alternativeMemberExprFullname = alternativeMemberExprParts.join(".");

          if (this.#hasTraced(alternativeMemberExprFullname)) {
            this.#declareNewAssignment(alternativeMemberExprFullname, id);
          }
        }

        if (isCallExpression(childNode.object)) {
          this.#walkVariableDeclaratorInitialization(variableDeclaratorNode, childNode.object);
        }
        break;
      }
    }
  }

  #walkVariableDeclarationWithAnythingElse(
    variableDeclaratorNode: ESTree.VariableDeclarator
  ): void {
    const { init } = variableDeclaratorNode;
    if (init === null) {
      return;
    }
    const { id } = variableDeclaratorNode as any;

    switch (init.type) {
      // const { process } = eval("this");
      case "CallExpression": {
        const fullIdentifierPath = getCallExpressionIdentifier(init);
        if (fullIdentifierPath === null) {
          break;
        }
        const [identifierName] = fullIdentifierPath.split(".");
        // const {} = Function.prototype.call.call(require, require, "http");
        if (isEvilIdentifierPath(fullIdentifierPath)) {
          this.#walkRequireCallExpression(init, id);
        }
        else if (kUnsafeGlobalCallExpression.has(identifierName)) {
          this.#autoTraceId(id);
        }
        // const { createHash } = require("crypto");
        else if (kRequirePatterns.has(identifierName)) {
          this.#walkRequireCallExpression(init, id);
        }

        break;
      }

      // const { process } = globalThis;
      case "Identifier": {
        const identifierName = init.name;
        if (this.#isGlobalVariableIdentifier(identifierName)) {
          this.#autoTraceId(id);
        }

        break;
      }
    }
  }

  #walkVariableDeclarator(
    node: ESTree.VariableDeclarator
  ): void {
    // var foo; <-- no initialization here.
    if (!notNullOrUndefined(node.init)) {
      return;
    }

    /**
     * const { foo } = {};
     *       ^     ^ ObjectPattern (example)
     */
    if (node.id.type !== "Identifier") {
      this.#walkVariableDeclarationWithAnythingElse(node);

      return;
    }

    // var root = freeGlobal || freeSelf || Function('return this')();
    if (node.init.type === "LogicalExpression") {
      for (const extractedNode of extractLogicalExpression(node.init)) {
        this.#walkVariableDeclaratorInitialization(
          node,
          extractedNode.node
        );
      }
    }
    // const foo = "bar";
    else {
      this.#walkVariableDeclaratorInitialization(node);
    }
  }

  walk(
    node: ESTree.Node
  ): void {
    this.#syncScopes(node);

    switch (node.type) {
      case "ImportDeclaration": {
        this.#declarationKind = "import";
        this.#walkImportDeclaration(node);
        this.#declarationKind = null;
        break;
      }
      case "VariableDeclaration": {
        this.#declarationKind = node.kind;
        node.declarations.forEach(
          (node) => this.#walkVariableDeclarator(node)
        );
        this.#declarationKind = null;
        break;
      }
    }
  }
}
