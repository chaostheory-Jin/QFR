'use client'

import type { ReactNode } from 'react'
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { buildCategoryChartData, buildMonthlyChartData, buildConfidenceHistogram, buildSalesByContactChartData, buildSalesMonthlyTrend } from '@/lib/report-utils'
import type { RawRow } from '@/lib/report-data'

const C = { blue: '#4cc9f0', indigo: '#4361ee', pink: '#f72585', teal: '#72efdd', dark: '#2a344d' }

function fmt(v: number | string | readonly (number | string)[] | undefined) {
  if (v === undefined || Array.isArray(v)) return ''
  const n = typeof v === 'string' ? parseFloat(v as string) : (v as number)
  return `$${n.toLocaleString('en-AU', { minimumFractionDigits: 2 })}`
}

function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2 pt-4">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

export function ChartsSection({ rows, topN, incomeCategories, mode = 'all' }: { mode?: 'all' | 'financial' | 'quality'; rows: RawRow[]; topN: number; incomeCategories: string[] }) {
  const top10Data = buildCategoryChartData(rows, Math.min(10, topN))
  const salesMonthlyTrend = buildSalesMonthlyTrend(rows, incomeCategories)
  const allSalesFiltered = rows.length > 0 && rows.every((r) => incomeCategories.includes(r.MappedCategory))
  const salesByContact = allSalesFiltered ? buildSalesByContactChartData(rows, incomeCategories) : []
  const monthlyData = buildMonthlyChartData(rows, incomeCategories)
  const histData = buildConfidenceHistogram(rows)

  const isSingleCategory = top10Data.length === 1
  const singleCatMonthly = isSingleCategory
    ? Array.from(
        rows.reduce((m, r) => {
          const month = r.Date.slice(0, 7)
          m.set(month, (m.get(month) ?? 0) + r.Amount)
          return m
        }, new Map<string, number>()),
      )
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, value]) => ({ month, value }))
    : []

  const totalAmt = rows.reduce((s, r) => s + r.Amount, 0)
  const unmappedAmt = rows.filter((r) => r.MappedCategory === 'Unmapped').reduce((s, r) => s + r.Amount, 0)
  const donutData = [
    { name: 'Mapped', value: Math.abs(totalAmt - unmappedAmt) },
    { name: 'Unmapped', value: Math.abs(unmappedAmt) },
  ]

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
    {mode !== 'financial' && <><ChartCard title="Mapped vs Unmapped">
        <ResponsiveContainer width="100%" height={380}>
          <PieChart>
            <Pie data={donutData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius="45%" outerRadius="70%" label={({ name, percent }: { name?: string; percent?: number }) => `${name ?? ''} ${((percent ?? 0) * 100).toFixed(0)}%`}>
              <Cell fill={C.blue} />
              <Cell fill={C.dark} />
            </Pie>
            <Tooltip formatter={fmt} />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="AI Confidence Distribution">
        <ResponsiveContainer width="100%" height={380}>
          <BarChart data={histData} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="bin" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="count" fill={C.teal} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      </>}
      {mode !== 'quality' && <><ChartCard title={
        isSingleCategory && allSalesFiltered
          ? `Monthly Trend: ${top10Data[0]?.name} — Actual vs Budget`
          : isSingleCategory
          ? `Monthly Trend: ${top10Data[0]?.name}`
          : `Top ${Math.min(10, topN)} Categories`
      }>
        <ResponsiveContainer width="100%" height={380}>
          {isSingleCategory ? (
            <LineChart
              data={(allSalesFiltered ? salesMonthlyTrend : singleCatMonthly) as object[]}
              margin={{ left: 8, right: 8, top: 8, bottom: 30 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 10, angle: -30, textAnchor: 'end' }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={fmt} />
              {allSalesFiltered && <Legend />}
              <Line type="monotone" dataKey={allSalesFiltered ? 'actual' : 'value'} name="Actual" stroke={C.indigo} strokeWidth={2} dot={{ r: 4 }} />
              {allSalesFiltered && (
                <Line type="monotone" dataKey="budget" name="Budget" stroke={C.pink} strokeWidth={2} dot={{ r: 4 }} strokeDasharray="5 5" />
              )}
            </LineChart>
          ) : (
            <BarChart data={top10Data} margin={{ left: 8, right: 8, top: 8, bottom: 60 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10, angle: -25, textAnchor: 'end' }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={fmt} />
              <Bar dataKey="value" fill={C.indigo} radius={[3, 3, 0, 0]} />
            </BarChart>
          )}
        </ResponsiveContainer>
      </ChartCard>
      
      <ChartCard title="Monthly Income vs Expense">
        <ResponsiveContainer width="100%" height={380}>
          <BarChart data={monthlyData} margin={{ left: 8, right: 8, top: 8, bottom: 30 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 10, angle: -30, textAnchor: 'end' }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip formatter={fmt} />
            <Legend />
            <Bar dataKey="income" name="Income" fill={C.blue} radius={[3, 3, 0, 0]} />
            <Bar dataKey="expense" name="Expense" fill={C.pink} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      {allSalesFiltered && salesByContact.length > 0 && (
        <ChartCard title="Sales by Company">
          <ResponsiveContainer width="100%" height={380}>
            <BarChart data={salesByContact} margin={{ left: 8, right: 8, top: 8, bottom: 60 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10, angle: -25, textAnchor: 'end' }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={fmt} />
              <Bar dataKey="actual" name="Sales Amount" fill={C.indigo} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )}
    </>}
    </div>
  )
}
