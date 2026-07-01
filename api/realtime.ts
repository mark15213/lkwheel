import type { IncomingMessage, ServerResponse } from "node:http";
import {
  getHttpRealtimeHealth,
  getHttpRealtimeRoom,
  handleHttpRealtimeEvent,
  type RealtimeEvent
} from "../server/httpRealtime";

type JsonBody = {
  event?: string;
  payload?: Record<string, unknown>;
  clientId?: string;
};

type QueryRequest = IncomingMessage & {
  query?: Record<string, string | string[] | undefined>;
  body?: unknown;
};

export default async function handler(request: QueryRequest, response: ServerResponse): Promise<void> {
  setJsonHeaders(response);

  if (request.method === "OPTIONS") {
    response.statusCode = 204;
    response.end();
    return;
  }

  try {
    if (request.method === "GET") {
      const query = readQuery(request);
      const code = getQueryValue(query.code);
      if (!code) {
        sendJson(response, 200, getHttpRealtimeHealth());
        return;
      }
      sendJson(response, 200, getHttpRealtimeRoom(code, getClientId(request, query.clientId)));
      return;
    }

    if (request.method === "POST") {
      const body = await readJsonBody(request);
      sendJson(
        response,
        200,
        handleHttpRealtimeEvent(
          String(body.event ?? "") as RealtimeEvent,
          body.payload && typeof body.payload === "object" ? body.payload : {},
          getClientId(request, body.clientId)
        )
      );
      return;
    }

    sendJson(response, 405, { ok: false, error: "Method not allowed" });
  } catch (error) {
    sendJson(response, 400, { ok: false, error: error instanceof Error ? error.message : "请求失败" });
  }
}

function setJsonHeaders(response: ServerResponse): void {
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.end(JSON.stringify(payload));
}

function readQuery(request: QueryRequest): Record<string, string | string[] | undefined> {
  if (request.query) {
    return request.query;
  }
  const url = new URL(request.url ?? "/api/realtime", "https://local.invalid");
  return Object.fromEntries(url.searchParams.entries());
}

function getQueryValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function getClientId(request: IncomingMessage, rawClientId: unknown): string {
  const headerValue = request.headers["x-client-id"];
  if (typeof headerValue === "string" && headerValue.trim()) {
    return headerValue;
  }
  if (Array.isArray(headerValue) && headerValue[0]) {
    return headerValue[0];
  }
  return String(rawClientId ?? "");
}

function readJsonBody(request: QueryRequest): Promise<JsonBody> {
  if (request.body && typeof request.body === "object") {
    return Promise.resolve(request.body as JsonBody);
  }
  if (typeof request.body === "string") {
    try {
      return Promise.resolve(JSON.parse(request.body) as JsonBody);
    } catch {
      return Promise.reject(new Error("JSON 格式不正确"));
    }
  }

  return new Promise((resolve, reject) => {
    let raw = "";
    request.on("data", (chunk: Buffer) => {
      raw += chunk.toString("utf8");
      if (raw.length > 128_000) {
        reject(new Error("请求内容过大"));
        request.destroy();
      }
    });
    request.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw) as JsonBody);
      } catch {
        reject(new Error("JSON 格式不正确"));
      }
    });
    request.on("error", reject);
  });
}
