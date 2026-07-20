import './hfEnv.js'
import { SamModel, AutoProcessor, RawImage } from '@huggingface/transformers'
import { memoize } from './modelMemo.js'
import { loadRawImage } from './rawImage.js'

// SlimSAM: a distilled, much smaller SAM1 encoder with a solid Xenova ONNX port, verified to load
// and run cleanly via transformers.js (SamModel/AutoProcessor). SAM2 has real Sam2Model/Sam2Processor
// support in @huggingface/transformers, but no complete, working ONNX checkpoint was found (the most
// likely candidate, onnx-community/sam2-hiera-tiny, is missing its config.json and fails to load) --
// SlimSAM stays the production choice until a real SAM2 checkpoint exists.
export const SEGMENTATION_MODEL_ID = 'Xenova/slimsam-77-uniform'

const getSamProcessor = memoize(() => AutoProcessor.from_pretrained(SEGMENTATION_MODEL_ID))
const getSamModel = memoize(() => SamModel.from_pretrained(SEGMENTATION_MODEL_ID, { dtype: 'q8' }))

export async function warmSegmentationModel() {
  await Promise.all([getSamProcessor(), getSamModel()])
}

// Below this, segmentation found essentially nothing (a failed/empty mask).
const MIN_MASK_FRACTION = 0.02
// Above this, the mask covers almost the whole frame -- segmentation didn't isolate anything from the
// background (common on reference photos that are already tightly cropped to the flower).
const MAX_MASK_FRACTION = 0.95
// Padding around the mask's bounding box so a tight crop doesn't clip petal tips right at the mask edge.
const CROP_PADDING_RATIO = 0.08

function boundingBoxFor(mask, width, height) {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    const rowOffset = y * width
    for (let x = 0; x < width; x++) {
      if (mask[rowOffset + x]) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  return { minX, minY, maxX, maxY }
}

// A single center-point prompt can pull in more than one nearby object -- most commonly two adjacent,
// visually-similar flowers in the same photo. When that happens the mask's *area* still looks plausible,
// but its bounding box has to span both objects (plus the gap and background between them), so the crop
// barely trims anything. Detecting disconnected regions in the mask and keeping only the one at the
// prompt point (falling back to whichever is nearest, if the point itself lands in a gap) fixes this
// specific failure mode without needing an interactive correction UI.
function isolateComponentAtPoint(mask, width, height, pointX, pointY) {
  const pixelCount = width * height
  const labels = new Int32Array(pixelCount)
  const stack = new Int32Array(pixelCount)
  const components = []

  let nextLabel = 0
  for (let start = 0; start < pixelCount; start++) {
    if (!mask[start] || labels[start] !== 0) continue
    nextLabel += 1
    let stackSize = 0
    stack[stackSize++] = start
    labels[start] = nextLabel
    let count = 0
    let sumX = 0
    let sumY = 0
    while (stackSize > 0) {
      const idx = stack[--stackSize]
      count += 1
      const x = idx % width
      const y = (idx - x) / width
      sumX += x
      sumY += y

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
          const nIdx = ny * width + nx
          if (mask[nIdx] && labels[nIdx] === 0) {
            labels[nIdx] = nextLabel
            stack[stackSize++] = nIdx
          }
        }
      }
    }
    components.push({ id: nextLabel, count, centroidX: sumX / count, centroidY: sumY / count })
  }

  if (components.length <= 1) return null // single region -- nothing to isolate

  const centerIdx = Math.round(pointY) * width + Math.round(pointX)
  const centerLabel = labels[centerIdx]
  let best = centerLabel !== 0 ? components.find((c) => c.id === centerLabel) : null

  if (!best) {
    // The exact prompt point landed in a gap between regions (e.g. a hole in the mask) -- fall back to
    // whichever component's centroid is nearest to it.
    let bestDist = Infinity
    for (const c of components) {
      const dist = (c.centroidX - pointX) ** 2 + (c.centroidY - pointY) ** 2
      if (dist < bestDist) {
        bestDist = dist
        best = c
      }
    }
  }

  const isolated = new Uint8Array(pixelCount)
  for (let i = 0; i < pixelCount; i++) if (labels[i] === best.id) isolated[i] = 1
  return { mask: isolated, foregroundCount: best.count }
}

/**
 * Segments the primary flower out of a photo using a center-point SAM prompt (the flower is assumed
 * to be roughly centered -- there is no click-to-correct UI yet). Always returns a usable RawImage:
 * on success it's a tightly cropped, background-transparent flower crop; on failure/skip it's the
 * original unsegmented image, so callers never have to branch on `applied` to get something embeddable.
 */
export async function segmentFlower({ buffer, contentType, url }) {
  const image = await loadRawImage({ buffer, contentType, url })
  const { width, height } = image
  const pixelCount = width * height
  const pointX = Math.round(width / 2)
  const pointY = Math.round(height / 2)

  const [processor, model] = await Promise.all([getSamProcessor(), getSamModel()])
  const input_points = [[[pointX, pointY]]]
  const inputs = await processor(image, { input_points })
  const outputs = await model(inputs)
  const masks = await processor.post_process_masks(outputs.pred_masks, inputs.original_sizes, inputs.reshaped_input_sizes, { binarize: true })

  const maskTensor = masks[0] // dims [1, numMasks, H, W]
  const numMasks = maskTensor.dims[1]
  const maskData = maskTensor.data
  const iouData = outputs.iou_scores.data

  // SAM's per-mask IoU score reflects the model's own confidence in that mask, not which of its
  // (typically 3) granularity proposals is the "whole object" -- a small, tightly-confident sub-part
  // (e.g. just a flower's center disc) can score a higher IoU than the correct whole-flower mask.
  // Empirically, preferring the largest proposal that stays within the sane-area bounds picks the
  // whole flower far more reliably than trusting raw IoU.
  let bestIndex = -1
  let bestFraction = -1
  let bestScore = -Infinity
  for (let i = 0; i < numMasks; i++) {
    const offset = i * pixelCount
    let count = 0
    for (let j = 0; j < pixelCount; j++) if (maskData[offset + j]) count++
    const fraction = count / pixelCount
    if (fraction < MIN_MASK_FRACTION || fraction > MAX_MASK_FRACTION) continue
    if (fraction > bestFraction) {
      bestFraction = fraction
      bestIndex = i
      bestScore = iouData[i]
    }
  }

  if (bestIndex === -1) {
    // Nothing in bounds -- report the largest raw fraction found for diagnostics, still fall back to
    // the unsegmented image.
    let fallbackFraction = 0
    for (let i = 0; i < numMasks; i++) {
      const offset = i * pixelCount
      let count = 0
      for (let j = 0; j < pixelCount; j++) if (maskData[offset + j]) count++
      fallbackFraction = Math.max(fallbackFraction, count / pixelCount)
    }
    return { applied: false, image, maskFraction: fallbackFraction, iouScore: Math.max(...iouData) }
  }

  const offset = bestIndex * pixelCount
  let mask = maskData.subarray(offset, offset + pixelCount)
  let maskFraction = bestFraction

  const isolated = isolateComponentAtPoint(mask, width, height, pointX, pointY)
  if (isolated) {
    mask = isolated.mask
    maskFraction = isolated.foregroundCount / pixelCount
  }

  const { minX, minY, maxX, maxY } = boundingBoxFor(mask, width, height)
  const padX = Math.round((maxX - minX + 1) * CROP_PADDING_RATIO)
  const padY = Math.round((maxY - minY + 1) * CROP_PADDING_RATIO)
  const left = Math.max(0, minX - padX)
  const top = Math.max(0, minY - padY)
  const right = Math.min(width - 1, maxX + padX)
  const bottom = Math.min(height - 1, maxY + padY)

  const maskSingleChannel = new Uint8ClampedArray(pixelCount)
  for (let i = 0; i < pixelCount; i++) maskSingleChannel[i] = mask[i] ? 255 : 0
  const maskImage = new RawImage(maskSingleChannel, width, height, 1)

  const maskedImage = image.putAlpha(maskImage)
  const croppedImage = await maskedImage.crop([left, top, right, bottom])

  return { applied: true, image: croppedImage, maskFraction, iouScore: bestScore }
}
