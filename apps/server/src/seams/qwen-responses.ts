import { AsyncLocalStorage } from "node:async_hooks";
import {
  OpenAIProvider,
  type Model,
  type ModelRequest,
  type ModelResponse,
  type ModelRetryAdviceRequest,
} from "@openai/agents";

import { StageError } from "../agent/failures.ts";

// One observation scope per runner.run; cached providers may serve concurrent attempts.
const observations = new AsyncLocalStorage<ModelResponse[]>();
export function observeQwenResponses<T>(responses: ModelResponse[], run: () => Promise<T>): Promise<T> {
  return observations.run(responses, run);
}

export class QwenResponseStatusError extends StageError {
  constructor(response: ModelResponse) {
    const raw = response.providerData;
    const detail = [raw?.error?.code, raw?.error?.message, raw?.incomplete_details?.reason]
      .filter((value): value is string => typeof value === "string")
      .join(" ");
    super(
      raw?.status === "incomplete" ? "invalid_output" : "provider_error",
      `Qwen Responses status ${String(raw?.status)}${detail ? `: ${detail}` : ""}`,
    );
  }
}

class QwenResponsesModel implements Model {
  constructor(private readonly model: Model) {}

  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    const response = await this.model.getResponse(request);
    observations.getStore()?.push(response);
    // SDK 0.17 maps output without checking the raw Responses completion status.
    // Reject here before Runner can execute any returned tool or accept partial text.
    if (response.providerData?.status !== "completed" || response.providerData?.error != null) {
      throw new QwenResponseStatusError(response);
    }
    return response;
  }

  getStreamedResponse(): never {
    throw new StageError("provider_error", "Luup Qwen executor requires non-streaming Responses status validation");
  }

  getRetryAdvice(request: ModelRetryAdviceRequest) {
    if (request.error instanceof QwenResponseStatusError) {
      return { suggested: false, replaySafety: "unsafe" as const, responseStarted: true };
    }
    return this.model.getRetryAdvice?.(request);
  }
}

/** Keep the SDK's Responses transport and provider retry advice; guard its returned result only. */
export class QwenResponsesProvider extends OpenAIProvider {
  override async getModel(modelName?: string): Promise<Model> {
    return new QwenResponsesModel(await super.getModel(modelName));
  }
}
