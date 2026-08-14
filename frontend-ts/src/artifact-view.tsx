import type { Artifact, ArtifactContent } from "./types";

/** Artifact 正文渲染。
 *
 * 对 `artifact_type` 做穷尽 switch，末尾用 `never` 兜底：新增一种 Artifact 时这里
 * 编译期就会报，而不是静默渲染成空白。这是「每种类型一个组件树」换不来的保证。
 */
export function ArtifactView({ artifact }: { artifact: Artifact }) {
  return (
    <section className="space-y-3 rounded-md border p-4">
      <div className="flex items-baseline gap-2">
        <h2 className="font-mono text-sm font-semibold">{artifact.type}</h2>
        <span className="font-mono text-[11px] text-muted-foreground">{artifact.id}</span>
      </div>
      {renderBody(artifact.content)}
    </section>
  );
}

function renderBody(content: ArtifactContent) {
  switch (content.artifact_type) {
    case "research":
      return (
        <div className="space-y-3">
          <Field label="摘要">{content.summary}</Field>
          <List
            label="论断"
            items={content.claims.map((claim) => `${claim.statement} [${claim.evidence_ids.join(", ")}]`)}
          />
          <List label="局限" items={content.limitations} />
        </div>
      );
    case "hypothesis":
      return (
        <div className="space-y-3">
          <Field label="假设">{content.hypothesis}</Field>
          <List label="可证伪预测" items={content.falsifiable_predictions} />
          <List label="边界" items={content.boundaries} />
        </div>
      );
    case "evidence-review":
      return (
        <div className="space-y-3">
          <List
            label="逐条判定"
            items={content.assessments.map((item) => `[${item.verdict}] ${item.claim}`)}
          />
          <List label="缺口" items={content.gaps.length > 0 ? content.gaps : ["无"]} />
        </div>
      );
    case "research-plan":
      return (
        <div className="space-y-3">
          <Field label="问题">{content.problem_statement}</Field>
          <Field label="目标">{content.target}</Field>
          <Field label="方法">{content.methods}</Field>
          {/* 每一项都带着自己的 evidence_id —— 绑定关系写在类型里，不是靠另一张对照表 */}
          <List
            label="基线"
            items={content.experiments.baselines.map((item) => `${item.name} [${item.evidence_id}]`)}
          />
          <List
            label="指标"
            items={content.experiments.metrics.map((item) => `${item.name} [${item.evidence_id}]`)}
          />
          <List
            label="预期结果"
            items={content.results.expected_outcomes.map((item) => `${item.metric}：${item.statement}`)}
          />
          <List label="参考文献" items={content.references} />
        </div>
      );
    case "review":
      return (
        <div className="space-y-3">
          <Field label="结论">{content.accepted ? "接受" : "拒绝"}</Field>
          <Field label="评分">
            {`科学价值 ${content.scores.scientific_value}`
              + ` · 技术深度 ${content.scores.technical_depth}`
              + ` · 应用潜力 ${content.scores.application_potential}`}
          </Field>
          <List label="弱点" items={content.weaknesses.length > 0 ? content.weaknesses : ["无"]} />
          <List label="建议" items={content.feedback.length > 0 ? content.feedback : ["无"]} />
        </div>
      );
    default: {
      const exhaustive: never = content;
      return exhaustive;
    }
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm">{children}</div>
    </div>
  );
}

function List({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <ul className="mt-1 space-y-1">
        {items.map((item) => (
          <li key={item} className="text-sm">· {item}</li>
        ))}
      </ul>
    </div>
  );
}
