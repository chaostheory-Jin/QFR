import { Activity, BarChart3, Info } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { BalanceSheetData } from '@/lib/balance-sheet-mock'
import { cn } from '@/lib/utils'
import { liquidityMetrics } from '@/lib/balance-sheet-metrics'

function fmtCurrency(value: number, currency: string): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(value)
}

function fmtRatio(value: number | null, suffix = 'x'): string {
  if (value === null || !Number.isFinite(value)) return 'n/a'
  return `${value.toFixed(2)}${suffix}`
}

function pct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'n/a'
  return `${value.toFixed(1)}%`
}

function divide(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null
  return numerator / denominator
}

function Indicator({ tone }: { tone: 'good' | 'watch' | 'risk' }) {
  return (
    <span
      className={cn(
        'inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
        tone === 'good' && 'bg-emerald-50 text-emerald-700',
        tone === 'watch' && 'bg-blue-50 text-blue-700',
        tone === 'risk' && 'bg-amber-50 text-amber-700',
      )}
    >
      {tone === 'good' ? 'Healthy' : tone === 'watch' ? 'Watch' : 'Review'}
    </span>
  )
}

export function FinancialAnalysisTables({ data }: { data: BalanceSheetData }) {
  const fmtAUD = (value: number) => fmtCurrency(value, data.currency ?? 'AUD')
  const totalAssets = data.assets.total.current
  const totalLiabilities = data.liabilities.total.current
  const totalEquity = data.equity.total.current
  const { workingCapital, currentRatio } = liquidityMetrics(data)

  const ratios = [
    {
      metric: 'Current Ratio',
      value: fmtRatio(currentRatio),
      benchmark: '> 1.00x',
      comment: 'Measures short-term asset coverage over current liabilities.',
      tone: currentRatio === null ? 'watch' : currentRatio >= 1 ? 'good' : 'risk',
    },
    {
      metric: 'Working Capital',
      value: fmtAUD(workingCapital),
      benchmark: 'Positive preferred',
      comment: 'Current assets minus current liabilities; fixed assets and long-term debt are excluded.',
      tone: workingCapital >= 0 ? 'good' : 'risk',
    },
    {
      metric: 'Debt to Assets',
      value: pct(totalAssets > 0 ? totalLiabilities / totalAssets * 100 : null),
      benchmark: 'Lower is safer',
      comment: 'Shows how much of the asset base is funded by liabilities.',
      tone: Math.abs(totalLiabilities) <= Math.abs(totalAssets) * 0.6 ? 'good' : 'watch',
    },
    {
      metric: 'Liabilities to Equity',
      value: fmtRatio(totalEquity > 0 ? totalLiabilities / totalEquity : null),
      benchmark: '< 1.00x',
      comment: 'Highlights leverage against equity. Negative equity should be reviewed.',
      tone: totalEquity >= 0 && Math.abs(totalLiabilities) <= totalEquity ? 'good' : 'risk',
    },
  ] as const

  const composition = [
    { section: 'Assets', amount: totalAssets, share: divide(Math.abs(totalAssets), Math.abs(totalAssets)) },
    { section: 'Liabilities', amount: totalLiabilities, share: divide(Math.abs(totalLiabilities), Math.abs(totalAssets)) },
    { section: 'Equity', amount: totalEquity, share: divide(Math.abs(totalEquity), Math.abs(totalAssets)) },
  ]

  const movements = [
    { label: 'Total Assets', current: data.assets.total.current, prior: data.assets.total.prior },
    { label: 'Total Liabilities', current: data.liabilities.total.current, prior: data.liabilities.total.prior },
    { label: 'Net Assets', current: data.netAssets.current, prior: data.netAssets.prior },
    { label: 'Total Equity', current: data.equity.total.current, prior: data.equity.total.prior },
  ].map((row) => ({
    ...row,
    change: row.current - row.prior,
    changePct: row.prior === 0 ? null : ((row.current - row.prior) / Math.abs(row.prior)) * 100,
  }))

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <Activity className="size-4 text-blue-700" />
            Liquidity & Leverage Ratios
          </CardTitle>
          <CardDescription>Common finance checks calculated from the balance sheet.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead>Metric</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead>Benchmark</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ratios.map((row) => (
                <TableRow key={row.metric}>
                  <TableCell>
                    <div className="font-medium">{row.metric}</div>
                    <div className="text-xs text-muted-foreground">{row.comment}</div>
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{row.value}</TableCell>
                  <TableCell className="text-muted-foreground">{row.benchmark}</TableCell>
                  <TableCell>
                    <Indicator tone={row.tone} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <BarChart3 className="size-4 text-blue-700" />
            Balance Composition
          </CardTitle>
          <CardDescription>Common-size view using total assets as the base.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead>Section</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">% of Assets</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {composition.map((row) => (
                <TableRow key={row.section}>
                  <TableCell className="font-medium">{row.section}</TableCell>
                  <TableCell className={cn('text-right tabular-nums', row.amount < 0 && 'text-red-600')}>
                    {fmtAUD(row.amount)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {pct(row.share === null ? null : row.share * 100)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="mt-3 flex gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            Liabilities use credit-positive balances. Ratios use current sections only; negative equity requires review.
          </div>
        </CardContent>
      </Card>

      <Card className="xl:col-span-2">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Period Movement</CardTitle>
          <CardDescription>Movement analysis across the main balance sheet totals.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead>Line</TableHead>
                <TableHead className="text-right">{data.asAt}</TableHead>
                <TableHead className="text-right">{data.priorPeriod}</TableHead>
                <TableHead className="text-right">Change</TableHead>
                <TableHead className="text-right">Change %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {movements.map((row) => (
                <TableRow key={row.label}>
                  <TableCell className="font-medium">{row.label}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtAUD(row.current)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtAUD(row.prior)}</TableCell>
                  <TableCell className={cn('text-right tabular-nums', row.change < 0 ? 'text-red-600' : 'text-green-600')}>
                    {fmtAUD(row.change)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{pct(row.changePct)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
