import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/about')({
  component: AboutComponent,
})

function AboutComponent() {
  return (
    <section>
      <h2>关于</h2>
      <p>这是一个示例二级路由，可删除或改成 dashboard 页面。</p>
    </section>
  )
}
