import os from 'node:os'
import path from 'node:path'
import { env } from '@huggingface/transformers'

// Defaults to caching downloaded model weights inside its own node_modules folder, which is read-only
// under common "run from package" deployments (e.g. Azure App Service) and fails with ENOENT on mkdir.
// Every module that loads a transformers.js model imports this file first for the side effect, so the
// cache dir is set exactly once regardless of import order.
env.cacheDir = process.env.HF_CACHE_DIR || path.join(os.tmpdir(), 'huggingface-transformers-cache')
