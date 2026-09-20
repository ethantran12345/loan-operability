// The comparison packet: everything the workspace read, as one pasteable text,
// so a chat model can be given the same inputs as the application.
//
// It carries the agreement, the policies in force for the chosen registry
// version, the capability registry JSON the evaluator reads, and the transaction
// date the evaluator uses. It carries no verdict, finding or hint.

import type { CapabilityGraph } from '../domain/types'
import { longDate } from './citations'
import type { Packet } from './packet'

export const COMPARISON_QUESTION = 'Can this bank support the agreement? Identify conflicts and cite evidence.'

export function buildComparisonPacket(packet: Packet, graph: CapabilityGraph, transactionTime: string): string {
  const docs = packet.documents
  const parts = [
    COMPARISON_QUESTION,
    '',
    `Assume the transaction date is ${longDate(transactionTime.slice(0, 10))} (${transactionTime}).`,
    `You are given ${docs.length} documents and the bank's capability registry. All of it is synthetic.`,
  ]
  docs.forEach((d, i) => {
    parts.push(
      '',
      `===== DOCUMENT ${i + 1} OF ${docs.length}: ${d.meta.title} (${d.meta.document_id}, version ${d.meta.version}) =====`,
      '',
      d.raw.trim(),
    )
  })
  parts.push(
    '',
    `===== BANK CAPABILITY REGISTRY, VERSION ${graph.version} (JSON) =====`,
    '',
    JSON.stringify(graph, null, 2),
    '',
    COMPARISON_QUESTION,
  )
  return parts.join('\n')
}
