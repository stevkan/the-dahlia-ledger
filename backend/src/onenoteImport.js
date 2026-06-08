import { toTitleCase } from './textFormat.js'

const IMAGE_EXTENSIONS = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
}

const LABEL_ALIASES = {
  name: ['Name'],
  bloom: ['Bloom', 'Bloom Size'],
  color: ['Color'],
  farm: ['Farm'],
  height: ['Height'],
  notes: ['Note', 'Notes'],
  tag: ['Tag#', 'Tag #', 'Tag'],
  location: ['Location'],
}

const ALL_LABELS = Object.values(LABEL_ALIASES).flat()

function decodeQuotedPrintable(input) {
  return input
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
}

function decodeHtmlEntities(input) {
  const named = {
    nbsp: ' ',
    quot: '"',
    amp: '&',
    lt: '<',
    gt: '>',
  }

  return input
    .replace(/&([a-z]+);/gi, (match, name) => named[name.toLowerCase()] ?? match)
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number.parseInt(code, 10)))
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
}

function stripTags(input) {
  return decodeHtmlEntities(input.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

function decodeMimeHeader(value) {
  return decodeHtmlEntities(value.trim().replace(/^<|>$/g, ''))
}

export function imageRefKeys(value) {
  if (!value) return []
  const decoded = decodeHtmlEntities(value).replace(/^cid:/i, '')
  const uriDecoded = safeDecodeURIComponent(decoded)
  const withoutFragment = decoded.split('#')[0]
  const uriDecodedWithoutFragment = uriDecoded.split('#')[0]
  const normalizedPath = uriDecodedWithoutFragment.replace(/\\/g, '/').replace(/^\.\//, '')
  const fileName = normalizedPath.split(/[\\/]/).at(-1)
  const keys = [value, decoded, uriDecoded, withoutFragment, uriDecodedWithoutFragment, normalizedPath]

  if (fileName) {
    keys.push(fileName)
    const filePathMatch = withoutFragment.match(/([^\\/]+_files[\\/][^\\/]+)$/i)
    if (filePathMatch) keys.push(filePathMatch[1].replace(/\\/g, '/'))
    const normalizedFilePathMatch = normalizedPath.match(/([^/]+_files\/[^/]+)$/i)
    if (normalizedFilePathMatch) keys.push(normalizedFilePathMatch[1])
  }

  return Array.from(new Set(keys.filter(Boolean)))
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function getMimeBoundary(raw) {
  return raw.match(/boundary="?([^";\r\n]+)"?/i)?.[1]
}

function parseHeaders(input) {
  const headers = new Map()
  const lines = input.replace(/\r\n/g, '\n').split('\n')
  let current = ''

  for (const line of lines) {
    if (/^[\t ]/.test(line) && current) {
      headers.set(current, `${headers.get(current)} ${line.trim()}`)
      continue
    }

    const separator = line.indexOf(':')
    if (separator === -1) continue
    current = line.slice(0, separator).trim().toLowerCase()
    headers.set(current, line.slice(separator + 1).trim())
  }

  return headers
}

function decodeMimeBody(body, encoding) {
  const normalizedEncoding = encoding.toLowerCase()
  if (normalizedEncoding.includes('base64')) return Buffer.from(body.replace(/\s/g, ''), 'base64')
  if (normalizedEncoding.includes('quoted-printable')) return Buffer.from(decodeQuotedPrintable(body), 'binary')
  return Buffer.from(body, 'binary')
}

function parseMhtParts(raw) {
  const boundary = getMimeBoundary(raw)
  if (!boundary) return []

  return raw
    .split(new RegExp(`(?:\r?\n)?--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:--)?\r?\n`))
    .map((part) => {
      const separator = part.search(/\r?\n\r?\n/)
      if (separator === -1) return null

      const headerText = part.slice(0, separator)
      const body = part.slice(separator).replace(/^\r?\n\r?\n?/, '')
      const headers = parseHeaders(headerText)

      return {
        headers,
        body,
      }
    })
    .filter(Boolean)
}

function imageExtension(contentType) {
  return IMAGE_EXTENSIONS[contentType.toLowerCase()] ?? ''
}

export function extractOneNoteImages(buffer) {
  const raw = buffer.toString('binary')
  const parts = parseMhtParts(raw)

  return parts
    .map(({ headers, body }) => {
      const contentType = headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? ''
      if (!contentType.startsWith('image/')) return null

      const contentLocation = headers.get('content-location') ? decodeMimeHeader(headers.get('content-location')) : ''
      const contentId = headers.get('content-id') ? decodeMimeHeader(headers.get('content-id')) : ''
      const data = decodeMimeBody(body, headers.get('content-transfer-encoding') ?? '')
      if (!data.length) return null

      return {
        contentType,
        contentLocation,
        contentId,
        data,
        extension: imageExtension(contentType),
      }
    })
    .filter(Boolean)
}

function splitParagraphs(html) {
  return html
    .split(/<\/p>/i)
    .map((part) => stripTags(part))
    .filter(Boolean)
}

function findImageForEntry(html, nameIndex, nextNameIndex) {
  const cellStart = Math.max(html.lastIndexOf('<td', nameIndex), html.lastIndexOf('<th', nameIndex))
  const cellEnd = cellStart === -1 ? -1 : html.indexOf('</td>', nameIndex)
  const sameCell = cellStart === -1 || cellEnd === -1 ? '' : html.slice(cellStart, cellEnd)
  const sameCellImage = sameCell.match(/<img\b[^>]*\bsrc=["']?([^"' >]+)["']?[^>]*>/i)?.[1]
  if (sameCellImage) return sameCellImage

  const rowStart = html.lastIndexOf('<tr', nameIndex)
  const rowEnd = rowStart === -1 ? -1 : html.indexOf('</tr>', nameIndex)
  const sameRow = rowStart === -1 || rowEnd === -1 ? '' : html.slice(rowStart, rowEnd)
  const sameRowImage = nearestImageToName(sameRow, nameIndex - rowStart)
  if (sameRowImage) return sameRowImage

  const sectionStart = previousEntryBoundary(html, nameIndex)
  const sectionEnd = nextNameIndex === -1 ? nextEntryBoundary(html, nameIndex) : nextNameIndex
  const section = html.slice(sectionStart, sectionEnd === -1 ? undefined : sectionEnd)
  return nearestImageToName(section, nameIndex - sectionStart)
}

function previousEntryBoundary(html, index) {
  const boundaries = ['<tr', '<td', '<div', '<p']
  const positions = boundaries.map((boundary) => html.lastIndexOf(boundary, index)).filter((position) => position !== -1)
  return positions.length ? Math.min(...positions) : index
}

function nextEntryBoundary(html, index) {
  const candidates = ['</tr>', '</td>', '</div>']
    .map((boundary) => html.indexOf(boundary, index))
    .filter((position) => position !== -1)
  return candidates.length ? Math.min(...candidates) : -1
}

function nearestImageToName(section, nameOffset) {
  const images = Array.from(section.matchAll(/<img\b[^>]*\bsrc=["']?([^"' >]+)["']?[^>]*>/gi))
  if (!images.length) return undefined

  return images
    .map((match) => ({ src: match[1], distance: Math.abs((match.index ?? 0) - nameOffset) }))
    .sort((a, b) => a.distance - b.distance)[0]?.src
}

function normalizeValue(value) {
  const normalized = value.replace(/^:+/, '').trim()
  return normalized === '"' ? '' : normalized.replace(/"$/, '').trim()
}

function labelPattern(label) {
  return label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
}

function anyLabelPattern(labels = ALL_LABELS) {
  return labels.map(labelPattern).join('|')
}

function isLabeledLine(line, labels = ALL_LABELS) {
  return new RegExp(`^(?:${anyLabelPattern(labels)}):\\s*`, 'i').test(line)
}

function isIgnorableLine(line) {
  return /^Received\b/i.test(line.trim())
}

function readLabeledValue(lines, index, labels) {
  const labelList = Array.isArray(labels) ? labels : [labels]
  const line = lines[index]
  const inline = line.match(new RegExp(`^(?:${anyLabelPattern(labelList)}):\\s*(.*)$`, 'i'))?.[1]
  if (inline?.trim()) return { value: normalizeValue(inline), nextIndex: index + 1 }

  const next = lines[index + 1] ?? ''
  if (!next || isLabeledLine(next)) return { value: '', nextIndex: index + 1 }

  return { value: normalizeValue(next), nextIndex: index + 2 }
}

function readNotes(lines, index) {
  const result = readLabeledValue(lines, index, LABEL_ALIASES.notes)
  if (result.value) return result

  const notes = []
  let cursor = index + 1

  while (cursor < lines.length && !isLabeledLine(lines[cursor]) && !parseCompanyHeading(lines[cursor])) {
    if (!isIgnorableLine(lines[cursor])) notes.push(normalizeValue(lines[cursor]))
    cursor += 1
  }

  return { value: notes.filter(Boolean).join('\n'), nextIndex: cursor }
}

function parseCompanyHeading(line) {
  const match = line.match(/^(.+?)\s+-\s+\d+$/)
  return match ? match[1].trim().replace(/\s+/g, ' ') : null
}

function getSeasonYear(lines) {
  const season = lines.find((line) => /\b\d{4}\s+Season\b/i.test(line))
  const year = season?.match(/\b(\d{4})\b/)?.[1]
  if (year) return Number(year)

  const nearbyYear = lines
    .slice(0, 20)
    .map((line) => line.match(/\b(20\d{2})\b/)?.[1])
    .find(Boolean)
  if (nearbyYear) return Number(nearbyYear)

  if (lines.some((line) => isLabeledLine(line, LABEL_ALIASES.tag) || isLabeledLine(line, LABEL_ALIASES.location))) return 2024
  if (lines.some((line) => isLabeledLine(line, LABEL_ALIASES.height) || isLabeledLine(line, LABEL_ALIASES.notes) || /^Bloom\s+Size:\s*/i.test(line))) return 2025
  return new Date().getFullYear()
}

function getOneNoteLayout(lines, seasonYearStart) {
  if (seasonYearStart === 2023 || seasonYearStart === 2024 || lines.some((line) => isLabeledLine(line, LABEL_ALIASES.tag) || isLabeledLine(line, LABEL_ALIASES.location))) return 'legacyTagLocation'
  if (seasonYearStart === 2025 || lines.some((line) => isLabeledLine(line, LABEL_ALIASES.height) || isLabeledLine(line, LABEL_ALIASES.notes))) return '2025'
  return 'default'
}

export function parseOneNoteMht(buffer) {
  const raw = buffer.toString('utf8')
  const decoded = decodeQuotedPrintable(raw)
  const html = decoded.match(/<html[\s\S]*?<\/html>/i)?.[0] ?? decoded
  const lines = splitParagraphs(html)
  const seasonYearStart = getSeasonYear(lines)
  const layout = getOneNoteLayout(lines, seasonYearStart)
  const entries = []
  const seen = new Set()
  let currentCompany = ''

  const nameMatches = Array.from(html.matchAll(/Name:\s*/gi))
  let nameMatchIndex = 0

  for (let i = 0; i < lines.length; i += 1) {
    const heading = parseCompanyHeading(lines[i])
    if (heading) currentCompany = heading

    if (!isLabeledLine(lines[i], LABEL_ALIASES.name)) continue

    const nameResult = readLabeledValue(lines, i, LABEL_ALIASES.name)
    const name = nameResult.value
    if (!name) continue

    const htmlNameIndex = nameMatches[nameMatchIndex]?.index ?? -1
    const nextHtmlNameIndex = nameMatches[nameMatchIndex + 1]?.index ?? -1
    const imageRef = htmlNameIndex === -1 ? undefined : findImageForEntry(html, htmlNameIndex, nextHtmlNameIndex)
    nameMatchIndex += 1

    let cursor = nameResult.nextIndex
    let bloom = ''
    let color = ''
    let farm = currentCompany
    let height = ''
    let notes = ''

    while (cursor < lines.length && !isLabeledLine(lines[cursor], LABEL_ALIASES.name)) {
      const line = lines[cursor]
      const nextHeading = parseCompanyHeading(line)
      if (nextHeading) break

      if (isIgnorableLine(line)) {
        cursor += 1
        continue
      }
      if (isLabeledLine(line, LABEL_ALIASES.bloom)) {
        const result = readLabeledValue(lines, cursor, LABEL_ALIASES.bloom)
        bloom = result.value
        cursor = result.nextIndex
        continue
      }
      if (isLabeledLine(line, LABEL_ALIASES.color)) {
        const result = readLabeledValue(lines, cursor, LABEL_ALIASES.color)
        color = result.value
        cursor = result.nextIndex
        continue
      }
      if (isLabeledLine(line, LABEL_ALIASES.height)) {
        const result = readLabeledValue(lines, cursor, LABEL_ALIASES.height)
        height = result.value
        cursor = result.nextIndex
        continue
      }
      if (isLabeledLine(line, LABEL_ALIASES.notes)) {
        const result = readNotes(lines, cursor)
        if (layout === 'legacyTagLocation') {
          farm = result.value || currentCompany
        } else {
          notes = result.value
        }
        cursor = result.nextIndex
        continue
      }
      if (isLabeledLine(line, LABEL_ALIASES.farm)) {
        const result = readLabeledValue(lines, cursor, LABEL_ALIASES.farm)
        farm = result.value || currentCompany
        cursor = result.nextIndex
        continue
      }
      if (isLabeledLine(line, LABEL_ALIASES.tag) || isLabeledLine(line, LABEL_ALIASES.location)) {
        const result = readLabeledValue(lines, cursor, [...LABEL_ALIASES.tag, ...LABEL_ALIASES.location])
        cursor = result.nextIndex
        continue
      }
      cursor += 1
    }

    const key = `${farm.toLowerCase()}|${name.toLowerCase()}`
    if (!seen.has(key)) {
      seen.add(key)
      entries.push({ name, bloom, color, farm, height, notes, seasonYearStart, imageRef })
    }
    i = Math.max(i, cursor - 1)
  }

  return entries
}

export function oneNoteEntryToRecord(entry) {
  const flowerName = toTitleCase(entry.name)
  const color = entry.color ? toTitleCase(entry.color) : undefined
  const source = entry.farm ? toTitleCase(entry.farm) : undefined

  return {
    flowerName,
    gardenLocation: '',
    seasonYearStart: entry.seasonYearStart,
    thumbnailUrl: entry.thumbnailUrl,
    imageUrl: entry.imageUrl,
    core: {
      cultivar: flowerName,
      color,
      size: entry.bloom || undefined,
      notes: entry.notes || undefined,
    },
    growth: {
      height: entry.height || undefined,
    },
    care: {},
    tuber: {
      source,
      acquiredYear: entry.seasonYearStart,
    },
    health: {},
    meta: {
      plantingState: 'purchased_container',
      agentOriginalInput: `OneNote import: Name: ${entry.name}; Height: ${entry.height}; Bloom: ${entry.bloom}; Color: ${entry.color}; Farm: ${entry.farm}; Notes: ${entry.notes}`,
    },
  }
}
