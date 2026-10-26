import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const checker = fileURLToPath(new URL('../tools/check-scope.js', import.meta.url));

async function repository(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'koto-scope-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  async function add(name, contents = 'export {};\n') {
    const filename = path.join(directory, ...name.split('/'));
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, contents);
  }
  const metadata = {
    name: '@mehrdadxzaker/koto', version: '3.0.0-alpha.0', type: 'module',
    engines: { node: '>=22' }, bin: { koto: 'bin/koto.js' },
    types: './src/core.d.ts',
    exports: { '.': { types: './src/core.d.ts', import: './src/core.js' } },
    files: ['bin/', 'src/', 'examples/', 'README.md', 'LICENSE'],
    devDependencies: { typescript: '5.9.3', '@types/node': '22.19.0' },
  };
  await add('package.json', JSON.stringify(metadata));
  await add('bin/koto.js', '#!/usr/bin/env node\n');
  await add('src/core.js');
  await add('src/core.d.ts', 'export {};\n');
  await add('examples/fixture-agent.js');
  await add('README.md', '# Fixture repository\n');
  await add('LICENSE', 'Apache-2.0\n');
  await mkdir(path.join(directory, 'tools'));
  await copyFile(checker, path.join(directory, 'tools/check-scope.js'));
  return {
    add,
    metadata,
    remove: (name) => rm(path.join(directory, ...name.split('/'))),
    run() {
      const result = spawnSync(process.execPath, ['tools/check-scope.js'], {
        cwd: directory, encoding: 'utf8', timeout: 5_000, maxBuffer: 1024 * 1024,
      });
      assert.equal(result.error, undefined, 'The public checker must launch successfully.');
      return result;
    },
  };
}

test('scope checker accepts a minimal typed ESM shared-core npm repository', async (t) => {
  const fixture = await repository(t);
  const result = fixture.run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Shared-core source.*verified/);
});

test('scope checker requires matching declarations and ordered ESM exports', async (t) => {
  const cases = [
    ['missing declaration file', (fixture) => fixture.remove('src/core.d.ts'), /declaration.*missing/i],
    ['missing types field', (fixture) => { delete fixture.metadata.types; }, /types field/i],
    ['mismatched types field', async (fixture) => {
      fixture.metadata.types = './src/other.d.ts';
      await fixture.add('src/other.d.ts');
    }, /types field/i],
    ['mismatched declaration export', async (fixture) => {
      fixture.metadata.exports['.'].types = './src/other.d.ts';
      await fixture.add('src/other.d.ts');
    }, /root export/i],
    ['mismatched runtime export', async (fixture) => {
      fixture.metadata.exports['.'].import = './src/other.js';
      await fixture.add('src/other.js');
    }, /root export/i],
    ['declaration condition after import', (fixture) => {
      fixture.metadata.exports['.'] = { import: './src/core.js', types: './src/core.d.ts' };
    }, /root export/i],
    ['undeclared CommonJS surface', (fixture) => {
      fixture.metadata.exports['.'].require = './src/core.js';
    }, /root export/i],
    ['legacy string export', (fixture) => { fixture.metadata.exports['.'] = './src/core.js'; }, /root export/i],
  ];
  for (const [label, change, diagnostic] of cases) {
    await t.test(label, async (child) => {
      const fixture = await repository(child);
      await change(fixture);
      await fixture.add('package.json', JSON.stringify(fixture.metadata));
      const result = fixture.run();
      assert.equal(result.status, 1);
      assert.match(result.stderr, diagnostic);
    });
  }
});

test('scope checker reserves approved IDE and UI deliveries and nested adapter paths', async (t) => {
  for (const filename of [
    'plugins/vscode/package.json',
    'ui/package.json',
    'src/adapters/hosted.js',
    'src/adapters/hosted/client.js',
    'src/clients/adapter.js',
    'src/diagnostics/trace.js',
    'plugins/ide/plugin.json',
    'ui/apps/view.js',
  ]) {
    await t.test(filename, async (child) => {
      const fixture = await repository(child);
      await fixture.add(filename, filename.endsWith('.json') ? '{}' : 'export {};\n');
      const result = fixture.run();
      assert.equal(result.status, 0, result.stderr);
    });
  }
});

test('scope checker rejects retired root products and archive prefixes', async (t) => {
  for (const filename of [
    'hormuz/old.js', 'koto/old.js', 'skills/koto/SKILL.md',
    '.agents/plugins/marketplace.json', '.claude-plugin/plugin.json',
    'apps/old.js', 'clients/old.js', 'enterprise/old.js', 'deploy/old.js',
    'website/old.js', 'marketing/old.js', 'experiments/old.js',
    'finance/old.js', 'portfolio/old.js', 'billing/old.js', 'hosted/old.js',
    'docs/campaigns/old.md', 'docs/local-harness/old.md',
    'docs/diagnostics/old.md', 'docs/qualifications/old.md',
  ]) {
    await t.test(filename, async (child) => {
      const fixture = await repository(child);
      await fixture.add(filename);
      const result = fixture.run();
      assert.equal(result.status, 1);
      assert(result.stderr.includes(filename), 'The failure must identify the unrelated source path.');
    });
  }
});

test('scope checker rejects old root manifests and Python in approved product paths', async (t) => {
  for (const filename of [
    'pyproject.toml', 'MANIFEST.in', 'plugin.json', 'gemini-extension.json',
    '.mcp.json', '.app.json', 'GEMINI.md',
    'src/legacy.py', 'plugins/vscode/legacy.py', 'ui/legacy.py',
  ]) {
    await t.test(filename, async (child) => {
      const fixture = await repository(child);
      await fixture.add(filename);
      const result = fixture.run();
      assert.equal(result.status, 1);
      assert(result.stderr.includes(filename), 'The failure must identify the legacy manifest or source.');
    });
  }
});

test('scope checker preserves ignored user artifacts and empty legacy directories', async (t) => {
  const fixture = await repository(t);
  await fixture.add('.scratch/retained.py');
  await fixture.add('.venv-local/retained.py');
  await fixture.add('hormuz/__pycache__/retained.pyc');
  const result = fixture.run();
  assert.equal(result.status, 0, result.stderr);
});
