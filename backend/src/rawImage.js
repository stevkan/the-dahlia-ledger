import { RawImage } from '@huggingface/transformers'

// Shared by every module that needs a decoded image (segmentation, each embedding model) so a
// buffer-or-url input photo is only ever decoded once per call site, the same branch used by the
// original embedImage().
export async function loadRawImage({ buffer, contentType, url }) {
  return buffer
    ? await RawImage.fromBlob(new Blob([buffer], { type: contentType || 'application/octet-stream' }))
    : await RawImage.read(url)
}
