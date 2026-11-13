// Import Node.js Dependencies
import assert from "node:assert";
import { test } from "node:test";

// Import Internal Dependencies
import { rootLocation } from "../src/utils/index.ts";
import {
  dedupeAndSortWarnings,
  generateWarning,
  type Warning
} from "../src/warnings.ts";

test("Given an encoded-literal kind it should generate a warning with deep location array", () => {
  const result = generateWarning("encoded-literal", {
    value: null,
    location: rootLocation()
  });

  assert.deepEqual(result, {
    experimental: false,
    kind: "encoded-literal",
    value: null,
    source: "JS-X-Ray",
    location: [
      [[0, 0], [0, 0]]
    ],
    i18n: "sast_warnings.encoded_literal",
    severity: "Information"
  });
});

test("Given weak-crypto kind it should generate a warning with value, location and experimental flag", () => {
  const result = generateWarning("crypto.weak-algorithm", {
    value: "md5",
    location: rootLocation(),
    file: "hello.js"
  });

  assert.deepEqual(result, {
    kind: "crypto.weak-algorithm",
    value: "md5",
    file: "hello.js",
    source: "JS-X-Ray",
    location: [
      [0, 0], [0, 0]
    ],
    i18n: "sast_warnings.weak_crypto",
    severity: "Information",
    experimental: false
  });
});

test("Given a known warning kind with a custom severity, it should override the default severity", () => {
  const warningA = generateWarning("parsing-error", {
    value: "test"
  });

  const warningB = generateWarning("parsing-error", {
    value: "test",
    severity: "Critical"
  });

  assert.strictEqual(warningA.severity, "Information");
  assert.notStrictEqual(warningA.severity, warningB.severity);
});

test("dedupeAndSortWarnings should remove duplicates sharing the same kind, value and location", () => {
  const warning = generateWarning("unsafe-stmt", {
    value: "eval",
    location: {
      start: { line: 1, column: 0 },
      end: { line: 1, column: 13 }
    }
  });

  const result = dedupeAndSortWarnings([
    warning,
    { ...warning },
    generateWarning("unsafe-stmt", {
      value: "eval",
      location: {
        start: { line: 2, column: 0 },
        end: { line: 2, column: 13 }
      }
    })
  ]);

  assert.strictEqual(result.length, 2);
});

test("dedupeAndSortWarnings should keep warnings with distinct original locations", () => {
  const result = dedupeAndSortWarnings([
    generateWarning("unsafe-stmt", {
      value: "eval",
      location: {
        start: { line: 1, column: 0 },
        end: { line: 1, column: 13 }
      }
    }),
    generateWarning("unsafe-stmt", {
      value: "eval",
      location: {
        start: { line: 1, column: 20 },
        end: { line: 1, column: 33 }
      }
    })
  ]);

  assert.strictEqual(result.length, 2);
});

test("dedupeAndSortWarnings should sort warnings by their original source position", () => {
  const result = dedupeAndSortWarnings([
    generateWarning("unsafe-stmt", {
      value: "eval",
      location: {
        start: { line: 3, column: 0 },
        end: { line: 3, column: 13 }
      }
    }),
    generateWarning("shady-link", {
      value: "https://bit.ly/abc",
      location: {
        start: { line: 1, column: 6 },
        end: { line: 1, column: 31 }
      }
    })
  ]);

  assert.deepEqual(
    result.map((warning) => warning.kind),
    ["shady-link", "unsafe-stmt"]
  );
});

test("dedupeAndSortWarnings should move warnings without a real position to the end (stable)", () => {
  const parsingError = generateWarning("parsing-error", { value: "foo" });
  const obfuscatedCode = generateWarning("obfuscated-code", { value: "morse" });
  const unsafeStmt = generateWarning("unsafe-stmt", {
    value: "eval",
    location: {
      start: { line: 1, column: 0 },
      end: { line: 1, column: 13 }
    }
  });

  const result = dedupeAndSortWarnings([
    parsingError,
    unsafeStmt,
    obfuscatedCode
  ]);

  assert.deepEqual(
    result.map((warning) => warning.kind),
    ["unsafe-stmt", "parsing-error", "obfuscated-code"]
  );
});

test("dedupeAndSortWarnings should support raw ESTree locations from custom probes", () => {
  const customWarning: Warning = {
    kind: "unsafe-danger",
    value: null,
    location: {
      start: { line: 1, column: 0 },
      end: { line: 1, column: 24 }
    } as any,
    source: "JS-X-Ray Custom Probe",
    i18n: "sast_warnings.unsafe-danger",
    severity: "Warning"
  };

  const result = dedupeAndSortWarnings([
    generateWarning("unsafe-stmt", {
      value: "eval",
      location: {
        start: { line: 2, column: 0 },
        end: { line: 2, column: 13 }
      }
    }),
    customWarning
  ]);

  assert.deepEqual(
    result.map((warning) => warning.kind),
    ["unsafe-danger", "unsafe-stmt"]
  );
});
