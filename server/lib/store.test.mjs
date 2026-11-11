import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createBlobsStore,
  createFileStore,
  createMemoryStore,
  createSupabaseStore,
  getSupabaseConfig,
  openStore,
  SupabaseError,
  StoreConflictError,
  updateJSON,
  useMemoryStoresForTests,
} from "./store.mjs";

// Подделка Netlify Blobs с тем же API, что у @netlify/blobs: проверяет, что адаптер правильно переводит вызовы.
function fakeBlobStore() {
  const data = new Map();
  let n = 0;
  return {
    async getWithMetadata(key, { type }) {
      assert.equal(type, "json");
      const entry = data.get(key);
      return entry ? { data: JSON.parse(entry.text), etag: entry.etag, metadata: {} } : null;
    },
    async setJSON(key, value, { onlyIfMatch, onlyIfNew } = {}) {
      const current = data.get(key);
      if (onlyIfNew && current) return { modified: false };
      if (onlyIfMatch !== undefined && current?.etag !== onlyIfMatch) return { modified: false };
      const etag = `"b${++n}"`;
      data.set(key, { text: JSON.stringify(value), etag });
      return { modified: true, etag };
    },
    async delete(key) { data.delete(key); },
    async list({ prefix = "" } = {}) {
      return { blobs: [...data.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key, etag: data.get(key).etag })), directories: [] };
    },
  };
}

// Подделка PostgREST (REST API Supabase) для таблицы kv: понимает те запросы, что шлёт драйвер, и отвечает как Supabase.
const SUPABASE_KEY = "sb_secret_test-key-for-unit-tests";
function fakePostgrest({ key: expectedKey = SUPABASE_KEY } = {}) {
  const rows = new Map();
  const id = (store, key) => `${store}\u0000${key}`;
  const calls = [];

  function matches(row, params) {
    for (const [column, condition] of params) {
      if (["select", "order", "limit", "offset", "on_conflict"].includes(column)) continue;
      const [op, ...rest] = condition.split(".");
      const value = rest.join(".");
      if (op === "eq" && String(row[column]) !== value) return false;
      if (op === "like") {
        const pattern = value.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/%/g, ".*").replace(/_/g, ".");
        if (!new RegExp(`^${pattern}$`).test(row[column])) return false;
      }
    }
    return true;
  }

  const fetchImpl = async (input, { method = "GET", headers = {}, body } = {}) => {
    const url = new URL(input);
    calls.push({ url, method, headers });
    assert.equal(url.pathname, "/rest/v1/kv");
    if (headers.apikey !== expectedKey) return Response.json({ message: "Invalid API key" }, { status: 401 });
    const params = [...url.searchParams.entries()];
    const prefer = headers.Prefer ?? "";
    const selected = (row) => {
      const select = url.searchParams.get("select");
      return select ? Object.fromEntries(select.split(",").map((c) => [c, row[c]])) : row;
    };

    if (method === "GET") {
      const limit = Number(url.searchParams.get("limit") ?? Infinity);
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const found = [...rows.values()].filter((row) => matches(row, params)).sort((a, b) => (a.key < b.key ? -1 : 1));
      return Response.json(found.slice(offset, offset + limit).map(selected));
    }
    if (method === "POST") {
      const row = JSON.parse(body);
      const existing = rows.get(id(row.store, row.key));
      if (existing && prefer.includes("resolution=ignore-duplicates")) return Response.json([], { status: 201 });
      rows.set(id(row.store, row.key), row);
      return Response.json([row], { status: 201 });
    }
    if (method === "PATCH") {
      const patch = JSON.parse(body);
      const updated = [];
      for (const row of rows.values()) {
        if (matches(row, params)) { Object.assign(row, patch); updated.push(row); }
      }
      return Response.json(updated);
    }
    if (method === "DELETE") {
      for (const [k, row] of rows) if (matches(row, params)) rows.delete(k);
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 405 });
  };
  return { fetchImpl, rows, calls };
}

// Один набор проверок для всех драйверов: при переезде на другой драйвер поведение не меняется.
const drivers = {
  supabase: async () => ({
    store: createSupabaseStore({ url: "https://test.supabase.co", secretKey: SUPABASE_KEY, store: "leads", fetchImpl: fakePostgrest().fetchImpl }),
    cleanup: async () => {},
  }),
  memory: async () => ({ store: createMemoryStore(), cleanup: async () => {} }),
  file: async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "store-test-"));
    return { store: createFileStore(dir), cleanup: () => rm(dir, { recursive: true, force: true }) };
  },
  blobs: async () => ({ store: createBlobsStore(fakeBlobStore()), cleanup: async () => {} }),
};

for (const [name, make] of Object.entries(drivers)) {
  test(`${name}: get, set, delete, list`, async () => {
    const { store, cleanup } = await make();
    try {
      assert.equal(await store.get("leads/a"), null);
      const written = await store.set("leads/a", { n: 1, text: "Привет" });
      assert.equal(written.ok, true);
      assert.deepEqual(await store.get("leads/a"), { value: { n: 1, text: "Привет" }, etag: written.etag });
      await store.set("leads/b", { n: 2 });
      await store.set("other", { n: 3 });
      assert.deepEqual(await store.list("leads/"), ["leads/a", "leads/b"]);
      assert.deepEqual(await store.list(), ["leads/a", "leads/b", "other"]);
      await store.delete("leads/a");
      await store.delete("missing");
      assert.equal(await store.get("leads/a"), null);
      assert.deepEqual(await store.list("leads/"), ["leads/b"]);
    } finally {
      await cleanup();
    }
  });

  test(`${name}: conditional writes by etag and onlyIfNew`, async () => {
    const { store, cleanup } = await make();
    try {
      assert.equal((await store.set("k", 1, { onlyIfNew: true })).ok, true);
      assert.equal((await store.set("k", 2, { onlyIfNew: true })).ok, false);
      const { etag } = await store.get("k");
      assert.equal((await store.set("k", 3, { onlyIfMatch: etag })).ok, true);
      assert.equal((await store.set("k", 4, { onlyIfMatch: etag })).ok, false);
      assert.equal((await store.get("k")).value, 3);
      assert.equal((await store.set("absent", 1, { onlyIfMatch: etag })).ok, false);
      await assert.rejects(store.set("k", 5, { onlyIfMatch: "x", onlyIfNew: true }), TypeError);
    } finally {
      await cleanup();
    }
  });

  test(`${name}: unsafe keys are rejected`, async () => {
    const { store, cleanup } = await make();
    try {
      for (const key of ["../etc/passwd", "a/../b", "/abs", "a//b", "a/", "", "с кириллицей", "a\\b"]) {
        await assert.rejects(store.set(key, 1), TypeError, key);
      }
    } finally {
      await cleanup();
    }
  });

  test(`${name}: updateJSON does not lose concurrent increments`, async () => {
    const { store, cleanup } = await make();
    try {
      await Promise.all(Array.from({ length: 10 }, () =>
        updateJSON(store, "counter", (value) => (value ?? 0) + 1, { attempts: 50 })));
      assert.equal((await store.get("counter")).value, 10);
    } finally {
      await cleanup();
    }
  });
}

test("memory store returns copies, not live objects", async () => {
  const store = createMemoryStore();
  const value = { list: [1] };
  await store.set("k", value);
  value.list.push(2);
  const read = (await store.get("k")).value;
  read.list.push(3);
  assert.deepEqual((await store.get("k")).value, { list: [1] });
});

test("updateJSON skips writing when the update returns undefined and fails after repeated conflicts", async () => {
  const store = createMemoryStore();
  assert.deepEqual(await updateJSON(store, "k", () => undefined), { value: null, changed: false });
  assert.equal(await store.get("k"), null);

  await store.set("k", 1);
  const racing = { ...store, set: async () => ({ ok: false }) };
  await assert.rejects(updateJSON(racing, "k", (v) => v + 1, { attempts: 3 }), StoreConflictError);
});

test("openStore picks the driver from STORAGE_DRIVER", async () => {
  await assert.rejects(openStore("Bad Name", { STORAGE_DRIVER: "memory" }), TypeError);
  await assert.rejects(openStore("leads", { STORAGE_DRIVER: "file" }), /STORAGE_DIR/);
  await assert.rejects(openStore("leads", { STORAGE_DRIVER: "file", STORAGE_DIR: "relative/dir" }), /STORAGE_DIR/);
  await assert.rejects(openStore("leads", { STORAGE_DRIVER: "mongo" }), /Неизвестный/);
  await assert.rejects(openStore("leads", {}), /SUPABASE_URL/);   // по умолчанию — supabase

  const dir = await mkdtemp(path.join(tmpdir(), "store-open-"));
  try {
    const store = await openStore("leads", { STORAGE_DRIVER: "file", STORAGE_DIR: dir });
    await store.set("x", { ok: true });
    assert.deepEqual((await createFileStore(path.join(dir, "leads")).get("x")).value, { ok: true });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  useMemoryStoresForTests();
  const a = await openStore("leads", { STORAGE_DRIVER: "blobs" });
  await a.set("x", 1);
  assert.equal((await (await openStore("leads")).get("x")).value, 1);
});

test("supabase: sections are separated, keys with _ and % are listed exactly, pages are followed", async () => {
  const fake = fakePostgrest();
  const make = (store) => createSupabaseStore({ url: "https://test.supabase.co/", secretKey: SUPABASE_KEY, store, fetchImpl: fake.fetchImpl });
  const leads = make("leads");
  const meta = make("meta");
  await leads.set("a_b/1", 1);
  await leads.set("axb/2", 2);       // «_» в like совпал бы с «x» — драйвер это отфильтровывает
  await meta.set("a_b/3", 3);
  assert.deepEqual(await leads.list("a_b/"), ["a_b/1"]);
  assert.deepEqual(await meta.list(), ["a_b/3"]);
  assert.equal(await meta.get("a_b/1"), null);

  for (let i = 0; i < 1005; i += 1) await leads.set(`p/${String(i).padStart(4, "0")}`, i);
  assert.equal((await leads.list("p/")).length, 1005);
  assert.ok(fake.calls.some((c) => c.url.searchParams.get("offset") === "1000"));
});

test("supabase: auth headers, errors without secrets, config checks", async () => {
  const fake = fakePostgrest({ key: "eyJhbGciOiJIUzI1NiJ9.legacy.jwt" });
  const legacy = createSupabaseStore({ url: "https://test.supabase.co", secretKey: "eyJhbGciOiJIUzI1NiJ9.legacy.jwt", store: "leads", fetchImpl: fake.fetchImpl });
  await legacy.set("k", 1);
  assert.equal(fake.calls[0].headers.Authorization, "Bearer eyJhbGciOiJIUzI1NiJ9.legacy.jwt");

  const modern = fakePostgrest();
  await createSupabaseStore({ url: "https://test.supabase.co", secretKey: SUPABASE_KEY, store: "leads", fetchImpl: modern.fetchImpl }).get("k");
  assert.equal(modern.calls[0].headers.Authorization, undefined);

  const wrong = createSupabaseStore({ url: "https://test.supabase.co", secretKey: "sb_secret_wrong-key", store: "leads", fetchImpl: fakePostgrest().fetchImpl });
  await assert.rejects(wrong.get("k"), (e) => e instanceof SupabaseError && e.status === 401 && !e.message.includes("sb_secret"));
  const offline = createSupabaseStore({ url: "https://test.supabase.co", secretKey: SUPABASE_KEY, store: "leads", fetchImpl: async () => { throw new TypeError("fetch failed"); } });
  await assert.rejects(offline.get("k"), (e) => e.status === "network_error");

  assert.equal((await createSupabaseStore({ url: "https://test.supabase.co", secretKey: SUPABASE_KEY, store: "leads", fetchImpl: fakePostgrest().fetchImpl })
    .set("k", 1, { onlyIfMatch: "not-a-uuid" })).ok, false);

  assert.deepEqual(getSupabaseConfig({ SUPABASE_URL: "https://abc.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_x" }),
    { url: "https://abc.supabase.co", secretKey: "sb_secret_x", table: "kv" });
  assert.throws(() => getSupabaseConfig({ SUPABASE_URL: "https://abc.supabase.co", SUPABASE_SECRET_KEY: "sb_publishable_x" }), /публичный ключ/);
  assert.throws(() => getSupabaseConfig({ SUPABASE_URL: "http://abc.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_x" }), /SUPABASE_URL/);
  assert.throws(() => getSupabaseConfig({ SUPABASE_URL: "https://abc.supabase.co" }), /SUPABASE_SECRET_KEY/);
});
