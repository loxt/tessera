import { Icon } from '../components/Icon'

/** footer presets, like DataGrip's page-size picker; any other size comes from Settings */
export const PAGE_SIZES = [10, 50, 100, 500, 1000, 5000]

interface Props {
  offset: number
  pageSize: number
  /** rows on the current page */
  rows: number
  hasMore: boolean
  /** from Count; null until counted */
  total: number | null
  /** paging needs a re-run the statement does not allow; the reason shows as the tooltip */
  disabledReason?: string
  onPage: (offset: number) => void
  onPageSize: (size: number) => void
  onCount: () => void
}

/** First / previous / next / last page, "1–10 of N", Count and rows per page: one pager for tables and query results. */
export function Pager({ offset, pageSize, rows, hasMore, total, disabledReason, onPage, onPageSize, onCount }: Props) {
  const off = !!disabledReason
  const lastOffset = total !== null && total > 0 ? Math.floor((total - 1) / pageSize) * pageSize : null
  return (
    <div className="pager" title={disabledReason}>
      <button className="btn icon" title="First page" disabled={off || offset === 0} onClick={() => onPage(0)}>
        <Icon name="first" />
      </button>
      <button className="btn icon" title="Previous page" disabled={off || offset === 0} onClick={() => onPage(Math.max(0, offset - pageSize))}>
        <Icon name="chevronLeft" />
      </button>
      <span className="pager-label">
        {rows ? `${(offset + 1).toLocaleString()}–${(offset + rows).toLocaleString()}` : '0 rows'}
        {total !== null ? ` of ${total.toLocaleString()}` : hasMore ? ' of many' : ''}
      </span>
      <button className="btn icon" title="Next page" disabled={off || !hasMore} onClick={() => onPage(offset + pageSize)}>
        <Icon name="chevronRight" />
      </button>
      <button className="btn icon" title="Last page" disabled={off || lastOffset === null || lastOffset <= offset} onClick={() => lastOffset !== null && onPage(lastOffset)}>
        <Icon name="last" />
      </button>
      <button className="btn" title="Count rows" disabled={off} onClick={onCount}>
        Count
      </button>
      <select className="input" title="Rows per page" aria-label="Rows per page" disabled={off} value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}>
        {[...new Set([...PAGE_SIZES, pageSize])]
          .sort((a, b) => a - b)
          .map((n) => (
            <option key={n} value={n}>
              {n.toLocaleString()} rows
            </option>
          ))}
      </select>
    </div>
  )
}
