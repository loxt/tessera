import type { languages } from 'monaco-editor'

// Monarch tokenizer shared by the three SQL dialects. Monaco's stock SQL grammars paint almost
// everything as "keyword" or "identifier"; this one tells apart what a reader scans for:
// keywords, types, functions, table names, bind parameters, constants, strings and casts.
// Token names map to theme colors in ../theme.ts.

export type SqlDialect = 'pgsql' | 'mysql' | 'sql'

type Rule = languages.IMonarchLanguageRule

const words = (s: string) => s.trim().split(/\s+/)

const KEYWORDS = words(`
  add after all alter analyze and any array as asc begin between both by cascade case check collate column commit
  concurrently constraint create cross cube current cursor database deallocate declare default deferrable delete desc
  distinct do drop each else end except exclude execute exists explain extension fetch filter first following for
  foreign from full function grant group grouping having if ilike immediate in index inherits initially inner insert
  instead intersect interval into is isnull join key language last lateral leading left like limit local lock
  materialized natural next no not nothing notnull nowait of off offset on only or order outer over overlaps owner
  partition placing preceding primary procedure range recursive references refresh release rename repeatable replace
  restrict return returning returns revoke right rollback rollup row rows rule savepoint schema select sequence session
  set sets show similar skip some start statement table tablespace temp temporary then ties to trailing transaction
  trigger truncate unbounded union unique unlogged until update using vacuum values verbose view volatile when where
  window with within without work
  engine auto_increment unsigned zerofill straight_join ignore duplicate describe use databases tables
  pragma glob regexp autoincrement conflict abort fail rowid strict
`)

const TYPES = words(`
  bigint bigserial bit bool boolean box bytea char character cidr circle date daterange decimal double float float4
  float8 inet int int2 int4 int8 int4range int8range integer json jsonb line lseg macaddr money name numeric numrange
  oid path point polygon precision real regclass serial serial2 serial4 serial8 smallint smallserial text time
  timestamp timestamptz timetz tsquery tsrange tstzrange tsvector uuid varbit varchar varying xml zone
  tinyint mediumint longtext mediumtext tinytext blob longblob mediumblob tinyblob datetime year enum binary varbinary
  nchar nvarchar clob
`)

const FUNCTIONS = words(`
  abs age array_agg array_length avg bool_and bool_or btrim cast ceil ceiling char_length coalesce concat concat_ws count
  date_part date_trunc dense_rank encode decode every exp extract first_value floor format generate_series greatest
  group_concat ifnull initcap json_agg json_build_object jsonb_agg jsonb_build_object jsonb_set jsonb_array_elements
  lag last_value lead least length ln log lower lpad ltrim max md5 min mod now ntile nullif nth_value percent_rank
  position power random rank regexp_replace regexp_matches repeat replace reverse round row_number rpad rtrim sign split_part
  sqrt string_agg strpos substr substring sum to_char to_date to_number to_timestamp trim trunc unnest upper
  date_format datediff str_to_date if instr gen_random_uuid pg_sleep pg_cancel_backend
  pg_terminate_backend pg_size_pretty pg_total_relation_size julianday strftime datetime printf typeof total
`)

const CONSTANTS = words(`
  null true false unknown current_date current_time current_timestamp current_user session_user localtime localtimestamp
`)

/** words after which the next name is a table */
const TABLE_INTRO = words('from join into update table references truncate')
/** words that may sit between TABLE_INTRO and the table name */
const TABLE_PREFIX = words('only if not exists lateral ignore low_priority')

export function sqlLanguage(dialect: SqlDialect): languages.IMonarchLanguage {
  const pg = dialect === 'pgsql'
  const my = dialect === 'mysql'
  const when = (cond: boolean, rules: Rule[]): Rule[] => (cond ? rules : [])

  const root: Rule[] = [
    { include: '@comments' },
    [/\s+/, 'white'],
    // casts: ::type
    [/(::)(\s*)([a-zA-Z_]\w*)/, ['operator', 'white', 'type']],
    // bind parameters
    [/:[a-zA-Z_]\w*/, 'variable'],
    [/\$\d+/, 'variable'],
    [/\?/, 'variable'],
    ...when(my, [[/@@?[a-zA-Z_][\w.]*/, 'variable']]),
    // strings
    ...when(pg, [
      [/\$\$/, { token: 'string.dollar', next: '@dollarPlain' }],
      [/\$([a-zA-Z_]\w*)\$/, { token: 'string.dollar', next: '@dollarTag.$1' }]
    ]),
    [/[eE]'/, { token: 'string', next: '@stringBackslash' }],
    [/'/, { token: 'string', next: my ? '@stringBackslash' : '@string' }],
    my ? [/"/, { token: 'string', next: '@dqString' }] : [/"/, { token: 'identifier.quote', next: '@quoted' }],
    [/`/, { token: 'identifier.quote', next: '@backtick' }],
    // numbers
    [/0[xX][0-9a-fA-F]+/, 'number'],
    [/(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/, 'number'],
    // alias.column: the part after a dot is a name even when it is a reserved word (o.order, s.group)
    [/(\.)([a-zA-Z_][\w$]*)(?![\w$]|\s*\()/, ['delimiter', 'identifier']],
    // a name followed by "(" is a call (or a sized type such as varchar(100))
    [
      /[a-zA-Z_][\w$]*(?=\s*\()/,
      {
        cases: {
          '@types': 'type',
          '@functions': 'predefined',
          '@tableIntro': { token: 'keyword', next: '@tableName' },
          '@keywords': 'keyword',
          '@default': 'function'
        }
      }
    ],
    [
      /[a-zA-Z_][\w$]*/,
      {
        cases: {
          '@tableIntro': { token: 'keyword', next: '@tableName' },
          '@constants': 'constant',
          '@types': 'type',
          '@keywords': 'keyword',
          '@default': 'identifier'
        }
      }
    ],
    [/[()[\]]/, '@brackets'],
    [/[;,.]/, 'delimiter'],
    [/->>?|#>>?|#-|@>|<@|\?\||\?&|\|\||<>|!=|<=|>=|<<|>>|[=<>+\-*/%~^&|!]/, 'operator']
  ]

  return {
    defaultToken: '',
    ignoreCase: true,
    tokenPostfix: '',
    keywords: KEYWORDS,
    types: TYPES,
    functions: FUNCTIONS,
    constants: CONSTANTS,
    tableIntro: TABLE_INTRO,
    tablePrefix: TABLE_PREFIX,
    brackets: [
      { open: '(', close: ')', token: 'delimiter.parenthesis' },
      { open: '[', close: ']', token: 'delimiter.square' }
    ],
    tokenizer: {
      root,
      comments: [
        [/--.*$/, 'comment'],
        ...when(my, [[/#.*$/, 'comment']]),
        [/\/\*/, { token: 'comment', next: '@blockComment' }]
      ],
      blockComment: [
        [/[^*/]+/, 'comment'],
        [/\*\//, { token: 'comment', next: '@pop' }],
        [/[*/]/, 'comment']
      ],
      string: [
        [/[^']+/, 'string'],
        [/''/, 'string.escape'],
        [/'/, { token: 'string', next: '@pop' }]
      ],
      stringBackslash: [
        [/[^'\\]+/, 'string'],
        [/\\./, 'string.escape'],
        [/''/, 'string.escape'],
        [/'/, { token: 'string', next: '@pop' }]
      ],
      dqString: [
        [/[^"\\]+/, 'string'],
        [/\\./, 'string.escape'],
        [/""/, 'string.escape'],
        [/"/, { token: 'string', next: '@pop' }]
      ],
      // $$ … $$ and $tag$ … $tag$ (function bodies, DO blocks): the closing tag must match the opening one
      dollarPlain: [
        [/\$\$/, { token: 'string.dollar', next: '@pop' }],
        [/[^$]+/, 'string.dollar'],
        [/\$/, 'string.dollar']
      ],
      dollarTag: [
        [/\$([a-zA-Z_]\w*)\$/, { cases: { '$1==$S2': { token: 'string.dollar', next: '@pop' }, '@default': 'string.dollar' } }],
        [/[^$]+/, 'string.dollar'],
        [/\$/, 'string.dollar']
      ],
      quoted: [
        [/[^"]+/, 'identifier.quote'],
        [/""/, 'identifier.quote'],
        [/"/, { token: 'identifier.quote', next: '@pop' }]
      ],
      backtick: [
        [/[^`]+/, 'identifier.quote'],
        [/``/, 'identifier.quote'],
        [/`/, { token: 'identifier.quote', next: '@pop' }]
      ],
      // after FROM / JOIN / INTO …: [schema.]table, quoted or not
      tableName: [
        [/\s+/, 'white'],
        { include: '@comments' },
        [/"(?:[^"]|"")*"|`[^`]*`/, { token: 'table', switchTo: '@tableDot' }],
        [
          /[a-zA-Z_][\w$]*/,
          {
            cases: {
              '@tablePrefix': 'keyword',
              '@keywords': { token: 'keyword', next: '@pop' },
              '@functions': { token: '@rematch', next: '@pop' },
              '@default': { token: 'table', switchTo: '@tableDot' }
            }
          }
        ],
        [/./, { token: '@rematch', next: '@pop' }]
      ],
      tableDot: [
        [/\./, { token: 'delimiter', switchTo: '@tableAfterDot' }],
        [/./, { token: '@rematch', next: '@pop' }]
      ],
      // after "schema." any word is a name, even a reserved one (supplier.group)
      tableAfterDot: [
        [/"(?:[^"]|"")*"|`[^`]*`|[a-zA-Z_][\w$]*/, { token: 'table', switchTo: '@tableDot' }],
        [/./, { token: '@rematch', next: '@pop' }]
      ]
    }
  }
}
