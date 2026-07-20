import express from 'express'
import multer from 'multer'
import { z } from 'zod'
import { identifyPhoto, ingestText, proposeMissedIssueCorrection, reviewRecordMapping, runMetricDrilldown, runMetricRequest } from '../agent.js'
import { resolveGardenId } from '../gardens.js'
import { forbidden, requireGlobalAdminRoute } from '../httpHelpers.js'
import { getSettings } from '../settings.js'
import { trackException, trackTrace } from '../telemetry.js'
import { getProjectionDriftStatus } from '../learnedProjection.js'
import { DINO_MODEL_ID } from '../dino.js'
import { PREPROCESSING_VERSION } from '../preprocessingVersion.js'

const router = express.Router()
const photoIdentifyUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } })

router.post('/agent/ingest', async (req, res) => {
  const Body = z.object({ text: z.string().min(1) })
  const parsed = Body.safeParse(req.body)
  if (!parsed.success) return res.status(400).send(parsed.error.toString())

  try {
    const out = await ingestText(parsed.data.text)
    const settings = await getSettings()
    if (settings.agentDebugReviewEnabled && out.record) {
      out.review = await reviewRecordMapping({ originalText: parsed.data.text, record: out.record })
    }
    res.json(out)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('Agent ingest failed:', message)
    trackException(e, { operation: 'agent-ingest' })
    res.status(503).json({ status: 'needs_clarification', message: `Agent unavailable: ${message}` })
  }
})

router.post('/agent/identify-photo', photoIdentifyUpload.single('file'), async (req, res) => {
  const Body = z.object({ imageUrl: z.string().min(1).optional() })
  const parsed = Body.safeParse(req.body)
  const diagnostics = {
    contentType: req.get('content-type') ?? 'none',
    contentLength: req.get('content-length') ?? 'none',
    userAgent: req.get('user-agent') ?? 'none',
    hasFile: Boolean(req.file),
    bodyKeys: Object.keys(req.body ?? {}).join(',') || 'none',
  }

  if (!parsed.success) {
    trackTrace('Agent identify-photo: invalid body', 2, diagnostics)
    return res.status(400).send(parsed.error.toString())
  }
  if (!req.file && !parsed.data.imageUrl) {
    trackTrace('Agent identify-photo: no file or imageUrl received', 2, diagnostics)
    return res.status(400).json({ status: 'needs_clarification', message: 'A photo is required to identify.' })
  }

  let gardenId
  try {
    gardenId = await resolveGardenId(req.user, req.query.gardenId)
  } catch (e) {
    if (forbidden(res, e)) return
    throw e
  }

  try {
    const out = await identifyPhoto({
      imageBuffer: req.file?.buffer,
      imageContentType: req.file?.mimetype,
      imageUrl: parsed.data.imageUrl,
      gardenId,
    })
    res.json(out)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('Agent photo identification failed:', message)
    trackException(e, { operation: 'agent-identify-photo' })
    res.status(503).json({ status: 'needs_clarification', message: `Agent unavailable: ${message}` })
  }
})

router.post('/agent/metrics', async (req, res) => {
  const Body = z.object({
    metric: z.enum([
      'flower_purchase_count_by_company',
      'flower_count_by_color',
      'flower_count_by_garden_area',
      'flower_count_by_planting_state',
      'flower_count_by_form',
      'invoice_total_by_company',
      'flower_count_by_season',
      'height_vs_bloom_size',
      'average_item_cost_by_company',
      'linked_vs_unlinked_purchase_records',
      'missing_data_summary',
      'garden_area_by_planting_state',
      'invoice_total_by_season',
      'flower_count_by_company_and_season',
      'average_item_cost_by_form',
      'garden_fill_by_area',
      'not_viable_reason_summary',
      'not_planted_reason_summary',
      'average_item_cost_by_season',
      'order_count_by_company',
      'flower_count_by_bloom_size',
      'flower_count_by_height',
      'flower_count_by_source',
      'flower_count_by_photo_type',
    ]),
    seasonYearStart: z.number().int().min(1900).max(3000).optional(),
    seasonYearStarts: z.array(z.number().int().min(1900).max(3000)).optional(),
    filters: z.object({
      companies: z.array(z.string()).optional(),
      gardenAreas: z.array(z.string()).optional(),
      plantingStates: z.array(z.string()).optional(),
      colors: z.array(z.string()).optional(),
      forms: z.array(z.string()).optional(),
    }).optional(),
    photoTypes: z.array(z.enum(['any', 'record', 'cultivar', 'none'])).optional(),
    sortBy: z.enum(['company', 'value_desc', 'value_asc']).optional(),
    visualization: z.object({
      type: z.enum(['bar', 'line', 'pie', 'scatter', 'table']).optional(),
      renderer: z.enum(['recharts', 'd3', 'table']).optional(),
      xLabelAngle: z.number().optional(),
    }).optional(),
  })
  const parsed = Body.safeParse(req.body)
  if (!parsed.success) return res.status(400).send(parsed.error.toString())

  try {
    res.json(await runMetricRequest(parsed.data))
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('Agent metrics failed:', message)
    trackException(e, { operation: 'agent-metrics' })
    res.status(503).json({ status: 'needs_clarification', message: `Analytics unavailable: ${message}` })
  }
})

router.post('/agent/metrics/drilldown', async (req, res) => {
  const Body = z.object({
    metric: z.enum([
      'missing_data_summary',
      'flower_count_by_color',
      'flower_count_by_garden_area',
      'flower_count_by_form',
      'flower_count_by_planting_state',
      'linked_vs_unlinked_purchase_records',
      'flower_purchase_count_by_company',
      'invoice_total_by_company',
      'flower_count_by_season',
      'height_vs_bloom_size',
      'garden_area_by_planting_state',
      'invoice_total_by_season',
      'flower_count_by_company_and_season',
      'average_item_cost_by_form',
      'garden_fill_by_area',
      'not_viable_reason_summary',
      'not_planted_reason_summary',
      'average_item_cost_by_season',
      'order_count_by_company',
      'flower_count_by_bloom_size',
      'flower_count_by_height',
      'flower_count_by_source',
      'flower_count_by_photo_type',
    ]),
    field: z.enum(['Color', 'Form', 'Height', 'Bloom size', 'Source', 'Linked invoice item', 'Garden area', 'Garden row', 'Garden position']).optional(),
    bucket: z.string().optional(),
    seasonYearStart: z.number().int().min(1900).max(3000).optional(),
    seasonYearStarts: z.array(z.number().int().min(1900).max(3000)).optional(),
    filters: z.object({
      companies: z.array(z.string()).optional(),
      gardenAreas: z.array(z.string()).optional(),
      plantingStates: z.array(z.string()).optional(),
      colors: z.array(z.string()).optional(),
      forms: z.array(z.string()).optional(),
    }).optional(),
    photoTypes: z.array(z.enum(['any', 'record', 'cultivar', 'none'])).optional(),
  }).refine((value) => value.metric === 'missing_data_summary' ? Boolean(value.field) : Boolean(value.bucket), 'field is required for missing_data_summary; bucket is required for other drilldowns')
  const parsed = Body.safeParse(req.body)
  if (!parsed.success) return res.status(400).send(parsed.error.toString())

  try {
    res.json(await runMetricDrilldown(parsed.data))
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('Agent metrics drilldown failed:', message)
    trackException(e, { operation: 'agent-metrics-drilldown' })
    res.status(503).json({ title: 'Drilldown unavailable', records: [], error: message })
  }
})

router.post('/agent/review', async (req, res) => {
  const Body = z.object({
    originalText: z.string().optional(),
    record: z.any().optional(),
    recordId: z.string().optional(),
  }).refine((value) => value.record || value.recordId, 'record or recordId is required')
  const parsed = Body.safeParse(req.body)
  if (!parsed.success) return res.status(400).send(parsed.error.toString())

  try {
    const review = await reviewRecordMapping(parsed.data)
    res.json({ review })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('Agent review failed:', message)
    trackException(e, { operation: 'agent-review' })
    res.status(503).json({ error: `Agent review unavailable: ${message}` })
  }
})

router.post('/agent/correction', async (req, res) => {
  const Body = z.object({
    originalText: z.string().optional(),
    record: z.any().optional(),
    recordId: z.string().optional(),
    review: z.any().optional(),
    userCorrection: z.string().min(1),
  }).refine((value) => value.record || value.recordId, 'record or recordId is required')
  const parsed = Body.safeParse(req.body)
  if (!parsed.success) return res.status(400).send(parsed.error.toString())

  try {
    const correction = await proposeMissedIssueCorrection(parsed.data)
    res.json({ correction })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('Agent correction failed:', message)
    trackException(e, { operation: 'agent-correction' })
    res.status(503).json({ error: `Agent correction unavailable: ${message}` })
  }
})

router.get('/agent/learned-projection-status', requireGlobalAdminRoute, async (req, res) => {
  try {
    const status = await getProjectionDriftStatus({ embeddingModel: DINO_MODEL_ID, preprocessingVersion: PREPROCESSING_VERSION })
    res.json(status)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('Learned projection status check failed:', message)
    trackException(e, { operation: 'agent-learned-projection-status' })
    res.status(503).json({ error: `Learned projection status unavailable: ${message}` })
  }
})

export default router
