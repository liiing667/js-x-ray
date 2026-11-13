// Import Node.js Dependencies
import assert from "node:assert";
import { describe, mock, test } from "node:test";

// Import Internal Dependencies
import {
  AstAnalyser,
  Pipelines
} from "../src/index.ts";
import {
  resolveStringConcatenation,
  StringConcat
} from "../src/pipelines/stringConcat.ts";
import {
  getWarningKind,
  parseScript
} from "./helpers.ts";

describe("AstAnalyser pipelines", () => {
  test("should iterate once on the pipeline", () => {
    const pipeline = {
      name: "test-pipeline",
      walk: mock.fn((body) => body)
    };

    const analyser = new AstAnalyser({
      pipelines: [
        pipeline,
        pipeline
      ]
    });

    analyser.analyse(`return "Hello World";`);

    assert.strictEqual(pipeline.walk.mock.callCount(), 1);
    assert.deepEqual(
      pipeline.walk.mock.calls[0].arguments[0],
      [
        {
          type: "ReturnStatement",
          argument: {
            type: "Literal",
            value: "Hello World",
            raw: "\"Hello World\"",
            loc: {
              start: {
                line: 1,
                column: 7
              },
              end: {
                line: 1,
                column: 20
              }
            }
          },
          loc: {
            start: {
              line: 1,
              column: 0
            },
            end: {
              line: 1,
              column: 21
            }
          }
        }
      ]
    );
  });
});

describe("Pipelines.deobfuscate", () => {
  test("should find a shady-url by deobfuscating a joined ArrayExpression", () => {
    const analyser = new AstAnalyser({
      pipelines: [
        new Pipelines.deobfuscate()
      ]
    });

    const { warnings } = analyser.analyse(`
      const URL = ["http://", ["77", "244", "210", "1"].join("."), "/script"].join("");
    `);

    assert.deepEqual(
      getWarningKind(warnings),
      ["shady-link"].sort()
    );
  });
});

describe("resolveStringConcatenation", () => {
  test("should resolve a concatenation of string Literals", () => {
    const ast = parseScript(`"con" + "sole." + "log";`);
    const [statement] = ast.body;

    assert.strictEqual(
      resolveStringConcatenation(statement.expression),
      "console.log"
    );
  });

  test("should return null when any leaf is not a string Literal", () => {
    for (const source of [
      `"con" + foo`,
      `"con" + 1`,
      `"con" - "sole"`,
      "1 + 2"
    ]) {
      const ast = parseScript(`${source};`);
      const [statement] = ast.body;

      assert.strictEqual(
        resolveStringConcatenation(statement.expression),
        null
      );
    }
  });
});

describe("StringConcat pipeline", () => {
  test("should fold a string concatenation into a Literal preserving the original location", () => {
    const ast = parseScript(`const foo = "con" + "sole";`);

    new StringConcat().walk(ast.body);

    const [declaration] = ast.body[0].declarations;
    assert.strictEqual(declaration.init.type, "Literal");
    assert.strictEqual(declaration.init.value, "console");
    assert.deepEqual(declaration.init.loc, {
      start: { line: 1, column: 12 },
      end: { line: 1, column: 26 }
    });
  });

  test("should not fold concatenations with non-string leaves", () => {
    const ast = parseScript(`const foo = "con" + bar;`);

    new StringConcat().walk(ast.body);

    const [declaration] = ast.body[0].declarations;
    assert.strictEqual(declaration.init.type, "BinaryExpression");
  });
});
