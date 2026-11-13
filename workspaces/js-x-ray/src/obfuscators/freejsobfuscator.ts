// Import Internal Dependencies
import {
  type ObfuscatedIdentifier
} from "../Deobfuscator.ts";

/*
 * See: https://github.com/microsoft/TypeScript/issues/61321
 * Remove when TS officially supports RegExp.escape() (
 */
declare global {
  interface RegExpConstructor {
    escape(str: string): string;
  }
}

const escapeRegExp: (str: string) => string = typeof RegExp.escape === "function" ?
  RegExp.escape.bind(RegExp) :
  (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function verify(
  identifiers: ObfuscatedIdentifier[],
  prefix: Record<string, number>
) {
  const pValue = Object.keys(prefix).pop()!;
  const regex = new RegExp(`^${escapeRegExp(pValue)}[a-zA-Z]{1,2}[0-9]{0,2}$`);

  return identifiers.every(({ name }) => regex.test(name));
}
