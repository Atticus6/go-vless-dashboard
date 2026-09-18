import { createFileRoute } from '@tanstack/react-router'
import { Copy, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { trpc } from '@/lib/trpc'
import type { RouterOutputs } from '@/lib/trpc'

type NodeUserItem = RouterOutputs['nodes']['nodeUserList']['users'][number]

type PushSync = { synced: string[]; failed: string[] }

// 推送结果拼到 toast 后面：全部成功 / 部分失败 / 暂无节点（下次注册自动同步）.
function formatSync(
  sync: PushSync | undefined,
  t: (key: string, opts?: Record<string, string | number>) => string,
): string {
  if (!sync || (sync.synced.length === 0 && sync.failed.length === 0)) {
    return `，${t('nodes.nodeUserNoNodes')}`
  }
  if (sync.failed.length === 0) {
    return `，${t('nodes.nodeUserPushed', { count: sync.synced.length })}`
  }
  return `，${t('nodes.nodeUserPushPartial', {
    synced: sync.synced.length,
    failed: sync.failed.length,
    names: sync.failed.join('、'),
  })}`
}

export const Route = createFileRoute('/dashboard/node-users')({
  component: NodeUsersPage,
})

function NodeUsersPage() {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<NodeUserItem | null>(null)

  const utils = trpc.useUtils()
  const listQuery = trpc.nodes.nodeUserList.useQuery()
  const users = listQuery.data?.users ?? []
  const loading = listQuery.isPending
  const error =
    listQuery.isError && listQuery.error instanceof Error
      ? listQuery.error.message
      : null
  const invalidate = () => void utils.nodes.nodeUserList.invalidate()
  const createUser = trpc.nodes.nodeUserCreate.useMutation({
    onSuccess: invalidate,
  })
  const removeUser = trpc.nodes.nodeUserRemove.useMutation({
    onSuccess: invalidate,
  })

  async function handleCreate(event: FormEvent) {
    event.preventDefault()
    if (name.trim() === '') return
    try {
      const res = await createUser.mutateAsync({ name: name.trim() })
      setName('')
      toast.success(
        `${t('nodes.nodeUserAdded')}${formatSync(res.sync, t)}`,
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'failed')
    }
  }

  async function handleCopy(token: string) {
    try {
      await navigator.clipboard.writeText(token)
      toast.success(t('nodes.tokenCopied'))
    } catch {
      toast.error(t('nodes.installCmdCopyFailed'))
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      const res = await removeUser.mutateAsync({ nodeUserId: deleteTarget.id })
      toast.success(
        `${t('nodes.nodeUserRemoved')}${formatSync(res.sync, t)}`,
      )
      setDeleteTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'failed')
    }
  }

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t('menu.nodeUsers')}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t('nodes.nodeUsersDesc')}
        </p>
      </div>

      {loading && (
        <p className="text-sm text-muted-foreground">{t('overview.loading')}</p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {!loading && !error && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>{t('nodes.name')}</TableHead>
                  <TableHead>UUID</TableHead>
                  <TableHead className="w-32 text-right">
                    {t('nodes.actions')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={3}
                      className="text-center text-sm text-muted-foreground"
                    >
                      {t('nodes.nodeUserEmpty')}
                    </TableCell>
                  </TableRow>
                )}
                {users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.name}</TableCell>
                    <TableCell className="font-mono text-xs break-all">
                      {u.token}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          title={t('nodes.copyToken')}
                          onClick={() => void handleCopy(u.token)}
                        >
                          <Copy />
                          {t('nodes.copyToken')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          title={t('nodes.delete')}
                          aria-label={t('nodes.delete')}
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => setDeleteTarget(u)}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('nodes.nodeUserAdd')}</CardTitle>
          <CardDescription>{t('nodes.nodeUsersDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex gap-2" onSubmit={handleCreate}>
            <div className="grid flex-1 gap-2">
              <Label htmlFor="node-user-name" className="sr-only">
                {t('nodes.name')}
              </Label>
              <Input
                id="node-user-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t('nodes.nodeUserNamePlaceholder')}
                required
                maxLength={64}
              />
            </div>
            <Button
              type="submit"
              disabled={createUser.isPending || name.trim() === ''}
            >
              {t('nodes.nodeUserAdd')}
            </Button>
          </form>
        </CardContent>
      </Card>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('nodes.nodeUserDeleteTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('nodes.nodeUserDeleteDesc', {
                name: deleteTarget?.name ?? '',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('nodes.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void handleDelete()
              }}
            >
              {t('nodes.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
