import './hfEnv.js'
import { SiglipVisionModel, AutoProcessor } from '@huggingface/transformers'
import { memoize } from './modelMemo.js'
import { loadRawImage } from './rawImage.js'

// onnx-community's SigLIP 2 export -- verified via spike test to load and return a proper
// pooler_output directly (unlike DINOv2's port, no manual CLS-token extraction needed).
export const SIGLIP_MODEL_ID = 'onnx-community/siglip2-base-patch16-224-ONNX'

const getSiglipProcessor = memoize(() => AutoProcessor.from_pretrained(SIGLIP_MODEL_ID))
const getSiglipModel = memoize(() => SiglipVisionModel.from_pretrained(SIGLIP_MODEL_ID, { dtype: 'q8' }))

export async function warmSiglipModel() {
  await Promise.all([getSiglipProcessor(), getSiglipModel()])
}

function l2Normalize(vector) {
  let sumSquares = 0
  for (const value of vector) sumSquares += value * value
  const norm = Math.sqrt(sumSquares) || 1
  return vector.map((value) => value / norm)
}

export async function embedImageSiglip({ buffer, contentType, url, image: preloadedImage }) {
  const image = preloadedImage ?? (await loadRawImage({ buffer, contentType, url }))
  const [processor, model] = await Promise.all([getSiglipProcessor(), getSiglipModel()])
  const inputs = await processor(image)
  const { pooler_output } = await model(inputs)
  return l2Normalize(Array.from(pooler_output.data))
}
