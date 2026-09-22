import { createFileRoute } from '@tanstack/react-router'
import {
  ChartColumn,
  ChevronDown,
  Copy,
  Link2,
  Pencil,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { QRCodeSVG } from 'qrcode.react'
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
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatNodeName } from '@/lib/country'
import { TableSkeleton } from '@/components/loading-skeletons'
import { TrafficBreakdownDialog } from '@/components/traffic-breakdown-dialog'
import { trpc } from '@/lib/trpc'
import type { RouterOutputs } from '@/lib/trpc'

type NodeUserItem = RouterOutputs['nodes']['nodeUserList']['users'][number]

type PushSync = { synced: string[]; failed: string[]; skipped?: string[] }

// 推送结果拼到 toast 后面：全部成功 / 部分失败 / 离线跳过 / 暂无节点（下次注册自动同步）.
function formatSync(
  sync: PushSync | undefined,
  t: (key: string, opts?: Record<string, string | number>) => string,
): string {
  const synced = sync?.synced ?? []
  const failed = sync?.failed ?? []
  const skipped = sync?.skipped ?? []
  if (synced.length === 0 && failed.length === 0 && skipped.length === 0) {
    return `，${t('nodes.nodeUserNoNodes')}`
  }
  const parts: string[] = []
  if (failed.length === 0) {
    if (synced.length > 0) {
      parts.push(t('nodes.nodeUserPushed', { count: synced.length }))
    }
  } else {
    parts.push(
      t('nodes.nodeUserPushPartial', {
        synced: synced.length,
        failed: failed.length,
        names: failed.join('、'),
      }),
    )
  }
  if (skipped.length > 0) {
    parts.push(
      t('nodes.nodeUserPushSkipped', {
        count: skipped.length,
        names: skipped.join('、'),
      }),
    )
  }
  return `，${parts.join('，')}`
}

export const Route = createFileRoute('/dashboard/node-users')({
  component: NodeUsersPage,
})

// 单个用户的订阅地址弹窗：一个 GET 地址，服务端按格式返回该用户
// 可访问的全部 vless 节点（默认 Clash，?format=vless|base64 可切换）.
function UserSubDialog({
  user,
  onClose,
}: {
  user: NodeUserItem
  onClose: () => void
}) {
  const { t } = useTranslation()
  const url = `${window.location.origin}/api/sub/${user.token}`

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url)
      toast.success(t('nodes.subLinkCopied'))
    } catch {
      toast.error(t('nodes.installCmdCopyFailed'))
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t('nodes.userSubTitle', { name: user.name })}
          </DialogTitle>
          <DialogDescription>{t('nodes.userSubDesc')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="user-sub-url">{t('nodes.userSubUrl')}</Label>
          <div className="flex gap-2">
            <Input
              id="user-sub-url"
              readOnly
              value={url}
              className="font-mono text-xs"
              onFocus={(event) => event.target.select()}
            />
            <Button size="sm" onClick={() => void handleCopy()}>
              {t('nodes.subCopyLink')}
            </Button>
          </div>
        </div>
        <div className="flex flex-col items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {t('nodes.subQrCode')}
          </span>
          <QRCodeSVG value={url} size={192} />
        </div>
        <p className="text-xs text-muted-foreground">
          {t('nodes.userSubUrlHint')}
        </p>
      </DialogContent>
    </Dialog>
  )
}

// 可用节点多选下拉（带搜索）：空数组 = 全部节点（含以后新增的）；
// 勾选后只用于所选节点。创建与编辑共用.
function ScopePicker({
  value,
  nodes,
  onChange,
  idPrefix,
}: {
  value: string[]
  nodes: Array<{ id: string; name: string; countryCode: string | null }>
  onChange: (ids: string[]) => void
  idPrefix: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const all = value.length === 0
  const names = new Map(
    nodes.map((n) => [n.id, formatNodeName(n.name, n.countryCode)] as const),
  )
  const label = all
    ? t('nodes.scopeAll')
    : value.length === 1
      ? (names.get(value[0] ?? '') ?? t('nodes.scopeAll'))
      : t('nodes.scopeSelected', { count: value.length })
  const keyword = query.trim().toLowerCase()
  const filtered =
    keyword === ''
      ? nodes
      : nodes.filter((n) => n.name.toLowerCase().includes(keyword))

  function toggle(id: string, checked: boolean) {
    if (checked) {
      if (!value.includes(id)) onChange([...value, id])
    } else {
      onChange(value.filter((v) => v !== id))
    }
  }

  function row(
    key: string,
    checked: boolean,
    text: string,
    onCheckedChange: (checked: boolean) => void,
  ) {
    return (
      <label
        key={key}
        htmlFor={`${idPrefix}-${key}`}
        className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
      >
        <Checkbox
          id={`${idPrefix}-${key}`}
          checked={checked}
          onCheckedChange={(checked) => onCheckedChange(checked === true)}
        />
        <span className="min-w-0 flex-1 truncate">{text}</span>
      </label>
    )
  }

  return (
    <div className="grid gap-2">
      <span className="text-sm font-medium">{t('nodes.scope')}</span>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) setQuery('')
        }}
      >
        <PopoverTrigger
          render={
            <Button variant="outline" className="w-full justify-between">
              <span className="min-w-0 flex-1 truncate text-left">
                {label}
              </span>
              <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
            </Button>
          }
        />
        <PopoverContent align="start" className="w-64 p-2">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('nodes.scopeSearch')}
          />
          <div className="max-h-56 overflow-y-auto">
            {row(
              'all',
              all,
              t('nodes.scopeAll'),
              (checked) =>
                onChange(checked ? [] : nodes.map((n) => n.id)),
            )}
            <Separator className="my-1" />
            {filtered.map((n) =>
              row(
                n.id,
                value.includes(n.id),
                formatNodeName(n.name, n.countryCode),
                (checked) => toggle(n.id, checked),
              ),
            )}
            {filtered.length === 0 && (
              <p className="px-2 py-1.5 text-sm text-muted-foreground">
                {t('nodes.scopeEmpty')}
              </p>
            )}
          </div>
        </PopoverContent>
      </Popover>
      <p className="text-xs text-muted-foreground">{t('nodes.scopeHint')}</p>
    </div>
  )
}

// 可用节点列展示：徽章换行排列，超过上限收进 +N（title 悬停看全量），
// 避免 join 长串把表格撑出横向滚动；空数组 = 全部节点.
const SCOPE_BADGE_MAX = 3

function ScopeBadges({
  names,
  allLabel,
}: {
  names: string[]
  allLabel: string
}) {
  if (names.length === 0) {
    return <span className="text-sm text-muted-foreground">{allLabel}</span>
  }
  const shown = names.slice(0, SCOPE_BADGE_MAX)
  const rest = names.slice(SCOPE_BADGE_MAX)
  return (
    <span className="flex max-w-80 flex-wrap gap-1">
      {shown.map((name) => (
        <Badge
          key={name}
          variant="secondary"
          title={name}
          className="max-w-44 truncate font-normal"
        >
          {name}
        </Badge>
      ))}
      {rest.length > 0 && (
        <Badge
          variant="outline"
          title={names.join('、')}
          className="font-normal"
        >
          +{rest.length}
        </Badge>
      )}
    </span>
  )
}

function NodeUsersPage() {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [scopeNodeIds, setScopeNodeIds] = useState<string[]>([])
  const [scopeTarget, setScopeTarget] = useState<NodeUserItem | null>(null)
  const [editScopeNodeIds, setEditScopeNodeIds] = useState<string[]>([])
  const [statsTarget, setStatsTarget] = useState<NodeUserItem | null>(null)
  const [subTarget, setSubTarget] = useState<NodeUserItem | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<NodeUserItem | null>(null)
  const [renameTarget, setRenameTarget] = useState<NodeUserItem | null>(null)
  const [renameName, setRenameName] = useState('')
  const [addOpen, setAddOpen] = useState(false)

  const utils = trpc.useUtils()
  const listQuery = trpc.nodes.nodeUserList.useQuery()
  const users = listQuery.data?.users ?? []
  const nodesQuery = trpc.nodes.list.useQuery()
  const scopeNodes = nodesQuery.data?.nodes ?? []
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
  const scopeUser = trpc.nodes.nodeUserScope.useMutation({
    onSuccess: invalidate,
  })
  const renameUser = trpc.nodes.nodeUserRename.useMutation({
    onSuccess: invalidate,
  })

  async function handleCreate(event: FormEvent) {
    event.preventDefault()
    if (name.trim() === '') return
    try {
      const res = await createUser.mutateAsync({
        name: name.trim(),
        nodeIds: scopeNodeIds,
      })
      setName('')
      setScopeNodeIds([])
      setAddOpen(false)
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

  function openScopeEditor(target: NodeUserItem) {
    setScopeTarget(target)
    setEditScopeNodeIds([...target.nodeIds])
  }

  function openRenameEditor(target: NodeUserItem) {
    setRenameTarget(target)
    setRenameName(target.name)
  }

  async function handleRenameSave() {
    if (!renameTarget || renameName.trim() === '') return
    try {
      await renameUser.mutateAsync({
        nodeUserId: renameTarget.id,
        name: renameName.trim(),
      })
      toast.success(t('nodes.nodeUserRenamed'))
      setRenameTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'failed')
    }
  }

  async function handleScopeSave() {
    if (!scopeTarget) return
    try {
      const res = await scopeUser.mutateAsync({
        nodeUserId: scopeTarget.id,
        nodeIds: editScopeNodeIds,
      })
      toast.success(
        `${t('nodes.nodeUserScopeSaved')}${formatSync(res.sync, t)}`,
      )
      setScopeTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'failed')
    }
  }

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t('menu.nodeUsers')}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t('nodes.nodeUsersDesc')}
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)}>{t('nodes.nodeUserAdd')}</Button>
      </div>

      {loading && <TableSkeleton rows={5} cols={4} avatar />}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {!loading && !error && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>{t('nodes.name')}</TableHead>
                  <TableHead>UUID</TableHead>
                  <TableHead>{t('nodes.scope')}</TableHead>
                  <TableHead className="w-32 text-right">
                    {t('nodes.actions')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="text-center text-sm text-muted-foreground"
                    >
                      {t('nodes.nodeUserEmpty')}
                    </TableCell>
                  </TableRow>
                )}
                {users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">
                      <button
                        type="button"
                        title={t('nodes.nodeUserRename')}
                        onClick={() => openRenameEditor(u)}
                        className="underline-offset-4 hover:underline"
                      >
                        {u.name}
                      </button>
                    </TableCell>
                    <TableCell className="font-mono text-xs break-all">
                      {u.token}
                    </TableCell>
                    <TableCell>
                      <ScopeBadges
                        names={u.nodeNames}
                        allLabel={t('nodes.scopeAll')}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          title={t('nodes.analyticsByNode')}
                          aria-label={t('nodes.analyticsByNode')}
                          onClick={() => setStatsTarget(u)}
                        >
                          <ChartColumn />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          title={t('nodes.nodeUserScopeTitle')}
                          aria-label={t('nodes.nodeUserScopeTitle')}
                          onClick={() => openScopeEditor(u)}
                        >
                          <Pencil />
                        </Button>
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
                          title={t('nodes.userSubCopy')}
                          aria-label={t('nodes.userSubCopy')}
                          onClick={() => setSubTarget(u)}
                        >
                          <Link2 />
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

      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          if (!open) {
            setAddOpen(false)
            setName('')
            setScopeNodeIds([])
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('nodes.nodeUserAdd')}</DialogTitle>
            <DialogDescription>{t('nodes.nodeUsersDesc')}</DialogDescription>
          </DialogHeader>
          <form className="space-y-3" onSubmit={handleCreate}>
            <div className="grid gap-2">
              <Label htmlFor="node-user-name">{t('nodes.name')}</Label>
              <Input
                id="node-user-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t('nodes.nodeUserNamePlaceholder')}
                required
                maxLength={64}
              />
            </div>
            <ScopePicker
              value={scopeNodeIds}
              nodes={scopeNodes}
              onChange={setScopeNodeIds}
              idPrefix="node-user-scope"
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setAddOpen(false)}
              >
                {t('nodes.cancel')}
              </Button>
              <Button
                type="submit"
                disabled={createUser.isPending || name.trim() === ''}
              >
                {t('nodes.nodeUserAdd')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={scopeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setScopeTarget(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t('nodes.nodeUserScopeTitle', {
                name: scopeTarget?.name ?? '',
              })}
            </DialogTitle>
          </DialogHeader>
          <ScopePicker
            value={editScopeNodeIds}
            nodes={scopeNodes}
            onChange={setEditScopeNodeIds}
            idPrefix="node-user-scope-edit"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setScopeTarget(null)}>
              {t('nodes.cancel')}
            </Button>
            <Button
              disabled={scopeUser.isPending}
              onClick={() => void handleScopeSave()}
            >
              {t('nodes.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('nodes.nodeUserRename')}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="node-user-rename">{t('nodes.name')}</Label>
            <Input
              id="node-user-rename"
              value={renameName}
              onChange={(event) => setRenameName(event.target.value)}
              placeholder={t('nodes.nodeUserNamePlaceholder')}
              required
              maxLength={64}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>
              {t('nodes.cancel')}
            </Button>
            <Button
              disabled={renameUser.isPending || renameName.trim() === ''}
              onClick={() => void handleRenameSave()}
            >
              {t('nodes.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {subTarget && (
        <UserSubDialog user={subTarget} onClose={() => setSubTarget(null)} />
      )}

      {statsTarget && (
        <TrafficBreakdownDialog
          open
          onClose={() => setStatsTarget(null)}
          title={statsTarget.name}
          description={t('nodes.analyticsByNodeDesc')}
          mode="node"
          nodeUserId={statsTarget.id}
        />
      )}

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
