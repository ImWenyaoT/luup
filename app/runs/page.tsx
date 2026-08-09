import Link from "next/link";
import { RunsTable } from "@/components/RunsTable";
import { EmptyState, Panel } from "@/components/ui";
import { activeRunId } from "@/lib/lock";
import { listRuns } from "@/lib/runs";
import { readRunsIndex } from "@/lib/runsIndex";

export const dynamic = "force-dynamic";

export default function RunsPage() {
  // 与 GET /api/runs 同一条路径：派生缓存优先，缺失/损坏/过期时退回全量扫盘
  const active = activeRunId();
  const runs = readRunsIndex(500, active) ?? listRuns(500, active);

  return (
    <div className="space-y-4">
      <Panel
        title="运行历史"
        right={
          active ? (
            <Link href={`/runs/${active}`} className="text-accent hover:underline">
              活跃 {active} →
            </Link>
          ) : (
            <span className="text-faint">无活跃 run</span>
          )
        }
      >
        {runs.length === 0 ? (
          <EmptyState
            title="尚无运行"
            hint={
              <>
                从<Link href="/" className="text-accent underline"> 仪表台 </Link>选一道 Science-125 题目开始
              </>
            }
          />
        ) : (
          <RunsTable runs={runs} />
        )}
      </Panel>
    </div>
  );
}
