import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import type { BaselineDiff, ViolationLike } from './baseline';

/**
 * WCAG 2.0, 2.1 and 2.2 levels A and AA, plus axe's "best-practice" rules (advisory guidance that
 * is not a WCAG failure by itself). Level AAA is out of scope.
 * SauceDemo currently has no WCAG A/AA violations, so the best-practice rules are what keep the
 * baseline mechanism exercised with real findings.
 */
export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

export async function runAxe(page: Page) {
  return new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
}

export type AxeScan = Awaited<ReturnType<typeof runAxe>>;

/** Markdown report attached to every a11y test next to the raw axe JSON. */
export function buildSummary(
  pageKey: string,
  scan: AxeScan,
  diff: BaselineDiff<ViolationLike>,
): string {
  const lines = [
    `# Accessibility summary: ${pageKey}`,
    '',
    `- URL: ${scan.url}`,
    `- Rule set: axe-core ${scan.testEngine.version}, tags ${AXE_TAGS.join(', ')}`,
    `- Violations: ${scan.violations.length} (new: ${diff.newViolations.length}, known: ${diff.stillPresent.length})`,
    `- Stale baseline entries: ${diff.resolved.length}`,
    `- Rules passed: ${scan.passes.length}, needing manual review (incomplete): ${scan.incomplete.length}`,
    '',
    'Automated checks cover only part of WCAG. They do not replace a manual audit.',
  ];

  const section = (title: string, rows: string[]) => {
    if (rows.length > 0) {
      lines.push('', `## ${title}`, '', ...rows);
    }
  };

  section(
    'New violations (fail the test)',
    diff.newViolations.map(
      (v) => `- \`${v.id}\` (${v.impact ?? 'n/a'}): ${v.help}, ${v.nodes.length} element(s)`,
    ),
  );
  section(
    'Known violations (in baseline)',
    diff.stillPresent.map(
      ({ violation: v, entry }) =>
        `- \`${v.id}\` (${v.impact ?? 'n/a'}), ${v.nodes.length} element(s). Since ${entry.since}: ${entry.reason}`,
    ),
  );
  section(
    'Stale baseline entries (rule no longer fires, remove from a11y-baseline.json)',
    diff.resolved.map((entry) => `- \`${entry.ruleId}\`: ${entry.reason}`),
  );
  return lines.join('\n') + '\n';
}
