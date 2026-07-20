import './hfEnv.js'
import { AutoModel, AutoProcessor } from '@huggingface/transformers'
import { memoize } from './modelMemo.js'
import { loadRawImage } from './rawImage.js'

export const DINO_MODEL_ID = 'Xenova/dinov2-small'

const getDinoProcessor = memoize(() => AutoProcessor.from_pretrained(DINO_MODEL_ID))
const getDinoModel = memoize(() => AutoModel.from_pretrained(DINO_MODEL_ID, { dtype: 'q8' }))

export async function warmDinoModel() {
  await Promise.all([getDinoProcessor(), getDinoModel()])
}

function l2Normalize(vector) {
  let sumSquares = 0
  for (const value of vector) sumSquares += value * value
  const norm = Math.sqrt(sumSquares) || 1
  return vector.map((value) => value / norm)
}

// DINOv2's transformers.js port (verified via spike test against Xenova/dinov2-small) only exposes
// last_hidden_state, [batch, numTokens, hiddenSize] -- no pooler_output. Token 0 is the CLS token,
// the standard image-level embedding for DINOv2. Unlike CLIP's projection heads, this isn't unit-norm
// by default, so it's normalized here for cosine similarity and centroid math to behave.
export async function embedImageDino({ buffer, contentType, url, image: preloadedImage }) {
  const image = preloadedImage ?? (await loadRawImage({ buffer, contentType, url }))
  const [processor, model] = await Promise.all([getDinoProcessor(), getDinoModel()])
  const inputs = await processor(image)
  const output = await model(inputs)

  let embedding
  if (output.pooler_output) {
    embedding = Array.from(output.pooler_output.data)
  } else {
    const hidden = output.last_hidden_state
    const hiddenSize = hidden.dims.at(-1)
    embedding = Array.from(hidden.data.slice(0, hiddenSize))
  }
  return l2Normalize(embedding)
}
