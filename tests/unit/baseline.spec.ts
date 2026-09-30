import { test, expect } from '@playwright/test';
import {
  diffAgainstBaseline,
  formatNewViolations,
  parseBaseline,
  type Baseline,
} from '../../src/a11y/baseline';

/** Builds a minimal axe-like violation for tests. */
function violation(id: string, overrides: Partial<{ impact: string; nodes: number }> = {}) {
  const nodeCount = overrides.nodes ?? 1;
  return {
    id,
    impact: overrides.impact ?? 'serious',
    help: `Help text for ${id}`,
    helpUrl: `https://dequeuniversity.com/rules/axe/4.13/${id}`,
    nodes: Array.from({ length: nodeCount }, (_, index) => ({ target: [`#${id}-${index}`] })),
  };
}

const baseline: Baseline = {
  login: [
    { ruleId: 'color-contrast', reason: 'Low contrast on the login button', since: '2026-09' },
  ],
  inventory: [
    { ruleId: 'select-name', reason: 'Sort select has no label', since: '2026-09' },
    { ruleId: 'image-alt', reason: 'Product images lack alt text', since: '2026-09' },
  ],
};

test.describe('a11y baseline diff', { tag: '@unit' }, () => {
  test('reports a violation that is not in the baseline as new', () => {
    const diff = diffAgainstBaseline('login', [violation('label')], baseline);

    expect(diff.newViolations.map((v) => v.id)).toEqual(['label']);
    expect(diff.stillPresent).toEqual([]);
  });

  test('treats a baselined violation as known, not new', () => {
    const diff = diffAgainstBaseline('login', [violation('color-contrast')], baseline);

    expect(diff.newViolations).toEqual([]);
    expect(diff.stillPresent).toHaveLength(1);
    expect(diff.stillPresent[0]?.entry.reason).toBe('Low contrast on the login button');
    expect(diff.stillPresent[0]?.violation.id).toBe('color-contrast');
  });

  test('flags a baselined rule that no longer fires as resolved', () => {
    const diff = diffAgainstBaseline('inventory', [violation('select-name')], baseline);

    expect(diff.newViolations).toEqual([]);
    expect(diff.stillPresent.map((item) => item.entry.ruleId)).toEqual(['select-name']);
    expect(diff.resolved.map((entry) => entry.ruleId)).toEqual(['image-alt']);
  });

  test('treats every violation as new on a page without a baseline entry', () => {
    const diff = diffAgainstBaseline(
      'checkout-step-one',
      [violation('label'), violation('x')],
      baseline,
    );

    expect(diff.newViolations.map((v) => v.id)).toEqual(['label', 'x']);
    expect(diff.stillPresent).toEqual([]);
    expect(diff.resolved).toEqual([]);
  });

  test('is clean when nothing fires and nothing is baselined', () => {
    const diff = diffAgainstBaseline('checkout-step-one', [], baseline);

    expect(diff).toEqual({ newViolations: [], stillPresent: [], resolved: [] });
  });

  test('keeps baselines of different pages independent', () => {
    // color-contrast is baselined on login only, so on inventory it is a new problem.
    const diff = diffAgainstBaseline('inventory', [violation('color-contrast')], baseline);

    expect(diff.newViolations.map((v) => v.id)).toEqual(['color-contrast']);
  });
});

test.describe('a11y violation formatting', { tag: '@unit' }, () => {
  test('names the page, rule, impact, help link and affected elements', () => {
    const message = formatNewViolations('login', [violation('label', { impact: 'critical' })]);

    expect(message).toContain('login');
    expect(message).toContain('label');
    expect(message).toContain('critical');
    expect(message).toContain('Help text for label');
    expect(message).toContain('https://dequeuniversity.com/rules/axe/4.13/label');
    expect(message).toContain('#label-0');
  });

  test('truncates long element lists but reports the total', () => {
    const message = formatNewViolations('inventory', [violation('image-alt', { nodes: 7 })]);

    expect(message).toContain('7 element(s)');
    expect(message).toContain('#image-alt-0');
    expect(message).not.toContain('#image-alt-6');
  });
});

test.describe('a11y baseline file validation', { tag: '@unit' }, () => {
  test('accepts a well-formed baseline', () => {
    expect(parseBaseline(baseline)).toEqual(baseline);
  });

  test('rejects an entry without a reason', () => {
    const broken = { login: [{ ruleId: 'color-contrast', reason: '', since: '2026-09' }] };

    expect(() => parseBaseline(broken)).toThrow(/reason/i);
  });

  test('rejects a malformed since date', () => {
    const broken = { login: [{ ruleId: 'color-contrast', reason: 'Why', since: 'September' }] };

    expect(() => parseBaseline(broken)).toThrow(/since/i);
  });

  test('rejects duplicate rule ids on the same page', () => {
    const entry = { ruleId: 'color-contrast', reason: 'Why', since: '2026-09' };

    expect(() => parseBaseline({ login: [entry, entry] })).toThrow(/duplicate/i);
  });
});
