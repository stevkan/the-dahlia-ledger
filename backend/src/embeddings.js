import os from 'node:os'
import path from 'node:path'
import { AutoProcessor, AutoTokenizer, CLIPVisionModelWithProjection, CLIPTextModelWithProjection, RawImage, cos_sim, env } from '@huggingface/transformers'

export const EMBEDDING_MODEL_ID = 'Xenova/clip-vit-base-patch32'

// Defaults to caching downloaded model weights inside its own node_modules folder, which is read-only
// under common "run from package" deployments (e.g. Azure App Service) and fails with ENOENT on mkdir.
env.cacheDir = process.env.HF_CACHE_DIR || path.join(os.tmpdir(), 'huggingface-transformers-cache')

// A rejected from_pretrained() call (e.g. a transient network failure fetching model weights) must not be
// cached forever, or every future request fails identically until the process restarts.
function memoize(load) {
  let promise
  return () => {
    if (!promise) {
      promise = load().catch((error) => {
        promise = undefined
        throw error
      })
    }
    return promise
  }
}

const getProcessor = memoize(() => AutoProcessor.from_pretrained(EMBEDDING_MODEL_ID))
const getModel = memoize(() => CLIPVisionModelWithProjection.from_pretrained(EMBEDDING_MODEL_ID, { dtype: 'fp32' }))
const getTokenizer = memoize(() => AutoTokenizer.from_pretrained(EMBEDDING_MODEL_ID))
const getTextModel = memoize(() => CLIPTextModelWithProjection.from_pretrained(EMBEDDING_MODEL_ID, { dtype: 'fp32' }))

export async function warmEmbeddingModel() {
  await Promise.all([getProcessor(), getModel(), getTokenizer(), getTextModel()])
}

export async function embedImage({ buffer, contentType, url }) {
  const image = buffer
    ? await RawImage.fromBlob(new Blob([buffer], { type: contentType || 'application/octet-stream' }))
    : await RawImage.read(url)

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
