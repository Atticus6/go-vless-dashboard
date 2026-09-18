import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: IndexComponent,
})

function IndexComponent() {
  return (
    <section>
      <h1>go-vless-dashboard</h1>
      <p>TanStack Router（file-based）已就绪，在 src/routes 下加文件即加路由。</p>
    </section>
  )
}
