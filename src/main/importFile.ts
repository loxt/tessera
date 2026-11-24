// Reads a spreadsheet the user picked for import: CSV/TSV/TXT through the shared parser, XLSX through
// read-excel-file. Everything comes back as plain cells (dates as ISO text), capped in size and rows.
import { readFile, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import readXlsxFile from 'read-excel-file/node'
import { detectDelimiter, parseDelimited, type ImportCell } from '@shared/importData'

export interface ImportFile {
  fileName: string
  sheets: { name: string; rows: ImportCell[][] }[]
}

const MAX_BYTES = 50 * 1024 * 1024
/** one import is one transaction; past this, split the file */
export const MAX_IMPORT_ROWS = 50_000
/** what an .xlsx may inflate to: a small file can unzip to gigabytes */
const MAX_UNZIPPED = 300 * 1024 * 1024
const MAX_COLUMNS = 1000

const EOCD = 0x06054b50
const CENTRAL = 0x02014b50
const ZIP64 = 0xffffffff

/**
 * Sum of the uncompressed sizes a zip's central directory declares, read without inflating anything.
 * Zip64 archives (entries past 4 GB) are refused outright.
 */
export function zipUncompressedSize(buf: Buffer): number {
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('The file is not a valid .xlsx (zip) file')
  const entries = buf.readUInt16LE(eocd + 10)
  let off = buf.readUInt32LE(eocd + 16)
  if (off === ZIP64 || entries === 0xffff) throw new Error('The workbook is too large to import')
  let total = 0
  for (let n = 0; n < entries; n++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== CENTRAL) throw new Error('The file is not a valid .xlsx (zip) file')
    const size = buf.readUInt32LE(off + 24)
    if (size === ZIP64) throw new Error('The workbook is too large to import')
    total += size
    off += 46 + buf.readUInt16LE(off + 28) + buf.readUInt16LE(off + 30) + buf.readUInt16LE(off + 32)
  }
  return total
}

const cell = (v: unknown): ImportCell => {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().replace('T', ' ').replace(/\.000Z$|Z$/, '')
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return v
  return String(v)
}

function checkRows(name: string, rows: ImportCell[][]): void {
  if (rows.length - 1 > MAX_IMPORT_ROWS) throw new Error(`${name} has ${(rows.length - 1).toLocaleString()} rows; import up to ${MAX_IMPORT_ROWS.toLocaleString()} at a time`)
  if (rows.some((r) => r.length > MAX_COLUMNS)) throw new Error(`${name} has more than ${MAX_COLUMNS} columns`)
}

export async function readImportFile(path: string): Promise<ImportFile> {
  if ((await stat(path)).size > MAX_BYTES) throw new Error('The file is larger than 50 MB')
  const fileName = basename(path)
  if (extname(path).toLowerCase() === '.xlsx') {
    const buf = await readFile(path)
    if (zipUncompressedSize(buf) > MAX_UNZIPPED) throw new Error('The workbook unpacks to more than 300 MB; save the sheet as CSV and import that')
    const sheets = (await readXlsxFile(buf)).map((s) => ({ name: s.sheet, rows: s.data.map((r) => r.map(cell)) }))
    sheets.forEach((s) => checkRows(`${fileName} › ${s.name}`, s.rows))
    return { fileName, sheets }
  }
  const text = await readFile(path, 'utf8')
  const rows = parseDelimited(text, extname(path).toLowerCase() === '.tsv' ? '\t' : detectDelimiter(text))
  checkRows(fileName, rows)
  return { fileName, sheets: [{ name: fileName, rows }] }
}
