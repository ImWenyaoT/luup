import { createFileRoute, Link, Outlet } from "@tanstack/react-router"

export const Route = createFileRoute("/_layout")({
  component: Layout,
})

function Layout() {
  return (
    <div className="relative mx-auto max-w-6xl px-4 pb-16">
      <header className="flex h-13 items-center gap-4 border-b">
        <Link to="/" className="text-[15px]">
          <b className="text-primary">luup</b>
          <span className="text-muted-foreground"> · 交付面</span>
        </Link>
        <nav className="flex gap-3 text-xs text-muted-foreground">
          <Link to="/" className="hover:text-primary">
            仪表台
          </Link>
          <Link to="/runs" className="hover:text-primary">
            历史
          </Link>
          <Link to="/" hash="api" className="hover:text-primary">
            API
          </Link>
        </nav>
        <span className="ml-auto text-[11px] text-muted-foreground max-md:hidden">
          数据源：runs/ + Science-125 · 工件读取只读
        </span>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  )
}
