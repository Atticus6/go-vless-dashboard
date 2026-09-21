import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { FormSkeleton } from '@/components/loading-skeletons'
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
  RadioGroup,
  RadioGroupItem,
} from '@/components/ui/radio-group'
import { trpc } from '@/lib/trpc'

export const Route = createFileRoute('/dashboard/config')({
  component: ConfigPage,
})

type Channel = 'off' | 'feishu' | 'telegram'

function ConfigPage() {
  const { t } = useTranslation()
  const utils = trpc.useUtils()
  const configQuery = trpc.notify.getConfig.useQuery()
  const [channel, setChannel] = useState<Channel>('off')
  const [webhook, setWebhook] = useState('')
  const [secret, setSecret] = useState('')
  const [botToken, setBotToken] = useState('')
  const [chatId, setChatId] = useState('')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const notify = configQuery.data?.config.notifyConfig
    if (!notify || loaded) return
    setLoaded(true)
    if (notify.feishu) {
      setChannel('feishu')
      setWebhook(notify.feishu.webhook)
      setSecret(notify.feishu.secret ?? '')
    } else if (notify.telegram) {
      setChannel('telegram')
      setBotToken(notify.telegram.botToken)
      setChatId(notify.telegram.chatId)
    }
  }, [configQuery.data, loaded])

  const updateConfig = trpc.notify.updateConfig.useMutation()
  const testNotify = trpc.notify.test.useMutation()

  async function handleSave() {
    try {
      await updateConfig.mutateAsync(
        channel === 'off'
          ? {}
          : channel === 'feishu'
            ? {
                notifyConfig: {
                  feishu: {
                    enabled: true,
                    webhook: webhook.trim(),
                    secret: secret.trim() || undefined,
                  },
                },
              }
            : {
                notifyConfig: {
                  telegram: {
                    enabled: true,
                    botToken: botToken.trim(),
                    chatId: chatId.trim(),
                  },
                },
              },
      )
      void utils.notify.getConfig.invalidate()
      toast.success(t('notify.saved'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'failed')
    }
  }

  async function handleTest() {
    try {
      const res = await testNotify.mutateAsync()
      if (res.results.length === 0) {
        toast.error(t('notify.noChannel'))
        return
      }
      const failed = res.results.filter((r) => !r.ok)
      if (failed.length === 0) {
        toast.success(
          t('notify.testOk', {
            channels: res.results.map((r) => r.channel).join('、'),
          }),
        )
      } else {
        toast.error(
          t('notify.testPartial', {
            failed: failed
              .map((r) => `${r.channel}(${r.error ?? 'error'})`)
              .join('、'),
          }),
        )
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'failed')
    }
  }

  function channelOption(value: Channel, label: string) {
    return (
      <div className="flex items-center gap-2">
        <RadioGroupItem value={value} id={`notify-channel-${value}`} />
        <Label
          htmlFor={`notify-channel-${value}`}
          className="cursor-pointer text-sm"
        >
          {label}
        </Label>
      </div>
    )
  }

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t('menu.config')}
        </h1>
        <p className="text-sm text-muted-foreground">{t('notify.desc')}</p>
      </div>

      {configQuery.isPending && (
        <Card>
          <CardContent className="pt-6">
            <FormSkeleton rows={4} />
          </CardContent>
        </Card>
      )}

      {configQuery.data && (
        <>
          <h2 className="text-lg font-semibold tracking-tight">
            {t('menu.notify')}
          </h2>
          <Card>
            <CardHeader>
              <CardTitle>{t('notify.channel')}</CardTitle>
            </CardHeader>
            <CardContent>
              <RadioGroup
                value={channel}
                onValueChange={(value) =>
                  setChannel(
                    value === 'feishu' || value === 'telegram'
                      ? value
                      : 'off',
                  )
                }
              >
                {channelOption('off', t('notify.channelOff'))}
                {channelOption('feishu', t('notify.feishuTitle'))}
                {channelOption('telegram', t('notify.telegramTitle'))}
              </RadioGroup>
            </CardContent>
          </Card>

          {channel === 'feishu' && (
            <Card>
              <CardHeader>
                <CardTitle>{t('notify.feishuTitle')}</CardTitle>
                <CardDescription>{t('notify.feishuDesc')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-2">
                  <Label htmlFor="notify-feishu-webhook">
                    {t('notify.webhook')}
                  </Label>
                  <Input
                    id="notify-feishu-webhook"
                    value={webhook}
                    onChange={(event) => setWebhook(event.target.value)}
                    placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..."
                    inputMode="url"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="notify-feishu-secret">
                    {t('notify.secret')}
                  </Label>
                  <Input
                    id="notify-feishu-secret"
                    value={secret}
                    onChange={(event) => setSecret(event.target.value)}
                    placeholder={t('notify.secretPlaceholder')}
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {channel === 'telegram' && (
            <Card>
              <CardHeader>
                <CardTitle>{t('notify.telegramTitle')}</CardTitle>
                <CardDescription>{t('notify.telegramDesc')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-2">
                  <Label htmlFor="notify-telegram-token">
                    {t('notify.botToken')}
                  </Label>
                  <Input
                    id="notify-telegram-token"
                    value={botToken}
                    onChange={(event) => setBotToken(event.target.value)}
                    placeholder="123456:ABC-DEF..."
                    autoComplete="off"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="notify-telegram-chat">
                    {t('notify.chatId')}
                  </Label>
                  <Input
                    id="notify-telegram-chat"
                    value={chatId}
                    onChange={(event) => setChatId(event.target.value)}
                    placeholder="@channel 或 123456789"
                  />
                </div>
              </CardContent>
            </Card>
          )}

          <div className="flex gap-2">
            <Button
              disabled={updateConfig.isPending}
              onClick={() => void handleSave()}
            >
              {t('nodes.save')}
            </Button>
            <Button
              variant="outline"
              disabled={testNotify.isPending}
              onClick={() => void handleTest()}
            >
              {t('notify.testSend')}
            </Button>
          </div>
        </>
      )}
    </section>
  )
}
