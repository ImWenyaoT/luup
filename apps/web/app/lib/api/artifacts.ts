import type { ApiClient } from "./client";
import type { Artifact } from "../types/wire";

export function fetchArtifact(client: ApiClient, artifactId: string): Promise<Artifact> {
  return client.get<Artifact>(`/api/artifacts/${encodeURIComponent(artifactId)}`);
}
