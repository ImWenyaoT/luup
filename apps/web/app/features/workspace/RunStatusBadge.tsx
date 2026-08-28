import type { RunStatus } from "../../lib/types/wire";
import { Badge } from "./Badge";

const STATUS_LABEL: Record<RunStatus, string> = {
  running: "进行中",
  completed: "已完成",
  review_rejected: "评审拒绝",
  failed: "失败",
};

const STATUS_VARIANT: Record<RunStatus, "default" | "secondary" | "destructive"> = {
  running: "secondary",
  completed: "default",
  review_rejected: "secondary",
  failed: "destructive",
};

export function RunStatusBadge({ status }: { status: RunStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>;
}
