import Link from "next/link";
import { RunsTable } from "@/components/RunsTable";
import { EmptyState, Panel } from "@/components/ui";
import { activeRun, listRuns } from "@/lib/runs";

export const dynamic = "force-dynamic";

export default function RunsPage() {
  const runs = listRuns(500);
  const active = activeRun();

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
