import { AutoProcessor, AutoTokenizer, CLIPVisionModelWithProjection, CLIPTextModelWithProjection, RawImage, cos_sim } from '@huggingface/transformers'

export const EMBEDDING_MODEL_ID = 'Xenova/clip-vit-base-patch32'

let processorPromise
let modelPromise
let tokenizerPromise
let textModelPromise

function getProcessor() {
  if (!processorPromise) processorPromise = AutoProcessor.from_pretrained(EMBEDDING_MODEL_ID)
  return processorPromise
}

function getModel() {
  if (!modelPromise) modelPromise = CLIPVisionModelWithProjection.from_pretrained(EMBEDDING_MODEL_ID, { dtype: 'fp32' })
  return modelPromise
}

function getTokenizer() {
  if (!tokenizerPromise) tokenizerPromise = AutoTokenizer.from_pretrained(EMBEDDING_MODEL_ID)
  return tokenizerPromise
}

function getTextModel() {
  if (!textModelPromise) textModelPromise = CLIPTextModelWithProjection.from_pretrained(EMBEDDING_MODEL_ID, { dtype: 'fp32' })
  return textModelPromise
}

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
