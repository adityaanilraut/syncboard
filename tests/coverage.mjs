import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import coverage from 'istanbul-lib-coverage';
import sourceMaps from 'istanbul-lib-source-maps';

const combined = coverage.createCoverageMap(
  JSON.parse(readFileSync('coverage/coverage-final.json', 'utf8')),
);
const browserDirectory = process.argv[2];
for (const file of ['coverage/e2e/coverage-final.json',
  ...readdirSync(browserDirectory).map(file => join(browserDirectory, file))]) {
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  const e2e = file.startsWith(browserDirectory)
    ? (await sourceMaps.createSourceMapStore().transformCoverage(coverage.createCoverageMap(raw))).toJSON()
    : raw;
  for (const [path, data] of Object.entries(e2e)) {
    const name = relative(process.cwd(), path);
    if (name.startsWith('src/') || name.startsWith('server/')) combined.addFileCoverage(data);
  }
}
const metrics = summary => {
  const { lines } = summary.toJSON();
  return { lines: lines.total, covered: lines.covered, percent: lines.pct };
};
const report = {
  all: metrics(combined.getCoverageSummary()),
  files: Object.fromEntries(combined.files().map(path => [
    relative(process.cwd(), path),
    metrics(combined.fileCoverageFor(path).toSummary()),
  ])),
};
writeFileSync('coverage/combined.json', JSON.stringify(report, null, 2) + '\n');
console.log(report);
