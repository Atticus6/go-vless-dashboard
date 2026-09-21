import { createFileRoute } from '@tanstack/react-router'
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Activity,
  ChevronDown,
  Copy,
  GripVertical,
  Pencil,
  QrCode,
  Server,
  Terminal,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useId, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { formatNodeName } from '@/lib/country'
import type { FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { QRCodeSVG } from 'qrcode.react'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Spinner } from '@/components/ui/spinner'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { BackendStatus, NodeItem } from '@/lib/nodes'
import { trpc } from '@/lib/trpc'
import {
  buildVlessLink,
  hostnameOf,
  type VlessNetwork,
  type VlessSecurity,
} from '@/lib/vless'
import type { RouterOutputs } from '@/lib/trpc'

type InstallKind = keyof RouterOutputs['nodes']['installCommand']['commands']

type NodeDialogKind =
  | 'test'
  | 'install'
  | 'copyVless'
  | 'edit'
  | 'delete'

export const Route = createFileRoute('/dashboard/nodes')({
  component: NodesPage,
})

function NodesPage() {
  const { t } = useTranslation()
  const listQuery = trpc.nodes.list.useQuery()
  const nodes = listQuery.data?.nodes ?? []
  const loading = listQuery.isPending
  const error =
    listQuery.isError && listQuery.error instanceof Error
      ? listQuery.error.message
      : null
  const [addOpen, setAddOpen] = useState(false)
  const [active, setActive] = useState<{
    kind: NodeDialogKind
    item: NodeItem
  } | null>(null)

  const utils = trpc.useUtils()
  const createNode = trpc.nodes.create.useMutation({
    onSuccess: () => void utils.nodes.invalidate(),
  })
  // 拖拽传感器：指针拖动手柄，键盘方向键移动（无障碍）.
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )
  // 排序落库：乐观更新先排好，失败回滚并提示（多端并发下旧顺序会被拒）.
  const reorderNodes = trpc.nodes.reorder.useMutation({
    onMutate: async (input) => {
      await utils.nodes.list.cancel()
      const prev = utils.nodes.list.getData()
      utils.nodes.list.setData(undefined, (old) => {
        if (!old) return old
        const byId = new Map(old.nodes.map((n) => [n.id, n] as const))
        return {
          ...old,
          nodes: input.ids.flatMap((id) => {
            const item = byId.get(id)
            return item ? [item] : []
          }),
        }
      })
      return { prev }
    },
    onError: (err, _input, context) => {
      if (context?.prev) utils.nodes.list.setData(undefined, context.prev)
      toast.error(err instanceof Error ? err.message : 'failed')
    },
    onSettled: () => void utils.nodes.list.invalidate(),
  })

  // 拖拽结束：按新位置重排后落库（原地释放不处理）.
  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (over === null || active.id === over.id) return
    const ids = nodes.map((n) => n.id)
    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    if (from < 0 || to < 0) return
    void reorderNodes.mutateAsync({ ids: arrayMove(ids, from, to) })
  }

  function open(kind: NodeDialogKind, item: NodeItem) {
    setActive({ kind, item })
  }

  function close(kind: NodeDialogKind) {
    setActive((prev) => (prev?.kind === kind ? null : prev))
  }

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t('nodes.title')}
          </h1>
          <p className="text-sm text-muted-foreground">{t('nodes.desc')}</p>
        </div>
        <Button onClick={() => setAddOpen(true)}>{t('nodes.add')}</Button>
      </div>

      {loading && (
        <p className="text-sm text-muted-foreground">{t('overview.loading')}</p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {!loading && !error && nodes.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('nodes.empty')}</CardTitle>
            <CardDescription>{t('nodes.emptyDesc')}</CardDescription>
          </CardHeader>
        </Card>
      )}

      {nodes.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-10">
                    <span className="sr-only">{t('nodes.sort')}</span>
                  </TableHead>
                  <TableHead>{t('nodes.name')}</TableHead>
                  <TableHead className="w-44">{t('nodes.status')}</TableHead>
                  <TableHead className="w-32 text-right">
                    {t('nodes.actions')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* restrictToVerticalAxis：只允许上下拖，禁止左右跑. */}
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  modifiers={[restrictToVerticalAxis]}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext
                    items={nodes.map((n) => n.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    {nodes.map((item) => (
                      <NodeTableRow
                        key={item.id}
                        item={item}
                        onOpen={open}
                      />
                    ))}
                  </SortableContext>
                </DndContext>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <NodeAddDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onSubmit={async (name) => {
          await createNode.mutateAsync({ name })
          toast.success(t('nodes.added'))
          setAddOpen(false)
        }}
      />

      <TestDialog
        item={active?.kind === 'test' ? active.item : null}
        onClose={() => close('test')}
      />
      <InstallDialog
        item={active?.kind === 'install' ? active.item : null}
        onClose={() => close('install')}
      />
      <CopyVlessDialog
        item={active?.kind === 'copyVless' ? active.item : null}
        onClose={() => close('copyVless')}
      />
      <EditDialog
        item={active?.kind === 'edit' ? active.item : null}
        onClose={() => close('edit')}
      />
      <DeleteDialog
        item={active?.kind === 'delete' ? active.item : null}
        onClose={() => close('delete')}
      />
    </section>
  )
}

// 可排序的节点行：transform 做位移动画，拖拽手柄独占 listeners，
// 行内按钮不受影响；拖拽中提升层级并半透明.
function NodeTableRow({
  item,
  onOpen,
}: {
  item: NodeItem
  onOpen: (kind: NodeDialogKind, item: NodeItem) => void
}) {
  const { t } = useTranslation()
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id })

  return (
    <TableRow
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={isDragging ? 'relative z-10 opacity-80 shadow-lg' : undefined}
    >
      <TableCell>
        <span
          {...attributes}
          {...listeners}
          tabIndex={0}
          title={t('nodes.sort')}
          aria-label={t('nodes.sort')}
          className="flex cursor-grab touch-none items-center text-muted-foreground outline-none focus-visible:text-foreground active:cursor-grabbing"
        >
          <GripVertical className="size-4" />
        </span>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Server className="size-4" />
          </span>
                        <div className="min-w-0">
                          <span className="truncate font-medium">
                            {formatNodeName(item.name, item.countryCode)}
                          </span>
            <p className="mt-0.5 max-w-70 truncate font-mono text-xs text-muted-foreground">
              {item.baseUrl ?? t('nodes.notConfigured')}
            </p>
          </div>
        </div>
      </TableCell>
      <TableCell>
        {item.online ? (
          <Badge variant="outline" className="gap-1.5">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            {t('nodes.online')}
          </Badge>
        ) : item.lastSeenAt ? (
          <Badge variant="outline" className="text-muted-foreground">
            {t('nodes.offline')}
          </Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            {item.baseUrl ? '-' : t('nodes.notConfigured')}
          </Badge>
        )}
      </TableCell>
      <TableCell className="text-right">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="outline" size="sm">
                {t('nodes.actions')}
                <ChevronDown />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onOpen('test', item)}>
              <Activity className="text-muted-foreground" />
              {t('nodes.connectivity')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onOpen('install', item)}>
              <Terminal className="text-muted-foreground" />
              {t('nodes.installCommands')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onOpen('copyVless', item)}>
              <Copy className="text-muted-foreground" />
              {t('nodes.copySubscription')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onOpen('edit', item)}>
              <Pencil className="text-muted-foreground" />
              {t('nodes.edit')}
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onClick={() => onOpen('delete', item)}
            >
              <Trash2 />
              {t('nodes.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  )
}

function NodeAddDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (name: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [formError, setFormError] = useState('')
  const [pending, setPending] = useState(false)

  function handleOpenChange(next: boolean) {
    if (!next) {
      setName('')
      setFormError('')
    }
    onOpenChange(next)
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setFormError('')
    setPending(true)
    try {
      await onSubmit(name)
      setName('')
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'failed')
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('nodes.addTitle')}</DialogTitle>
          <DialogDescription>{t('nodes.formDescAdd')}</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="grid gap-2">
            <Label htmlFor="node-name">{t('nodes.name')}</Label>
            <Input
              id="node-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('nodes.namePlaceholder')}
              required
              maxLength={64}
            />
          </div>
          {formError && (
            <p className="text-sm text-destructive">{formError}</p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? t('nodes.saving') : t('nodes.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function TestDialog({
  item,
  onClose,
}: {
  item: NodeItem | null
  onClose: () => void
}) {
  const { t } = useTranslation()

  return (
    <Dialog
      open={item !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('nodes.connectivity')}</DialogTitle>
          <DialogDescription>
              {item ? formatNodeName(item.name, item.countryCode) : ''}
            </DialogDescription>
        </DialogHeader>
        {item && <TestBody key={item.id} nodeId={item.id} />}
      </DialogContent>
    </Dialog>
  )
}

function TestBody({ nodeId }: { nodeId: string }) {
  const { t } = useTranslation()
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(
    null,
  )
  const testNode = trpc.nodes.test.useMutation()

  async function run() {
    setTesting(true)
    try {
      const data = await testNode.mutateAsync({ id: nodeId })
      setResult(
        data.ok === true
          ? {
              ok: true,
              text: `${'latencyMs' in data ? (data.latencyMs ?? 0) : 0}ms`,
            }
          : {
              ok: false,
              text:
                'error' in data && typeof data.error === 'string'
                  ? data.error
                  : 'failed',
            },
      )
    } catch (err) {
      setResult({
        ok: false,
        text: err instanceof Error ? err.message : 'failed',
      })
    } finally {
      setTesting(false)
    }
  }

  // 打开即测一次
  useEffect(() => {
    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={testing}
          onClick={() => void run()}
        >
          {testing && <Spinner className="size-3.5" />}
          {testing ? t('nodes.testing') : t('nodes.test')}
        </Button>
        {!testing &&
          result &&
          (result.ok ? (
            <Badge variant="outline" className="gap-1.5">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              {result.text}
            </Badge>
          ) : (
            <Badge variant="destructive">{result.text}</Badge>
          ))}
      </div>
      <RegisterSyncInfo nodeId={nodeId} />
    </div>
  )
}

// 节点端 /config 的 register 段：服务端（dashboard）注册/同步状态.
// 老版本后端没有该段时不展示.
function RegisterSyncInfo({ nodeId }: { nodeId: string }) {
  const { t } = useTranslation()
  const statusQuery = trpc.nodes.status.useQuery({ id: nodeId })

  if (statusQuery.isPending) {
    return (
      <p className="text-sm text-muted-foreground">{t('overview.loading')}</p>
    )
  }
  if (statusQuery.isError) {
    return (
      <p className="text-sm text-destructive">
        {statusQuery.error.message}
      </p>
    )
  }
  const data = statusQuery.data
  if (!data) return null
  return (
    <>
      {data.register && <RegisterSyncDetail reg={data.register} />}
      <TLSCertDetail tls={data.tls} />
      <NodeInfoDetail data={data} />
    </>
  )
}

function RegisterSyncDetail({
  reg,
}: {
  reg: NonNullable<BackendStatus['register']>
}) {
  const { t } = useTranslation()
  const connected = reg.enabled && !reg.lastError && !!reg.lastSuccessAt
  const failed = reg.enabled && !!reg.lastError

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{t('nodes.regTitle')}</span>
        {!reg.enabled ? (
          <Badge variant="outline" className="text-muted-foreground">
            {t('nodes.regDisabled')}
          </Badge>
        ) : failed ? (
          <Badge variant="destructive">{t('nodes.regFailed')}</Badge>
        ) : connected ? (
          <Badge variant="outline" className="gap-1.5">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            {t('nodes.regConnected')}
          </Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            {t('nodes.regPending')}
          </Badge>
        )}
      </div>
      {reg.enabled && (
        <dl className="space-y-1 text-xs">
          {reg.dashboardUrl && (
            <div className="flex gap-2">
              <dt className="shrink-0 text-muted-foreground">
                {t('nodes.regDashboardUrl')}
              </dt>
              <dd
                className="min-w-0 flex-1 break-all font-mono"
                title={reg.dashboardUrl}
              >
                {reg.dashboardUrl}
              </dd>
            </div>
          )}
          {reg.nodeId && (
            <div className="flex gap-2">
              <dt className="shrink-0 text-muted-foreground">
                {t('nodes.regNodeId')}
              </dt>
              <dd
                className="min-w-0 flex-1 break-all font-mono"
                title={reg.nodeId}
              >
                {reg.nodeId}
              </dd>
            </div>
          )}
          <div className="flex gap-2">
            <dt className="shrink-0 text-muted-foreground">
              {t('nodes.regLastSync')}
            </dt>
            <dd className="flex-1">
              {reg.lastSuccessAt
                ? new Date(reg.lastSuccessAt).toLocaleString()
                : t('nodes.regNever')}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="shrink-0 text-muted-foreground">
              {t('nodes.regNextSyncLabel')}
            </dt>
            <dd className="flex-1">
              {t('nodes.regNextSyncValue', {
                count: Math.max(1, Math.ceil((reg.nextSyncInSec ?? 0) / 60)),
              })}
            </dd>
          </div>
          {reg.syncedUsers !== undefined && (
            <div className="flex gap-2">
              <dt className="shrink-0 text-muted-foreground">
                {t('nodes.regSyncedUsersLabel')}
              </dt>
              <dd className="flex-1">
                {t('nodes.regSyncedUsersValue', {
                  count: reg.syncedUsers,
                })}{' '}
                <span className="text-muted-foreground">
                  {t('nodes.regLastChange', {
                    added: reg.lastSyncAdded ?? 0,
                    removed: reg.lastSyncRemoved ?? 0,
                  })}
                </span>
              </dd>
            </div>
          )}
          {reg.lastError && (
            <div className="flex gap-2">
              <dt className="shrink-0 text-muted-foreground">
                {t('nodes.regLastError')}
              </dt>
              <dd className="min-w-0 flex-1 break-all text-destructive">
                {reg.lastError}
              </dd>
            </div>
          )}
        </dl>
      )}
    </div>
  )
}

// 节点端 /config 的 tls 段：HTTPS 证书状态（域名、到期时间、剩余天数）。
// 老版本后端无该段时不展示；已启用但尚无证书（等待首次握手）提示等待。
function TLSCertDetail({ tls }: { tls: BackendStatus['tls'] }) {
  const { t } = useTranslation()
  if (!tls) return null
  const daysLeft = tls.daysLeft ?? Number.POSITIVE_INFINITY
  const expired = tls.enabled && daysLeft < 0
  const expiring = tls.enabled && !expired && daysLeft < 30

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{t('nodes.tlsTitle')}</span>
        {!tls.enabled ? (
          <Badge variant="outline" className="text-muted-foreground">
            {t('nodes.tlsDisabled')}
          </Badge>
        ) : expired ? (
          <Badge variant="destructive">{t('nodes.tlsExpired')}</Badge>
        ) : (
          <Badge variant="outline" className="gap-1.5">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            {t('nodes.tlsEnabled')}
          </Badge>
        )}
      </div>
      {tls.enabled && (
        <dl className="space-y-1 text-xs">
          {tls.domain && (
            <div className="flex gap-2">
              <dt className="shrink-0 text-muted-foreground">
                {t('nodes.tlsDomain')}
              </dt>
              <dd
                className="min-w-0 flex-1 break-all font-mono"
                title={tls.domain}
              >
                {tls.domain}
              </dd>
            </div>
          )}
          <div className="flex gap-2">
            <dt className="shrink-0 text-muted-foreground">
              {t('nodes.tlsExpires')}
            </dt>
            <dd className="flex-1">
              {tls.expiresAt
                ? new Date(tls.expiresAt).toLocaleString()
                : t('nodes.tlsNoCert')}
            </dd>
          </div>
          {tls.expiresAt && tls.daysLeft !== undefined && (
            <div className="flex gap-2">
              <dt className="shrink-0 text-muted-foreground">
                {t('nodes.tlsDaysLeftLabel')}
              </dt>
              <dd className="flex-1">
                {t('nodes.tlsDaysLeftValue', { count: tls.daysLeft })}
                {(expired || expiring) && (
                  <span className="text-destructive">
                    {' '}
                    {expired ? t('nodes.tlsExpired') : t('nodes.tlsExpiring')}
                  </span>
                )}
              </dd>
            </div>
          )}
        </dl>
      )}
    </div>
  )
}

// 节点端 /config 的其余字段：可用地址、出口 IP、用户流量、运行状态。
function NodeInfoDetail({ data }: { data: BackendStatus }) {
  const { t } = useTranslation()
  const userEntries = Object.entries(data.users ?? {})
  const egress =
    data.ipv6 && data.egressIPv6 && data.egressIPv6 !== 'unknown'
      ? `${data.egressIPv4} / ${data.egressIPv6}`
      : data.egressIPv4

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{t('nodes.nodeInfoTitle')}</span>
        <Badge variant="outline" className="text-muted-foreground">
          {t('nodes.nodeInfoUsers', { count: userEntries.length })}
        </Badge>
      </div>
      <dl className="space-y-1 text-xs">
        {data.urls.length > 0 && (
          <div className="flex gap-2">
            <dt className="shrink-0 text-muted-foreground">
              {t('nodes.nodeInfoUrls')}
            </dt>
            <dd className="min-w-0 flex-1 break-all font-mono">
              {data.urls.map((u) => (
                <p key={u} title={u}>
                  {u}
                </p>
              ))}
            </dd>
          </div>
        )}
        <div className="flex gap-2">
          <dt className="shrink-0 text-muted-foreground">
            {t('nodes.nodeInfoEgress')}
          </dt>
          <dd className="min-w-0 flex-1 break-all font-mono">{egress}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0 text-muted-foreground">
            {t('nodes.nodeInfoUptime')}
          </dt>
          <dd className="flex-1">{data.uptime}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0 text-muted-foreground">
            {t('nodes.nodeInfoMemory')}
          </dt>
          <dd
            className="flex-1"
            title={`alloc ${data.memory.alloc} / sys ${data.memory.sys}`}
          >
            {data.memory.rss}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0 text-muted-foreground">
            {t('nodes.nodeInfoBuild')}
          </dt>
          <dd className="flex-1">
            {data.binarySize} · {new Date(data.buildTime).toLocaleString()}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0 text-muted-foreground">
            {t('nodes.nodeInfoTunnel')}
          </dt>
          <dd className="min-w-0 flex-1 break-all font-mono">
            {data.tunnel && data.tunnelURL ? (
              <span title={data.tunnelURL}>{data.tunnelURL}</span>
            ) : (
              <span className="font-sans text-muted-foreground">
                {t('nodes.nodeInfoTunnelOff')}
              </span>
            )}
          </dd>
        </div>
      </dl>
      {userEntries.length > 0 ? (
        <ul className="space-y-0.5 border-t pt-2 font-mono text-xs">
          {userEntries.map(([uuid, traffic]) => (
            <li
              key={uuid}
              className="flex items-baseline justify-between gap-2"
              title={uuid}
            >
              <span className="min-w-0 flex-1 truncate">
                {uuid.slice(0, 8)}…
              </span>
              <span className="shrink-0 text-muted-foreground">
                ↑{traffic.up} ↓{traffic.down}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="border-t pt-2 text-xs text-muted-foreground">
          {t('nodes.nodeInfoNoUsers')}
        </p>
      )}
    </div>
  )
}

function InstallDialog({
  item,
  onClose,
}: {
  item: NodeItem | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const installCmd = trpc.nodes.installCommand.useMutation()

  // 后端安装命令（含 服务端地址:节点id:config_key）：点击复制 = 明示查看 key。
  async function handleCopyInstall(kind: InstallKind) {
    if (!item) return
    try {
      const { commands } = await installCmd.mutateAsync({ id: item.id })
      await navigator.clipboard.writeText(commands[kind])
      toast.success(t('nodes.installCmdCopied'))
    } catch {
      toast.error(t('nodes.installCmdCopyFailed'))
    }
  }

  // 三元组原文（服务端地址:节点id:config_key），供 --register / REGISTER 手填。
  async function handleCopyTriple() {
    if (!item) return
    try {
      const { triple } = await installCmd.mutateAsync({ id: item.id })
      await navigator.clipboard.writeText(triple)
      toast.success(t('nodes.tripleCopied'))
    } catch {
      toast.error(t('nodes.installCmdCopyFailed'))
    }
  }

  const kinds: Array<[InstallKind, string]> = [
    ['auto', t('nodes.installAuto')],
    ['binary', t('nodes.installBinary')],
    ['docker', t('nodes.installDocker')],
    ['dev', t('nodes.installDev')],
    ['devPwsh', t('nodes.installDevPwsh')],
  ]

  return (
    <Dialog
      open={item !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('nodes.installCommands')}</DialogTitle>
          <DialogDescription>
              {item ? formatNodeName(item.name, item.countryCode) : ''}
            </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Button
            variant="outline"
            className="justify-start"
            disabled={installCmd.isPending}
            onClick={() => void handleCopyTriple()}
          >
            <Copy className="text-muted-foreground" />
            {t('nodes.tripleCopy')}
          </Button>
          <p className="text-xs text-muted-foreground">
            {t('nodes.tripleDesc')}
          </p>
          {kinds.map(([kind, label]) => (
            <Button
              key={kind}
              variant="outline"
              className="justify-start"
              disabled={installCmd.isPending}
              onClick={() => void handleCopyInstall(kind)}
            >
              <Copy className="text-muted-foreground" />
              {label}
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function CopyVlessDialog({
  item,
  onClose,
}: {
  item: NodeItem | null
  onClose: () => void
}) {
  const { t } = useTranslation()

  return (
    <Dialog
      open={item !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('nodes.copySubscription')}</DialogTitle>
          <DialogDescription>
              {item ? formatNodeName(item.name, item.countryCode) : ''}
            </DialogDescription>
        </DialogHeader>
        {item && <CopyVlessBody key={item.id} item={item} />}
      </DialogContent>
    </Dialog>
  )
}

function CopyVlessBody({ item }: { item: NodeItem }) {
  const { t } = useTranslation()
  // UUID 取当前用户的节点用户（token 即订阅链接的 uuid），
  // 只列出本节点范围内的（无关联=全部节点，有关联须含本节点）.
  const listQuery = trpc.nodes.nodeUserList.useQuery()
  const nodeUsers = (listQuery.data?.users ?? []).filter(
    (u) => u.nodeIds.length === 0 || u.nodeIds.includes(item.id),
  )
  const [nodeUserId, setNodeUserId] = useState('')
  const selected = nodeUsers.find((u) => u.id === nodeUserId) ?? null
  const token = selected?.token ?? ''

  // 单用户时自动选中。
  useEffect(() => {
    if (!nodeUserId && nodeUsers.length === 1 && nodeUsers[0]) {
      setNodeUserId(nodeUsers[0].id)
    }
  }, [nodeUserId, nodeUsers])
  const hosts = useMemo(() => {
    const out: string[] = []
    for (const raw of [...item.reportedUrls, item.reportedTunnelUrl ?? '']) {
      const host = hostnameOf(raw)
      if (host && !out.includes(host)) out.push(host)
    }
    return out
  }, [item])

  const [manualAddress, setManualAddress] = useState('')
  const [qrTarget, setQrTarget] = useState<{
    host: string
    link: string
  } | null>(null)

  // 有上报地址就每个出一项；一个都没上报（离线/未注册）时可用手动地址补一项。
  const effectiveHosts =
    hosts.length > 0
      ? hosts
      : manualAddress.trim()
        ? [manualAddress.trim()]
        : []

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-2">
        <Label htmlFor="vless-user">{t('nodes.subUuid')}</Label>
        {listQuery.isPending ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="size-3.5" />
            {t('overview.loading')}
          </p>
        ) : nodeUsers.length > 0 ? (
          <>
            <Select
              value={nodeUserId}
              items={nodeUsers.map((u) => ({ value: u.id, label: u.name }))}
              onValueChange={(value) => setNodeUserId(value ?? '')}
            >
              <SelectTrigger id="vless-user" className="w-full">
                <SelectValue placeholder={t('nodes.subUuid')} />
              </SelectTrigger>
              <SelectContent>
                {nodeUsers.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selected && (
              <p className="font-mono text-xs break-all text-muted-foreground">
                {selected.token}
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t('nodes.subNoUsers')}
          </p>
        )}
      </div>

      {hosts.length === 0 && (
        <div className="grid gap-2">
          <Label htmlFor="vless-manual">{t('nodes.subHost')}</Label>
          <Input
            id="vless-manual"
            value={manualAddress}
            onChange={(event) => setManualAddress(event.target.value)}
            placeholder="example.com"
          />
        </div>
      )}

      {selected && effectiveHosts.length > 0 ? (
        <Accordion defaultValue={[effectiveHosts[0] ?? '']}>
          {effectiveHosts.map((host, index) => (
            <AccordionItem key={host} value={host}>
              <AccordionTrigger>
                <span className="truncate font-mono text-xs">{host}</span>
              </AccordionTrigger>
              <AccordionContent>
                <VlessDetail
                  nodeId={item.id}
                  nodeUserId={selected.id}
                  host={host}
                  token={token}
                  defaultRemark={
                    // 与订阅备注同格式：旗帜前缀 + 名，多地址缀序号.
                    effectiveHosts.length > 1
                      ? `${formatNodeName(item.name, item.countryCode)}-${index + 1}`
                      : formatNodeName(item.name, item.countryCode)
                  }
                  onShowQr={(link) => setQrTarget({ host, link })}
                />
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      ) : (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed py-8 text-muted-foreground">
          <QrCode className="size-8" />
          <p className="px-4 text-center text-xs">
            {t('nodes.subIncomplete')}
          </p>
        </div>
      )}

      <QrDialog target={qrTarget} onClose={() => setQrTarget(null)} />
    </div>
  )
}

function VlessDetail({
  nodeId,
  nodeUserId,
  host,
  token,
  defaultRemark,
  onShowQr,
}: {
  nodeId: string
  nodeUserId: string
  host: string
  token: string
  defaultRemark: string
  onShowQr: (link: string) => void
}) {
  const { t } = useTranslation()
  const uid = useId()
  const [port, setPort] = useState('443')
  const [security, setSecurity] = useState<VlessSecurity>('tls')
  const [network, setNetwork] = useState<VlessNetwork>('ws')
  const [path, setPath] = useState('/')
  const [hostHeader, setHostHeader] = useState('')
  const [fp, setFp] = useState('chrome')
  const [sni, setSni] = useState('')
  const [remark, setRemark] = useState(defaultRemark)

  const ensure = trpc.nodes.nodeUserEnsure.useMutation()

  // HOST / SNI 为空时跟随本地址。
  const resolvedHost = hostHeader.trim() || host
  const resolvedSni = sni.trim() || host
  const ready = port.trim() !== ''
  const link = ready
    ? buildVlessLink({
        uuid: token,
        address: host,
        port: port.trim(),
        security,
        network,
        path,
        host: resolvedHost,
        fp,
        sni: resolvedSni,
        remark: remark.trim() || defaultRemark,
      })
    : ''

  async function handleCopy() {
    if (!link) return
    try {
      // 先把 token 同步到该节点后端（幂等），再复制。
      await ensure.mutateAsync({ id: nodeId, nodeUserId })
      await navigator.clipboard.writeText(link)
      toast.success(t('nodes.subLinkCopied'))
    } catch {
      toast.error(t('nodes.installCmdCopyFailed'))
    }
  }

  async function handleShowQr() {
    if (!link) return
    try {
      await ensure.mutateAsync({ id: nodeId, nodeUserId })
      onShowQr(link)
    } catch {
      toast.error(t('nodes.installCmdCopyFailed'))
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-2">
          <Label htmlFor={`${uid}-port`}>{t('nodes.subPort')}</Label>
          <Input
            id={`${uid}-port`}
            value={port}
            onChange={(event) => setPort(event.target.value)}
            placeholder="443"
            inputMode="numeric"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${uid}-fp`}>{t('nodes.subFp')}</Label>
          <Select
            value={fp}
            onValueChange={(value) => setFp(value ?? 'chrome')}
          >
            <SelectTrigger
              id={`${uid}-fp`}
              className="w-full font-mono text-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="chrome">chrome</SelectItem>
              <SelectItem value="firefox">firefox</SelectItem>
              <SelectItem value="safari">safari</SelectItem>
              <SelectItem value="edge">edge</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-2">
          <Label htmlFor={`${uid}-security`}>
            {t('nodes.subSecurity')}
          </Label>
          <Select
            value={security}
            onValueChange={(value) =>
              setSecurity(value as VlessSecurity)
            }
          >
            <SelectTrigger id={`${uid}-security`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tls">tls</SelectItem>
              <SelectItem value="none">none</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${uid}-network`}>
            {t('nodes.subNetwork')}
          </Label>
          <Select
            value={network}
            onValueChange={(value) => setNetwork(value as VlessNetwork)}
          >
            <SelectTrigger id={`${uid}-network`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ws">ws</SelectItem>
              <SelectItem value="tcp">tcp</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {network === 'ws' && (
        <div className="grid gap-2">
          <Label htmlFor={`${uid}-path`}>{t('nodes.subPath')}</Label>
          <Input
            id={`${uid}-path`}
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder="/"
            className="font-mono text-xs"
          />
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-2">
          <Label htmlFor={`${uid}-wshost`}>
            {t('nodes.subHostHeader')}
          </Label>
          <Input
            id={`${uid}-wshost`}
            value={hostHeader}
            onChange={(event) => setHostHeader(event.target.value)}
            placeholder={host}
            className="font-mono text-xs"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${uid}-sni`}>{t('nodes.subSni')}</Label>
          <Input
            id={`${uid}-sni`}
            value={sni}
            onChange={(event) => setSni(event.target.value)}
            placeholder={host}
            className="font-mono text-xs"
          />
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${uid}-remark`}>{t('nodes.subRemark')}</Label>
        <Input
          id={`${uid}-remark`}
          value={remark}
          onChange={(event) => setRemark(event.target.value)}
          maxLength={64}
        />
      </div>
      {link && (
        <p className="rounded-lg bg-muted p-2.5 font-mono text-xs break-all">
          {link}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={!ready || ensure.isPending}
          onClick={() => void handleCopy()}
          className="flex-1"
        >
          {(ensure.isPending) && <Spinner className="size-3.5" />}
          <Copy />
          {t('nodes.subCopyLink')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!ready || ensure.isPending}
          onClick={() => void handleShowQr()}
          className="flex-1"
        >
          <QrCode />
          {t('nodes.subQrCode')}
        </Button>
      </div>
    </div>
  )
}

function QrDialog({
  target,
  onClose,
}: {
  target: { host: string; link: string } | null
  onClose: () => void
}) {
  const { t } = useTranslation()

  // Esc 关闭（灯箱直挂 body，不经过 Dialog 嵌套）。
  useEffect(() => {
    if (!target) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [target, onClose])

  async function handleCopy() {
    if (!target) return
    try {
      await navigator.clipboard.writeText(target.link)
      toast.success(t('nodes.subLinkCopied'))
    } catch {
      toast.error(t('nodes.installCmdCopyFailed'))
    }
  }

  if (!target) return null

  // 轻量灯箱：flex 居中保证位置，无灰色遮罩层，点击空白处关闭。
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={target.host}
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
    >
      <button
        aria-label={t('nodes.cancel')}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-transparent"
      />
      <div className="relative flex w-full max-w-xs flex-col items-center gap-4 rounded-xl bg-popover p-6 text-popover-foreground ring-1 ring-foreground/10">
        <button
          aria-label={t('nodes.cancel')}
          onClick={onClose}
          className="absolute top-2 right-2 flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
        >
          <X className="size-4" />
        </button>
        <p className="w-full truncate text-center font-mono text-sm">
          {target.host}
        </p>
        <div className="rounded-xl bg-white p-4">
          <QRCodeSVG value={target.link} size={256} level="M" />
        </div>
        <Button onClick={() => void handleCopy()} className="w-full">
          <Copy />
          {t('nodes.subCopyLink')}
        </Button>
      </div>
    </div>,
    document.body,
  )
}

function EditDialog({
  item,
  onClose,
}: {
  item: NodeItem | null
  onClose: () => void
}) {
  const { t } = useTranslation()

  return (
    <Dialog
      open={item !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('nodes.editTitle')}</DialogTitle>
          <DialogDescription>{t('nodes.formDesc')}</DialogDescription>
        </DialogHeader>
        {item && <EditForm key={item.id} item={item} onSaved={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

function EditForm({
  item,
  onSaved,
}: {
  item: NodeItem
  onSaved: () => void
}) {
  const { t } = useTranslation()
  const utils = trpc.useUtils()
  const [name, setName] = useState(item.name)
  const [baseUrl, setBaseUrl] = useState(item.baseUrl ?? '')
  const [configKey, setConfigKey] = useState('')
  const [formError, setFormError] = useState('')
  const updateNode = trpc.nodes.update.useMutation({
    onSuccess: () => void utils.nodes.invalidate(),
  })

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setFormError('')
    try {
      // key 留空表示不修改
      const payload =
        configKey.length > 0 ? { name, baseUrl, configKey } : { name, baseUrl }
      await updateNode.mutateAsync({ id: item.id, ...payload })
      toast.success(t('nodes.saved'))
      onSaved()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'failed')
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <div className="grid gap-2">
        <Label htmlFor="edit-node-name">{t('nodes.name')}</Label>
        <Input
          id="edit-node-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t('nodes.namePlaceholder')}
          required
          maxLength={64}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="edit-node-url">{t('nodes.baseUrl')}</Label>
        <Input
          id="edit-node-url"
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          placeholder="http://192.168.1.10:8080"
          required
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="edit-node-key">{t('nodes.configKey')}</Label>
        <Input
          id="edit-node-key"
          type="password"
          value={configKey}
          onChange={(event) => setConfigKey(event.target.value)}
          placeholder={t('nodes.configKeyKeep')}
        />
      </div>
      {formError && <p className="text-sm text-destructive">{formError}</p>}
      <DialogFooter>
        <Button type="submit" disabled={updateNode.isPending}>
          {updateNode.isPending ? t('nodes.saving') : t('nodes.save')}
        </Button>
      </DialogFooter>
    </form>
  )
}

function DeleteDialog({
  item,
  onClose,
}: {
  item: NodeItem | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const utils = trpc.useUtils()
  const deleteNode = trpc.nodes.remove.useMutation({
    onSuccess: () => void utils.nodes.invalidate(),
  })

  async function handleDelete() {
    if (!item) return
    try {
      await deleteNode.mutateAsync({ id: item.id })
      toast.success(t('nodes.deleted'))
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'failed')
    }
  }

  return (
    <AlertDialog
      open={item !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('nodes.confirmDeleteTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('nodes.confirmDeleteDesc', { name: item?.name ?? '' })}
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
  )
}

