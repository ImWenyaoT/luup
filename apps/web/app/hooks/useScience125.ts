import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { fetchScience125 } from "../lib/api/science125";
import type { ApiError } from "../lib/api/client";
import type { Science125Data, Science125Question } from "../lib/types/wire";
import { useApiClient } from "../providers/api";
import type { ApiClient } from "../lib/api/client";

const SCIENCE125_QUERY_KEY = ["science125"] as const;

export type UseScience125Options = {
  client?: ApiClient;
};

export function useScience125(options?: UseScience125Options) {
  const defaultClient = useApiClient();
  const client = options?.client ?? defaultClient;

  const query = useQuery({
    queryKey: SCIENCE125_QUERY_KEY,
    queryFn: () => fetchScience125(client),
    staleTime: Infinity,
  });

  const allQuestions = useMemo(() => {
    if (!query.data) return [] as Science125Question[];
    return query.data.domains.flatMap((domain) => domain.questions);
  }, [query.data]);

  const getById = useCallback(
    (id: number): Science125Question | undefined => allQuestions.find((q) => q.id === id),
    [allQuestions],
  );

  const pickRandom = useCallback((): Science125Question | null => {
    if (allQuestions.length === 0) return null;
    const index = Math.floor(Math.random() * allQuestions.length);
    return allQuestions[index] ?? null;
  }, [allQuestions]);

  return {
    data: (query.data ?? null) as Science125Data | null,
    loading: query.isLoading,
    error: (query.error as ApiError | null) ?? null,
    pickRandom,
    getById,
  };
}
