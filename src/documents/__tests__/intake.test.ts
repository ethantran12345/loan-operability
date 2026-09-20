import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { sha256Hex } from '../../domain/sha256'
import { checkIntake, sampleIntakeFiles, type IntakeFile } from '../intake'
import { readPacket, readPacketFrom, samplePacketFiles } from '../packet'

const dropped = (names: string[]): IntakeFile[] =>
  samplePacketFiles()
    .filter((f) => names.includes(f.file))
    .map((f) => ({ ...f, size: f.raw.length, source: 'dropped' }))

const V7 = [
  'credit-agreement.draft-7.md',
  'ops-101-notice-intake.v2.3.md',
  'ops-204-funding-windows.v5.1.md',
  'ops-310-booking-entities.v4.0.md',
  'pol-007-approvals.v3.md',
]

describe('document intake', () => {
  it('nothing handed over: not ready, and every needed file is named', () => {
    const intake = checkIntake([], 7)
    expect(intake.ready).toBe(false)
    expect(intake.missing.map((r) => r.file)).toEqual(V7)
  })

  it('the five v7 files: ready, each hashed from its own text', () => {
    const files = dropped(V7)
    const intake = checkIntake(files, 7)
    expect(intake.blockers).toEqual([])
    expect(intake.ready).toBe(true)
    for (const e of intake.entries) {
      expect(e.status).toBe('needed')
      expect(e.source).toBe('dropped')
      expect(e.sha256).toBe(sha256Hex(files.find((f) => f.file === e.file)!.raw))
    }
  })

  it('names the file that is still needed', () => {
    const intake = checkIntake(dropped(V7.slice(0, 4)), 7)
    expect(intake.ready).toBe(false)
    expect(intake.missing.map((r) => r.file)).toEqual(['pol-007-approvals.v3.md'])
    expect(intake.blockers.join(' ')).toContain('pol-007-approvals.v3.md')
  })

  it('registry v8 needs approvals v4, and says v3 is not used', () => {
    const intake = checkIntake(dropped(V7), 8)
    expect(intake.ready).toBe(false)
    expect(intake.missing.map((r) => r.file)).toEqual(['pol-007-approvals.v4.md'])
    const v3 = intake.entries.find((e) => e.file === 'pol-007-approvals.v3.md')!
    expect(v3.status).toBe('unused')
    expect(v3.note).toContain('not used by registry v8')
  })

  it('all six files are ready under either registry version', () => {
    const six = dropped(samplePacketFiles().map((f) => f.file))
    expect(checkIntake(six, 7).ready).toBe(true)
    expect(checkIntake(six, 8).ready).toBe(true)
  })

  it('rejects a file that is not packet format v1, by name, and blocks the run', () => {
    const notes: IntakeFile = { file: 'meeting-notes.md', raw: '# Notes\n\nNot a packet document.\n', size: 31, source: 'dropped' }
    const intake = checkIntake([...dropped(V7), notes], 7)
    const entry = intake.entries.find((e) => e.file === 'meeting-notes.md')!
    expect(entry.status).toBe('rejected')
    expect(entry.note).toContain('missing front matter')
    expect(entry.sha256).toBeNull()
    expect(intake.ready).toBe(false)
    expect(intake.blockers.join(' ')).toContain('meeting-notes.md')
  })

  it('rejects a PDF and anything that is not .md', () => {
    const pdf: IntakeFile = { file: 'credit-agreement.pdf', raw: '%PDF-1.7 ...', size: 12, source: 'dropped' }
    const txt: IntakeFile = { ...dropped(V7)[0]!, file: 'credit-agreement.draft-7.txt' }
    const intake = checkIntake([pdf, txt], 7)
    expect(intake.entries.map((e) => e.status)).toEqual(['rejected', 'rejected'])
    expect(intake.ready).toBe(false)
  })

  it('a dropped file with a bundled name is read for what it says, never swapped for the bundled copy', () => {
    const files = dropped(V7)
    const funding = files.find((f) => f.file === 'ops-204-funding-windows.v5.1.md')!
    funding.raw = funding.raw.replace('version: 5.1', 'version: 5.0')
    const intake = checkIntake(files, 7)
    expect(intake.ready).toBe(false)
    expect(intake.missing.map((r) => r.file)).toEqual(['ops-204-funding-windows.v5.1.md'])
    expect(intake.entries.find((e) => e.file === funding.file)!.sha256).toBe(sha256Hex(funding.raw))
  })

  it('identifies a renamed file by its front matter', () => {
    const files = dropped(V7).map((f, i) => ({ ...f, file: `scan-${i}.md` }))
    expect(checkIntake(files, 7).ready).toBe(true)
  })

  it('an edit to a dropped agreement is what the packet carries', () => {
    const files = dropped(V7)
    const a = files[0]!
    a.raw = a.raw.replace('Borrower', 'Obligor')
    const packet = readPacketFrom(files, 7)
    expect(packet.agreement.sha256).toBe(`sha256:${sha256Hex(a.raw)}`)
    expect(packet.agreement.sha256).not.toBe(readPacket(7).agreement.sha256)
    expect(packet.agreement.raw).toContain('Obligor')
  })

  it('surfaces the wrong agreement draft as an intake error', () => {
    const files = dropped(V7)
    files[0]!.raw = files[0]!.raw.replace(/^version: .+$/m, 'version: draft-6')
    const intake = checkIntake(files, 7)
    expect(intake.ready).toBe(false)
    expect(intake.blockers.join(' ')).toContain('draft-6')
  })

  it('two files claiming one identity block the run', () => {
    const files = dropped(V7)
    const copy = { ...files[4]!, file: 'approvals-copy.md' }
    const intake = checkIntake([...files, copy], 7)
    expect(intake.ready).toBe(false)
    expect(intake.blockers.join(' ')).toContain('approvals-copy.md')
  })

  it('the sample packet is ready, and is labelled as the sample', () => {
    const intake = checkIntake(sampleIntakeFiles(), 7)
    expect(intake.ready).toBe(true)
    expect(intake.source).toBe('sample')
    expect(intake.entries.every((e) => e.source === 'sample')).toBe(true)
  })

  it('a packet read from the sample files is the packet readPacket reads', () => {
    const a = readPacketFrom(samplePacketFiles(), 7)
    const b = readPacket(7)
    expect(a.documents.map((d) => d.sha256)).toEqual(b.documents.map((d) => d.sha256))
    expect(a.clauses).toEqual(b.clauses)
  })

  it('demo-packet/ is the sample packet, byte for byte, so a drag from it and the sample agree', () => {
    const folder = new URL('../../../demo-packet/', import.meta.url)
    expect(readdirSync(folder).filter((n) => n.endsWith('.md')).sort()).toEqual(samplePacketFiles().map((f) => f.file).sort())
    for (const f of samplePacketFiles()) expect(readFileSync(new URL(f.file, folder), 'utf8')).toBe(f.raw)
  })
})
