import type { ReportSource } from '@/lib/report-source'
import { DATA_SOURCE_LABELS } from '@/lib/report-source'

type Props = {
  value: ReportSource
  onChange: (source: ReportSource) => void
}

export function DataSourceSelect({ value, onChange }: Props) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-white px-3 py-2 shadow-sm">
      <label htmlFor="report-data-source" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Data source
      </label>
      <select
        id="report-data-source"
        value={value}
        onChange={(event) => onChange(event.target.value as ReportSource)}
        className="h-8 min-w-36 rounded-md border border-input bg-background px-2 text-sm font-medium outline-none focus:ring-2 focus:ring-blue-200"
      >
        {(Object.keys(DATA_SOURCE_LABELS) as ReportSource[]).map((source) => (
          <option key={source} value={source}>{DATA_SOURCE_LABELS[source]}</option>
        ))}
      </select>
    </div>
  )
}
