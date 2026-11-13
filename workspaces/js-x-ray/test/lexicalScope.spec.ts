// Import Node.js Dependencies
import assert from "node:assert";
import { describe, it } from "node:test";

// Import Internal Dependencies
import {
  AstAnalyser,
  DefaultCollectableSet,
  type Dependency
} from "../src/index.ts";
import { extractDependencies } from "./helpers.ts";
import { createTracer } from "./VariableTracer/utils.ts";

// CONSTANTS
const kFixtureURL = new URL("fixtures/lexical-scope/", import.meta.url);

function analyseFixture(
  fixtureName: string
): Map<string, Dependency> {
  const dependencySet = new DefaultCollectableSet<Dependency>("dependency");
  const result = new AstAnalyser({
    collectables: [dependencySet]
  }).analyseFileSync(new URL(fixtureName, kFixtureURL));

  assert.ok(result.ok);

  return extractDependencies(dependencySet);
}

describe("lexical scope of require aliases", () => {
  it("should not leak an alias into functions shadowing the same identifier", () => {
    const dependencies = analyseFixture("shadowedAlias.js");

    assert.deepEqual([...dependencies.keys()], ["fs"]);
  });

  it("should honor hoisted var declarations shadowing an outer alias", () => {
    const dependencies = analyseFixture("hoistedShadow.js");

    assert.deepEqual([...dependencies.keys()], ["fs"]);
  });

  it("should not resolve an alias referenced before its local declaration", () => {
    const dependencies = analyseFixture("useBeforeDeclaration.js");

    assert.deepEqual([...dependencies.keys()], []);
  });

  it("should resolve an outer alias from a nested closure", () => {
    const dependencies = analyseFixture("closure.js");

    assert.deepEqual([...dependencies.keys()], ["fs"]);
  });

  it("should scope block-level shadows and restore the outer alias after the block", () => {
    const dependencies = analyseFixture("blockShadow.js");

    assert.deepEqual([...dependencies.keys()], ["fs"]);
  });
});

describe("VariableTracer lexical scope", () => {
  it("should not expose a function-scoped alias once the scope is exited", () => {
    const helpers = createTracer(true);
    helpers.walkOnCode(`
      function a() {
        const r = require;
      }
      r;
    `);

    assert.strictEqual(helpers.tracer.getDataFromIdentifier("r"), null);
  });

  it("should resolve a top-level alias from a nested function (closure)", () => {
    const helpers = createTracer(true);
    helpers.walkOnCode(`
      const r = require;
      function a() {
        function b() {
          r("fs");
        }
      }
    `);

    const result = helpers.tracer.getDataFromIdentifier("r");

    assert.ok(result !== null);
    assert.strictEqual(result.identifierOrMemberExpr, "require");
  });

  it("should shadow an outer alias with a function parameter", () => {
    const helpers = createTracer(true);
    helpers.walkOnCode(`
      const r = require;
      function a(r) {
        r("fs");
      }
      r;
    `);

    const result = helpers.tracer.getDataFromIdentifier("r");

    assert.ok(result !== null);
    assert.deepEqual(result.assignmentMemory, [
      {
        type: "AliasBinding",
        name: "r"
      }
    ]);
  });

  it("should scope return value tracking to the declaration scope", () => {
    const helpers = createTracer(false);
    helpers.tracer.trace("foo", {
      followConsecutiveAssignment: true,
      followReturnValueAssignement: true
    });
    helpers.walkOnCode(`
      function a() {
        const x = foo();
      }
      function b() {
        const x = "local";
        const y = x;
      }
      x;
    `);

    const result = helpers.tracer.getDataFromIdentifier("foo");

    assert.ok(result !== null);
    assert.deepEqual(result.assignmentMemory, [
      {
        type: "ReturnValueAssignment",
        name: "x"
      }
    ]);
  });

  it("should not merge same-named return value assignments across functions", () => {
    const helpers = createTracer(false);
    helpers.tracer.trace("foo", {
      followConsecutiveAssignment: true,
      followReturnValueAssignement: true
    });
    helpers.walkOnCode(`
      function a() {
        const x = foo();
        const y = x;
      }
      function b() {
        const y = "local";
        const z = y;
      }
      z;
    `);

    const result = helpers.tracer.getDataFromIdentifier("foo");

    assert.ok(result !== null);
    assert.deepEqual(result.assignmentMemory, [
      {
        type: "ReturnValueAssignment",
        name: "x"
      },
      {
        type: "ReturnValueAssignment",
        name: "y"
      }
    ]);
  });
});
