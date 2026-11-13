// Import Third-party Dependencies
import type { ESTree } from "meriyah";

// Import Internal Dependencies
import { notNullOrUndefined } from "./utils/notNullOrUndefined.ts";
import {
  rootLocation,
  toArrayLocation,
  type SourceArrayLocation
} from "./utils/toArrayLocation.ts";

export type OptionalWarningName =
  | "synchronous-io"
  | "log-usage"
  | "insecure-random"
  | "crypto.weak-scrypt"
  | "crypto.unsafe-prehash"
  | "crypto.weak-bcrypt"
  | "crypto.password-shucking"
  | "crypto.weak-argon2"
  | "crypto.weak-pbkdf2";

export type WarningName =
  | "parsing-error"
  | "encoded-literal"
  | "unsafe-regex"
  | "unsafe-stmt"
  | "short-identifiers"
  | "suspicious-literal"
  | "suspicious-file"
  | "obfuscated-code"
  | "crypto.weak-algorithm"
  | "shady-link"
  | "unsafe-command"
  | "unsafe-import"
  | "serialize-environment"
  | "data-exfiltration"
  | "sql-injection"
  | "monkey-patch"
  | "insecure-random"
  | "prototype-pollution"
  | "unsafe-vm-context"
  | OptionalWarningName;

export interface Warning<T = WarningName> {
  kind: T | (string & {});
  file?: string;
  value: string | null;
  source: string;
  location: null | SourceArrayLocation | SourceArrayLocation[];
  i18n: string;
  severity: "Information" | "Warning" | "Critical";
  experimental?: boolean;
}

export const warnings = Object.freeze({
  "parsing-error": {
    i18n: "sast_warnings.parsing_error",
    severity: "Information",
    experimental: false
  },
  "unsafe-import": {
    i18n: "sast_warnings.unsafe_import",
    severity: "Warning",
    experimental: false
  },
  "unsafe-regex": {
    i18n: "sast_warnings.unsafe_regex",
    severity: "Warning",
    experimental: false
  },
  "unsafe-stmt": {
    i18n: "sast_warnings.unsafe_stmt",
    severity: "Warning",
    experimental: false
  },
  "encoded-literal": {
    i18n: "sast_warnings.encoded_literal",
    severity: "Information",
    experimental: false
  },
  "short-identifiers": {
    i18n: "sast_warnings.short_identifiers",
    severity: "Warning",
    experimental: false
  },
  "suspicious-literal": {
    i18n: "sast_warnings.suspicious_literal",
    severity: "Warning",
    experimental: false
  },
  "suspicious-file": {
    i18n: "sast_warnings.suspicious_file",
    severity: "Critical",
    experimental: false
  },
  "obfuscated-code": {
    i18n: "sast_warnings.obfuscated_code",
    severity: "Critical",
    experimental: true
  },
  "crypto.weak-algorithm": {
    i18n: "sast_warnings.weak_crypto",
    severity: "Information",
    experimental: false
  },
  "shady-link": {
    i18n: "sast_warnings.shady_link",
    severity: "Warning",
    experimental: false
  },
  "unsafe-command": {
    i18n: "sast_warnings.unsafe_command",
    severity: "Warning",
    experimental: true
  },
  "synchronous-io": {
    i18n: "sast_warnings.synchronous_io",
    severity: "Warning",
    experimental: true
  },
  "serialize-environment": {
    i18n: "sast_warnings.serialize_environment",
    severity: "Warning",
    experimental: false
  },
  "data-exfiltration": {
    i18n: "sast_warnings.data_exfiltration",
    severity: "Warning",
    experimental: false
  },
  "log-usage": {
    i18n: "sast_warnings.log_usage",
    severity: "Information",
    experimental: false
  },
  "sql-injection": {
    i18n: "sast_warnings.sql_injection",
    severity: "Warning",
    experimental: false
  },
  "monkey-patch": {
    i18n: "sast_warnings.monkey_patch",
    severity: "Warning",
    experimental: false
  },
  "insecure-random": {
    i18n: "sast_warnings.insecure_random",
    severity: "Information",
    experimental: false
  },
  "prototype-pollution": {
    i18n: "sast_warnings.prototype_pollution",
    severity: "Warning",
    experimental: false
  },
  "crypto.weak-scrypt": {
    i18n: "sast_warnings.weak_scrypt",
    severity: "Warning",
    experimental: true
  },
  "crypto.unsafe-prehash": {
    i18n: "sast_warnings.unsafe_prehash",
    severity: "Warning",
    experimental: true
  },
  "crypto.weak-bcrypt": {
    i18n: "sast_warnings.weak_bcrypt",
    severity: "Warning",
    experimental: true
  },
  "crypto.password-shucking": {
    i18n: "sast_warnings.password_shucking",
    severity: "Warning",
    experimental: true
  },
  "unsafe-vm-context": {
    i18n: "sast_warnings.unsafe_vm_context",
    severity: "Warning",
    experimental: false
  },
  "crypto.weak-argon2": {
    i18n: "sast_warnings.weak_argon2",
    severity: "Warning",
    experimental: true
  },
  "crypto.weak-pbkdf2": {
    i18n: "sast_warnings.weak_pbkdf2",
    severity: "Warning",
    experimental: true
  }
}) satisfies Record<WarningName, Pick<Warning, "experimental" | "i18n" | "severity">>;

export interface GenerateWarningOptions {
  location?: ESTree.SourceLocation | null;
  file?: string | null;
  value: string | null;
  source?: string;
  /**
   * Override the default severity level for this warning
   */
  severity?: "Information" | "Warning" | "Critical";
}

export function generateWarning<T extends WarningName>(
  kind: T,
  options: GenerateWarningOptions
): Warning<T> {
  const {
    file = null,
    value,
    source = "JS-X-Ray",
    severity = warnings[kind].severity
  } = options;
  const location = options.location ?? rootLocation();

  if (kind === "encoded-literal") {
    return {
      kind,
      value,
      location: [toArrayLocation(location)],
      source,
      ...warnings[kind]
    };
  }

  return {
    kind,
    location: toArrayLocation(location),
    source,
    ...warnings[kind],
    severity,
    ...(notNullOrUndefined(file) ? { file } : {}),
    ...(notNullOrUndefined(value) ? { value } : { value: null })
  };
}

function normalizeLocations(
  location: Warning["location"]
): SourceArrayLocation[] {
  if (location === null) {
    return [];
  }
  /*
   * Custom probes may report a raw ESTree.SourceLocation object
   * instead of the array form.
   */
  if (typeof location === "object" && !Array.isArray(location) && "start" in location) {
    return [toArrayLocation(location as ESTree.SourceLocation)];
  }
  if (!Array.isArray(location) || location.length === 0) {
    return [];
  }

  return Array.isArray(location[0]?.[0]) ?
    location as SourceArrayLocation[] :
    [location as SourceArrayLocation];
}

function warningIdentity(
  warning: Warning
): string {
  return JSON.stringify([
    warning.kind,
    warning.value,
    warning.file ?? null,
    normalizeLocations(warning.location)
  ]);
}

/**
 * Extract the first real start position of a warning.
 *
 * Warnings falling back to the file root location ([0, 0]) are
 * considered to have no real position and are sorted last.
 */
function warningStartPosition(
  warning: Warning
): [line: number, column: number] | null {
  const [first] = normalizeLocations(warning.location);
  if (first === undefined) {
    return null;
  }
  const [[line, column]] = first;

  return line === 0 && column === 0 ? null : [line, column];
}

function compareWarningsByLocation(
  left: Warning,
  right: Warning
): number {
  const leftPosition = warningStartPosition(left);
  const rightPosition = warningStartPosition(right);

  if (leftPosition === null || rightPosition === null) {
    if (leftPosition === rightPosition) {
      return 0;
    }

    return leftPosition === null ? 1 : -1;
  }

  return leftPosition[0] - rightPosition[0] ||
    leftPosition[1] - rightPosition[1];
}

/**
 * Dedupe warnings sharing the same kind, value, file and original
 * source location(s) — the same security pattern may be reported
 * multiple times after inlining and nested eval unrolling — and
 * sort them by their original source position.
 *
 * The sort is stable: warnings without a real source position keep
 * their relative order and are moved to the end of the list.
 */
export function dedupeAndSortWarnings(
  warnings: Warning[]
): Warning[] {
  const seen = new Set<string>();
  const unique = warnings.filter((warning) => {
    const identity = warningIdentity(warning);
    if (seen.has(identity)) {
      return false;
    }
    seen.add(identity);

    return true;
  });

  return unique.sort(compareWarningsByLocation);
}
