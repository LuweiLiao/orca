import * as z from 'zod'

export const MobileDiffReviewSchema = z.object({
  version: z.literal(1),
  updatedAt: z.number().finite().optional(),
  completedAt: z.number().finite().optional(),
  files: z.record(
    z.string(),
    z.object({
      key: z.string(),
      filePath: z.string(),
      oldPath: z.string().optional(),
      scope: z.enum(['unstaged', 'staged', 'branch']),
      lastOpenedAt: z.number().finite().optional(),
      lastSeenDiffIdentity: z.string().optional(),
      reviewedAt: z.number().finite().optional(),
      reviewDiffIdentity: z.string().optional()
    })
  )
})

const PdfNoteRegionSchema = z.object({
  page: z.number().int().positive(),
  left: z.number().finite(),
  top: z.number().finite(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive()
})

const PdfNoteTexSourceSchema = z.object({
  filePath: z.string().min(1),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive()
})

export const DiffCommentSchema = z.object({
  id: z.string(),
  worktreeId: z.string(),
  filePath: z.string(),
  source: z.enum(['diff', 'markdown', 'pdf']).optional(),
  selectedText: z.string().optional(),
  pdfRegion: PdfNoteRegionSchema.optional(),
  pdfTexSource: PdfNoteTexSourceSchema.optional(),
  startLine: z.number().int().positive().optional(),
  // 0 is a whole-file note (the phone's File Note; formatDiffComment prints "Scope: file").
  lineNumber: z.number().int().nonnegative(),
  body: z.string(),
  createdAt: z.number().finite(),
  updatedAt: z.number().finite().optional(),
  sentAt: z.number().finite().optional(),
  scope: z.enum(['unstaged', 'staged', 'branch']).optional(),
  oldPath: z.string().optional(),
  diffIdentity: z.string().optional(),
  side: z.literal('modified')
})
