import type { GetFileNodesResponse, Paint, Rectangle, TypeStyle } from "@figma/rest-api-spec";

import { HTTP_REQUEST_TIMEOUT_MS, NODE_META_CACHE_TTL_MS } from "./constants.ts";

export interface NodeMetadata {
  nodeType: string;
  lastModified: string | null;
  absoluteBoundingBox: Rectangle | null;
  typeStyle: TypeStyle | null;
  fills: Paint[] | null;
}

type NodeMetaOutcome = NodeMetadata | { error: string };

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

const NODE_META_CACHE = new Map<string, CacheEntry<NodeMetaOutcome>>();

export function clearNodeMetaCache(): void {
  NODE_META_CACHE.clear();
}

export interface NodeMetadataRequestOptions {
  fetchImpl?: typeof fetch;
  cache?: boolean;
}

function cacheKey(fileKey: string, nodeId: string): string {
  return `${fileKey}:${nodeId}`;
}

export async function getNodeMetadata(
  fileKey: string,
  nodeId: string,
  token: string,
  options: NodeMetadataRequestOptions = {},
): Promise<NodeMetaOutcome> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const useCache = options.cache ?? true;
  const key = cacheKey(fileKey, nodeId);
  const cached = NODE_META_CACHE.get(key);
  if (useCache && cached) {
    if (Date.now() - cached.fetchedAt < NODE_META_CACHE_TTL_MS) return cached.data;
    NODE_META_CACHE.delete(key);
  }
  try {
    const res = await fetchImpl(
      `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}/nodes?ids=${encodeURIComponent(nodeId)}&depth=1`,
      {
        headers: { "X-Figma-Token": token },
        signal: AbortSignal.timeout(HTTP_REQUEST_TIMEOUT_MS),
      },
    );
    if (!res.ok) {
      return { error: `Figma metadata call returned HTTP ${res.status}.` };
    }
    const json = (await res.json()) as GetFileNodesResponse;
    const node = json.nodes?.[nodeId];
    if (!node) {
      return { error: `Figma metadata call returned no node for "${nodeId}".` };
    }
    const doc = node.document;
    const result: NodeMetaOutcome = {
      nodeType: doc.type,
      lastModified: json.lastModified ?? null,
      absoluteBoundingBox: "absoluteBoundingBox" in doc ? (doc.absoluteBoundingBox ?? null) : null,
      typeStyle: doc.type === "TEXT" ? (doc.style ?? null) : null,
      fills: "fills" in doc ? (doc.fills ?? null) : null,
    };
    if (useCache) {
      NODE_META_CACHE.set(key, { data: result, fetchedAt: Date.now() });
    }
    return result;
  } catch {
    return { error: "network error during Figma metadata call." };
  }
}
