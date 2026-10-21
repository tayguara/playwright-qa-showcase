// Renders results/summary.md from results/suite-*.json and results/weak-assertions.json.
// Pure: takes the parsed files, returns Markdown. The summary is generated, never hand-edited.

import { FAULTS } from '../stub/faults.mjs';
import { SUITES } from './suites.mjs';

const SUITE_IDS = ['H', 'A', 'B'];
const percent = (rate) => `${(rate * 100).toFixed(1)}%`;
const code = (text) => `\`${text}\``;
/**
 * Makes a string safe to show on ONE Markdown line. Test titles, rule names and the like come from
 * code an AI wrote, so a title with a newline must not be able to start a new line (a list item, a
 * heading, an HTML block) in the summary. Control characters become spaces, pipes and backticks are
 * escaped, `<` is escaped so that no HTML starts, and the length is capped.
 */
export function inline(value, max = 300) {
  const text = String(value)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f\u0085\u2028\u2029]+/g, ' ')
    .replace(/[|`<>\\]/g, (c) => `\\${c}`)
    .trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

const uniqueTitles = (clean) => new Set(clean.tests.map((t) => t.key)).size;

/** One table cell per suite; `none` is shown when the suite or the section has not been run. */
const cells = (suites, pick, none = 'n/a') =>
  SUITE_IDS.map((id) => {
    const value = suites[id] ? pick(suites[id]) : undefined;
    return value === undefined ? none : value;
  });

const row = (label, values) => `| ${[label, ...values].join(' | ')} |`;

function faultTable(suites) {
  const lines = [
    row(
      'Fault',
      SUITE_IDS.map((id) => `Suite ${id}`),
    ),
    row(
      '---',
      SUITE_IDS.map(() => '---'),
    ),
  ];
  for (const fault of FAULTS) {
    const values = cells(suites, (s) => {
      const entry = s.stub?.faults?.find((f) => f.fault === fault.id);
      if (!entry) return undefined;
      // `invalid` is not a catch: show it as such. A fault seen only as flaky is flagged.
      if (entry.status === 'missed' && entry.flakyTests.length > 0) return 'missed (flaky only)';
      return entry.status;
    });
    lines.push(row(`${fault.id}. ${code(fault.slug)}`, values));
  }
  const totals = cells(suites, (s) =>
    s.stub?.faults ? `${s.stub.faultsCaught} / ${FAULTS.length}` : undefined,
  );
  lines.push(
    row(
      '**Faults caught**',
      totals.map((t) => `**${t}**`),
    ),
  );
  return lines.join('\n');
}

function weakCells(weak, suites) {
  if (!weak) return cells(suites, () => 'pending');
  return SUITE_IDS.map((id) => {
    const entry = weak.suites?.[id];
    if (!entry) return 'n/a';
    const hitTests = new Set(entry.hits.map((hit) => hit.test)).size;
    return `${entry.hits.length} hits, ${hitTests} / ${inline(entry.tests, 20)} tests`;
  });
}

function topRules(byRule, limit = 3) {
  const top = Object.entries(byRule ?? {})
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([rule, count]) => `${inline(rule, 80)} (${count})`);
  return top.length > 0 ? top.join(', ') : 'none';
}

function metricsTable(suites, weak) {
  const lines = [
    row(
      'Metric',
      SUITE_IDS.map((id) => `Suite ${id}`),
    ),
    row(
      '---',
      SUITE_IDS.map(() => '---'),
    ),
  ];
  lines.push(
    row(
      'Tests (executions; unique titles)',
      cells(suites, (s) =>
        s.stub?.clean ? `${s.stub.clean.total}; ${uniqueTitles(s.stub.clean)}` : undefined,
      ),
    ),
    row(
      'Pass rate, clean stub',
      cells(suites, (s) =>
        s.stub?.clean
          ? `${percent(s.stub.clean.passRate)} (${s.stub.clean.passed} / ${s.stub.clean.total - s.stub.clean.skipped})`
          : undefined,
      ),
    ),
    row(
      'Pass rate, public API',
      cells(suites, (s) =>
        s.public ? `${percent(s.public.passRate)} (${s.public.ranAt})` : undefined,
      ),
    ),
    row(
      'Faults caught (headline)',
      cells(suites, (s) =>
        s.stub?.faults ? `${s.stub.faultsCaught} / ${FAULTS.length}` : undefined,
      ),
    ),
    row(
      'Faults surfaced only as flaky',
      cells(suites, (s) =>
        s.stub?.faults
          ? String(
              s.stub.faults.filter((f) => f.status !== 'caught' && f.flakyTests.length > 0).length,
            )
          : undefined,
      ),
    ),
    row(
      'Fault 10 deterministic',
      cells(suites, (s) =>
        s.stub?.fault10Deterministic === undefined
          ? undefined
          : String(s.stub.fault10Deterministic),
      ),
    ),
    row(
      'Lint violations (errors + warnings; measured, not enforced)',
      cells(suites, (s) =>
        s.lint
          ? `${s.lint.errors + s.lint.warnings} (${s.lint.errors} errors, ${s.lint.warnings} warnings)`
          : undefined,
      ),
    ),
    row(
      'Lint fatal (parse or project errors)',
      cells(suites, (s) => (s.lint ? String(s.lint.fatal) : undefined)),
    ),
    row(
      'Top lint rules',
      cells(suites, (s) => (s.lint ? topRules(s.lint.byRule) : undefined)),
    ),
    row('Weak assertions (checklist v1)', weakCells(weak, suites)),
    row(
      'Flaky over 5 repeats',
      cells(suites, (s) =>
        s.repeat ? `${s.repeat.flakyTests.length} of ${s.repeat.executions} executions` : undefined,
      ),
    ),
    row(
      'Type errors (supplementary)',
      cells(suites, (s) => (s.typecheck ? String(s.typecheck.errors) : undefined)),
    ),
  );
  return lines.join('\n');
}

function details(suites) {
  const sections = [];
  for (const id of SUITE_IDS) {
    const suite = suites[id];
    if (!suite) continue;
    // Label and source come from the constants in suites.mjs, never from the results files.
    const lines = [
      `### Suite ${id}: ${SUITES[id].label}`,
      '',
      `Source: ${code(SUITES[id].source)}`,
    ];
    if (suite.stub?.faults) {
      lines.push('', 'Failing tests per fault:', '');
      for (const f of suite.stub.faults) {
        const flaky = f.flakyTests.length > 0 ? `; flaky: ${f.flakyTests.length}` : '';
        const globalErrors =
          f.newGlobalErrors > 0 ? `; new global errors: ${f.newGlobalErrors}` : '';
        lines.push(
          `- fault ${f.fault} (${f.slug}): ${f.status}, ${f.failingTests.length} failing, ${f.requests} requests${flaky}${globalErrors}`,
        );
        for (const key of f.failingTests) lines.push(`  - ${inline(key)}`);
      }
    }
    if (suite.repeat?.flakyTests.length > 0) {
      lines.push(
        '',
        'Flaky over the repeat run:',
        ...suite.repeat.flakyTests.map((k) => `- ${inline(k)}`),
      );
    }
    if (suite.repeat?.consistentlyFailing.length > 0) {
      lines.push(
        '',
        'Failing in every repetition:',
        ...suite.repeat.consistentlyFailing.map((k) => `- ${inline(k)}`),
      );
    }
    sections.push(lines.join('\n'));
  }
  return sections.join('\n\n');
}

/** Warns when a suite file mixes results measured against different stub versions. */
function stubWarnings(suites) {
  const warnings = [];
  for (const id of SUITE_IDS) {
    const suite = suites[id];
    if (!suite) continue;
    for (const section of ['stub', 'repeat']) {
      const sha = suite[section]?.stubSha256;
      if (sha && sha !== suite.stubSha256) {
        warnings.push(
          `Suite ${id}: the ${section} results were measured with another stub version; rerun them.`,
        );
      }
    }
    if (suite.stub && suite.stub.complete === false) {
      warnings.push(
        `Suite ${id}: the fault run is NOT complete (debug subset), so it is not official.`,
      );
    }
  }
  const shas = new Set(SUITE_IDS.map((id) => suites[id]?.stubSha256).filter(Boolean));
  if (shas.size > 1) warnings.push('Suites were measured with different stub versions.');
  return warnings;
}

/**
 * @param {{ suites: Record<string, object|undefined>, weak?: object|null }} input
 * @returns {string} Markdown
 */
export function renderSummary({ suites, weak = null }) {
  const stubShas = [...new Set(SUITE_IDS.map((id) => suites[id]?.stubSha256).filter(Boolean))];
  const gitShas = [...new Set(SUITE_IDS.map((id) => suites[id]?.gitSha).filter(Boolean))];
  const parts = [
    '# Experiment summary',
    '',
    '> Generated by `harness/report.mjs` from `results/suite-*.json` and `results/weak-assertions.json`. Do not edit by hand.',
    '',
    `Stub sha256: ${stubShas.length > 0 ? stubShas.map(code).join(', ') : 'n/a'}`,
    `Git SHA: ${gitShas.length > 0 ? gitShas.map(code).join(', ') : 'n/a'}`,
  ];
  const warnings = stubWarnings(suites);
  if (warnings.length > 0) parts.push('', ...warnings.map((w) => `> Warning: ${w}`));
  parts.push(
    '',
    '## Faults caught',
    '',
    'Suites by faults. `invalid` means the suite never reached the stub and counts as not caught.',
    '',
    faultTable(suites),
    '',
    '## Metrics',
    '',
    metricsTable(suites, weak),
    '',
    '## Details',
    '',
    details(suites),
    '',
  );
  return parts.join('\n');
}
