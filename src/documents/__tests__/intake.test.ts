import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { sha256Hex } from '../../domain/sha256'
import { addIntakeFiles, checkIntake, sampleAgreementIntake, samplePolicyIntake, withoutPolicies, type IntakeFile } from '../intake'
import { readPacket, readPacketFrom, samplePacketFiles, standingPolicies } from '../packet'

const dropped = (names: string[]): IntakeFile[] =>
  samplePacketFiles()
    .filter((f) => names.includes(f.file))
    .map((f) => ({ ...f, size: f.raw.length, source: 'dropped' }))

const AGREEMENT = 'credit-agreement.draft-7.md'
const sources = (files: IntakeFile[], version: number) => checkIntake(files, version).policies.map((p) => p.source)

const V7 = [
  'credit-agreement.draft-7.md',
  'ops-101-notice-intake.v2.3.md',
  'ops-204-funding-windows.v5.1.md',
  'ops-310-booking-entities.v4.0.md',
  'pol-007-approvals.v3.md',
]

describe('document intake', () => {
  it('nothing handed over: only the agreement is needed, and the standing policies are already in force', () => {
    const intake = checkIntake([], 7)
    expect(intake.ready).toBe(false)
    expect(intake.missing.map((r) => r.file)).toEqual([AGREEMENT])
    expect(intake.blockers).toEqual(['Still needed: the draft agreement.'])
    expect(intake.policies.map((p) => p.doc.file)).toEqual(V7.slice(1))
    expect(intake.policies.every((p) => p.source === 'standing')).toBe(true)
  })

  it('the agreement alone: ready, hashed from its own text, and the packet is completed by the standing policies', () => {
    const files = dropped([AGREEMENT])
    const intake = checkIntake(files, 7)
    expect(intake.blockers).toEqual([])
    expect(intake.ready).toBe(true)
    expect(intake.source).toBe('dropped')
    expect(intake.entries.map((e) => [e.file, e.status, e.sha256])).toEqual([[AGREEMENT, 'needed', sha256Hex(files[0]!.raw)]])
    expect(intake.packet_files.map((f) => f.file)).toEqual(V7)
    expect(readPacketFrom(intake.packet_files, 7).documents.map((d) => d.sha256)).toEqual(readPacket(7).documents.map((d) => d.sha256))
  })

  it('the five v7 files: ready, each hashed from its own text, each dropped policy in place of the standing one', () => {
    const files = dropped(V7)
    const intake = checkIntake(files, 7)
    expect(intake.blockers).toEqual([])
    expect(intake.ready).toBe(true)
    for (const e of intake.entries) {
      expect(e.status).toBe('needed')
      expect(e.source).toBe('dropped')
      expect(e.sha256).toBe(sha256Hex(files.find((f) => f.file === e.file)!.raw))
    }
    expect(intake.policies.map((p) => p.source)).toEqual(['dropped', 'dropped', 'dropped', 'dropped'])
    // No standing copy rides along with a file that was dropped.
    expect(intake.packet_files).toEqual(files)
  })

  it('a policy is never named as needed: the standing copy is in force where none was dropped', () => {
    const intake = checkIntake(dropped(V7.slice(0, 4)), 7)
    expect(intake.ready).toBe(true)
    expect(intake.missing).toEqual([])
    expect(intake.policies.map((p) => p.source)).toEqual(['dropped', 'dropped', 'dropped', 'standing'])
    expect(intake.policies[3]!.doc.file).toBe('pol-007-approvals.v3.md')
  })

  it('policies without an agreement: not ready, and only the agreement is named', () => {
    const intake = checkIntake(dropped(V7.slice(1)), 7)
    expect(intake.ready).toBe(false)
    expect(intake.missing.map((r) => r.kind)).toEqual(['agreement'])
    expect(intake.blockers).toEqual(['Still needed: the draft agreement.'])
  })

  it('capabilities v8 puts the standing approvals v4 in force, and says a dropped v3 is not used', () => {
    const intake = checkIntake(dropped(V7), 8)
    expect(intake.ready).toBe(true)
    expect(intake.missing).toEqual([])
    const v3 = intake.entries.find((e) => e.file === 'pol-007-approvals.v3.md')!
    expect(v3.status).toBe('unused')
    expect(v3.note).toContain('not in force for capabilities v8')
    expect(intake.policies[3]).toEqual({ doc: standingPolicies(8)[3], source: 'standing' })
    expect(intake.policies[3]!.doc.file).toBe('pol-007-approvals.v4.md')
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
    // It says it is v5.0, so it is not the policy in force, whatever it is called. It is shown as unused,
    // and the v5.1 in force is the standing copy, labelled as standing.
    const entry = intake.entries.find((e) => e.file === funding.file)!
    expect(entry.status).toBe('unused')
    expect(entry.note).toContain('5.0 is not in force for capabilities v7')
    expect(entry.sha256).toBe(sha256Hex(funding.raw))
    expect(intake.ready).toBe(true)
    expect(intake.policies[1]).toEqual({ doc: standingPolicies(7)[1], source: 'standing' })
  })

  it('an edited policy with the identity in force is what the packet carries, not the standing copy', () => {
    const files = dropped([AGREEMENT, 'ops-204-funding-windows.v5.1.md'])
    const funding = files[1]!
    funding.raw = funding.raw.replace('EUR', 'EUR ')
    const intake = checkIntake(files, 7)
    expect(intake.ready).toBe(true)
    expect(intake.policies[1]!.source).toBe('dropped')
    const packet = readPacketFrom(intake.packet_files, 7)
    expect(packet.policies[1]!.sha256).toBe(`sha256:${sha256Hex(funding.raw)}`)
    expect(packet.policies[1]!.sha256).not.toBe(standingPolicies(7)[1]!.sha256)
    expect(intake.packet_files.filter((f) => f.file === funding.file)).toHaveLength(1)
  })

  it('identifies a renamed file by its front matter', () => {
    const files = dropped(V7).map((f, i) => ({ ...f, file: `scan-${i}.md` }))
    expect(checkIntake(files, 7).ready).toBe(true)
    expect(sources(files, 7)).toEqual(['dropped', 'dropped', 'dropped', 'dropped'])
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

  it('the sample agreement is one file, ready under either version, and labelled as the sample', () => {
    const intake = checkIntake([sampleAgreementIntake()], 7)
    expect(intake.ready).toBe(true)
    expect(intake.source).toBe('sample')
    expect(intake.entries.map((e) => [e.file, e.source])).toEqual([[AGREEMENT, 'sample']])
    expect(checkIntake([sampleAgreementIntake()], 8).ready).toBe(true)
  })

  it('the sample policy files replace the standing ones and stay labelled as the sample', () => {
    const files = [sampleAgreementIntake(), ...samplePolicyIntake()]
    expect(sources(files, 7)).toEqual(['sample', 'sample', 'sample', 'sample'])
    expect(sources(files, 8)).toEqual(['sample', 'sample', 'sample', 'sample'])
    expect(sources(withoutPolicies(files), 7)).toEqual(['standing', 'standing', 'standing', 'standing'])
    expect(withoutPolicies(files)).toEqual([files[0]])
  })

  it('a new agreement replaces the one already in, and leaves the policies that were handed over', () => {
    const mine = { ...dropped([AGREEMENT])[0]!, file: 'my-draft.md' }
    const funding = dropped(['ops-204-funding-windows.v5.1.md'])
    const files = addIntakeFiles([sampleAgreementIntake(), ...funding], [mine])
    expect(files.map((f) => [f.file, f.source])).toEqual([['ops-204-funding-windows.v5.1.md', 'dropped'], ['my-draft.md', 'dropped']])
    expect(checkIntake(files, 7).source).toBe('dropped')
    // A policy coming in leaves the agreement where it is.
    expect(addIntakeFiles([sampleAgreementIntake()], funding).map((f) => f.file)).toEqual([AGREEMENT, funding[0]!.file])
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
