// Counting helpers for the lint mode (pure).

/** Counts ESLint JSON results: errors, warnings, fatal (parse or project) errors, and by rule. */
export function countLint(results) {
  const counts = { files: results.length, errors: 0, warnings: 0, fatal: 0, byRule: {} };
  for (const file of results) {
    for (const message of file.messages) {
      if (message.fatal) {
        counts.fatal += 1;
        continue;
      }
      if (message.severity === 2) counts.errors += 1;
      else counts.warnings += 1;
      const rule = message.ruleId ?? '(no rule)';
      counts.byRule[rule] = (counts.byRule[rule] ?? 0) + 1;
    }
  }
  counts.byRule = Object.fromEntries(
    Object.entries(counts.byRule).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  );
  return counts;
}

/**
 * Counts `error TS1234` lines in tsc output. tsc must run with `--pretty false`: its pretty output
 * (the default when FORCE_COLOR is set) wraps the code in ANSI colours, and nothing would match.
 */
export function countTypeErrors(output) {
  return (output.match(/error TS\d+/g) ?? []).length;
}
