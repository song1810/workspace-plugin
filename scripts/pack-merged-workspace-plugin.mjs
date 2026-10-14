/**
 * Produce the shareable self-contained zip from the merged package.
 *
 * Two things the merge build does not do are required here. The package's own
 * dependencies must be vendored into the directory, because the client installs a chosen
 * directory as a `link:` dependency and `link:` never installs the linked package's
 * dependencies. And the directory must be zipped with itself as the top-level entry, so
 * the recipient extracts it and points the client at that folder.
 *
 * Usage: node scripts/pack-merged-workspace-plugin.mjs [--out <zip>] [--skip-install]
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const root = 'E:/wd8'
const target = join(root, 'packages/workspace-plugin')
const argv = process.argv.slice(2)
const outIndex = argv.indexOf('--out')
const out = outIndex === -1
  ? 'E:/Cursor/deepseek-harness-dsh/workspace-plugin-single/workspace-plugin-0.1.0-selfcontained.zip'
  : argv[outIndex + 1]
if (out === undefined) throw new Error('--out needs a path')

/**
 * Run one step, inheriting stdio so the caller sees the tool output it already expects.
 * No shell: on Windows the executable paths themselves contain spaces, and `cmd /c`
 * would split `D:\Program Files\nodejs\node.exe` at the space.
 */
function run(command, args, cwd, useShell = false) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', ...(useShell ? { shell: true } : {}) })
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${result.status}`)
}

const powershell = process.platform === 'win32' ? 'powershell.exe' : 'pwsh'

/** The merge build; members' own dist must already be current. */
run(process.execPath, [join(root, 'scripts/build-merged-workspace-plugin.mjs')], root)

// Dependencies only: the official harness packages are peers the host supplies, and npm
// would otherwise pull them into the folder as real copies.
if (!(argv.includes('--skip-install') && existsSync(join(target, 'node_modules')))) {
  // A leftover lockfile from an earlier pack pins the previously vendored versions, so the
  // copies inside the zip would silently disagree with the manifest. Drop it and let npm
  // resolve from package.json every time.
  rmSync(join(target, 'package-lock.json'), { force: true })
  // `npm` is a .cmd shim on Windows, which Node can only start through a shell.
  run('npm', ['install', '--omit=dev', '--legacy-peer-deps', '--no-audit', '--no-fund'], target, true)
}

// Stage only what an install needs. Since the members' sources live inside the same
// package directory, zipping it whole would ship their sources and their own
// node_modules to whoever receives the package.
const staged = join(tmpdir(), 'workspace-plugin-pack')
const stagedPackage = join(staged, 'workspace-plugin')
rmSync(staged, { recursive: true, force: true })
mkdirSync(stagedPackage, { recursive: true })
for (const entry of ['dist', 'package.json', 'cordis.patch.yml', 'node_modules']) {
  const from = join(target, entry)
  if (!existsSync(from)) throw new Error(`packaging needs ${from}`)
  cpSync(from, join(stagedPackage, entry), { recursive: true })
}

mkdirSync(dirname(out), { recursive: true })
rmSync(out, { force: true })
run(powershell, [
  '-NoProfile', '-Command',
  `Compress-Archive -Path '${stagedPackage}' -DestinationPath '${out}' -CompressionLevel Optimal -Force`,
], root)
rmSync(staged, { recursive: true, force: true })
console.log(`self-contained zip: ${out}`)
