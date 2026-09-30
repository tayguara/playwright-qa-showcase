import { expect, test as base } from '@playwright/test';
import { buildSummary, runAxe } from '../a11y/axe';
import baselineFile from '../a11y/a11y-baseline.json';
import { diffAgainstBaseline, formatNewViolations, parseBaseline } from '../a11y/baseline';

const baseline = parseBaseline(baselineFile);

interface A11yFixtures {
  /**
   * Scans the current page with axe, attaches the raw results and a markdown summary, and
   * compares the violations with the baseline. Known violations and stale entries become
   * annotations. The test fails only on a violation that is not in the baseline.
   */
  auditPage: (pageKey: string) => Promise<void>;
}

export const test = base.extend<A11yFixtures>({
  auditPage: async ({ page }, use, testInfo) => {
    await use(async (pageKey) => {
      const scan = await runAxe(page);
      const diff = diffAgainstBaseline(pageKey, scan.violations, baseline);

      await testInfo.attach('axe-results.json', {
        body: JSON.stringify(scan, null, 2),
        contentType: 'application/json',
      });
      await testInfo.attach('a11y-summary.md', {
        body: buildSummary(pageKey, scan, diff),
        contentType: 'text/markdown',
      });

      for (const { violation, entry } of diff.stillPresent) {
        testInfo.annotations.push({
          type: 'a11y-known-violation',
          description: `${violation.id}: ${entry.reason} (since ${entry.since})`,
        });
      }
      for (const entry of diff.resolved) {
        testInfo.annotations.push({
          type: 'a11y-baseline-stale',
          description: `${entry.ruleId} no longer fires on ${pageKey}; remove it from a11y-baseline.json`,
        });
      }

      // Only rule ids are compared; the details go in the message.
      expect(
        diff.newViolations.map((violation) => violation.id),
        formatNewViolations(pageKey, diff.newViolations),
      ).toEqual([]);
    });
  },
});

export { expect } from '@playwright/test';
