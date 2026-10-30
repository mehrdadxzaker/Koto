#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directories = new Set(['bin', 'src', 'plugins', 'ui', 'tools', 'docs', '.github', 'assets', 'skills', 'Formula', 'install']);
const distributionFiles = new Set(['Formula/koto.rb', 'install/manifest.json']);
const skillFiles = new Set(['skills/koto/SKILL.md', 'skills/koto/agents/openai.yaml', 'skills/koto/references/cli-workflow.md']);
const rootFiles = new Set(['package.json', 'package-lock.json', '.gitignore', '.editorconfig', 'LICENSE', 'NOTICE', 'install.sh']);
const ignoredDirectories = /^(?:\.git|node_modules|dist|build|coverage|\.scratch|\.cache|\.pytest_cache|__pycache__|\.venv.*|.*\.egg-info)$/;
const ignoredFiles = /^(?:\.env(?:\..*)?|\.coverage|.*\.runtime\.env|(?:hormuz|koto)\.json|.*\.(?:py[co]|sqlite3(?:-(?:shm|wal))?))$/;
const retiredRoots = /^(?:hormuz|koto|tests|\.agents|\.claude-plugin|apps|clients|deploy|website|marketing|experiments|finance|portfolio|billing|enterprise|hosted)$/i;
const retiredRootFiles = /^(?:pyproject\.toml|setup\.(?:py|cfg)|MANIFEST\.in|requirements(?:[-.].*)?\.txt|(?:uv|poetry)\.lock|tox\.ini|plugin\.json|gemini-extension\.json|mcp\.json|\.mcp\.json|\.app\.json|GEMINI\.md|binding\.gyp)$/i;
const retiredArchives = ['docs/campaigns', 'docs/diagnostics', 'docs/local-harness', 'docs/qualifications'];
const errors = new Set();
const files = new Set();
const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));

function fail(message) {
  errors.add(message);
}

function localPath(name) {
  return path.resolve(root, ...name.split('/'));
}

function insideRoot(filename) {
  const relative = path.relative(root, filename);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function allowedRoot(name, isDirectory) {
  return isDirectory ? directories.has(name) : rootFiles.has(name) || /^[^/]+\.md$/i.test(name);
}

function checkPath(name) {
  const parts = name.split('/');
  const basename = parts.at(-1);
  // Retired roots and archive prefixes identify removed products. Terms such
  // as "hosted" or "clients" remain valid inside the shared core and deliveries.
  if (retiredRoots.test(parts[0]) || (parts.length === 1 && retiredRootFiles.test(basename))
      || retiredArchives.some((prefix) => name === prefix || name.startsWith(`${prefix}/`))
      || /\.(?:py|pyi|pyc|pyo|node)$/i.test(basename)) {
    fail(`Retired or native source is outside the shared-core scope: ${name}`);
  }
  if (!allowedRoot(parts[0], parts.length > 1)) {
    fail(`Unexpected repository path: ${name}`);
  }
  if (parts[0] === 'skills' && !skillFiles.has(name)) {
    fail(`Only the optional CLI-backed Koto skill belongs in skills/: ${name}`);
  }
  if (['Formula', 'install'].includes(parts[0]) && !distributionFiles.has(name)) {
    fail(`Unexpected CLI distribution source: ${name}`);
  }
}

function walk(directory = root, prefix = '') {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    // A real Git worktree has a regular root .git pointer rather than a
    // directory. It is repository metadata, never package source. Symlinks
    // and tracked/private artifacts still go through their normal checks.
    if (!prefix && entry.name === '.git' && entry.isFile()) continue;
    if (entry.isDirectory() && ignoredDirectories.test(entry.name)) continue;
    if (!entry.isDirectory() && ignoredFiles.test(entry.name)) continue;
    if (entry.isSymbolicLink()) {
      fail(`Active source must not depend on a symlink: ${name}`);
      continue;
    }
    if (entry.isDirectory()) {
      walk(path.join(directory, entry.name), name);
    } else if (entry.isFile()) {
      checkPath(name);
      files.add(name);
    }
  }
}

function checkTrackedPaths() {
  // The traversal includes new files. Git additionally catches files committed
  // inside directories that are normally private or generated. Git is optional.
  let tracked;
  try {
    tracked = execFileSync('git', ['ls-files', '--cached', '-z'], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024,
    }).split('\0').filter(Boolean);
  } catch {
    return;
  }
  for (const name of tracked) {
    if (!existsSync(localPath(name))) continue; // A staged or pending deletion.
    if (name.split('/').some((part) => ignoredDirectories.test(part))
        || ignoredFiles.test(path.posix.basename(name))) {
      fail(`Generated or private artifacts must not be tracked: ${name}`);
    }
    checkPath(name);
  }
}

function packageTarget(target, label) {
  if (typeof target !== 'string' || !target || path.isAbsolute(target)
      || target.includes('\\') || !insideRoot(localPath(target))) {
    fail(`${label} must name a file or directory inside this package`);
    return;
  }
  const filename = localPath(target);
  if (!existsSync(filename)) {
    fail(`${label} is missing: ${target}`);
  } else {
    const entry = lstatSync(filename);
    if (entry.isSymbolicLink() || !insideRoot(realpathSync(filename))) {
      fail(`${label} must stay inside this package: ${target}`);
    } else if (target.endsWith('/') ? !entry.isDirectory() : !entry.isFile()) {
      fail(`${label} has the wrong file type: ${target}`);
    }
  }
}

function checkDistribution() {
  try {
    const manifest = JSON.parse(readFileSync(localPath('install/manifest.json'), 'utf8'));
    const cli = manifest.cli;
    const node = manifest.node;
    if (manifest.schemaVersion !== 1 || cli.package !== '@mehrdadz/koto'
        || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(cli.version)
        || cli.url !== `https://registry.npmjs.org/${cli.package}/-/koto-${cli.version}.tgz`
        || !/^[a-f0-9]{64}$/.test(cli.sha256) || !/^[a-f0-9]{40}$/.test(cli.sourceCommit)
        || !/^24\.\d+\.\d+$/.test(node.version) || node.homebrewDependency !== 'node@24'
        || node.checksums !== `https://nodejs.org/dist/v${node.version}/SHASUMS256.txt`
        || Object.keys(node.linux).sort().join(',') !== 'arm64,x64'
        || Object.values(node.linux).some((digest) => !/^[a-f0-9]{64}$/.test(digest))) {
      throw new Error('invalid pinned distribution metadata');
    }
    const shell = readFileSync(localPath('install.sh'), 'utf8');
    const constants = Object.fromEntries([...shell.matchAll(/^(KOTO_VERSION|KOTO_URL|KOTO_SHA256|NODE_VERSION)=([^\r\n]+)$/gm)]
      .map((match) => [match[1], match[2]]));
    for (const [key, value] of Object.entries({ KOTO_VERSION: cli.version, KOTO_URL: cli.url,
      KOTO_SHA256: cli.sha256, NODE_VERSION: `v${node.version}` })) {
      if (constants[key] !== value) fail(`Linux installer ${key} differs from install/manifest.json`);
    }
    for (const digest of Object.values(node.linux)) {
      if (!shell.includes(`node_sha=${digest}`)) fail('Linux runtime checksum differs from install/manifest.json');
    }
    const formula = readFileSync(localPath('Formula/koto.rb'), 'utf8');
    for (const [key, value] of Object.entries({ url: cli.url, version: cli.version, sha256: cli.sha256,
      depends_on: node.homebrewDependency })) {
      if (!formula.split('\n').some((line) => line.trim() === `${key} "${value}"`)) {
        fail(`Homebrew ${key} differs from install/manifest.json`);
      }
    }
  } catch (error) {
    fail(`CLI distribution metadata: ${error.message}`);
  }
}

function checkIdeDelivery() {
  const prefix = 'plugins/vscode/';
  if (!existsSync(localPath(`${prefix}package.json`))) return;
  try {
    const plugin = JSON.parse(readFileSync(localPath(`${prefix}package.json`), 'utf8'));
    const lock = JSON.parse(readFileSync(localPath(`${prefix}package-lock.json`), 'utf8'));
    const integrity = JSON.parse(readFileSync(localPath(`${prefix}core-integrity.json`), 'utf8'));
    // Each IDE release keeps its independently verified core archive frozen.
    const corePackage = '@mehrdadz/koto';
    const entries = value => value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value) : [];
    if (plugin.name !== 'koto' || plugin.displayName !== 'Koto'
        || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(plugin.version ?? '')
        || plugin.main !== './extension.cjs' || Object.hasOwn(plugin, 'browser')
        || JSON.stringify(plugin.extensionKind) !== JSON.stringify(['ui'])) {
      fail('The IDE delivery must be a versioned Koto extension in the local Node host');
    }
    if (entries(plugin.dependencies).length !== 1 || plugin.dependencies?.[corePackage] !== integrity.version
        || entries(plugin.devDependencies).length !== 1 || !/^\d+\.\d+\.\d+$/.test(plugin.devDependencies?.['@vscode/vsce'] ?? '')
        || entries(plugin.optionalDependencies).length || entries(plugin.peerDependencies).length) {
      fail('The IDE delivery must pin only the published core at runtime and an exact VSCE build dependency');
    }
    for (const hook of ['preinstall', 'install', 'postinstall', 'prepare', 'preprepare', 'postprepare']) {
      if (Object.hasOwn(plugin.scripts ?? {}, hook)) fail(`IDE dependency installation must not run a ${hook} hook`);
    }
    const production = lock.packages?.[`node_modules/${corePackage}`];
    const packager = lock.packages?.['node_modules/@vscode/vsce'];
    if (lock.name !== plugin.name || lock.version !== plugin.version
        || lock.packages?.['']?.name !== plugin.name
        || lock.packages?.['']?.version !== plugin.version
        || lock.packages?.['']?.dependencies?.[corePackage] !== integrity.version
        || lock.packages?.['']?.devDependencies?.['@vscode/vsce'] !== plugin.devDependencies?.['@vscode/vsce']
        || production?.version !== integrity.version || production?.resolved !== integrity.archive?.url
        || production?.integrity !== integrity.archive?.integrity
        || packager?.version !== plugin.devDependencies?.['@vscode/vsce']) {
      fail('The IDE lock must bind its own version, packager and exact published core integrity');
    }
    if (integrity.schemaVersion !== 1 || integrity.package !== corePackage
        || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(integrity.version ?? '')
        || integrity.archive?.url !== `https://registry.npmjs.org/${corePackage}/-/koto-${integrity.version}.tgz`
        || !/^[a-f0-9]{64}$/.test(integrity.archive?.sha256 ?? '')
        || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(integrity.archive?.integrity ?? '')
        || !/^[a-f0-9]{64}$/.test(integrity.releaseManifestSha256 ?? '')
        || !/^[a-f0-9]{40}$/.test(integrity.source?.commit ?? '') || !/^[a-f0-9]{40}$/.test(integrity.source?.tree ?? '')
        || !/^[a-f0-9]{40}$/.test(integrity.source?.packedFromCommit ?? '')
        || !Array.isArray(integrity.payloads) || integrity.payloads.length !== 54) {
      fail('The IDE integrity manifest must bind the frozen distribution archive and source identity');
    }
    const payloadNames = new Set();
    for (const payload of Array.isArray(integrity.payloads) ? integrity.payloads : []) {
      const name = payload?.path;
      if (typeof name !== 'string' || !name || name !== path.posix.normalize(name)
          || path.posix.isAbsolute(name) || name.includes('\\') || name.includes('\0') || name.split('/').includes('..')
          || payloadNames.has(name) || !Number.isSafeInteger(payload.bytes) || payload.bytes < 0 || payload.bytes > 2 * 1024 * 1024
          || !/^[a-f0-9]{64}$/.test(payload.sha256 ?? '') || !/^0[0-7]{3}$/.test(payload.mode ?? '')) {
        fail('The IDE integrity manifest must contain unique bounded package-local payloads, digests and modes');
        continue;
      }
      payloadNames.add(name);
    }
    // The IDE ships its independently qualified alpha.1 archive. Unreleased CLI
    // additions must not alter that frozen inventory; its package build also
    // compares every record with the downloaded archive's bytes and modes.
    const frozenInventory = (Array.isArray(integrity.payloads) ? integrity.payloads : [])
      .map(payload => [payload.path, payload.bytes, payload.sha256, payload.mode])
      .sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0);
    if (createHash('sha256').update(JSON.stringify(frozenInventory)).digest('hex')
        !== '8b36f31038caa60eded0ce65caae3c76911b265a7aff0e7e34bdbb904538ed66') {
      fail('The IDE integrity inventory must retain its independently verified frozen payload identities');
    }
    // These are delivery declarations, not a substitute for native host trust,
    // activation, process cleanup or model-work observations.
    if (plugin.capabilities?.untrustedWorkspaces?.supported !== false
        || plugin.capabilities?.virtualWorkspaces?.supported !== false) {
      fail('The IDE preview must declare trusted local workspaces only');
    }
    const commands = plugin.contributes?.commands;
    const requiredTerms = ['isWorkspaceTrusted', '!virtualWorkspace', '!remoteName'];
    if (!Array.isArray(commands) || !commands.length || commands.some(command => {
      const terms = typeof command.enablement === 'string' ? command.enablement.split(/\s*&&\s*/) : [];
      return terms.length !== requiredTerms.length || requiredTerms.some(term => !terms.includes(term));
    })) fail('Every IDE command must require a trusted, local, non-virtual host');
    const settings = entries(plugin.contributes?.configuration?.properties);
    if (settings.length !== 2 || settings.some(([name, setting]) => !['koto.nodePath', 'koto.stateDirectory'].includes(name)
        || setting?.type !== 'string' || setting.default !== '' || setting.scope !== 'application')) {
      fail('IDE runtime and state-directory settings must remain User-level application settings');
    }
    if (Object.hasOwn(plugin, 'files') || !existsSync(localPath(`${prefix}.vscodeignore`))) {
      fail('The IDE delivery must use one explicit VSIX allowlist without a conflicting files field');
    } else {
      const allowed = ['!package.json', '!extension.cjs', '!client.cjs', '!runner.mjs', '!core-integrity.json',
        '!dist/core/**', '!media/**', '!README.md', '!CHANGELOG.md', '!LICENSE', '!package.nls.json'];
      const patterns = readFileSync(localPath(`${prefix}.vscodeignore`), 'utf8').split(/\r?\n/)
        .map(line => line.trim()).filter(line => line && !line.startsWith('#'));
      if (patterns[0] !== '**' || patterns.length !== allowed.length + 1
          || allowed.some(pattern => !patterns.slice(1).includes(pattern))) {
        fail('The VSIX allowlist must include only host sources, assets, package metadata and the frozen core');
      }
    }
    for (const name of ['extension.cjs', 'client.cjs', 'runner.mjs', 'build.mjs', 'README.md', 'CHANGELOG.md', 'LICENSE']) {
      packageTarget(`${prefix}${name}`, `IDE delivery ${name}`);
    }
  } catch (error) {
    fail(`IDE delivery metadata: ${error.message}`);
  }
}

function checkPackage() {
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  } catch {
    fail('A valid package.json is required');
    return;
  }
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) {
    fail('package.json must contain an object');
    return;
  }
  if (pkg.name !== '@mehrdadz/koto') fail('The npm package name must be @mehrdadz/koto');
  if (pkg.type !== 'module') fail('The shared core and CLI must use Node ESM');
  if (pkg.private === true) fail('The npm package must be publishable');
  if (typeof pkg.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pkg.version)) {
    fail('The npm package must declare a semantic version');
  }
  if (!/^>=\s*22(?:\.0(?:\.0)?)?$/.test(pkg.engines?.node ?? '')) {
    fail('The npm package must support Node >=22 without an upper-version or platform restriction');
  }
  if (Number(process.versions.node.split('.')[0]) < 22) fail('Run source checks with Node 22 or newer');
  for (const field of ['os', 'cpu', 'libc']) {
    if (Object.hasOwn(pkg, field)) fail(`The npm package must not restrict ${field}`);
  }
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    if (Object.hasOwn(pkg, field) && (!pkg[field] || typeof pkg[field] !== 'object'
        || Array.isArray(pkg[field]) || Object.keys(pkg[field]).length)) {
      fail(`The core and CLI must have no runtime ${field}`);
    }
  }
  for (const field of ['bundledDependencies', 'bundleDependencies']) {
    if (Object.hasOwn(pkg, field) && pkg[field] !== false
        && (!Array.isArray(pkg[field]) || pkg[field].length)) {
      fail('The core and CLI must not bundle runtime dependencies');
    }
  }
  for (const hook of ['preinstall', 'install', 'postinstall', 'prepare', 'preprepare', 'postprepare', 'prepublish']) {
    if (Object.hasOwn(pkg.scripts ?? {}, hook)) fail(`Installation must not run a ${hook} hook`);
  }
  if (pkg.gypfile) fail('The npm package must not require a native build');
  if (!pkg.bin || Object.keys(pkg.bin).length !== 1 || pkg.bin.koto !== 'bin/koto.js') {
    fail('The package must expose koto through bin/koto.js');
  }
  packageTarget(pkg.bin?.koto, 'The koto executable');
  if (pkg.types !== './src/core.d.ts') fail('The types field must be ./src/core.d.ts');
  packageTarget(pkg.types, 'The public declaration');
  const publicExport = pkg.exports?.['.'];
  const conditions = publicExport && typeof publicExport === 'object' && !Array.isArray(publicExport)
    ? Object.keys(publicExport) : [];
  if (!pkg.exports || Object.keys(pkg.exports).length !== 1
      || conditions.join(',') !== 'types,import'
      || publicExport.types !== './src/core.d.ts' || publicExport.import !== './src/index.js') {
    fail('The package root export must declare types: ./src/core.d.ts before import: ./src/index.js (ESM only)');
  }
  packageTarget(publicExport?.types, 'The public declaration export');
  packageTarget(publicExport?.import, 'The shared-core export');
  const expected = ['bin/', 'src/', 'README.md', 'LICENSE'];
  if (!Array.isArray(pkg.files) || pkg.files.length !== expected.length
      || expected.some((name) => !pkg.files.includes(name))) {
    fail(`Published files must be limited to ${expected.join(', ')}`);
  }
  for (const [index, target] of (Array.isArray(pkg.files) ? pkg.files : []).entries()) {
    packageTarget(target, `Published files entry ${index + 1}`);
  }
  if (existsSync(path.join(root, 'package-lock.json'))) {
    try {
      const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
      if (lock.name !== pkg.name || lock.version !== pkg.version
          || lock.packages?.['']?.name !== pkg.name || lock.packages?.['']?.version !== pkg.version) {
        fail('package-lock.json must match the package name and version');
      }
    } catch {
      fail('package-lock.json must be valid JSON');
    }
  }
}

function checkImports(name) {
  if (!/^(?:src|bin)\/.*\.js$/.test(name)) return;
  const source = readFileSync(localPath(name), 'utf8');
  const imports = /\b(?:from\s*|import\s*(?:\(\s*)?|require\s*\(\s*)['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(imports)) {
    const target = match[1];
    if (builtins.has(target)) continue;
    if (!target.startsWith('./') && !target.startsWith('../')) {
      fail(`Runtime import must use Node built-ins or package-local files: ${name} -> ${target}`);
      continue;
    }
    const destination = path.resolve(path.dirname(localPath(name)), target);
    if (!insideRoot(destination) || !existsSync(destination)) {
      fail(`Runtime import is outside the package or missing: ${name} -> ${target}`);
    }
  }
}

function checkWorkflowActions(name) {
  if (!/^\.github\/workflows\/[^/]+\.ya?ml$/i.test(name)) return;
  const lines = readFileSync(localPath(name), 'utf8').split('\n');
  let blockColumn = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (blockColumn >= 0) {
      if (!line.trim() || line.match(/^\s*/)[0].length > blockColumn) continue;
      blockColumn = -1;
    }
    const property = line.match(/^(\s*)(-\s+)?("[^"]+"|'[^']+'|[A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!property) continue;
    const key = property[3].replace(/^["']|["']$/g, '');
    let reference = property[4].trim();
    if (/^[|>][1-9+-]*(?:\s+#.*)?$/.test(reference)) {
      blockColumn = property[1].length + (property[2]?.length ?? 0);
      if (key !== 'uses') continue; // Script contents are not action references.
      const parts = [];
      for (let next = index + 1; next < lines.length; next += 1) {
        const content = lines[next];
        if (!content.trim()) continue;
        if (content.match(/^\s*/)[0].length <= blockColumn) break;
        parts.push(content.trim());
      }
      reference = parts.join(reference.startsWith('>') ? ' ' : '\n').trim();
    }
    if (key !== 'uses') continue;
    const quoted = reference.match(/^("|')(.*?)\1(?:\s+#.*)?$/);
    reference = quoted ? quoted[2] : reference.replace(/\s+#.*$/, '').trim();
    // Container image references have their own digest syntax; this rule checks
    // GitHub actions and reusable workflows, which use Git commit references.
    if (reference.startsWith('./') || reference.startsWith('docker://')) continue;
    if (!/^[^@\s]+@[a-fA-F0-9]{40}$/.test(reference)) {
      fail(`Remote GitHub actions and reusable workflows require a full 40-character commit SHA in ${name}:${index + 1}`);
    }
  }
}

function withoutCode(source) {
  let fence;
  const lines = source.split('\n').map((line) => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = undefined;
      return '';
    }
    return fence ? '' : line;
  });
  return lines.join('\n').replace(/(`+)[^`]*\1/g, '');
}

function checkMarkdown(name) {
  if (!name.endsWith('.md') || (name.includes('/') && !name.startsWith('docs/') && !name.startsWith('skills/'))) return;
  const source = withoutCode(readFileSync(localPath(name), 'utf8'));
  const destinations = [...source.matchAll(/^ {0,3}\[[^\]\n]+\]:\s*(<[^>\n]+>|\S+)/gm)]
    .map((match) => match[1]);
  for (const match of source.matchAll(/\]\(\s*/g)) {
    const start = match.index + match[0].length;
    let cursor = start;
    let depth = 0;
    if (source[cursor] === '<') {
      cursor = source.indexOf('>', cursor + 1);
      if (cursor === -1) continue;
      cursor += 1;
    } else {
      while (cursor < source.length) {
        const character = source[cursor];
        if (character === '\\') {
          cursor += 2;
          continue;
        }
        if (/\s/.test(character) || (character === ')' && depth === 0)) break;
        if (character === '(') depth += 1;
        if (character === ')') depth -= 1;
        cursor += 1;
      }
    }
    if (/^\s*(?:["'][^\n]*?["']\s*)?\)/.test(source.slice(cursor))) {
      destinations.push(source.slice(start, cursor));
    }
  }
  for (const destinationText of destinations) {
    let target = destinationText.replace(/^<|>$/g, '').replace(/\\([\\() ])/g, '$1');
    if (/^[A-Za-z][A-Za-z\d+.-]*:/.test(target) || target.startsWith('#') || target.startsWith('//')) continue;
    target = target.split(/[?#]/, 1)[0];
    try {
      target = decodeURIComponent(target);
    } catch {
      fail(`Malformed local Markdown link in ${name}: ${destinationText}`);
      continue;
    }
    if (!target) continue;
    const destination = path.resolve(path.dirname(localPath(name)), target);
    if (!insideRoot(destination) || !existsSync(destination)) {
      fail(`Broken or non-portable local Markdown link in ${name}: ${destinationText}`);
    }
  }
}

walk();
checkTrackedPaths();
checkPackage();
checkDistribution();
checkIdeDelivery();
for (const name of [...files].sort()) {
  checkImports(name);
  checkWorkflowActions(name);
  checkMarkdown(name);
}

if (errors.size) {
  const messages = [...errors].sort();
  for (const message of messages.slice(0, 30)) console.error(`Scope check: ${message}`);
  if (messages.length > 30) console.error(`Scope check: ${messages.length - 30} additional violations`);
  process.exitCode = 1;
} else {
  console.log('Shared-core source, npm portability, runtime imports and documentation links verified');
}
