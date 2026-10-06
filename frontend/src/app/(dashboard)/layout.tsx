import { Sidebar } from '@/components/Sidebar'
import { FloatingAssistant } from '@/components/FloatingAssistant'
import { BrowserStorageNotice } from '@/components/BrowserStorageNotice'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="min-w-0 flex-1 overflow-auto bg-background">
        <BrowserStorageNotice />
        {children}
      </main>
      <FloatingAssistant />
    </div>
  )
}
