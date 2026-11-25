export type TypeKind = 'number' | 'text' | 'bool' | 'date' | 'json' | 'binary' | 'other'

// order matters: "interval" and "point" contain "int", "tinyint(1)" is MySQL's boolean
const KINDS: [TypeKind, RegExp][] = [
  ['bool', /^(bool|boolean|bit(\(1\))?|tinyint\(1\))$/i],
  ['date', /date|time|interval|year/i],
  ['json', /json/i],
  ['binary', /blob|binary|bytea|^bit/i],
  ['other', /point|polygon|geometry|line|circle|box|path/i],
  ['number', /int|numeric|decimal|float|double|real|serial|money|number/i],
  ['text', /char|text|clob|string|uuid|enum|set|citext|xml|name/i]
]

/** Database column type → the icon family shown in the grid header. */
export const typeKind = (type: string): TypeKind => KINDS.find(([, re]) => re.test(type))?.[0] ?? 'other'
