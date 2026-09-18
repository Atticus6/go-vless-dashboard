import { useAuthenticate } from '@better-auth-ui/react'
import { Outlet, createFileRoute } from '@tanstack/react-router'
import { AppSidebar } from '@/components/app-sidebar'
import { InvitationBell } from '@/components/invitation-bell'
import { LanguageSwitcher } from '@/components/language-switcher'
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { authClient } from '@/lib/auth-client'

export const Route = createFileRoute('/dashboard')({
  component: DashboardLayout,
})

function DashboardLayout() {
  const { data: session, isPending } = useAuthenticate(authClient)

  if (isPending || !session) {
    return null
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="sticky top-0 z-10 flex shrink-0 items-center gap-2 border-b bg-background px-4 py-2">
          <SidebarTrigger />
          <span className="flex-1" />
          <InvitationBell />
          <LanguageSwitcher />
        </header>
        <main className="mx-auto w-full max-w-5xl space-y-6 p-4 md:p-6">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
