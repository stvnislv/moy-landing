import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createBlobsStore,
  createFileStore,
  createMemoryStore,
  openStore,
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

// Один набор проверок для всех драйверов: при переезде на другой драйвер поведение не меняется.
const drivers = {
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
