'use client'

import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { BalanceSheetData } from '@/lib/balance-sheet-mock'
import { liquidityMetrics } from '@/lib/balance-sheet-metrics'

const C = { blue: '#4cc9f0', indigo: '#4361ee', pink: '#f72585', teal: '#72efdd', dark: '#2a344d' }

function fmtCurrency(value: number | string | readonly (number | string)[] | undefined, currency: string) {
  if (value === undefined || Array.isArray(value)) return ''
  const amount = typeof value === 'string' ? Number(value) : value
  return amount.toLocaleString('en-AU', { style: 'currency', currency })
}

function FigureCard({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2 pt-4">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

export function BalanceSheetFigures({ data }: { data: BalanceSheetData }) {
  const fmtAUD = (value: number | string | readonly (number | string)[] | undefined) => fmtCurrency(value, data.currency ?? 'AUD')
  const totals = [
    { name: 'Assets', current: data.assets.total.current, prior: data.assets.total.prior },
    { name: 'Liabilities', current: data.liabilities.total.current, prior: data.liabilities.total.prior },
    { name: 'Equity', current: data.equity.total.current, prior: data.equity.total.prior },
  ]

  const composition = [
    { name: 'Assets', value: Math.abs(data.assets.total.current), color: C.blue },
    { name: 'Liabilities', value: Math.abs(data.liabilities.total.current), color: C.pink },
    { name: 'Equity', value: Math.abs(data.equity.total.current), color: C.indigo },
  ].filter((item) => item.value > 0)

  const liquidity = liquidityMetrics(data)
  const workingCapital = [{
    name: 'Current position',
    assets: liquidity.currentAssets,
    liabilities: -liquidity.currentLiabilities,
    net: liquidity.workingCapital,
  }]

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <FigureCard title="Balance Sheet Totals" description="Current period compared with prior period.">
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={totals} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(value) => `$${Number(value).toLocaleString('en-AU')}`} />
            <Tooltip formatter={fmtAUD} />
            <Bar dataKey="current" name={data.asAt} fill={C.indigo} radius={[3, 3, 0, 0]} />
            <Bar dataKey="prior" name={data.priorPeriod} fill={C.teal} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </FigureCard>

      <FigureCard title="Capital Structure Mix" description="Absolute balance mix for assets, liabilities, and equity.">
        <ResponsiveContainer width="100%" height={320}>
          <PieChart>
            <Pie
              data={composition}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius="45%"
              outerRadius="72%"
              label={({ name, percent }: { name?: string; percent?: number }) => `${name ?? ''} ${((percent ?? 0) * 100).toFixed(0)}%`}
            >
              {composition.map((item) => (
                <Cell key={item.name} fill={item.color} />
              ))}
            </Pie>
            <Tooltip formatter={fmtAUD} />
          </PieChart>
        </ResponsiveContainer>
      </FigureCard>

      <FigureCard title="Working Capital Bridge" description="Current assets minus current liabilities. Liability bars show the deduction.">
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={workingCapital} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(value) => `$${Number(value).toLocaleString('en-AU')}`} />
            <Tooltip formatter={fmtAUD} />
            <Bar dataKey="assets" name="Current Assets" fill={C.blue} radius={[3, 3, 0, 0]} />
            <Bar dataKey="liabilities" name="Current Liabilities" fill={C.pink} radius={[3, 3, 0, 0]} />
            <Bar dataKey="net" name="Net Working Capital" fill={C.dark} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </FigureCard>

      <FigureCard title="Net Position" description="Assets, liabilities, and net assets as reported.">
        <ResponsiveContainer width="100%" height={320}>
          <BarChart
            data={[
              { name: 'Assets', value: data.assets.total.current },
              { name: 'Liabilities', value: data.liabilities.total.current },
              { name: 'Net Assets', value: data.netAssets.current },
            ]}
            margin={{ left: 8, right: 8, top: 8, bottom: 8 }}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(value) => `$${Number(value).toLocaleString('en-AU')}`} />
            <Tooltip formatter={fmtAUD} />
            <Bar dataKey="value" fill={C.indigo} radius={[3, 3, 0, 0]}>
              <Cell fill={data.assets.total.current < 0 ? C.pink : C.blue} />
              <Cell fill={data.liabilities.total.current < 0 ? C.pink : C.teal} />
              <Cell fill={data.netAssets.current < 0 ? C.pink : C.indigo} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </FigureCard>
    </div>
  )
}
