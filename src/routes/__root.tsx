import { createRootRoute, Link, Outlet } from '@tanstack/react-router'

export const Route = createRootRoute({
  component: () => (
    <>
      <nav style={{ display: 'flex', gap: 16, padding: '12px 16px' }}>
        <Link to="/" activeProps={{ style: { fontWeight: 'bold' } }}>
          首页
        </Link>
        <Link to="/about" activeProps={{ style: { fontWeight: 'bold' } }}>
          关于
        </Link>
      </nav>
      <hr />
      <main style={{ padding: 16 }}>
        <Outlet />
      </main>
    </>
  ),
})
