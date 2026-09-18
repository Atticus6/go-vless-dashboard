import { viewPaths } from '@better-auth-ui/core'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { Auth } from '@/components/auth/auth'

const validAuthPaths = new Set(Object.values(viewPaths.auth))

export const Route = createFileRoute('/auth/$path')({
  beforeLoad({ params: { path } }) {
    if (!validAuthPaths.has(path)) {
      throw redirect({ to: '/' })
    }
  },
  component: AuthPage,
})

function AuthPage() {
  const { path } = Route.useParams()

  return (
    <div className="mx-auto flex w-full max-w-md justify-center p-4 md:p-6">
      <Auth path={path} />
    </div>
  )
}
