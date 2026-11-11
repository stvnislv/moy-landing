import assert from "node:assert/strict";
import test from "node:test";
import {
  corsHeaders,
  errorResponse,
  getAllowedOrigins,
  isAllowedOrigin,
  jsonResponse,
  preflightResponse,
  readJsonBody,
  RequestValidationError,
} from "./http.mjs";

const ORIGINS = ["https://stvnislv.netlify.app", "https://stvnislv-app.netlify.app"];
const req = (method, headers = {}, body) => new Request("https://stvnislv.netlify.app/api/x", { method, headers, body });

test("jsonResponse sets JSON and no-store", async () => {
  const response = jsonResponse({ a: 1 }, 201, { "X-Test": "1" });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-test"), "1");
  assert.deepEqual(await response.json(), { a: 1 });
});

test("errorResponse turns validation errors into their status and rethrows others", async () => {
  const response = errorResponse(new RequestValidationError("Слишком часто.", 429));
  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), { error: "Слишком часто." });
  assert.throws(() => errorResponse(new Error("boom")), /boom/);
});

test("readJsonBody enforces content type, size limit and valid JSON", async () => {
  assert.deepEqual(await readJsonBody(req("POST", { "Content-Type": "application/json" }, '{"a":1}')), { a: 1 });
  await assert.rejects(readJsonBody(req("POST", { "Content-Type": "text/plain" }, "{}")), RequestValidationError);
  await assert.rejects(readJsonBody(req("POST", { "Content-Type": "application/json" }, "{")), /Некорректный JSON/);
  await assert.rejects(
    readJsonBody(req("POST", { "Content-Type": "application/json" }, JSON.stringify({ t: "я".repeat(100) })), { maxBytes: 150 }),
    (error) => error instanceof RequestValidationError && error.status === 413,
  );
});

test("allowed origins are parsed strictly", () => {
  assert.deepEqual(getAllowedOrigins({ ALLOWED_ORIGINS: " https://stvnislv.netlify.app , https://stvnislv-app.netlify.app" }), ORIGINS);
  assert.deepEqual(getAllowedOrigins({}), []);
  assert.throws(() => getAllowedOrigins({ ALLOWED_ORIGINS: "https://stvnislv.netlify.app/path" }), /без пути/);
});

test("CORS headers only for allowed origins; preflight answers 204 or 403", () => {
  assert.equal(corsHeaders(req("GET", { Origin: ORIGINS[1] }), ORIGINS)["Access-Control-Allow-Origin"], ORIGINS[1]);
  assert.deepEqual(corsHeaders(req("GET", { Origin: "https://evil.example" }), ORIGINS), {});
  assert.deepEqual(corsHeaders(req("GET"), ORIGINS), {});
  assert.equal(preflightResponse(req("OPTIONS", { Origin: ORIGINS[0] }), ORIGINS).status, 204);
  assert.equal(preflightResponse(req("OPTIONS", { Origin: "https://evil.example" }), ORIGINS).status, 403);
  assert.equal(preflightResponse(req("GET", { Origin: ORIGINS[0] }), ORIGINS), null);
  assert.equal(isAllowedOrigin(req("POST", { Origin: ORIGINS[0] }), ORIGINS), true);
  assert.equal(isAllowedOrigin(req("POST"), ORIGINS), false);
});
