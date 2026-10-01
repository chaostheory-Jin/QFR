'use client'

import { useRef, useState, useEffect } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent } from '@/components/ui/card'
import type { FilterState } from '@/lib/report-utils'

type Props = {
  filters: FilterState
  allTypes: string[]
  allAccounts: string[]
  onChange: (f: FilterState) => void
  onReset: () => void
}

function AccountDropdown({
  filters,
  allAccounts,
  onChange,
}: {
  filters: FilterState
  allAccounts: string[]
  onChange: (f: FilterState) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function toggleAccount(account: string) {
    const next = new Set(filters.selectedAccounts)
    if (next.has(account)) { next.delete(account) } else { next.add(account) }
    onChange({ ...filters, selectedAccounts: next })
  }

  const count = filters.selectedAccounts.size
  const label = count === 0 ? 'All accounts' : `${count} selected`

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm hover:bg-muted transition-colors"
      >
        <span>{label}</span>
        <ChevronDown className="size-3.5 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-20 min-w-48 rounded-lg border bg-popover shadow-md p-1.5 flex flex-col gap-0.5 max-h-52 overflow-y-auto">
          {allAccounts.map((account) => (
            <label
              key={account}
              className="flex items-center gap-2 text-sm px-2 py-1 rounded hover:bg-muted cursor-pointer"
            >
              <Checkbox
                checked={filters.selectedAccounts.has(account)}
                onCheckedChange={() => toggleAccount(account)}
              />
              {account}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

export function FilterPanel({ filters, allTypes, allAccounts, onChange, onReset }: Props) {
  function set(partial: Partial<FilterState>) {
    onChange({ ...filters, ...partial })
  }

  function toggleType(type: string) {
    if (filters.selectedTypes.size === 0) {
      set({ selectedTypes: new Set(allTypes.filter((t) => t !== type)) })
    } else {
      const next = new Set(filters.selectedTypes)
      if (next.has(type)) { next.delete(type) } else { next.add(type) }
      set({ selectedTypes: next })
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-wrap items-end gap-4 pt-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="start-date" className="text-xs text-muted-foreground">Start date</Label>
          <input id="start-date" type="date" title="Start date" value={filters.startDate} onChange={(e) => set({ startDate: e.target.value })} className="h-8 w-36 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="end-date" className="text-xs text-muted-foreground">End date</Label>
          <input id="end-date" type="date" title="End date" value={filters.endDate} onChange={(e) => set({ endDate: e.target.value })} className="h-8 w-36 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="search" className="text-xs text-muted-foreground">Search</Label>
          <Input id="search" type="text" placeholder="Contact / description / category" value={filters.search} onChange={(e) => set({ search: e.target.value })} className="w-56" />
        </div>
        <div className="flex flex-col gap-2 min-w-[140px]">
          <Label className="text-xs text-muted-foreground">
            Top N: <span className="font-semibold text-foreground">{filters.topN}</span>
          </Label>
          <Slider min={5} max={25} step={1} value={[filters.topN]} onValueChange={(v) => set({ topN: Array.isArray(v) ? (v as number[])[0] : (v as number) })} className="w-32" />
        </div>
        <div className="flex flex-col gap-2">
          <Label className="text-xs text-muted-foreground">Type filter</Label>
          <div className="flex flex-wrap gap-2">
            {allTypes.map((type) => (
              <label key={type} className="flex items-center gap-1.5 text-sm cursor-pointer">
                <Checkbox
                  checked={filters.selectedTypes.size === 0 || filters.selectedTypes.has(type)}
                  onCheckedChange={() => toggleType(type)}
                />
                {type}
              </label>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label className="text-xs text-muted-foreground">Account filter</Label>
          <AccountDropdown filters={filters} allAccounts={allAccounts} onChange={onChange} />
        </div>
        <div className="flex flex-col gap-2">
          <Label className="text-xs text-muted-foreground">Quick filters</Label>
          <div className="flex gap-3">
            <label className="flex items-center gap-1.5 text-sm cursor-pointer">
              <Checkbox checked={filters.onlyUnmapped} onCheckedChange={(c) => set({ onlyUnmapped: !!c })} />
              Unmapped only
            </label>
            <label className="flex items-center gap-1.5 text-sm cursor-pointer">
              <Checkbox checked={filters.onlyLowConf} onCheckedChange={(c) => set({ onlyLowConf: !!c })} />
              Review required
            </label>
          </div>
        </div>
        <div className="ml-auto">
          <Button variant="outline" onClick={onReset}>Reset</Button>
        </div>
      </CardContent>
    </Card>
  )
}
