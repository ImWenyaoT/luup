import type { ApiClient } from "./client";
import type { Science125Data, Science125Question } from "../types/wire";

export function fetchScience125(client: ApiClient): Promise<Science125Data> {
  return client.get<Science125Data>("/api/science125");
}

export function fetchScience125Question(
  client: ApiClient,
  id: number,
): Promise<{ question: Science125Question; formattedText: string }> {
  return client.get<{ question: Science125Question; formattedText: string }>(
    `/api/science125/${encodeURIComponent(id)}`,
  );
}
