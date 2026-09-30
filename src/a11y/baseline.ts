import { z } from 'zod';

/**
 * Accessibility baseline: the violations we knowingly accept on each page, keyed by axe rule id.
 *
 * The suite fails only on violations that are NOT in the baseline. A baselined rule that stops
 * firing is reported as "resolved" (annotation, no failure) so the entry can be removed in a PR.
 * There is deliberately no automatic "update baseline" mode: every entry is reviewed by hand.
 */

const entrySchema = z.object({
  ruleId: z.string().min(1, 'ruleId must not be empty'),
  reason: z.string().min(1, 'reason must not be empty'),
  since: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'since must look like "YYYY-MM"'),
});

const baselineSchema = z.record(
  z.string(),
  z.array(entrySchema).superRefine((entries, ctx) => {
    const seen = new Set<string>();
    for (const entry of entries) {
      if (seen.has(entry.ruleId)) {
        ctx.addIssue({ code: 'custom', message: `Duplicate rule id "${entry.ruleId}"` });
      }
      seen.add(entry.ruleId);
    }
  }),
);

export type BaselineEntry = z.infer<typeof entrySchema>;
export type Baseline = z.infer<typeof baselineSchema>;

/** The part of an axe violation this module needs (structural, so it stays decoupled from axe). */
export interface ViolationLike {
  id: string;
  impact?: string | null;
  help: string;
  helpUrl: string;
  nodes: ReadonlyArray<{ target: ReadonlyArray<unknown> }>;
}

export interface BaselineDiff<T extends ViolationLike> {
  /** Not in the baseline: these fail the test. */
  newViolations: T[];
  /** In the baseline and still firing: reported, does not fail. */
  stillPresent: Array<{ violation: T; entry: BaselineEntry }>;
  /** In the baseline but no longer firing: the entry is stale and can be removed. */
  resolved: BaselineEntry[];
}

/** Validates the JSON file read from disk (a real boundary: the file is edited by hand). */
export function parseBaseline(raw: unknown): Baseline {
  return baselineSchema.parse(raw);
}

export function diffAgainstBaseline<T extends ViolationLike>(
  pageKey: string,
  violations: readonly T[],
  baseline: Baseline,
): BaselineDiff<T> {
  const entries = baseline[pageKey] ?? [];
  const entryByRule = new Map(entries.map((entry) => [entry.ruleId, entry]));
  const firedRules = new Set(violations.map((violation) => violation.id));

  const diff: BaselineDiff<T> = {
    newViolations: [],
    stillPresent: [],
    resolved: entries.filter((entry) => !firedRules.has(entry.ruleId)),
  };

  for (const violation of violations) {
    const entry = entryByRule.get(violation.id);
    if (entry) {
      diff.stillPresent.push({ violation, entry });
    } else {
      diff.newViolations.push(violation);
    }
  }
  return diff;
}

const MAX_TARGETS_LISTED = 3;

/** Human-readable failure message for violations that are not in the baseline. */
export function formatNewViolations(pageKey: string, violations: readonly ViolationLike[]): string {
  const lines = [
    `${violations.length} new accessibility violation(s) on "${pageKey}" (not in a11y-baseline.json):`,
  ];
  for (const violation of violations) {
    lines.push(
      '',
      `- ${violation.id} [${violation.impact ?? 'unknown impact'}]: ${violation.help}`,
      `  ${violation.nodes.length} element(s), e.g.:`,
    );
    for (const node of violation.nodes.slice(0, MAX_TARGETS_LISTED)) {
      lines.push(`    ${node.target.map(String).join(' >> ')}`);
    }
    lines.push(`  More info: ${violation.helpUrl}`);
  }
  return lines.join('\n');
}
