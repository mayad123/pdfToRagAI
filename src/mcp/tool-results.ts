import { readPackageVersion } from "./version.js";

export type ToolErrorCode =
  | "PATH_NOT_ALLOWED"
  | "INVALID_INPUT"
  | "INGEST_FAILED"
  | "QUERY_FAILED"
  | "SEARCH_FAILED"
  | "INSPECT_FAILED"
  | "INTERNAL";

export type McpToolSuccess<T> = {
  ok: true;
  version: string;
  data: T;
};

export type McpToolFailure = {
  ok: false;
  version: string;
  error: {
    code: ToolErrorCode;
    message: string;
  };
};

export type McpToolResult<T> = McpToolSuccess<T> | McpToolFailure;

export function toolSuccess<T>(data: T): McpToolSuccess<T> {
  return { ok: true, version: readPackageVersion(), data };
}

export function toolFailure(code: ToolErrorCode, message: string): McpToolFailure {
  return { ok: false, version: readPackageVersion(), error: { code, message } };
}

export function mapUnknownError(e: unknown): McpToolFailure {
  if (
    e &&
    typeof e === "object" &&
    "code" in e &&
    (e as NodeJS.ErrnoException).code === "PATH_NOT_ALLOWED" &&
    "message" in e &&
    typeof (e as { message: unknown }).message === "string"
  ) {
    return toolFailure("PATH_NOT_ALLOWED", (e as { message: string }).message);
  }
  const message = e instanceof Error ? e.message : String(e);
  return toolFailure("INTERNAL", message);
}
