import { AlertTriangle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { BalanceSheetData } from '@/lib/balance-sheet-mock'

function fmtCurrency(value: number, currency: string): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(value)
}

export function SummaryCards({ data }: { data: BalanceSheetData }) {
  const currency = data.currency ?? 'AUD'
  const cards = [
    { label: 'Total Assets',      item: data.assets.total,      warn: data.assets.total.current < 0 },
    { label: 'Total Liabilities', item: data.liabilities.total, warn: false },
    { label: 'Net Assets',        item: data.netAssets,         warn: data.netAssets.current < 0 },
    { label: 'Total Equity',      item: data.equity.total,      warn: data.equity.total.current < 0 },
  ]

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map(({ label, item, warn }) => (
        <Card key={label}>
          <CardHeader className="pb-1 pt-4">
            <CardTitle className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {warn && <AlertTriangle size={12} className="shrink-0 text-amber-500" />}
              {label}
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <p className={cn('break-words text-2xl font-bold', item.current < 0 && 'text-red-600')}>
              {fmtCurrency(item.current, currency)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {item.prior === 0 ? `Opening at ${data.priorPeriod}: zero` : `Prior: ${fmtCurrency(item.prior, currency)}`}
            </p><p className="mt-2 text-xs text-slate-500">Change: {fmtCurrency(item.current - item.prior, currency)}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
