import { viewPaths } from '@better-auth-ui/core'
import { createFileRoute, notFound } from '@tanstack/react-router'
import { Settings } from '@/components/auth/settings/settings'

const validSettingsPaths = Object.values(viewPaths.settings)

export const Route = createFileRoute('/dashboard/settings/$path')({
  beforeLoad({ params: { path } }) {
    if (!validSettingsPaths.includes(path)) {
      throw notFound()
    }
  },
  component: SettingsPage,
})

function SettingsPage() {
  const { path } = Route.useParams()

  return (
    <div className="mx-auto w-full max-w-3xl">
      <Settings path={path} />
    </div>
  )
}
