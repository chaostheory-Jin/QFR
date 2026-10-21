import { PortalShell } from '@/components/PortalShell'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <PortalShell>{children}</PortalShell>
}
