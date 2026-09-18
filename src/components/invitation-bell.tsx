import { useTranslation } from 'react-i18next'
import { Bell, Check, Inbox, Server, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Spinner } from '@/components/ui/spinner'
import { trpc } from '@/lib/trpc'

export function InvitationBell() {
  const { t } = useTranslation()
  const utils = trpc.useUtils()
  const listQuery = trpc.nodes.myInvitations.useQuery()
  const invitations = listQuery.data?.invitations ?? []
  const invalidate = () => void utils.nodes.invalidate()
  const accept = trpc.nodes.invitationAccept.useMutation({
    onSuccess: invalidate,
  })
  const decline = trpc.nodes.invitationDecline.useMutation({
    onSuccess: invalidate,
  })

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('nodes.invitations')}
            title={t('nodes.invitations')}
          >
            <span className="relative">
              <Bell />
              {invitations.length > 0 && (
                <span className="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground">
                  {invitations.length}
                </span>
              )}
            </span>
          </Button>
        }
      />
      <DropdownMenuContent align="end" sideOffset={8} className="w-80 p-0">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center justify-between px-4 pt-3 pb-2">
          <span>{t('nodes.invitations')}</span>
          {invitations.length > 0 && (
            <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
              {invitations.length}
            </span>
          )}
        </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator className="mx-0" />
        <div className="max-h-80 space-y-2 overflow-y-auto p-2">
          {listQuery.isPending ? (
            <div className="flex items-center justify-center gap-2 px-2 py-6 text-sm text-muted-foreground">
              <Spinner className="size-4" />
              {t('overview.loading')}
            </div>
          ) : invitations.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-2 py-6 text-center">
              <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Inbox className="size-5" />
              </span>
              <p className="text-sm text-muted-foreground">
                {t('nodes.invitationsEmpty')}
              </p>
            </div>
          ) : (
            invitations.map((inv) => {
              const accepting =
                accept.isPending &&
                accept.variables?.invitationId === inv.id
              const declining =
                decline.isPending &&
                decline.variables?.invitationId === inv.id
              const busy = accept.isPending || decline.isPending
              return (
                <div
                  key={inv.id}
                  className="rounded-xl border border-border/60 bg-muted/30 p-3"
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      aria-hidden
                      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary"
                    >
                      {(inv.inviterEmail.charAt(0) || '?').toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {inv.inviterEmail}
                      </p>
                      <p className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="shrink-0">
                          {t('nodes.inviteJoinLabel')}
                        </span>
                        <span className="inline-flex min-w-0 max-w-40 items-center gap-1 rounded-md bg-secondary px-1.5 py-0.5 font-medium text-secondary-foreground">
                          <Server className="size-3 shrink-0" />
                          <span className="truncate">{inv.nodeName}</span>
                        </span>
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void accept.mutateAsync({ invitationId: inv.id })
                      }
                    >
                      {accepting ? (
                        <Spinner className="size-3.5" />
                      ) : (
                        <Check className="size-3.5" />
                      )}
                      {t('nodes.inviteAccept')}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void decline.mutateAsync({ invitationId: inv.id })
                      }
                    >
                      {declining ? (
                        <Spinner className="size-3.5" />
                      ) : (
                        <X className="size-3.5" />
                      )}
                      {t('nodes.inviteDecline')}
                    </Button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
