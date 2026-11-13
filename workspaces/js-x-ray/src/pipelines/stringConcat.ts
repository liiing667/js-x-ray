// Import Third-party Dependencies
import type { ESTree } from "meriyah";

// Import Internal Dependencies
import type { Pipeline } from "./Runner.class.ts";
import { isStringLiteral } from "../estree/index.ts";
import { walkEnter } from "../walker/index.ts";

/**
 * Resolve a BinaryExpression made exclusively of string Literals
 * (e.g. "con" + "sole." + "log") back to its concatenated value.
 *
 * Returns null when any leaf is not a string Literal.
 */
export function resolveStringConcatenation(
  node: ESTree.Node
): string | null {
  if (isStringLiteral(node)) {
    return node.value;
  }
  if (node.type === "BinaryExpression" && node.operator === "+") {
    const left = resolveStringConcatenation(node.left);
    if (left === null) {
      return null;
    }
    const right = resolveStringConcatenation(node.right);
    if (right === null) {
      return null;
    }

    return left + right;
  }

  return null;
}

/**
 * Fold string concatenations (e.g. "cu" + "rl") back into a single
 * Literal so downstream probes can detect commands, links and
 * credentials rebuilt through concatenation.
 *
 * The folded Literal inherits the `loc` of the original
 * BinaryExpression so warnings keep the real source position.
 */
export class StringConcat implements Pipeline {
  name = "string-concat";

  walk(
    body: ESTree.Program["body"]
  ): ESTree.Program["body"] {
    walkEnter(body, function walk(node): void {
      if (Array.isArray(node) || node.type !== "BinaryExpression") {
        return;
      }

      const value = resolveStringConcatenation(node);
      if (value === null) {
        return;
      }

      const literal: ESTree.Literal = {
        type: "Literal",
        value,
        raw: JSON.stringify(value),
        ...(node.loc ? { loc: node.loc } : {})
      };

      this.replaceAndSkip(literal);
    });

    return body;
  }
}
