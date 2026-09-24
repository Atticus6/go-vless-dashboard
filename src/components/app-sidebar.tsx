import { Link, useLocation } from '@tanstack/react-router'
import {
  Activity,
  Network,
  Server,
  Settings,
  SlidersHorizontal,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { UserButton } from '@/components/auth/user/user-button'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from '@/components/ui/sidebar'

type MenuItem =
  | { to: '/dashboard/nodes'; label: 'menu.nodes'; icon: LucideIcon }
  | { to: '/dashboard/node-users'; label: 'menu.nodeUsers'; icon: LucideIcon }
  | { to: '/dashboard/traffic'; label: 'menu.traffic'; icon: LucideIcon }
  | { to: '/dashboard/config'; label: 'menu.config'; icon: LucideIcon }
  | {
      to: '/dashboard/settings/$path'
      params: { path: string }
      match: '/dashboard/settings'
      label: 'menu.settings'
      icon: LucideIcon
    }

const manageItems: MenuItem[] = [
  { to: '/dashboard/nodes', label: 'menu.nodes', icon: Server },
  { to: '/dashboard/node-users', label: 'menu.nodeUsers', icon: Users },
  { to: '/dashboard/traffic', label: 'menu.traffic', icon: Activity },
]

const systemItems: MenuItem[] = [
  { to: '/dashboard/config', label: 'menu.config', icon: SlidersHorizontal },
  {
    to: '/dashboard/settings/$path',
    params: { path: 'account' },
    match: '/dashboard/settings',
    label: 'menu.settings',
    icon: Settings,
  },
]

function MenuGroupItems({ items }: { items: MenuItem[] }) {
  const { t } = useTranslation()
  const { pathname } = useLocation()

  return (
    <SidebarMenu className="gap-1">
      {items.map((item) => {
        const match = 'match' in item ? item.match : item.to
        const active = pathname.startsWith(match)
        const label = t(item.label)
        const Icon = item.icon
        return (
          <SidebarMenuItem key={item.to}>
            <SidebarMenuButton
              size="lg"
              isActive={active}
              tooltip={label}
              render={
                <Link
                  to={item.to}
                  params={'params' in item ? item.params : undefined}
                >
                  <span className="grid size-7 shrink-0 place-items-center rounded-md border border-sidebar-border/60 bg-sidebar-accent/50 text-sidebar-foreground/70 transition-colors group-hover/menu-button:border-sidebar-border group-data-[active=true]/menu-button:border-transparent group-data-[active=true]/menu-button:bg-primary group-data-[active=true]/menu-button:text-primary-foreground group-data-[active=true]/menu-button:shadow-xs">
                    <Icon className="size-4" />
                  </span>
                  <span className="font-normal group-data-[active=true]/menu-button:font-medium">
                    {label}
                  </span>
                </Link>
              }
            />
          </SidebarMenuItem>
        )
      })}
    </SidebarMenu>
  )
}

export function AppSidebar() {
  const { t } = useTranslation()

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-2.5 px-2 pt-2 pb-1">
          <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-linear-to-br from-primary to-primary/55 text-primary-foreground shadow-xs">
            <Network className="size-4" />
          </div>
          <div className="grid min-w-0 flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
            <span className="truncate text-sm font-semibold tracking-tight">
              {t('app.title')}
            </span>
            <span className="truncate text-[11px] text-sidebar-foreground/60">
              {t('menu.subtitle')}
            </span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{t('menu.manage')}</SidebarGroupLabel>
          <SidebarGroupContent>
            <MenuGroupItems items={manageItems} />
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>{t('menu.system')}</SidebarGroupLabel>
          <SidebarGroupContent>
            <MenuGroupItems items={systemItems} />
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarSeparator className="mx-0" />
        <UserButton className="h-auto w-full rounded-lg border border-sidebar-border/70 bg-sidebar-accent/30 px-2.5 py-2 hover:border-sidebar-border hover:bg-sidebar-accent" />
      </SidebarFooter>
    </Sidebar>
  )
}
