// A rejected from_pretrained() call (e.g. a transient network failure fetching model weights) must not be
// cached forever, or every future request fails identically until the process restarts.
export function memoize(load) {
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
