export function toTitleCase(value) {
  if (typeof value !== 'string') return value

  return value
    .trim()
    .toLowerCase()
    .replace(/(^|[\s-])\p{L}/gu, (match) => match.toUpperCase())
}
