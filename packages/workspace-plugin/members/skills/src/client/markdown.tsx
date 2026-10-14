import * as React from 'react';

/**
 * Deliberately small Markdown projection for SKILL.md.
 *
 * It renders the block shapes a skill document actually uses — ATX headings, ordered
 * and unordered lists, pipe tables, block quotes and paragraphs — plus inline code and
 * emphasis, and passes everything else through as text. It is not a Markdown engine and
 * makes no attempt to be one: no nested lists, no fenced code blocks, no links, no
 * reference definitions.
 *
 * Blocks become React nodes directly, so document text is escaped by React and no HTML
 * from the skill file can ever reach the DOM.
 */

type Block =
  | { readonly kind: 'frontmatter'; readonly lines: readonly string[] }
  | { readonly kind: 'heading'; readonly level: number; readonly text: string }
  | { readonly kind: 'list'; readonly ordered: boolean; readonly items: readonly string[] }
  | { readonly kind: 'quote'; readonly text: string }
  | { readonly kind: 'table'; readonly header: readonly string[]; readonly rows: readonly (readonly string[])[] }
  | { readonly kind: 'paragraph'; readonly text: string };

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const SEPARATOR_CELL = /^:?-{2,}:?$/;
const CONTINUATION = /^\s{2,}\S/;
const INLINE = /(`[^`\n]+`|\*\*[^*\n]+\*\*)/;
const HEADING_TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;

/** Split one table row; the outer pipes are decoration, inner ones separate cells. */
function tableCells(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
}

function isTableSeparator(line: string): boolean {
  if (!line.includes('-')) return false;
  const cells = tableCells(line);
  return cells.length > 0 && cells.every(cell => SEPARATOR_CELL.test(cell));
}

/** Parse the document into the block list this renderer understands. */
export function parseSkillDocument(document: string): readonly Block[] {
  const lines = document.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let index = 0;
  // A leading `---` fence is YAML frontmatter, not Markdown: keep it verbatim so its
  // `key: value` rows never read as prose or as a list of `- value` bullets.
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((line, position) => position > 0 && line.trim() === '---');
    if (end > 0) { blocks.push({ kind: 'frontmatter', lines: lines.slice(1, end) }); index = end + 1; }
  }
  const isTableStart = (position: number) => (lines[position] ?? '').includes('|') && isTableSeparator(lines[position + 1] ?? '');
  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (!line.trim()) { index += 1; continue; }
    const heading = HEADING.exec(line);
    if (heading) { blocks.push({ kind: 'heading', level: heading[1]!.length, text: heading[2]!.trim() }); index += 1; continue; }
    const bullet = BULLET.exec(line);
    if (bullet) {
      const items: string[] = [];
      while (index < lines.length) {
        const match = BULLET.exec(lines[index] ?? '');
        if (match) { items.push(match[1]!.trim()); index += 1; continue; }
        // A wrapped bullet continues on an indented line that carries no marker of its own.
        const continuation = lines[index] ?? '';
        if (!items.length || !CONTINUATION.test(continuation) || HEADING.test(continuation) || ORDERED.test(continuation)) break;
        items[items.length - 1] = `${items[items.length - 1]} ${continuation.trim()}`; index += 1;
      }
      blocks.push({ kind: 'list', ordered: false, items }); continue;
    }
    const order = ORDERED.exec(line);
    if (order) {
      const items: string[] = [];
      while (index < lines.length) {
        const match = ORDERED.exec(lines[index] ?? '');
        if (match) { items.push(match[1]!.trim()); index += 1; continue; }
        const continuation = lines[index] ?? '';
        if (!items.length || !CONTINUATION.test(continuation) || HEADING.test(continuation) || BULLET.test(continuation)) break;
        items[items.length - 1] = `${items[items.length - 1]} ${continuation.trim()}`; index += 1;
      }
      blocks.push({ kind: 'list', ordered: true, items }); continue;
    }
    const quote = QUOTE.exec(line);
    if (quote) {
      const parts: string[] = [];
      while (index < lines.length) { const match = QUOTE.exec(lines[index] ?? ''); if (!match) break; parts.push(match[1]!.trim()); index += 1; }
      blocks.push({ kind: 'quote', text: parts.join(' ') }); continue;
    }
    if (isTableStart(index)) {
      const header = tableCells(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length) { const row = lines[index] ?? ''; if (!row.trim() || !row.includes('|')) break; rows.push(tableCells(row)); index += 1; }
      blocks.push({ kind: 'table', header, rows }); continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length && (lines[index] ?? '').trim() && !HEADING.test(lines[index] ?? '') && !BULLET.test(lines[index] ?? '') && !ORDERED.test(lines[index] ?? '') && !QUOTE.test(lines[index] ?? '') && !isTableStart(index)) {
      paragraph.push((lines[index] ?? '').trim()); index += 1;
    }
    blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
  }
  return blocks;
}

/** Inline `code` and **emphasis**; anything else stays literal text. */
function inlineNodes(text: string, key: string): React.ReactNode {
  const parts = text.split(INLINE);
  if (parts.length === 1) return text;
  return parts.map((part, position) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) return <code key={`${key}-${position}`}>{part.slice(1, -1)}</code>;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={`${key}-${position}`}>{part.slice(2, -2)}</strong>;
    return part;
  });
}

function renderBlock(block: Block, key: number): React.ReactElement {
  const inline = (text: string) => inlineNodes(text, `b${key}`);
  if (block.kind === 'frontmatter') return <pre className="markdown-frontmatter" key={key}>{block.lines.join('\n')}</pre>;
  if (block.kind === 'heading') return React.createElement(HEADING_TAGS[Math.min(Math.max(block.level, 1), HEADING_TAGS.length) - 1]!, { key }, inline(block.text));
  if (block.kind === 'quote') return <blockquote key={key}>{inline(block.text)}</blockquote>;
  if (block.kind === 'list') {
    const items = block.items.map((item, position) => <li key={position}>{inlineNodes(item, `b${key}-${position}`)}</li>);
    return block.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>;
  }
  if (block.kind === 'table') {
    return <table key={key}>
      <thead><tr>{block.header.map((cell, position) => <th key={position}>{inlineNodes(cell, `b${key}-h${position}`)}</th>)}</tr></thead>
      <tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{block.header.map((_cell, column) => <td key={column}>{inlineNodes(row[column] ?? '', `b${key}-r${rowIndex}c${column}`)}</td>)}</tr>)}</tbody>
    </table>;
  }
  return <p key={key}>{inline(block.text)}</p>;
}

/** Render a SKILL.md body as formatted blocks. */
export function MarkdownDocument({ text }: { readonly text: string }) {
  const blocks = React.useMemo(() => parseSkillDocument(text), [text]);
  return <>{blocks.map(renderBlock)}</>;
}
