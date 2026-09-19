import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { z } from 'zod'
import { ExtractedClauseSchema } from '@/domain/schema'
import type { ExtractedClause } from '@/domain/types'
import type { Extraction, FallbackReason } from './extractClient'

/** A human correction to an extracted field, kept so Results can show it happened. */
export interface ReviewerEdit {
  requirement_id: string
  field: 'amount.value'
  from: number
  to: number
}

/** What the reviewer sent to the evaluator: the clause as corrected, plus its provenance. */
export interface Submission {
  clause: ExtractedClause
  fallback_reason: FallbackReason | null
  edits: ReviewerEdit[]
}

interface ReviewSession {
  selectedClauseId: string | null
  extraction: Extraction | null
  /** requirement_id -> the reviewer's amount, as typed. */
  amountDrafts: Record<string, string>
  submission: Submission | null
  select: (clauseId: string | null) => void
  setExtraction: (e: Extraction | null) => void
  setAmountDraft: (requirementId: string, value: string | null) => void
  submit: (s: Submission) => void
}

const STORAGE_KEY = 'loan-operability.submission'

const SubmissionSchema = z.object({
  clause: ExtractedClauseSchema,
  fallback_reason: z.string().nullable(),
  edits: z.array(
    z.object({
      requirement_id: z.string(),
      field: z.literal('amount.value'),
      from: z.number(),
      to: z.number(),
    }),
  ),
})

function restoreSubmission(): Submission | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = SubmissionSchema.safeParse(JSON.parse(raw))
    return parsed.success ? (parsed.data as Submission) : null
  } catch {
    return null
  }
}

const Ctx = createContext<ReviewSession | null>(null)

export function ReviewSessionProvider({ children }: { children: ReactNode }) {
  const [selectedClauseId, setSelected] = useState<string | null>(null)
  const [extraction, setExtraction] = useState<Extraction | null>(null)
  const [amountDrafts, setAmountDrafts] = useState<Record<string, string>>({})
  const [submission, setSubmission] = useState<Submission | null>(restoreSubmission)

  const select = useCallback((clauseId: string | null) => {
    setSelected(clauseId)
    setExtraction(null)
    setAmountDrafts({})
  }, [])

  const setAmountDraft = useCallback((requirementId: string, value: string | null) => {
    setAmountDrafts((prev) => {
      const next = { ...prev }
      if (value === null) delete next[requirementId]
      else next[requirementId] = value
      return next
    })
  }, [])

  const submit = useCallback((s: Submission) => {
    setSubmission(s)
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s))
    } catch {
      // Storage is a convenience for reloads, not a dependency.
    }
  }, [])

  const value = useMemo(
    () => ({
      selectedClauseId,
      extraction,
      amountDrafts,
      submission,
      select,
      setExtraction,
      setAmountDraft,
      submit,
    }),
    [selectedClauseId, extraction, amountDrafts, submission, select, setAmountDraft, submit],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useReviewSession(): ReviewSession {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useReviewSession must be used inside ReviewSessionProvider')
  return ctx
}
