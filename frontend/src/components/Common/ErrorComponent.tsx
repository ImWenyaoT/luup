import { Link } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"

const ErrorComponent = () => {
  return (
    <div
      className="mx-auto flex min-h-screen w-full max-w-[1360px] flex-col justify-center gap-4 px-6"
      data-testid="error-component"
    >
      <p className="font-mono text-sm text-destructive">error</p>
      <h1 className="text-2xl font-medium tracking-tight">页面渲染失败</h1>
      <p className="max-w-[68ch] text-sm text-muted-foreground">
        前端在渲染这一页时抛出了异常。重新载入通常可以恢复；若持续失败，请看浏览器控制台。
      </p>
      <div>
        <Button asChild>
          <Link to="/">回仪表台</Link>
        </Button>
      </div>
    </div>
  )
}

export default ErrorComponent
