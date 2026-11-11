import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { checkEnv, clientIp, createServer, routes } from "./server.mjs";

async function withServer(env, fn) {
  const server = createServer(env);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("routes the API, answers 404 as JSON and rejects oversized bodies", async () => {
  await withServer({}, async (base) => {
    const health = await fetch(`${base}/api/health`);
    assert.deepEqual(await health.json(), { ok: true });

    const missing = await fetch(`${base}/api/nothing`);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: "Не найдено." });

    const big = await fetch(`${base}/api/leads`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "x".repeat(70 * 1024) });
    assert.equal(big.status, 413);
  });
});

test("passes method, headers, body and client IP to handlers; hides internal errors", async () => {
  const original = { ...routes };
  let seen;
  routes["/api/echo"] = async (request, { ip }) => {
    seen = { method: request.method, type: request.headers.get("content-type"), body: await request.text(), ip };
    return new Response("ok");
  };
  routes["/api/boom"] = async () => { throw new Error("секрет в тексте ошибки"); };
  try {
    await withServer({ TRUST_PROXY: "1" }, async (base) => {
      await fetch(`${base}/api/echo?x=1`, { method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": "203.0.113.9, 10.0.0.1" }, body: "{\"a\":1}" });
      assert.deepEqual(seen, { method: "POST", type: "application/json", body: "{\"a\":1}", ip: "203.0.113.9" });

      const boom = await fetch(`${base}/api/boom`);
      assert.equal(boom.status, 500);
      const text = await boom.text();
      assert.doesNotMatch(text, /секрет/);
    });
  } finally {
    for (const key of Object.keys(routes)) if (!(key in original)) delete routes[key];
  }
});

test("X-Forwarded-For is ignored unless TRUST_PROXY=1", () => {
  const req = { headers: { "x-forwarded-for": "6.6.6.6" }, socket: { remoteAddress: "127.0.0.1" } };
  assert.equal(clientIp(req, {}), "127.0.0.1");
  assert.equal(clientIp(req, { TRUST_PROXY: "1" }), "6.6.6.6");
});

test("static files: only the site, privacy page and tg-app; no traversal, no secrets", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "static-"));
  try {
    await writeFile(path.join(root, "index.html"), "<h1>site</h1>");
    await writeFile(path.join(root, ".env"), "SECRET=1");
    await writeFile(path.join(root, "package.json"), "{}");
    await mkdir(path.join(root, "tg-app"));
    await writeFile(path.join(root, "tg-app", "app.js"), "app()");
    await writeFile(path.join(root, "tg-app", "CLAUDE.md"), "notes");

    await withServer({ STATIC_ROOT: root }, async (base) => {
      const home = await fetch(`${base}/`);
      assert.equal(home.headers.get("content-type"), "text/html; charset=utf-8");
      assert.equal(await home.text(), "<h1>site</h1>");
      assert.equal(await (await fetch(`${base}/tg-app/app.js`)).text(), "app()");
      await mkdir(path.join(root, "works"));
      await writeFile(path.join(root, "works", "site.webp"), "img");
      assert.equal((await fetch(`${base}/works/site.webp`)).headers.get("content-type"), "image/webp");
      assert.equal((await fetch(`${base}/works/../.env`)).status, 404);
      await writeFile(path.join(root, "tg-app", "index.html"), "<h1>app</h1>");
      assert.equal(await (await fetch(`${base}/tg-app/`)).text(), "<h1>app</h1>");
      for (const blocked of ["/.env", "/package.json", "/tg-app/CLAUDE.md", "/tg-app/..%2F.env", "/%2e%2e/etc/passwd", "/tg-app/missing.js"]) {
        assert.equal((await fetch(`${base}${blocked}`)).status, 404, blocked);
      }
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("checkEnv lists missing settings", () => {
  assert.equal(checkEnv({}).length, 5);
  const common = { TELEGRAM_BOT_TOKEN: "x", OWNER_TELEGRAM_ID: "1", ALLOWED_ORIGINS: "https://a.b", IP_HASH_SALT: "s" };
  assert.deepEqual(checkEnv({ ...common, STORAGE_DRIVER: "file", STORAGE_DIR: "/var/lib/stvnislv" }), []);
  assert.deepEqual(checkEnv({ ...common, SUPABASE_URL: "https://a.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_x" }), []);
  assert.match(checkEnv({ ...common, STORAGE_DRIVER: "file" })[0], /STORAGE_DIR/);
  assert.match(checkEnv({ ...common, STORAGE_DRIVER: "mongo" })[0], /supabase или file/);
});
