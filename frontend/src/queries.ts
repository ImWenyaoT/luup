import { queryOptions } from "@tanstack/react-query"
import { api } from "./api"

/** run 相关的 key 都挂在 ["run", id] 下，触发新 run 后一次 invalidate 就能全刷。 */
export const runKey = (id: string) => ["run", id] as const

export const science125QueryOptions = queryOptions({
  queryKey: ["science125"],
  queryFn: () => api.science125(),
})

export const runsQueryOptions = queryOptions({
  queryKey: ["runs"],
  queryFn: () => api.runs(),
})

export const runDetailQueryOptions = (id: string) =>
  queryOptions({
    queryKey: [...runKey(id), "detail"],
    queryFn: () => api.detail(id),
  })

export const runStatusQueryOptions = (id: string) =>
  queryOptions({
    queryKey: [...runKey(id), "status"],
    queryFn: () => api.status(id),
  })

export const artifactQueryOptions = (id: string, file: string) =>
  queryOptions({
    queryKey: [...runKey(id), "artifact", file],
    queryFn: () => api.artifact(id, file),
  })
