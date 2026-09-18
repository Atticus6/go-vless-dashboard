import { Link, useLocation } from '@tanstack/react-router'
import { Server, Settings, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { UserButton } from '@/components/auth/user/user-button'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'

const menuKeys = [
  { to: '/dashboard/nodes', label: 'menu.nodes', icon: Server },
  { to: '/dashboard/node-users', label: 'menu.nodeUsers', icon: Users },
  {
    to: '/dashboard/settings/$path',
    params: { path: 'account' },
    match: '/dashboard/settings',
    label: 'menu.settings',
    icon: Settings,
  },
] as const

export function AppSidebar() {
  const { t } = useTranslation()
  const { pathname } = useLocation()

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="px-2 py-1 text-sm font-semibold tracking-tight">
          {t('app.title')}
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarMenu className="gap-1">
          {menuKeys.map((item) => {
            const match = 'match' in item ? item.match : item.to
            const active = pathname.startsWith(match)
            return (
              <SidebarMenuItem key={item.to}>
                <SidebarMenuButton
                  size="lg"
                  isActive={active}
                  render={
                    <Link
                      to={item.to}
                      params={'params' in item ? item.params : undefined}
                    >
                      <item.icon />
                      <span>{t(item.label)}</span>
                    </Link>
                  }
                />
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarContent>
      <SidebarFooter>
        <UserButton />
      </SidebarFooter>
    </Sidebar>
  )
}
