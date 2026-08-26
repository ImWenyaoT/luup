import type { ReactNode } from "react";

import type { Artifact, ArtifactContent } from "../../lib/types/wire";
import { Badge } from "./Badge";

export function ArtifactView({ artifact }: { artifact: Artifact }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white shadow-sm" data-testid="artifact-view">
      <div className="flex flex-row items-center justify-between border-b border-neutral-100 p-3.5 pb-3">
        <div className="flex items-center gap-2">
          <Badge>{artifact.type}</Badge>
          <span className="font-mono text-[11px] text-neutral-500">{artifact.id}</span>
        </div>
      </div>
      <div className="p-4 pt-3.5">{renderBody(artifact.content)}</div>
    </div>
  );
}

function renderBody(content: ArtifactContent) {
  switch (content.artifact_type) {
    case "research":
      return (
        <div className="space-y-3.5 text-xs">
          <Field label="研究对象">{content.research_framing.research_object}</Field>
          <Field label="研究范围">{content.research_framing.scope}</Field>
          <List
            label="变量"
            items={content.research_framing.variables.map(
              (variable) => `${variable.name}（${variable.role}）：${variable.operationalization}`,
            )}
          />
          <List label="已有认识" items={content.research_framing.known} />
          <List label="争议" items={content.research_framing.controversies} />
          <List label="未知" items={content.research_framing.unknowns} />
          <Field label="知识缺口">{content.research_framing.knowledge_gap}</Field>
          <List label="约束" items={content.research_framing.constraints} />
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
        <div className="space-y-3.5 text-xs">
          <Field label="问题">{content.question}</Field>
          <Field label="筛选状态">
            {content.selection_status === "candidate_selected"
              ? "已选择候选进入研究计划（非已证实）"
              : content.selection_status}
          </Field>
          {content.candidates.map((candidate) => (
            <div
              key={candidate.candidate_id}
              className="space-y-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3"
            >
              <Field label={`候选 ${candidate.candidate_id} · ${candidate.claim_status}`}>{candidate.core_claim}</Field>
              <Field label="依据">{candidate.basis}</Field>
              <List label="支持证据" items={candidate.supporting_evidence_ids} />
              <List label="反对证据" items={candidate.opposing_evidence_ids} />
              <List label="可证伪预测" items={candidate.falsifiable_predictions} />
              <List label="替代解释" items={candidate.alternative_explanations} />
              <List label="不确定性" items={candidate.uncertainty} />
              <List label="边界" items={candidate.boundaries} />
              <List label="验证条件" items={candidate.validation_conditions} />
            </div>
          ))}
          <Field label="选中候选">{content.comparison.selected_candidate_id}</Field>
          <Field label="筛选理由">{content.comparison.selection_rationale}</Field>
          <List
            label="比较标准"
            items={content.comparison.criteria.map((criterion) => `${criterion.criterion}：${criterion.rationale}`)}
          />
          <List
            label="比较记录"
            items={content.comparison.evaluations.map(
              (evaluation) =>
                `${evaluation.candidate_id}（第 ${evaluation.rank}）：${evaluation.rationale}；优点：${evaluation.strengths.join("、")}；弱点：${evaluation.weaknesses.join("、")}`,
            )}
          />
        </div>
      );
    case "evidence-review":
      return (
        <div className="space-y-3.5 text-xs">
          <List label="逐条判定" items={content.assessments.map((item) => `[${item.verdict}] ${item.claim}`)} />
          <List label="缺口" items={content.gaps.length > 0 ? content.gaps : ["无"]} />
        </div>
      );
    case "research-plan":
      return (
        <div className="space-y-3.5 text-xs">
          <div className="space-y-1.5 rounded-lg border border-neutral-200 bg-neutral-900/5 p-3">
            <Field label="论文标题">
              <span className="text-sm font-semibold text-neutral-900">{content.paper_title}</span>
            </Field>
            <Field label="论文摘要">{content.paper_abstract}</Field>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="问题">{content.problem_statement}</Field>
            <Field label="理由">{content.rationale}</Field>
          </div>

          <Field label="技术细节">{content.technical_details}</Field>
          <List label="数据集" items={content.datasets} />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="来源">{content.source}</Field>
            <Field label="目标">{content.target}</Field>
          </div>

          <div className="space-y-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
            <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-neutral-500">执行计划</h3>
            <List
              label="可检验预测"
              items={content.execution_plan.predictions.map(
                (item) => `[${item.candidate_id}] ${item.prediction}（证伪：${item.falsification_criterion}）`,
              )}
            />
            <List
              label="数据与条件"
              items={content.execution_plan.data_requirements.map(
                (item) => `${item.source}；变量：${item.variables.join("、")}；条件：${item.conditions.join("；")}`,
              )}
            />
            <List
              label="执行步骤"
              items={content.execution_plan.steps.map(
                (item) => `${item.order}. ${item.action} → ${item.expected_output}`,
              )}
            />
            <List
              label="分析与决策"
              items={content.execution_plan.analysis.map(
                (item) => `${item.method}；输入：${item.inputs.join("、")}；规则：${item.decision_rule}`,
              )}
            />
            <List
              label="不同结果含义"
              items={content.execution_plan.result_interpretations.map(
                (item) => `${item.observed_result} → ${item.meaning}`,
              )}
            />
            <List label="停止条件" items={content.execution_plan.stop_conditions} />
            <List label="回退条件" items={content.execution_plan.rollback_conditions} />
            <List label="补证条件" items={content.execution_plan.supplement_evidence_conditions} />
          </div>

          <Field label="方法">{content.methods}</Field>
          <Field label="实验设计">{content.experiments.design}</Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <List
              label="基线"
              items={content.experiments.baselines.map((item) => `${item.name} [${item.evidence_id}]`)}
            />
            <List
              label="指标"
              items={content.experiments.metrics.map((item) => `${item.name} [${item.evidence_id}]`)}
            />
          </div>

          <div className="space-y-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
            <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-neutral-500">论证与预期</h3>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Field label="结果状态">{content.results.status}</Field>
              <Field label="可行性验证依据">{content.results.validation_basis}</Field>
            </div>
            <Field label="可行性论证">{content.results.feasibility_argument}</Field>
            <List
              label="预期结果"
              items={content.results.expected_outcomes.map((item) => `${item.metric}：${item.statement}`)}
            />
          </div>

          <List label="参考文献" items={content.references} />
        </div>
      );
    case "review":
      return (
        <div className="space-y-3.5 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] uppercase tracking-widest text-neutral-500">结论:</span>
            <Badge variant={content.accepted ? "default" : "destructive"}>
              {content.accepted ? "接受 (Accepted)" : "拒绝 (Rejected)"}
            </Badge>
          </div>
          <Field label="评分">
            {`科学价值 ${content.scores.scientific_value}` +
              ` · 技术深度 ${content.scores.technical_depth}` +
              ` · 应用潜力 ${content.scores.application_potential}`}
          </Field>
          <List label="弱点" items={content.weaknesses} />
          <List label="反馈" items={content.feedback} />
          <List label="独立证据" items={content.independent_evidence_ids} />
        </div>
      );
    default: {
      const _never: never = content;
      return <p className="text-xs text-neutral-500">未知产物类型</p>;
    }
  }
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <div className="font-mono text-[11px] uppercase tracking-widest text-neutral-500">{label}</div>
      <div className="text-neutral-800">{children}</div>
    </div>
  );
}

function List({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-0.5">
      <div className="font-mono text-[11px] uppercase tracking-widest text-neutral-500">{label}</div>
      <ul className="list-inside list-disc space-y-0.5 text-neutral-800">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
