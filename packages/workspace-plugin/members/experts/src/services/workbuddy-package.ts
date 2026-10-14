/**
 * Read a WorkBuddy expert/team package.
 *
 * A WorkBuddy package is a directory (or zip) whose `.codebuddy-plugin/plugin.json`
 * declares identity, display metadata, agents, skills and optional connector
 * dependencies; each agent is a free-form Markdown document with YAML frontmatter.
 * This reader only extracts and normalizes those fields — storing the professional
 * Markdown as provided is the caller's job, so an imported package keeps its
 * original wording instead of being re-authored into our own sections.
 */
import { strFromU8, unzipSync } from 'fflate'
import type { ExpertDefinition } from 'workspace-contracts';
import { EXPERT_LIMITS } from '../domain/values.js';

/** Localized (zh/en) display text. */
export interface WorkbuddyLocalized {
  readonly zh?: string
  readonly en?: string
}

/** One role document inside a package. */
export interface WorkbuddyAgent {
  /** Package-relative path, e.g. `agents/long-manuscript-expert.md`. */
  readonly file: string
  readonly name: string
  readonly description?: string
  readonly displayName?: WorkbuddyLocalized
  readonly profession?: WorkbuddyLocalized
  readonly maxTurns?: number
  readonly skills: readonly string[]
  /** Free-form Markdown body, preserved verbatim. */
  readonly content: string
}

/** One bundled skill directory referenced by the package manifest. */
export interface WorkbuddySkill {
  readonly path: string
  /** Skill name from `SKILL.md` frontmatter, falling back to the directory name. */
  readonly name: string
  /** `SKILL.md` text, installed as the skill document. */
  readonly document: string
  /** Package-relative paths of the skill's own resources (everything but SKILL.md). */
  readonly resources: readonly string[]
  /** Skill-relative file bytes, ready to stage for installation (`SKILL.md` plus resources). */
  readonly contents: Readonly<Record<string, Uint8Array>>
  readonly files: readonly string[]
  readonly hasSkillMd: boolean
}

/** Normalized WorkBuddy package. */
export interface WorkbuddyPackage {
  readonly kind: 'agent' | 'team'
  readonly root: string
  readonly name: string
  readonly version?: string
  readonly description?: string
  readonly displayName?: WorkbuddyLocalized
  readonly profession?: WorkbuddyLocalized
  readonly categoryId?: string
  readonly avatar?: string
  readonly tags: readonly WorkbuddyLocalized[]
  readonly prompts: readonly WorkbuddyLocalized[]
  /** Declared connector identifiers; importing never installs them. */
  readonly connectors: readonly string[]
  readonly agents: readonly WorkbuddyAgent[]
  readonly lead?: string
  readonly members: readonly string[]
  readonly skills: readonly WorkbuddySkill[]
  /** Package-relative paths that are neither manifest, agent, nor skill files. */
  readonly resources: readonly string[]
}

const PLUGIN_SUFFIX = '.codebuddy-plugin/plugin.json'

/** Strip ASCII and CJK quotation marks the generator emits around scalars. */
function unquote(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length >= 2) {
    const first = trimmed[0]
    const last = trimmed[trimmed.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'") || (first === '“' && last === '”')) {
      return trimmed.slice(1, -1).trim()
    }
  }
  return trimmed
}

const isListLine = (line: string): boolean => /^\s+-\s+/.test(line)
const indentOf = (line: string): number => line.length - line.trimStart().length

/** Parse the subset of YAML the WorkBuddy specs use: scalars, nested maps, and lists. */
function parseFrontmatterBlock(lines: readonly string[], depth: number): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  let index = 0
  while (index < lines.length) {
    const line = lines[index]!
    const match = /^(\s*)([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line)
    if (match === null) { index += 1; continue }
    const indent = indentOf(line)
    if (indent < depth) break
    const key = match[2]!
    const inline = match[3]!.trim()
    if (inline !== '') {
      result[key] = unquote(inline)
      index += 1
      continue
    }
    let end = index + 1
    while (end < lines.length && (lines[end]!.trim() === '' || indentOf(lines[end]!) > indent)) end += 1
    const block = lines.slice(index + 1, end).filter(candidate => candidate.trim() !== '')
    if (block.length === 0) { result[key] = ''; index = end; continue }
    if (block.every(isListLine)) {
      result[key] = block.map(entry => unquote(entry.trim().replace(/^-\s+/, '')))
    } else {
      result[key] = parseFrontmatterBlock(block, indentOf(block[0]!))
    }
    index = end
  }
  return result
}

/** Split a Markdown document into parsed frontmatter fields and its body. */
export function parseAgentDocument(text: string): { fields: Record<string, unknown>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  if (match === null) return { fields: {}, body: text }
  return { fields: parseFrontmatterBlock(match[1]!.split(/\r?\n/), 0), body: text.slice(match[0].length) }
}

function localized(value: unknown): WorkbuddyLocalized | undefined {
  if (typeof value === 'string') {
    const text = unquote(value)
    return text === '' ? undefined : { en: text }
  }
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const zh = typeof record.zh === 'string' ? unquote(record.zh) : undefined
  const en = typeof record.en === 'string' ? unquote(record.en) : undefined
  return zh === undefined && en === undefined ? undefined : { ...(zh === undefined ? {} : { zh }), ...(en === undefined ? {} : { en }) }
}

function localizedList(value: unknown): WorkbuddyLocalized[] {
  if (!Array.isArray(value)) return []
  const rows: WorkbuddyLocalized[] = []
  for (const entry of value) { const row = localized(entry); if (row !== undefined) rows.push(row) }
  return rows
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string').map(unquote) : []
}

/**
 * Read one WorkBuddy package archive.
 * @param zipBytes - Archive bytes.
 * @returns Normalized package, or undefined when the archive is not a WorkBuddy package.
 */
export function readWorkbuddyPackage(zipBytes: Uint8Array): WorkbuddyPackage | undefined {
  const entries = unzipSync(zipBytes)
  const paths = Object.keys(entries).filter(path => path.endsWith('/') === false)
  const pluginPath = paths.find(path => path.endsWith(PLUGIN_SUFFIX)) ?? paths.find(path => path === 'plugin.json')
  if (pluginPath === undefined) return undefined
  const root = pluginPath === 'plugin.json' ? '' : pluginPath.slice(0, -PLUGIN_SUFFIX.length)
  const manifest = JSON.parse(strFromU8(entries[pluginPath]!)) as Record<string, unknown>
  const relative = (path: string): string => path.replace(/^\.\//, '')
  const agents: WorkbuddyAgent[] = []
  const declaredAgents = stringList(manifest.agents)
  const agentFiles = declaredAgents.length > 0
    ? declaredAgents.map(relative).map(path => `${root}${path}`)
    // Some packages list agents only through members/teamInfo; fall back to every
    // role document the archive actually carries.
    : paths.filter(path => path.startsWith(`${root}agents/`) && path.endsWith('.md')).sort()
  for (const file of agentFiles) {
    const bytes = entries[file]
    if (bytes === undefined) continue
    const { fields, body } = parseAgentDocument(strFromU8(bytes))
    agents.push({
      file: file.slice(root.length),
      name: typeof fields.name === 'string' ? unquote(fields.name) : file.split('/').pop()!.replace(/\.md$/, ''),
      ...(typeof fields.description === 'string' ? { description: unquote(fields.description) } : {}),
      ...(localized(fields.displayName) === undefined ? {} : { displayName: localized(fields.displayName)! }),
      ...(localized(fields.profession) === undefined ? {} : { profession: localized(fields.profession)! }),
      ...(Number.isFinite(Number(fields.maxTurns)) && fields.maxTurns !== undefined ? { maxTurns: Number(fields.maxTurns) } : {}),
      skills: stringList(fields.skills),
      content: body,
    })
  }
  const skills: WorkbuddySkill[] = []
  for (const declared of stringList(manifest.skills)) {
    const prefix = `${root}${relative(declared)}/`
    const files = paths.filter(path => path.startsWith(prefix)).map(path => path.slice(prefix.length))
    const skillMd = files.find(file => file === 'SKILL.md')
    const document = skillMd === undefined ? '' : strFromU8(entries[`${prefix}SKILL.md`]!)
    const declaredName = parseAgentDocument(document).fields.name
    skills.push({
      path: relative(declared),
      name: typeof declaredName === 'string' && declaredName !== '' ? unquote(declaredName) : relative(declared).split('/').pop()!,
      document,
      resources: files.filter(file => file !== 'SKILL.md'),
      contents: Object.fromEntries(files.map(file => [file, entries[`${prefix}${file}`]!])),
      files,
      hasSkillMd: skillMd !== undefined,
    })
  }
  const claimed = new Set<string>([pluginPath, ...agents.map(agent => `${root}${agent.file}`)])
  for (const skill of skills) for (const file of skill.files) claimed.add(`${root}${skill.path}/${file}`)
  const resources = paths.filter(path => path.startsWith(root) && !claimed.has(path)).map(path => path.slice(root.length))
  const teamInfo = (manifest.teamInfo ?? {}) as Record<string, unknown>
  const kind = manifest.expertType === 'team' ? 'team' : 'agent'
  const lead = typeof teamInfo.leadAgent === 'string' ? teamInfo.leadAgent : (typeof manifest.agentName === 'string' ? manifest.agentName : undefined)
  const members = stringList(teamInfo.memberAgents)
  return {
    kind,
    root,
    name: typeof manifest.name === 'string' ? unquote(manifest.name) : lead ?? 'workbuddy-expert',
    ...(typeof manifest.version === 'string' ? { version: unquote(manifest.version) } : {}),
    ...(typeof manifest.description === 'string' ? { description: unquote(manifest.description) } : {}),
    ...(localized(manifest.displayName) === undefined ? {} : { displayName: localized(manifest.displayName)! }),
    ...(localized(manifest.profession) === undefined ? {} : { profession: localized(manifest.profession)! }),
    ...(typeof manifest.categoryId === 'string' ? { categoryId: unquote(manifest.categoryId) } : {}),
    ...(typeof manifest.avatar === 'string' ? { avatar: relative(manifest.avatar) } : {}),
    tags: localizedList(manifest.tags),
    prompts: [...localizedList(manifest.quickPrompts), ...localizedList(manifest.defaultInitPrompt === undefined ? [] : [manifest.defaultInitPrompt])],
    connectors: stringList((manifest.dependencies as Record<string, unknown> | undefined)?.connectors),
    agents,
    ...(lead === undefined ? {} : { lead }),
    members: members.length === 0 ? agents.filter(agent => agent.name !== lead).map(agent => agent.name) : members,
    skills,
    resources,
  }
}

const clamp = (text: string, max: number): string => (text.length <= max ? text : text.slice(0, max))

/** Prefer the Chinese wording our product renders, falling back to English. */
const preferred = (value: WorkbuddyLocalized | undefined, fallback: string): string =>
  value === undefined ? fallback : (value.zh ?? value.en ?? fallback)

/** Member keys must be lowercase kebab-case and may not reuse the lead's reserved key. */
function memberKey(name: string, taken: Set<string>): string {
  const base = name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '').replace(/^[^a-z]+/, '') || 'member'
  let key = base.slice(0, 40)
  if (key === 'lead') key = 'lead-member'
  let index = 2
  while (taken.has(key)) key = `${base.slice(0, 37)}-${index++}`
  taken.add(key)
  return key
}

/**
 * Bridge one WorkBuddy role document into our definition.
 *
 * The professional Markdown is preserved verbatim in `role`, which the persona prefix
 * renders as the expert's own instructions. WorkBuddy has no separate methodology /
 * boundary / deliverable sections, so those three fields carry short pointers instead
 * of restating or truncating the original text.
 */
function roleDefinition(pkg: WorkbuddyPackage, agent: WorkbuddyAgent, name: string, description: string): ExpertDefinition {
  // Original wording is preserved; only a literal `{{`/`}}` pair is broken up because
  // the persona template would otherwise read it as an interpolation.
  const body = agent.content.trim().replaceAll('{{', '{ {').replaceAll('}}', '} }')
  const examples = pkg.prompts
    .map(prompt => clamp(preferred(prompt, ''), 4000))
    .filter(prompt => prompt !== '')
    .slice(0, EXPERT_LIMITS.examplesMax)
    .map((prompt, index) => ({ id: `workbuddy-example-${index + 1}`, prompt }))
  const tags: string[] = []
  for (const tag of pkg.tags) {
    const text = clamp(preferred(tag, ''), 40)
    if (text !== '' && tags.includes(text) === false) tags.push(text)
    if (tags.length === EXPERT_LIMITS.tagsMax) break
  }
  return {
    name: clamp(name, EXPERT_LIMITS.nameMax),
    description: clamp(description, EXPERT_LIMITS.descriptionMax),
    role: clamp(body, EXPERT_LIMITS.proseMax),
    methodology: '按角色定位中的专业方法执行，保持原有步骤与判断标准。',
    boundaries: '不超出角色定位声明的职责范围；信息不足时先向用户澄清。',
    deliverables: '按角色定位中的交付要求输出成果，并说明实际完成范围。',
    tags,
    categoryId: pkg.categoryId ?? 'general',
    examples,
    skillRequirements: [],
    futureRequirements: [],
  }
}

/**
 * Convert a WorkBuddy package into our definition, preserving the original prose.
 * @param pkg - Normalized WorkBuddy package.
 * @returns Ready candidate definition for validation and preview.
 */
export function definitionFromWorkbuddy(pkg: WorkbuddyPackage): ExpertDefinition {
  const lead = pkg.agents.find(agent => agent.name === pkg.lead) ?? pkg.agents[0]
  const summary = [preferred(pkg.profession, ''), preferred(pkg.displayName, ''), pkg.description ?? '']
    .filter(part => part !== '')
    .join(' — ')
  const definition = roleDefinition(pkg, lead ?? {
    file: '', name: pkg.name, skills: [], content: '',
  }, pkg.name, summary === '' ? pkg.name : summary)
  if (pkg.kind !== 'team') return definition
  const taken = new Set<string>()
  const members = pkg.agents
    .filter(agent => agent !== lead)
    .slice(0, 16)
    .map(agent => ({
      key: memberKey(agent.name, taken),
      definition: roleDefinition(pkg, agent, agent.name,
        [preferred(agent.profession, ''), preferred(agent.displayName, '')].filter(part => part !== '').join(' · ') || agent.name),
    }))
  return {
    ...definition,
    team: {
      members,
      workflows: [{
        id: 'workbuddy-default',
        title: `${definition.name} 默认协作`,
        trigger: '用户提出的任务需要多位成员协作完成时',
        deliverable: '由主理人指派成员协作，并汇总一份完整成果',
        stages: [],
      }],
    },
  }
}
