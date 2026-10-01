'use client'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { canonicalReportRows, categoryEvidence } from '@/lib/financial-lineage'
import { withLineIds } from '@/lib/mapping-reviews'
import type { RawRow } from '@/lib/report-data'

export function ReportTrace({ rows, originals, source, company, currency, snapshot }: { rows: RawRow[]; originals: RawRow[]; source: string; company: string; currency: string; snapshot: string }) {
  const [category, setCategory] = useState<string | null>(null)
  const grouped = useMemo(() => Array.from(new Set(rows.map(row => row.MappedCategory))), [rows])
  const evidence = categoryEvidence(rows, category)
  const originalRows = withLineIds(originals)
  const canonical = canonicalReportRows(originalRows, { source, company, currency, snapshot, file: source === 'quickbooks' ? 'quickbooks-report-data.generated.json' : 'report-data-mock.ts' })
  return <Card><CardHeader><CardTitle>Trace report totals to source records</CardTitle></CardHeader><CardContent className="space-y-3">
    <p className="break-all text-xs text-muted-foreground">{company} · {source} · {currency} · Snapshot {snapshot || 'loading'}. Totals use the current filters and saved classifications. Source records are the downloaded/demo bundle, not a live ERP query.</p>
    <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setCategory(null)}>All lines: {categoryEvidence(rows, null).amount.toLocaleString()} {currency}</Button>{grouped.map(name => <Button variant="outline" key={name} onClick={() => setCategory(name)}>{name}: {categoryEvidence(rows, name).amount.toLocaleString()} {currency}</Button>)}</div>
    <p className="text-sm">{category ?? 'All lines'}: {evidence.amount.toLocaleString()} {currency} from {evidence.lines.length} source lines. Category sums are not net profit.</p>
    <div className="max-h-80 overflow-auto">{evidence.lines.map(row => {
      const index = originalRows.findIndex(original => original.LineID === row.LineID), original = originalRows[index]
      return <details key={row.LineID} className="border-t py-2 text-xs"><summary className="cursor-pointer">{row.Date} · {row.AccountName} · {row.Amount} {currency} · {row.LineID}</summary><pre className="max-w-full overflow-auto whitespace-pre-wrap">{JSON.stringify({ provenance: canonical[index], originalSource: original, reviewedLine: row }, null, 2)}</pre></details>
    })}</div>
  </CardContent></Card>
}
