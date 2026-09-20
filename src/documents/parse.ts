// Packet text format v1: the one document format the workspace reads.
//
//   ---                         front matter, `key: value` per line
//   document_id: MCB-OPS-204
//   ...
//   ---
//   <!-- page 2 -->             page marker: everything after it is on that page
//   # Article II. The Facility  article heading (grouping only)
//   ## 2.03 Same-Day Advances   section heading: "<id> <title>"
//   (a) The Borrower may ...    labelled paragraph, cited as 2.03(a)
//   Plain paragraph.            unlabelled paragraph, cited by section and position
//
// It is UTF-8 text and nothing else. There is no PDF, DOCX or image path and no
// OCR: a scanned agreement cannot be read by this parser, and the UI says so.
//
// Every paragraph keeps its exact text and its character offsets into the raw
// file, so a citation can always be checked against the source byte for byte.

import { sha256Hex } from '../domain/sha256'

export type DocumentKind = 'agreement' | 'policy'

export interface DocumentMeta {
  document_id: string
  title: string
  kind: DocumentKind
  version: string
  /** ISO date the document carries on its face. */
  dated: string
  notice: string
  owner?: string
  status?: string
}

export interface DocParagraph {
  /** Citation for this paragraph: "2.03(a)" when labelled, else "3 ¶2". */
  ref: string
  label: string | null
  /** Exact text, label removed. Always equal to raw.slice(start, end). */
  text: string
  start: number
  end: number
  page: number
}

export interface DocSection {
  id: string
  title: string
  article: string | null
  page: number
  paragraphs: DocParagraph[]
}

export interface ParsedDocument {
  meta: DocumentMeta
  raw: string
  /** SHA-256 of the raw file: the identity of exactly what was read. */
  sha256: string
  pages: number
  sections: DocSection[]
  paragraph_count: number
}

export class PacketFormatError extends Error {}

const REQUIRED_META = ['document_id', 'title', 'kind', 'version', 'dated', 'notice'] as const
const PAGE_RE = /^<!--\s*page\s+(\d+)\s*-->$/
const SECTION_RE = /^##\s+(\d+(?:\.\d+)?)\s+(.+)$/
const ARTICLE_RE = /^#\s+(.+)$/
const LABEL_RE = /^\(([a-z])\)\s+/

function parseMeta(block: string, name: string): DocumentMeta {
  const fields: Record<string, string> = {}
  for (const line of block.split('\n')) {
    if (!line.trim()) continue
    const colon = line.indexOf(':')
    if (colon < 1) throw new PacketFormatError(`${name}: front matter line is not "key: value": ${line}`)
    fields[line.slice(0, colon).trim()] = line.slice(colon + 1).trim()
  }
  for (const key of REQUIRED_META) {
    if (!fields[key]) throw new PacketFormatError(`${name}: front matter is missing "${key}"`)
  }
  if (fields.kind !== 'agreement' && fields.kind !== 'policy') {
    throw new PacketFormatError(`${name}: kind must be "agreement" or "policy"`)
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.dated!)) {
    throw new PacketFormatError(`${name}: dated must be an ISO date`)
  }
  return fields as unknown as DocumentMeta
}

/** Parse one packet document. Throws PacketFormatError rather than guessing. */
export function parseDocument(raw: string, name = 'document'): ParsedDocument {
  if (raw.startsWith('%PDF') || raw.startsWith('PK')) {
    throw new PacketFormatError(`${name}: binary formats (PDF, DOCX) are not supported. Only packet text format v1 is read.`)
  }
  if (!raw.startsWith('---\n')) throw new PacketFormatError(`${name}: missing front matter`)
  const close = raw.indexOf('\n---\n', 4)
  if (close < 0) throw new PacketFormatError(`${name}: front matter is not closed`)
  const meta = parseMeta(raw.slice(4, close), name)

  const sections: DocSection[] = []
  let article: string | null = null
  let section: DocSection | null = null
  let page = 1
  let pages = 1
  let paragraph_count = 0

  // Walk blocks separated by blank lines, tracking offsets into the raw file.
  let cursor = close + '\n---\n'.length
  while (cursor < raw.length) {
    while (cursor < raw.length && raw[cursor] === '\n') cursor++
    if (cursor >= raw.length) break
    let end = raw.indexOf('\n\n', cursor)
    if (end < 0) end = raw.length
    let blockEnd = end
    while (blockEnd > cursor && raw[blockEnd - 1] === '\n') blockEnd--
    const block = raw.slice(cursor, blockEnd)
    const blockStart = cursor
    cursor = end

    const pageMatch = PAGE_RE.exec(block)
    if (pageMatch) {
      page = Number(pageMatch[1])
      pages = Math.max(pages, page)
      continue
    }
    const sectionMatch = SECTION_RE.exec(block)
    if (sectionMatch) {
      section = { id: sectionMatch[1]!, title: sectionMatch[2]!.trim(), article, page, paragraphs: [] }
      sections.push(section)
      continue
    }
    const articleMatch = ARTICLE_RE.exec(block)
    if (articleMatch) {
      article = articleMatch[1]!.trim()
      section = null
      continue
    }
    if (block.startsWith('#')) throw new PacketFormatError(`${name}: unsupported heading: ${block.slice(0, 60)}`)
    if (!section) throw new PacketFormatError(`${name}: text appears before any "## <id> <title>" section: ${block.slice(0, 60)}`)

    const labelMatch = LABEL_RE.exec(block)
    const label = labelMatch ? labelMatch[1]! : null
    const start = blockStart + (labelMatch ? labelMatch[0].length : 0)
    const ref = label ? `${section.id}(${label})` : `${section.id} ¶${section.paragraphs.length + 1}`
    section.paragraphs.push({ ref, label, text: raw.slice(start, blockEnd), start, end: blockEnd, page })
    paragraph_count++
  }

  if (sections.length === 0) throw new PacketFormatError(`${name}: no sections found`)
  return { meta, raw, sha256: `sha256:${sha256Hex(raw)}`, pages, sections, paragraph_count }
}

/** The paragraph cited by a reference such as "2.03(a)". */
export function findParagraph(doc: ParsedDocument, ref: string): DocParagraph | null {
  for (const s of doc.sections) {
    const hit = s.paragraphs.find((p) => p.ref === ref)
    if (hit) return hit
  }
  return null
}

/** A policy section by its title, the way the capability registry cites one. */
export function findSectionByTitle(doc: ParsedDocument, title: string): DocSection | null {
  const want = title.trim().toLowerCase()
  return doc.sections.find((s) => s.title.toLowerCase() === want) ?? null
}
