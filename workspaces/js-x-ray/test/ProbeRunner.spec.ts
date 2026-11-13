// Import Node.js Dependencies
import assert from "node:assert";
import { describe, it, mock } from "node:test";

// Import Third-party Dependencies
import type { ESTree } from "meriyah";

// Import Internal Dependencies
import {
  type Probe,
  type ProbeContext,
  ProbeRunner
} from "../src/ProbeRunner.ts";
import { SourceFile } from "../src/SourceFile.ts";
import { isCallExpression } from "../src/estree/index.ts";

function assertProbeCtx(ctx: unknown, expected: {
  sourceFile: SourceFile;
  context?: any;
}) {
  const c = ctx as any;
  assert.strictEqual(c.sourceFile, expected.sourceFile);
  assert.deepStrictEqual(c.context, expected.context);
  assert.strictEqual(typeof c.setEntryPoint, "function");
}

function assertProbeMainContext(ctx: unknown, expected: {
  sourceFile: SourceFile;
  context?: any;
  data?: any;
  signals: any;
}) {
  const c = ctx as any;
  assertProbeCtx(c, expected);
  assert.deepStrictEqual(c.data, expected.data);
  assert.strictEqual(c.signals, expected.signals);
}

describe("ProbeRunner", () => {
  describe("constructor", () => {
    it("should instanciate class with Defaults probes when none are provide", () => {
      const pr = new ProbeRunner(new SourceFile());

      assert.strictEqual(pr.probes, ProbeRunner.Defaults);
    });

    it("should use provided probes with validate node as func", () => {
      const fakeProbe = [
        {
          validateNode: (node: ESTree.Node) => [isCallExpression(node)],
          main: mock.fn(),
          teardown: mock.fn()
        }
      ];

      const pr = new ProbeRunner(new SourceFile(),
        // @ts-expect-error
        fakeProbe);
      assert.strictEqual(pr.probes, fakeProbe);
    });

    it("should use provided probe with validate node as Array", () => {
      const fakeProbe = [
        {
          validateNode: [],
          main: mock.fn(),
          teardown: mock.fn()
        }
      ];

      const pr = new ProbeRunner(new SourceFile(),
        // @ts-expect-error
        fakeProbe);
      assert.strictEqual(pr.probes, fakeProbe);
    });

    it("should fail if main not present", () => {
      const fakeProbe = {
        validateNode: (node: ESTree.Node) => [isCallExpression(node)],
        teardown: mock.fn()
      };

      function instantiateProbeRunner() {
        return new ProbeRunner(new SourceFile(),
          // @ts-expect-error
          [fakeProbe]);
      }

      assert.throws(instantiateProbeRunner, Error, "Invalid probe");
    });

    it("should fail if validate not present", () => {
      const fakeProbe = {
        main: mock.fn(),
        teardown: mock.fn()
      };

      function instantiateProbeRunner() {
        return new ProbeRunner(new SourceFile(),
          // @ts-expect-error
          [fakeProbe]);
      }

      assert.throws(instantiateProbeRunner, Error, "Invalid probe");
    });

    it("should fail if initialize is present and not a function", () => {
      const fakeProbe = {
        validateNode: mock.fn(),
        main: mock.fn(),
        initialize: null
      };

      function instantiateProbeRunner() {
        return new ProbeRunner(
          new SourceFile(),
          // @ts-expect-error
          [fakeProbe]
        );
      }

      assert.throws(instantiateProbeRunner, Error, "Invalid probe");
    });

    it("should throw if one the provided probe is sealed or frozen", () => {
      const methods = ["seal", "freeze"];
      for (const method of methods) {
        const fakeProbe = Object[method]({
          name: "frozen-probe",
          initialize() {
            return {};
          },
          validateNode: mock.fn((_: ESTree.Node) => [true]),
          main: () => ProbeRunner.Signals.Skip
        });

        assert.throws(() => {
          new ProbeRunner(
            new SourceFile(),
            [fakeProbe]
          );
        }, {
          message: "Failed to define original context for probe 'frozen-probe'"
        });
      }
    });
  });

  describe("walk", () => {
    it("should pass validateNode, enter main and then teardown", () => {
      const sourceFile = new SourceFile();
      const fakeProbe = {
        validateNode: (node: ESTree.Node) => [node.type === "Literal"],
        main: mock.fn(),
        teardown: mock.fn()
      };

      // @ts-expect-error
      const pr = new ProbeRunner(sourceFile, [fakeProbe]);

      const astNode: ESTree.Literal = {
        type: "Literal",
        value: "test"
      };
      const result = pr.walk(astNode);
      assert.strictEqual(result, null);

      const mainCallArgs = fakeProbe.main.mock.calls.at(0)?.arguments;
      assert.ok(mainCallArgs, "mainCallArgs should be defined");
      assert.strictEqual(mainCallArgs[0], astNode);

      assertProbeMainContext(mainCallArgs[1], {
        sourceFile,
        context: undefined,
        data: null,
        signals: ProbeRunner.Signals
      });

      assert.strictEqual(fakeProbe.teardown.mock.calls.length, 1);
      const teardownCallArgs = fakeProbe.teardown.mock.calls.at(0)?.arguments;
      assert.ok(teardownCallArgs);
      assertProbeCtx(teardownCallArgs[0], {
        sourceFile,
        context: undefined
      });
    });

    it("should forward validateNode data to main", () => {
      const data = { test: "data" };
      const fakeProbe = {
        validateNode: mock.fn((_: ESTree.Node) => [true, data]),
        main: mock.fn(() => ProbeRunner.Signals.Skip)
      };

      const sourceFile = new SourceFile();

      const pr = new ProbeRunner(
        sourceFile,
        // @ts-expect-error
        [fakeProbe]
      );

      const astNode: ESTree.Literal = {
        type: "Literal",
        value: "test"
      };
      pr.walk(astNode);
      pr.finalize();

      const expectedContext = {
        sourceFile,
        context: undefined
      };

      const validateNodeArgs = fakeProbe.validateNode.mock.calls.at(0)?.arguments;
      assert.ok(validateNodeArgs);
      assert.strictEqual(validateNodeArgs[0], astNode);
      assertProbeCtx((validateNodeArgs as any)[1], expectedContext);

      const mainArgs = fakeProbe.main.mock.calls.at(0)?.arguments;
      assert.ok(mainArgs);
      assert.strictEqual((mainArgs as any)[0], astNode);
      assertProbeMainContext((mainArgs as any)[1], {
        ...expectedContext,
        data,
        signals: ProbeRunner.Signals
      });
    });

    it("should trigger and return a skip signal", () => {
      const fakeProbe = {
        validateNode: (node: ESTree.Node) => [node.type === "Literal"],
        main: () => ProbeRunner.Signals.Skip,
        teardown: mock.fn()
      };

      const pr = new ProbeRunner(
        new SourceFile(),
        // @ts-expect-error
        [fakeProbe]
      );

      const astNode: ESTree.Node = {
        type: "Literal",
        value: "test"
      };
      const result = pr.walk(astNode);

      assert.strictEqual(result, "skip");
      assert.strictEqual(fakeProbe.teardown.mock.calls.length, 1);
    });

    it("should trigger setEntryPoint and be cleared after execution", () => {
      const fakeProbe = {
        validateNode: mock.fn((node: ESTree.Node, { setEntryPoint }) => {
          if (node.type === "Literal") {
            setEntryPoint("custom");
          }

          return [true];
        }),
        main: {
          default: mock.fn(),
          custom: mock.fn()
        }
      };

      const sourceFile = new SourceFile();
      // @ts-expect-error
      const pr = new ProbeRunner(sourceFile, [fakeProbe]);

      const literalNode: ESTree.Literal = { type: "Literal", value: "test" };
      const nonLiteralNode: ESTree.Identifier = { type: "Identifier", name: "foo" };

      // 1. First node should trigger setEntryPoint("custom")
      pr.walk(literalNode);
      assert.strictEqual((fakeProbe.main.custom as any).mock.calls.length, 1);
      assert.strictEqual((fakeProbe.main.default as any).mock.calls.length, 0);

      // 2. Second node should fallback to default (entry point cleared)
      pr.walk(nonLiteralNode);
      assert.strictEqual((fakeProbe.main.custom as any).mock.calls.length, 1);
      assert.strictEqual((fakeProbe.main.default as any).mock.calls.length, 1);
    });
  });

  describe("finalize", () => {
    it("should call the finalize methods", () => {
      const fakeProbe = {
        validateNode: (_: ESTree.Node) => [true],
        main: () => ProbeRunner.Signals.Skip,
        finalize: mock.fn()
      };

      const fakeProbeSkip = {
        validateNode: (_: ESTree.Node) => [true],
        main: () => ProbeRunner.Signals.Skip,
        teardown: mock.fn(),
        finalize: mock.fn()
      };

      const fakeProbeBreak = {
        validateNode: (_: ESTree.Node) => [true],
        main: () => ProbeRunner.Signals.Break,
        teardown: mock.fn(),
        finalize: mock.fn()
      };

      const probes = [fakeProbe, fakeProbeBreak, fakeProbeSkip];

      const sourceFile = new SourceFile();

      const pr = new ProbeRunner(
        sourceFile,
        // @ts-expect-error
        probes
      );

      pr.finalize();

      probes.forEach((probe) => {
        assert.strictEqual(probe.finalize.mock.calls.length, 1);
        const finalizeArgs = probe.finalize.mock.calls.at(0)?.arguments;
        assert.ok(finalizeArgs);
        assertProbeCtx(finalizeArgs[0], {
          sourceFile,
          context: undefined
        });
      });
    });
  });

  describe("context", () => {
    it("should define context with initialize and dispatch it to all methods", () => {
      const fakeCtx = {};

      const sourceFile = new SourceFile();

      const fakeProbe = {
        initialize: mock.fn(() => {
          sourceFile.tracer.on("fake-event", () => {
            // ignored
          });

          return fakeCtx;
        }),
        validateNode: mock.fn((_: ESTree.Node) => [true]),
        main: mock.fn(() => ProbeRunner.Signals.Skip),
        finalize: mock.fn()
      };

      const pr = new ProbeRunner(
        sourceFile,
        // @ts-expect-error
        [fakeProbe]
      );

      const astNode: ESTree.Literal = {
        type: "Literal",
        value: "test"
      };
      pr.walk(astNode);
      pr.finalize();

      const expectedContext = {
        sourceFile,
        context: fakeCtx
      };

      const validateNodeArgs = fakeProbe.validateNode.mock.calls.at(0)?.arguments;
      assert.ok(validateNodeArgs, "validateNodeArgs should be defined");
      assert.strictEqual(validateNodeArgs[0], astNode);
      assertProbeCtx((validateNodeArgs as any)[1], expectedContext);

      const mainArgs = fakeProbe.main.mock.calls.at(0)?.arguments;
      assert.ok(mainArgs, "mainArgs should be defined");
      assert.strictEqual((mainArgs as any)[0], astNode);
      assertProbeMainContext((mainArgs as any)[1], {
        ...expectedContext,
        data: null,
        signals: ProbeRunner.Signals
      });

      const initializeArgs = fakeProbe.initialize.mock.calls.at(0)?.arguments;
      assert.ok(initializeArgs);
      assertProbeCtx((initializeArgs as any)[0], {
        ...expectedContext,
        context: undefined
      });

      const finalizeArgs = fakeProbe.finalize.mock.calls.at(0)?.arguments;
      assert.ok(finalizeArgs, "finalizeArgs should be defined");
      assertProbeCtx(finalizeArgs[0], expectedContext);
      assert.strictEqual(sourceFile.tracer.eventNames().length, 0);
    });

    it("should define context within the probe and dispatch it to all methods", () => {
      const fakeCtx = {};
      const fakeProbe = {
        initialize: mock.fn(),
        validateNode: mock.fn((_: ESTree.Node) => [true]),
        main: mock.fn(() => ProbeRunner.Signals.Skip),
        finalize: mock.fn(),
        context: fakeCtx
      };

      const sourceFile = new SourceFile();

      const pr = new ProbeRunner(
        sourceFile,
        // @ts-expect-error
        [fakeProbe]
      );

      const astNode: ESTree.Literal = {
        type: "Literal",
        value: "test"
      };
      pr.walk(astNode);
      pr.finalize();

      const expectedContext = {
        sourceFile,
        context: fakeCtx
      };

      const validateNodeArgs = fakeProbe.validateNode.mock.calls.at(0)?.arguments;
      assert.ok(validateNodeArgs);
      assert.strictEqual(validateNodeArgs[0], astNode);
      assertProbeCtx((validateNodeArgs as any)[1], expectedContext);

      const mainArgs = fakeProbe.main.mock.calls.at(0)?.arguments;
      assert.ok(mainArgs);
      assert.strictEqual((mainArgs as any)[0], astNode);
      assertProbeMainContext((mainArgs as any)[1], {
        ...expectedContext,
        data: null,
        signals: ProbeRunner.Signals
      });

      const finalizeArgs = fakeProbe.finalize.mock.calls.at(0)?.arguments;
      assert.ok(finalizeArgs);
      assertProbeCtx(finalizeArgs[0], expectedContext);

      const initializeArgs = fakeProbe.initialize.mock.calls.at(0)?.arguments;
      assert.ok(initializeArgs);
      assertProbeCtx(initializeArgs[0], expectedContext);
    });

    it("should deep clone initialization context and clear context when the probe is fully executed", () => {
      const fakeCtx = {};
      const fakeProbe: any = {
        initialize() {
          return fakeCtx;
        },
        validateNode: mock.fn((_: ESTree.Node) => [true]),
        main(_node: ESTree.Node, ctx: Required<ProbeContext>) {
          ctx.context.hello = "world";

          return ProbeRunner.Signals.Skip;
        }
      };

      const sourceFile = new SourceFile();

      const pr = new ProbeRunner(
        sourceFile,
        [fakeProbe]
      );

      const astNode: ESTree.Literal = {
        type: "Literal",
        value: "test"
      };
      pr.walk(astNode);
      assert.deepEqual(fakeProbe.context, {
        hello: "world"
      });

      pr.finalize();

      assert.strictEqual(fakeProbe.context, undefined);
      const { context = null } = fakeProbe.validateNode.mock.calls.at(0)?.arguments[1] ?? {};
      assert.deepEqual(context, {
        hello: "world"
      });
      assert.notStrictEqual(context, fakeCtx);
    });

    it("should keep the context of a probe without initialize when the probe is fully executed", () => {
      const fakeCtx = {};
      const fakeProbe: any = {
        validateNode: mock.fn((_: ESTree.Node) => [true]),
        main: mock.fn(() => ProbeRunner.Signals.Skip),
        context: fakeCtx
      };

      const pr = new ProbeRunner(
        new SourceFile(),
        [fakeProbe]
      );
      pr.walk({
        type: "Literal",
        value: "test"
      });
      pr.finalize();

      assert.strictEqual(fakeProbe.context, fakeCtx);
    });
  });

  describe("error isolation", () => {
    function createLocatedLiteral(): ESTree.Literal {
      return {
        type: "Literal",
        value: "test",
        loc: {
          start: { line: 1, column: 0 },
          end: { line: 1, column: 6 }
        }
      };
    }

    it("should isolate a validateNode failure and keep running other probes", () => {
      const sourceFile = new SourceFile();
      const throwingProbe: Probe = {
        name: "throwing-validate",
        validateNode: () => {
          throw new Error("validate boom");
        },
        main: mock.fn()
      };
      const healthyProbe: Probe = {
        name: "healthy",
        validateNode: (node) => [node.type === "Literal"],
        main: mock.fn()
      };

      const pr = new ProbeRunner(sourceFile, [throwingProbe, healthyProbe]);

      const result = pr.walk(createLocatedLiteral());

      assert.strictEqual(result, null);
      assert.strictEqual((throwingProbe.main as any).mock.calls.length, 0);
      assert.strictEqual((healthyProbe.main as any).mock.calls.length, 1);

      assert.strictEqual(sourceFile.warnings.length, 1);
      const [warning] = sourceFile.warnings;
      assert.strictEqual(warning.kind, "probe-error");
      assert.strictEqual(
        warning.value,
        'probe "throwing-validate" validate error: validate boom'
      );
      assert.deepStrictEqual(warning.location, [[1, 0], [1, 6]]);
    });

    it("should isolate a main failure, preserve findings and still run teardown", () => {
      const sourceFile = new SourceFile();
      const failingProbe: Probe = {
        name: "failing-main",
        validateNode: (node) => [node.type === "Literal"],
        main: (_node, ctx) => {
          ctx.sourceFile.warnings.push({
            kind: "unsafe-danger",
            value: null,
            location: null,
            source: "test",
            i18n: "n/a",
            severity: "Warning"
          });
          throw new Error("main boom");
        },
        teardown: mock.fn()
      };
      const healthyProbe: Probe = {
        name: "healthy",
        validateNode: (node) => [node.type === "Literal"],
        main: mock.fn()
      };

      const pr = new ProbeRunner(sourceFile, [failingProbe, healthyProbe]);

      const result = pr.walk(createLocatedLiteral());

      assert.strictEqual(result, null);
      assert.strictEqual((healthyProbe.main as any).mock.calls.length, 1);
      assert.strictEqual((failingProbe.teardown as any).mock.calls.length, 1);

      assert.strictEqual(sourceFile.warnings.length, 2);
      const [finding, diagnostic] = sourceFile.warnings;
      assert.strictEqual(finding.kind, "unsafe-danger");
      assert.strictEqual(diagnostic.kind, "probe-error");
      assert.strictEqual(
        diagnostic.value,
        'probe "failing-main" main error: main boom'
      );
      assert.deepStrictEqual(diagnostic.location, [[1, 0], [1, 6]]);
    });

    it("should isolate a teardown failure and keep running other probes", () => {
      const sourceFile = new SourceFile();
      const failingProbe: Probe = {
        name: "failing-teardown",
        validateNode: () => [true],
        main: () => null,
        teardown: () => {
          throw new Error("teardown boom");
        }
      };
      const healthyProbe: Probe = {
        name: "healthy",
        validateNode: () => [true],
        main: mock.fn()
      };

      const pr = new ProbeRunner(sourceFile, [failingProbe, healthyProbe]);

      const result = pr.walk(createLocatedLiteral());

      assert.strictEqual(result, null);
      assert.strictEqual((healthyProbe.main as any).mock.calls.length, 1);

      assert.strictEqual(sourceFile.warnings.length, 1);
      const [warning] = sourceFile.warnings;
      assert.strictEqual(warning.kind, "probe-error");
      assert.strictEqual(
        warning.value,
        'probe "failing-teardown" teardown error: teardown boom'
      );
    });

    it("should cap the number of diagnostics reported for a failing probe", () => {
      const sourceFile = new SourceFile();
      const failingProbe: Probe = {
        name: "always-failing",
        validateNode: () => {
          throw new Error("boom");
        },
        main: () => null
      };

      const pr = new ProbeRunner(sourceFile, [failingProbe]);

      for (let i = 0; i < 10; i++) {
        pr.walk(createLocatedLiteral());
      }

      const probeErrors = sourceFile.warnings.filter(
        (warning) => warning.kind === "probe-error"
      );
      assert.strictEqual(probeErrors.length, 3);
    });

    it("should truncate long error messages to keep diagnostics stable", () => {
      const sourceFile = new SourceFile();
      const failingProbe: Probe = {
        name: "verbose-failure",
        validateNode: () => {
          throw new Error("x".repeat(500));
        },
        main: () => null
      };

      const pr = new ProbeRunner(sourceFile, [failingProbe]);
      pr.walk(createLocatedLiteral());

      assert.strictEqual(sourceFile.warnings.length, 1);
      const [warning] = sourceFile.warnings;
      assert.strictEqual(
        warning.value,
        `probe "verbose-failure" validate error: ${"x".repeat(200)}…`
      );
    });

    it("should isolate finalize failures and run finalize hooks only once", () => {
      const sourceFile = new SourceFile();
      sourceFile.tracer.on("fake-event", () => {
        // ignored
      });

      const failingProbe: Probe = {
        name: "failing-finalize",
        validateNode: () => [false],
        main: () => null,
        finalize: mock.fn(() => {
          throw new Error("finalize boom");
        })
      };
      const healthyProbe: Probe = {
        name: "healthy-finalize",
        validateNode: () => [false],
        main: () => null,
        finalize: mock.fn()
      };

      const pr = new ProbeRunner(sourceFile, [failingProbe, healthyProbe]);

      pr.finalize();
      pr.finalize();

      assert.strictEqual((failingProbe.finalize as any).mock.calls.length, 1);
      assert.strictEqual((healthyProbe.finalize as any).mock.calls.length, 1);
      assert.strictEqual(sourceFile.tracer.eventNames().length, 0);

      assert.strictEqual(sourceFile.warnings.length, 1);
      const [warning] = sourceFile.warnings;
      assert.strictEqual(warning.kind, "probe-error");
      assert.strictEqual(
        warning.value,
        'probe "failing-finalize" finalize error: finalize boom'
      );
      assert.deepStrictEqual(warning.location, [[0, 0], [0, 0]]);
    });
  });
});
