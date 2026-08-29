import type { ReactNode } from "react";
import styled from "@emotion/styled";

import type { Artifact, ArtifactContent } from "../../lib/types/wire";
import { Badge } from "./Badge";
import { colors, mono, Surface } from "../../styles";

const View = styled(Surface)`
  overflow: hidden;
  margin-top: 12px;
`;
const ViewHead = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid ${colors.border};
  span {
    overflow-wrap: anywhere;
  }
`;
const ViewBody = styled.div`
  padding: 16px;
  font-size: 12px;
  line-height: 1.65;
  overflow-wrap: anywhere;
`;
const Stack = styled.div`
  display: grid;
  gap: 14px;
  font-size: 12px;
`;
const Inset = styled.div`
  display: grid;
  gap: 8px;
  border: 1px solid ${colors.border};
  border-radius: 10px;
  background: #f8fafc;
  padding: 12px;
`;
const Columns = styled.div`
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
  @media (min-width: 560px) {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
`;
const ArtifactTitle = styled.span`
  color: ${colors.ink};
  font-size: 14px;
  font-weight: 700;
`;
const InsetTitle = styled.h3`
  margin: 0;
  color: ${colors.muted};
  font: 700 10px ${mono};
  letter-spacing: 0.07em;
  text-transform: uppercase;
`;
const ReviewHead = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;
const FieldWrap = styled.div`
  display: grid;
  gap: 3px;
  min-width: 0;
`;
const FieldLabel = styled.div`
  font-family: ${mono};
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: ${colors.muted};
`;
const ListWrap = styled.div`
  display: grid;
  gap: 4px;
  ul {
    margin: 0;
    padding-left: 18px;
    display: grid;
    gap: 3px;
  }
`;

export function ArtifactView({ artifact }: { artifact: Artifact }) {
  return (
    <View data-testid="artifact-view">
      <ViewHead>
        <Badge>{artifact.type}</Badge>
        <span style={{ fontFamily: mono, fontSize: 10, color: colors.muted }}>{artifact.id}</span>
      </ViewHead>
      <ViewBody>{renderBody(artifact.content)}</ViewBody>
    </View>
  );
}

function renderBody(content: ArtifactContent) {
  switch (content.artifact_type) {
    case "research":
      return (
        <Stack>
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
        </Stack>
      );
    case "hypothesis":
      return (
        <Stack>
          <Field label="问题">{content.question}</Field>
          <Field label="筛选状态">
            {content.selection_status === "candidate_selected"
              ? "已选择候选进入研究计划（非已证实）"
              : content.selection_status}
          </Field>
          {content.candidates.map((candidate) => (
            <Inset key={candidate.candidate_id}>
              <Field label={`候选 ${candidate.candidate_id} · ${candidate.claim_status}`}>{candidate.core_claim}</Field>
              <Field label="依据">{candidate.basis}</Field>
              <List label="支持证据" items={candidate.supporting_evidence_ids} />
              <List label="反对证据" items={candidate.opposing_evidence_ids} />
              <List label="可证伪预测" items={candidate.falsifiable_predictions} />
              <List label="替代解释" items={candidate.alternative_explanations} />
              <List label="不确定性" items={candidate.uncertainty} />
              <List label="边界" items={candidate.boundaries} />
              <List label="验证条件" items={candidate.validation_conditions} />
            </Inset>
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
        </Stack>
      );
    case "evidence-review":
      return (
        <Stack>
          <List
            label="逐条判定"
            items={content.assessments.map(
              (item) => `${item.candidate_id ? `${item.candidate_id} ` : ""}[${item.verdict}] ${item.claim}`,
            )}
          />
          <List label="缺口" items={content.gaps.length > 0 ? content.gaps : ["无"]} />
        </Stack>
      );
    case "research-plan":
      return (
        <Stack>
          <Inset>
            <Field label="论文标题">
              <ArtifactTitle>{content.paper_title}</ArtifactTitle>
            </Field>
            <Field label="论文摘要">{content.paper_abstract}</Field>
          </Inset>

          <Columns>
            <Field label="问题">{content.problem_statement}</Field>
            <Field label="理由">{content.rationale}</Field>
          </Columns>

          <Field label="技术细节">{content.technical_details}</Field>
          <List label="数据集" items={content.datasets} />

          <Columns>
            <Field label="来源">{content.source}</Field>
            <Field label="目标">{content.target}</Field>
          </Columns>

          <Inset>
            <InsetTitle>执行计划</InsetTitle>
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
          </Inset>

          <Field label="方法">{content.methods}</Field>
          <Field label="实验设计">{content.experiments.design}</Field>

          <Columns>
            <List
              label="基线"
              items={content.experiments.baselines.map((item) => `${item.name} [${item.evidence_id}]`)}
            />
            <List
              label="指标"
              items={content.experiments.metrics.map((item) => `${item.name} [${item.evidence_id}]`)}
            />
          </Columns>

          <Inset>
            <InsetTitle>论证与预期</InsetTitle>
            <Columns>
              <Field label="结果状态">{content.results.status}</Field>
              <Field label="可行性验证依据">{content.results.validation_basis}</Field>
            </Columns>
            <Field label="可行性论证">{content.results.feasibility_argument}</Field>
            <List
              label="预期结果"
              items={content.results.expected_outcomes.map((item) => `${item.metric}：${item.statement}`)}
            />
          </Inset>

          <List label="参考文献" items={content.references} />
        </Stack>
      );
    case "review":
      return (
        <Stack>
          <ReviewHead>
            <FieldLabel>结论:</FieldLabel>
            <Badge variant={content.accepted ? "default" : "destructive"}>
              {content.accepted ? "接受 (Accepted)" : "拒绝 (Rejected)"}
            </Badge>
          </ReviewHead>
          <Field label="评分">
            {`科学价值 ${content.scores.scientific_value}` +
              ` · 技术深度 ${content.scores.technical_depth}` +
              ` · 应用潜力 ${content.scores.application_potential}`}
          </Field>
          <List label="弱点" items={content.weaknesses} />
          <List label="反馈" items={content.feedback} />
          <List label="独立证据" items={content.independent_evidence_ids} />
        </Stack>
      );
    default: {
      const _never: never = content;
      return <p style={{ color: colors.muted, fontSize: 12 }}>未知产物类型</p>;
    }
  }
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <FieldWrap>
      <FieldLabel>{label}</FieldLabel>
      <div>{children}</div>
    </FieldWrap>
  );
}

function List({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ListWrap>
      <FieldLabel>{label}</FieldLabel>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </ListWrap>
  );
}
