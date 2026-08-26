import { useQuery } from "@tanstack/react-query";

import { fetchArtifact } from "../lib/api/artifacts";
import { ApiError } from "../lib/api/client";
import type { ApiClient } from "../lib/api/client";
import type { Artifact } from "../lib/types/wire";
import { useApiClient } from "../providers/api";

export type UseArtifactOptions = {
  client?: ApiClient;
};

export function useArtifact(artifactId: string | null, options?: UseArtifactOptions) {
  const defaultClient = useApiClient();
  const client = options?.client ?? defaultClient;

  const query = useQuery({
    queryKey: ["artifact", artifactId],
    queryFn: async (): Promise<Artifact> => {
      if (!artifactId) throw new ApiError(400, "artifact id required");
      return fetchArtifact(client, artifactId);
    },
    enabled: Boolean(artifactId),
    retry: false,
    staleTime: Infinity,
  });

  return {
    artifact: query.data ?? null,
    loading: query.isLoading,
    error: query.error instanceof ApiError ? query.error : query.error ? new ApiError(500, String(query.error)) : null,
    refetch: () => void query.refetch(),
  };
}
