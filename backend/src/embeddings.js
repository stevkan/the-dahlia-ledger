import './hfEnv.js'
import { AutoProcessor, AutoTokenizer, CLIPVisionModelWithProjection, CLIPTextModelWithProjection, cos_sim } from '@huggingface/transformers'
import { memoize } from './modelMemo.js'
import { loadRawImage } from './rawImage.js'

export const EMBEDDING_MODEL_ID = 'Xenova/clip-vit-base-patch32'

const getProcessor = memoize(() => AutoProcessor.from_pretrained(EMBEDDING_MODEL_ID))
const getModel = memoize(() => CLIPVisionModelWithProjection.from_pretrained(EMBEDDING_MODEL_ID, { dtype: 'fp32' }))
const getTokenizer = memoize(() => AutoTokenizer.from_pretrained(EMBEDDING_MODEL_ID))
const getTextModel = memoize(() => CLIPTextModelWithProjection.from_pretrained(EMBEDDING_MODEL_ID, { dtype: 'fp32' }))

export async function warmEmbeddingModel() {
  await Promise.all([getProcessor(), getModel(), getTokenizer(), getTextModel()])
}

export async function embedImage({ buffer, contentType, url, image: preloadedImage }) {
  const image = preloadedImage ?? (await loadRawImage({ buffer, contentType, url }))

  const [processor, model] = await Promise.all([getProcessor(), getModel()])
  const inputs = await processor(image)
  const { image_embeds } = await model(inputs)
  return Array.from(image_embeds.data)
}

export async function embedTexts(texts) {
  const [tokenizer, textModel] = await Promise.all([getTokenizer(), getTextModel()])
  const inputs = tokenizer(texts, { padding: true, truncation: true })
  const { text_embeds } = await textModel(inputs)
  const dim = text_embeds.dims.at(-1)
  const data = text_embeds.data
  return texts.map((_, i) => Array.from(data.slice(i * dim, (i + 1) * dim)))
}

export const cosineSimilarity = cos_sim
