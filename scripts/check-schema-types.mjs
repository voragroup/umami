// Compare full-program type diagnostics against the deployed rawQuery source
// in memory. Does not overwrite source files or suppress existing errors.
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';

const root = process.cwd();
const target = path.join(root, 'src/lib/prisma.ts');
const baseline = execFileSync('git', [
  'show', 'c78ff36db0c82e13c86e5073020472c6546313a3:src/lib/prisma.ts',
], { encoding: 'utf8' });
const config = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
assert.equal(config.error, undefined);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
assert.equal(parsed.errors.length, 0);

function diagnostics(useBaseline) {
  const options = { ...parsed.options, noEmit: true, incremental: false };
  const host = ts.createCompilerHost(options);
  const read = host.readFile.bind(host);
  if (useBaseline) host.readFile = filename => path.resolve(filename) === target ? baseline : read(filename);
  const program = ts.createProgram(parsed.fileNames, options, host);
  return ts.getPreEmitDiagnostics(program)
    .filter(d => d.category === ts.DiagnosticCategory.Error)
    .map(d => `${d.file ? path.relative(root, d.file.fileName) : '<config>'}:${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`)
    .sort();
}

const before = diagnostics(true);
const after = diagnostics(false);
assert.deepEqual(after, before, 'The repair changed full-program type diagnostics');
assert.equal(after.filter(d => d.startsWith('src/lib/prisma.ts:')).length, 0);
console.log(`PASS: ${before.length} existing type errors on deployed baseline; identical diagnostics after repair; none in src/lib/prisma.ts. Full type check remains failing.`);
