# Probe Error

| Code | Severity | i18n | Experimental |
| --- | --- | --- | :-: |
| probe-error | `Information` | `sast_warnings.probe_error` | ❌ |

## Introduction

<kbd>probe-error</kbd> warning is emitted when a security probe throws an error while running its `validateNode`, `main`, `teardown` or `finalize` handler.

Probe failures are isolated: a failing probe neither aborts the analysis of the file nor prevents other probes from running. All findings collected before (and after) the failure are preserved, and the failing probe keeps running on subsequent nodes.

Diagnostics are:

- **stable**: the value is a deterministic `probe "<name>" <phase> error: <message>` string with the error message truncated to 200 characters.
- **located**: the warning carries the location of the AST node being analyzed when the failure occurred (root location for `finalize` failures).
- **capped**: at most 3 diagnostics are reported per probe to avoid flooding the report when a probe fails on many nodes.

## Example

```json
{
  "kind": "probe-error",
  "value": "probe \"my-custom-probe\" main error: Cannot read properties of undefined (reading 'foo')",
  "location": [[1, 0], [1, 23]]
}
```
