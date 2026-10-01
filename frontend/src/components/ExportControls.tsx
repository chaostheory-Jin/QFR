'use client'

import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'

export type ExportMode = 'summary' | 'byLine'

export function ExportControls({
  mode,
  onModeChange,
  onExport,
  disabled = false,
}: {
  mode: ExportMode
  onModeChange: (mode: ExportMode) => void
  onExport: () => void
  disabled?: boolean
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={mode}
        onChange={(event) => onModeChange(event.target.value as ExportMode)}
        className="h-8 rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        aria-label="Export type"
      >
        <option value="summary">Summary</option>
        <option value="byLine">By line</option>
      </select>
      <Button type="button" size="sm" variant="outline" onClick={onExport} disabled={disabled}>
        <Download className="size-3.5" />
        Export Excel
      </Button>
    </div>
  )
}
