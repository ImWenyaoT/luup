import { createFileRoute, Link, Outlet } from "@tanstack/react-router"

export const Route = createFileRoute("/_layout")({
  component: Layout,
})

/** 选中态只靠下划线 + 字重，不用颜色单独承载。 */
const NAV_LINK =
  "relative -my-px py-4 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-[status=active]:font-medium data-[status=active]:text-foreground data-[status=active]:after:absolute data-[status=active]:after:inset-x-0 data-[status=active]:after:bottom-0 data-[status=active]:after:h-px data-[status=active]:after:bg-foreground"

function Layout() {
  return (
    <div className="min-h-screen">
      <header
        className="sticky top-0 z-30 border-b bg-background"
        data-testid="topbar"
      >
        <div className="mx-auto flex h-13 w-full max-w-[1360px] items-center gap-8 px-6">
          <Link
            to="/"
            className="flex items-baseline gap-2 self-stretch py-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            data-testid="topbar-brand"
          >
            <span className="font-mono text-[15px] font-semibold tracking-tight">
              luup
            </span>
            <span className="text-xs text-muted-foreground">交付面</span>
          </Link>
          <nav
            className="flex items-center gap-6 self-stretch text-[13px]"
            data-testid="topbar-nav"
          >
            <Link to="/" activeOptions={{ exact: true }} className={NAV_LINK}>
              仪表台
            </Link>
            <Link to="/batch" className={NAV_LINK}>
              批次
            </Link>
            <Link to="/runs" className={NAV_LINK}>
              历史
            </Link>
            <Link
              to="/"
              hash="api"
              activeOptions={{ exact: true, includeHash: true }}
              className={NAV_LINK}
            >
              API
            </Link>
          </nav>
          <span className="ml-auto text-xs text-muted-foreground">
            数据源 runs/ + Science-125 · 工件只读
          </span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1360px] px-6 pb-24">
        <Outlet />
      </main>
    </div>
  )
}
