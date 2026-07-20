import '../src/env.js'
import { deactivateLearnedProjection } from '../src/learnedProjection.js'

await deactivateLearnedProjection()

console.log('Deactivated the learned projection -- identifyPhoto() has reverted to unprojected (raw DINOv2) matching.')
