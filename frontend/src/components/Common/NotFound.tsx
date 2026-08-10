import { Link } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"

const NotFound = () => {
  return (
    <div
      className="mx-auto flex min-h-screen w-full max-w-[1360px] flex-col justify-center gap-4 px-6"
      data-testid="not-found"
    >
      <p className="font-mono text-sm text-muted-foreground">404</p>
      <h1 className="text-2xl font-medium tracking-tight">页面不存在</h1>
      <p className="max-w-[68ch] text-sm text-muted-foreground">
        这个地址没有对应的路由。仪表台、运行历史与 run 详情是仅有的三个页面。
      </p>
      <div>
        <Button asChild>
          <Link to="/">回仪表台</Link>
        </Button>
      </div>
    </div>
  )
}

export default NotFound
