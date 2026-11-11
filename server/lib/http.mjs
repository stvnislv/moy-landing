// Общее для всех функций: JSON-ответы, разбор тела запроса, CORS.
// Работает на стандартных Request/Response — тот же код подойдёт для Node-сервера на VPS.

/** Ошибка в запросе клиента: текст показывается человеку, статус по умолчанию 400. */
export class RequestValidationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

/** Ответ на ошибку клиента: RequestValidationError → её статус и текст. Остальное пробрасывается. */
export function errorResponse(error, headers = {}) {
  if (error instanceof RequestValidationError) {
    return jsonResponse({ error: error.message }, error.status, headers);
  }
  throw error;
}

/** Читает JSON-тело не больше maxBytes байт. */
export async function readJsonBody(request, { maxBytes = 8192 } = {}) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new RequestValidationError("Ожидается JSON.");
  }

  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new RequestValidationError("Форма слишком большая.", 413);
  }
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > maxBytes) {
    throw new RequestValidationError("Форма слишком большая.", 413);
  }
  try {
    return JSON.parse(body);
  } catch (error) {
    if (error instanceof SyntaxError) throw new RequestValidationError("Некорректный JSON.");
    throw error;
  }
}

/** Разрешённые адреса из ALLOWED_ORIGINS (через запятую), только origin без пути. */
export function getAllowedOrigins(env = process.env) {
  return (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      const url = new URL(value);
      if (url.origin !== value) throw new Error(`ALLOWED_ORIGINS: «${value}» должен быть адресом сайта без пути.`);
      return url.origin;
    });
}

/**
 * Заголовки CORS для запроса с разрешённого адреса. Для чужого или пустого Origin — пустой объект:
 * браузер тогда не отдаст ответ странице. Авторизация идёт заголовком, cookie не используются.
 */
export function corsHeaders(request, allowedOrigins) {
  const origin = request.headers.get("origin");
  if (!origin || !allowedOrigins.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "Authorization, Content-Type, If-Match",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

/** Ответ на предварительный запрос OPTIONS или null, если это не он. */
export function preflightResponse(request, allowedOrigins) {
  if (request.method !== "OPTIONS") return null;
  const headers = corsHeaders(request, allowedOrigins);
  return new Response(null, { status: Object.keys(headers).length ? 204 : 403, headers });
}

export function isAllowedOrigin(request, allowedOrigins) {
  const origin = request.headers.get("origin");
  return Boolean(origin) && allowedOrigins.includes(origin);
}
