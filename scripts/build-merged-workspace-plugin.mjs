/**
 * Aggregate the six workspace-* plugin packages into one `workspace-plugin`:
 * copy each package's dist, merge their cordis patch arrays into one patch whose
 * `name:` specifiers point at this package's subpath exports, and concatenate the
 * three client bundles into one browser artifact.
 * Usage: node scripts/build-merged-workspace-plugin.mjs
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { build } from 'esbuild'

const root = 'E:/wd8'
const target = join(root, 'packages/workspace-plugin')

/**
 * Version of the package this build produces. It is a single source on purpose: an earlier
 * revision hard-coded it inside the manifest literal, so every build shipped the same
 * number no matter how much the code changed, and two different builds could not be told
 * apart. Override for a one-off build with `--version <x>`.
 */
const versionFlag = process.argv.indexOf('--version')
const VERSION = versionFlag === -1 ? '0.2.1' : (process.argv[versionFlag + 1] ?? '0.2.1')

/**
 * Rewrite the asset URLs a member's code computes with `import.meta.url`.
 *
 * esbuild leaves `new URL('../...', import.meta.url)` untouched, so a module that
 * lived deeper than the member's dist entry keeps a `../` count that no longer
 * matches where it ends up. Every bundled file now sits at
 * `dist/<key>/dist/<name>.js` while resources are copied to `dist/<key>/resources`,
 * which is exactly one level up, so collapse any depth to a single `../`.
 *
 * Without this, `experts` resolves its bundled skill to `dist/resources/...`, which
 * is missing, and the top-level `load()` throws `expert-skill/missing` during import.
 */
function normalizeResourceUrls(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      normalizeResourceUrls(path)
      continue
    }
    if (!entry.name.endsWith('.js')) continue
    const text = readFileSync(path, 'utf8')
    const normalized = text.replace(/(?:\.\.\/)+resources\//g, '../resources/')
    if (normalized !== text) writeFileSync(path, normalized)
  }
}

/** package directory → dist subdirectory + patch `name:` replacements. */
const members = [
  { dir: 'packages/workspace-plugin/members/identity-local', key: 'identity-local', specifiers: ['workspace-provider-identity-local'] },
  { dir: 'packages/workspace-plugin/members/audit', key: 'audit', specifiers: ['workspace-plugin-audit'] },
  { dir: 'packages/workspace-plugin/members/access', key: 'access', specifiers: ['workspace-plugin-access'] },
  { dir: 'packages/workspace-plugin/members/skills', key: 'skills', specifiers: ['workspace-plugin-skills'] },
  { dir: 'packages/workspace-plugin/members/experts', key: 'experts', specifiers: ['workspace-plugin-experts'] },
  { dir: 'packages/workspace-plugin/members/connectors', key: 'connectors', specifiers: ['workspace-plugin-connectors'] },
]
const clients = ['skills', 'experts', 'connectors']

// Only the generated entries are cleared. The members' sources live inside this same
// package, so removing the directory itself would delete the build's own input.
for (const generated of ['dist', 'cordis.patch.yml', 'package.json']) {
  rmSync(join(target, generated), { recursive: true, force: true })
}
mkdirSync(join(target, 'dist'), { recursive: true })

const patchParts = []
const clientInject = new Set()
const dependencies = {}
const peerDependencies = { '@deepseek-ai/cordis': '4.0.4' }
for (const member of members) {
  const source = join(root, member.dir)
  // Bundle each host entry into one self-contained file: the aggregated package must
  // not depend on the original package's dist layout. Official packages and other
  // bare specifiers stay external; `packages: 'external'` keeps only local code in.
  const entries = [{ in: join(source, 'dist/index.js'), out: 'index' }]
  for (const sub of ['session', 'tool']) {
    if (existsSync(join(source, `dist/${sub}.js`))) entries.push({ in: join(source, `dist/${sub}.js`), out: sub })
  }
  await build({
    entryPoints: entries, outdir: join(target, 'dist', member.key, 'dist'),
    bundle: true, format: 'esm', platform: 'node', target: 'node22', packages: 'external', logLevel: 'silent',
  })
  normalizeResourceUrls(join(target, 'dist', member.key, 'dist'))
  // Entry URLs such as `new URL('../resources/...', import.meta.url)` must keep working,
  // so resources stay one level above the bundled dist directory.
  if (existsSync(join(source, 'resources'))) cpSync(join(source, 'resources'), join(target, 'dist', member.key, 'resources'), { recursive: true })
  let patch = readFileSync(join(source, 'cordis.patch.yml'), 'utf8').replace(/^---\r?\n/, '')
  for (const specifier of member.specifiers) patch = patch.replaceAll(specifier, `workspace-plugin/${member.key}`)
  patchParts.push(patch.trimEnd())
  const memberManifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
  // The merged package resolves every member's runtime imports, so it must declare
  // their dependencies and peers itself: subpath entries load from this package.
  Object.assign(dependencies, memberManifest.dependencies)
  // The members' own dependencies stay dependencies, and what they only *peer* on
  // stays a peer here too. Promoting peers to dependencies makes pnpm link a second,
  // version-pinned copy of the whole harness into the profile instead of using the
  // runtime the profile already ships (dsh-base/dsh-web-app, or the app itself), and
  // it bypasses dsh-app-boot, which only validates @deepseek-ai/dsh-* peer ranges —
  // so a runtime mismatch would load mixed versions silently instead of being reported.
  Object.assign(peerDependencies, memberManifest.peerDependencies)
  if (clients.includes(member.key)) {
    for (const injected of memberManifest.dsh?.client?.inject ?? []) clientInject.add(injected)
  }
}
delete peerDependencies['workspace-contracts']
delete peerDependencies['workspace-ui']
delete dependencies['workspace-contracts']
delete dependencies['workspace-ui']
delete dependencies['react']
delete dependencies['@types/react']
delete peerDependencies['react']
delete peerDependencies['@types/react']
// A member that only peered on something another member depends on (zod is both)
// must not end up listing it twice: the merged package imports it itself, so the
// dependency wins and the peer entry is dropped.
for (const name of Object.keys(dependencies)) delete peerDependencies[name]
// Every official harness package is a peer the host supplies, and dsh-app-boot only asks
// whether the running runtime satisfies the declared range. Binding that range to any
// particular release makes a harness upgrade refuse to load the plugin; the product
// decision here is the opposite: declare no constraint at all, let the plugin load on any
// runtime, and upgrade the plugin only when a harness change actually breaks it.
// (`^0.1.7-rc.2` would be even worse than useless here: on 0.x caret pins the minor, so it
// silently excludes every 0.2.x runtime.)
const SUPPORTED_OFFICIAL_RANGE = '*'
for (const name of Object.keys(peerDependencies)) {
  if (name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-')) {
    peerDependencies[name] = SUPPORTED_OFFICIAL_RANGE
  }
}
// The browser roster keys a client half on a Loader row whose specifier IS the package
// root (`exactPackageSpecifier` rejects subpaths), so the members' `workspace-plugin/<key>`
// rows never reach the browser. The merged package therefore needs one bare-name row of
// its own; `dist/index.js` is that row's host half.
patchParts.push([
  '- insert:',
  '    - id: workspace-plugin',
  '      name: workspace-plugin',
].join('\n'))

// The aggregated patch is the concatenation of every member's patch array, so the
// loader applies the members' overrides and inserts in the order listed above.
writeFileSync(join(target, 'cordis.patch.yml'), `${patchParts.join('\n')}\n`)

writeFileSync(join(target, 'dist/index.js'), [
  '/**',
  " * Host half of the bare-name row the browser roster needs.",
  ' *',
  " * The client module system maps a Loader row to a package only when the row's",
  ' * specifier is the exact package root, so the member rows never produce a browser',
  ' * entry. This row is what makes the package declaration reach the boot graph.',
  ' * @module workspace-plugin',
  ' */',
  '',
  '/** Bundle name, matching the package the roster keys on. */',
  "export const name = 'workspace-plugin'",
  '',
  '/** The host halves are their own rows; this one carries only the browser declaration. */',
  'export function apply() {}',
  '',
].join('\n'))

const clientHalves = clients.map((key) => {
  const dir = join(target, 'members', key)
  return {
    // The member's own package name: both the id its bundle registers and the id required here.
    id: JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name,
    code: readFileSync(join(dir, 'dist/client.browser.js'), 'utf8'),
  }
})
// The package owns exactly one browser row, so the members' registrations are reachable
// only as factories in the module table: this entry composes them, and it is what that row
// materializes. A factory `require` materializes an already-registered factory, which is
// exactly what each member registration below leaves behind.
const mergedClientEntry = [
  'window.__ModuleLoader__.load({id: "workspace-plugin", factory: function(require) {',
  `const halves = ${JSON.stringify(clientHalves.map(half => half.id))}.map(function (id) { return require(id) });`,
  'const inject = [];',
  'for (const half of halves) for (const service of half.inject || []) if (!inject.includes(service)) inject.push(service);',
  'function apply(ctx) { for (const half of halves) half.apply(ctx) }',
  'return { name: "workspace-plugin", inject: inject, apply: apply };',
  '}});',
  '',
].join('\n')
writeFileSync(join(target, 'dist/client.js'), [...clientHalves.map(half => half.code), mergedClientEntry].join('\n'))

const exportsMap = { '.': { default: './dist/index.js' }, './client': { default: './dist/client.js' } }
for (const member of members) exportsMap[`./${member.key}`] = { default: `./dist/${member.key}/dist/index.js` }
// The access package additionally exposes these two subpath entries.
exportsMap['./access/session'] = { default: './dist/access/dist/session.js' }
exportsMap['./access/tool'] = { default: './dist/access/dist/tool.js' }
writeFileSync(join(target, 'package.json'), `${JSON.stringify({
  name: 'workspace-plugin',
  version: VERSION,
  private: false,
  type: 'module',
  description: 'Workspace workbench: experts, expert teams, skills and connectors in one plugin',
  exports: exportsMap,
  files: ['dist', 'cordis.patch.yml', 'README.md'],
  dsh: {
    bundle: { patch: './cordis.patch.yml' },
    client: { platform: 'web', immediately: true, inject: [...clientInject].sort() },
  },
  dependencies: Object.fromEntries(Object.entries(dependencies).sort()),
  peerDependencies: Object.fromEntries(Object.entries(peerDependencies).sort()),
}, undefined, 2)}\n`)

const patchText = readFileSync(join(target, 'cordis.patch.yml'), 'utf8')
console.log(`merged package: ${target} (v${VERSION})`)
console.log(`patch bytes: ${patchText.length}, insert entries: ${(patchText.match(/^ {4}- id: /gm) ?? []).length}`)
console.log(`client bundle bytes: ${readFileSync(join(target, 'dist/client.js')).length}, inject: ${clientInject.size}`)
console.log(`dist subtrees: ${members.map(member => member.key).join(', ')}`)
if (!existsSync(join(target, 'dist/client.js'))) throw new Error('client bundle missing')
