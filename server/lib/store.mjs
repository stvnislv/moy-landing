// Хранилище. ВСЯ работа с данными идёт через этот модуль — при переезде (например, на российский VPS)
// меняется только выбор драйвера в STORAGE_DRIVER, код заявок, контента и оплаты не трогается.
//
// Драйверы:
//   supabase — таблица kv в Supabase (основной, по умолчанию; SUPABASE_URL, SUPABASE_SECRET_KEY);
//   file     — JSON-файлы в папке STORAGE_DIR (на будущее — российский VPS: один процесс Node, запись через rename);
//   blobs    — Netlify Blobs (запасной);
//   memory   — в памяти, для тестов.
//
// Интерфейс хранилища (одного «раздела», например leads или content):
//   get(key)                         → { value, etag } | null
//   set(key, value, { onlyIfMatch?, onlyIfNew? }) → { ok, etag }   ok=false — условие не выполнено
//   delete(key)                      → void
//   list(prefix?)                    → [key, …] по алфавиту
// Значения — только JSON. etag — непрозрачная строка: сравнивать можно только на равенство.

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const STORE_NAME = /^[a-z][a-z0-9-]{1,40}$/;
// Ключ: латиница, цифры, «-», «_», «.», «/» как разделитель; без «..» и пустых частей — безопасно и для файлов.
const KEY = /^(?!.*\/\/)(?!\/)(?!.*\/$)[A-Za-z0-9._\/-]{1,200}$/;

export class StoreConflictError extends Error {
  constructor(key) {
    super(`Не удалось записать «${key}»: данные одновременно меняли в другом месте.`);
  }
}

function checkKey(key) {
  if (typeof key !== "string" || !KEY.test(key) || key.split("/").some((part) => part === "." || part === "..")) {
    throw new TypeError(`Недопустимый ключ хранилища: ${JSON.stringify(key)}`);
  }
}

function checkConditions(options) {
  if (options.onlyIfMatch !== undefined && options.onlyIfNew) {
    throw new TypeError("onlyIfMatch и onlyIfNew нельзя задавать вместе.");
  }
}

// ---------- memory ----------
export function createMemoryStore() {
  const data = new Map();
  let counter = 0;
  return {
    async get(key) {
      checkKey(key);
      const entry = data.get(key);
      return entry ? { value: structuredClone(entry.value), etag: entry.etag } : null;
    },
    async set(key, value, options = {}) {
      checkKey(key);
      checkConditions(options);
      const current = data.get(key);
      if (options.onlyIfNew && current) return { ok: false };
      if (options.onlyIfMatch !== undefined && current?.etag !== options.onlyIfMatch) return { ok: false };
      const etag = `m${++counter}`;
      data.set(key, { value: JSON.parse(JSON.stringify(value)), etag });   // как настоящее хранилище: только JSON
      return { ok: true, etag };
    },
    async delete(key) {
      checkKey(key);
      data.delete(key);
    },
    async list(prefix = "") {
      return [...data.keys()].filter((key) => key.startsWith(prefix)).sort();
    },
  };
}

// ---------- file ----------
// Каждый ключ — файл <dir>/<store>/<key>.json. etag — хэш содержимого.
// Проверка условия и запись идут под замком на ключ, поэтому в пределах одного процесса гонок нет.
// Запускать на VPS одним процессом (не кластером), иначе замки не работают.
export function createFileStore(dir) {
  const locks = new Map();
  const fileOf = (key) => path.join(dir, `${key}.json`);
  const etagOf = (text) => createHash("sha256").update(text).digest("base64url").slice(0, 22);

  async function withLock(key, fn) {
    const previous = locks.get(key) ?? Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    const chain = previous.then(() => current);
    locks.set(key, chain);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (locks.get(key) === chain) locks.delete(key);
    }
  }

  async function readText(key) {
    try {
      return await readFile(fileOf(key), "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  async function walk(base, prefix) {
    let entries;
    try {
      entries = await readdir(base, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    const keys = [];
    for (const entry of entries) {
      if (entry.isDirectory()) keys.push(...await walk(path.join(base, entry.name), `${prefix}${entry.name}/`));
      else if (entry.name.endsWith(".json")) keys.push(`${prefix}${entry.name.slice(0, -5)}`);
    }
    return keys;
  }

  return {
    async get(key) {
      checkKey(key);
      const text = await readText(key);
      return text === null ? null : { value: JSON.parse(text), etag: etagOf(text) };
    },
    async set(key, value, options = {}) {
      checkKey(key);
      checkConditions(options);
      return withLock(key, async () => {
        const currentText = await readText(key);
        if (options.onlyIfNew && currentText !== null) return { ok: false };
        if (options.onlyIfMatch !== undefined && (currentText === null || etagOf(currentText) !== options.onlyIfMatch)) {
          return { ok: false };
        }
        const text = JSON.stringify(value);
        const file = fileOf(key);
        await mkdir(path.dirname(file), { recursive: true });
        const temp = `${file}.${randomUUID()}.tmp`;
        await writeFile(temp, text, { mode: 0o600 });
        await rename(temp, file);
        return { ok: true, etag: etagOf(text) };
      });
    },
    async delete(key) {
      checkKey(key);
      await withLock(key, () => rm(fileOf(key), { force: true }));
    },
    async list(prefix = "") {
      return (await walk(dir, "")).filter((key) => key.startsWith(prefix)).sort();
    },
  };
}

// ---------- Netlify Blobs ----------
export function createBlobsStore(blobStore) {
  return {
    async get(key) {
      checkKey(key);
      const entry = await blobStore.getWithMetadata(key, { type: "json" });
      return entry ? { value: entry.data, etag: entry.etag } : null;
    },
    async set(key, value, options = {}) {
      checkKey(key);
      checkConditions(options);
      const conditions = {};
      if (options.onlyIfNew) conditions.onlyIfNew = true;
      if (options.onlyIfMatch !== undefined) conditions.onlyIfMatch = options.onlyIfMatch;
      const result = await blobStore.setJSON(key, value, conditions);
      return { ok: result.modified, etag: result.etag };
    },
    async delete(key) {
      checkKey(key);
      await blobStore.delete(key);
    },
    async list(prefix = "") {
      const { blobs } = await blobStore.list(prefix ? { prefix } : {});
      return blobs.map((blob) => blob.key).sort();
    },
  };
}

// ---------- Supabase (PostgREST) ----------
// Таблица (supabase/schema.sql): kv(store, key, value jsonb, etag uuid, updated_at), первичный ключ (store, key).
// Доступ только с секретным ключом на сервере; в браузер ключ не попадает. Без библиотек — обычный fetch.
export class SupabaseError extends Error {
  constructor(status, code) {
    super(`Supabase: ${status}${code ? ` ${code}` : ""}`);
    this.status = status;
    this.code = code;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = 1000;

export function createSupabaseStore({ url, secretKey, table = "kv", store, fetchImpl = globalThis.fetch }) {
  const base = `${url.replace(/\/$/, "")}/rest/v1/${table}`;
  const auth = { apikey: secretKey };
  // Старый ключ service_role — это JWT, его нужно передать и в Authorization. Новый sb_secret_… — только в apikey.
  if (secretKey.startsWith("eyJ")) auth.Authorization = `Bearer ${secretKey}`;
  const eq = (value) => `eq.${encodeURIComponent(value)}`;
  const where = (key) => `store=${eq(store)}&key=${eq(key)}`;

  async function request(query, { method = "GET", headers = {}, body } = {}) {
    let response;
    try {
      response = await fetchImpl(`${base}?${query}`, {
        method,
        headers: { ...auth, ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      throw new SupabaseError("network_error", error?.cause?.code ?? error?.name);
    }
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    // В текст ошибки — только код ответа и код PostgREST, без тела и ключа.
    if (!response.ok) throw new SupabaseError(response.status, data?.code);
    return data;
  }

  const row = (key, value) => ({ store, key, value, etag: randomUUID(), updated_at: new Date().toISOString() });

  return {
    async get(key) {
      checkKey(key);
      const rows = await request(`select=value,etag&${where(key)}`);
      return rows?.length ? { value: rows[0].value, etag: rows[0].etag } : null;
    },
    async set(key, value, options = {}) {
      checkKey(key);
      checkConditions(options);
      const data = row(key, JSON.parse(JSON.stringify(value)));

      if (options.onlyIfMatch !== undefined) {
        if (!UUID.test(options.onlyIfMatch)) return { ok: false };
        const updated = await request(`${where(key)}&etag=${eq(options.onlyIfMatch)}`, {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: { value: data.value, etag: data.etag, updated_at: data.updated_at },
        });
        return updated?.length ? { ok: true, etag: data.etag } : { ok: false };
      }

      const inserted = await request("on_conflict=store,key", {
        method: "POST",
        headers: { Prefer: `resolution=${options.onlyIfNew ? "ignore" : "merge"}-duplicates,return=representation` },
        body: data,
      });
      return inserted?.length ? { ok: true, etag: data.etag } : { ok: false };
    },
    async delete(key) {
      checkKey(key);
      await request(where(key), { method: "DELETE" });
    },
    async list(prefix = "") {
      // like в PostgREST: «*» — любые символы. «_» и «%» в префиксе — тоже шаблоны, поэтому результат дофильтровывается.
      const filter = prefix ? `&key=like.${encodeURIComponent(`${prefix}*`)}` : "";
      const keys = [];
      for (let offset = 0; ; offset += PAGE) {
        const rows = await request(`select=key&store=${eq(store)}${filter}&order=key.asc&limit=${PAGE}&offset=${offset}`);
        keys.push(...rows.map((r) => r.key));
        if (rows.length < PAGE) break;
      }
      return keys.filter((key) => key.startsWith(prefix)).sort();
    },
  };
}

export function getSupabaseConfig(env = process.env) {
  const url = env.SUPABASE_URL?.trim();
  const secretKey = env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !/^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+\/?$/i.test(url)) throw new Error("Не задан корректный SUPABASE_URL.");
  if (!secretKey) throw new Error("Не задан SUPABASE_SECRET_KEY.");
  if (secretKey.startsWith("sb_publishable_")) {
    throw new Error("В SUPABASE_SECRET_KEY указан публичный ключ (sb_publishable_…). Нужен секретный: sb_secret_… или service_role.");
  }
  return { url, secretKey, table: env.SUPABASE_TABLE?.trim() || "kv" };
}

// ---------- выбор драйвера ----------
const memoryStores = new Map();
let testDriver = null;

/** Для тестов: все openStore() возвращают хранилища в памяти. resetMemoryStores() — очистить. */
export function useMemoryStoresForTests() {
  testDriver = "memory";
  memoryStores.clear();
}

export function resetMemoryStores() {
  memoryStores.clear();
}

/** Открыть раздел хранилища по имени: leads, content, media, meta… */
export async function openStore(name, env = process.env) {
  if (!STORE_NAME.test(name)) throw new TypeError(`Недопустимое имя хранилища: ${name}`);
  const driver = testDriver ?? env.STORAGE_DRIVER ?? "supabase";

  if (driver === "memory") {
    if (!memoryStores.has(name)) memoryStores.set(name, createMemoryStore());
    return memoryStores.get(name);
  }
  if (driver === "supabase") {
    return createSupabaseStore({ ...getSupabaseConfig(env), store: name });
  }
  if (driver === "file") {
    const dir = env.STORAGE_DIR?.trim();
    if (!dir || !path.isAbsolute(dir)) throw new Error("Для STORAGE_DRIVER=file задайте абсолютный путь STORAGE_DIR.");
    return createFileStore(path.join(dir, name));
  }
  if (driver === "blobs") {
    const { getStore } = await import("@netlify/blobs");
    // strong — чтение сразу видит последнюю запись: без этого условные обновления по etag часто конфликтуют.
    return createBlobsStore(getStore({ name, consistency: "strong" }));
  }
  throw new Error(`Неизвестный STORAGE_DRIVER: ${driver}`);
}

/**
 * Прочитать — изменить — записать с проверкой etag. update(current|null) возвращает новое значение
 * (или undefined — ничего не записывать). При одновременной записи повторяет до attempts раз.
 */
export async function updateJSON(store, key, update, { attempts = 5 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const current = await store.get(key);
    const next = await update(current ? current.value : null);
    if (next === undefined) return { value: current?.value ?? null, changed: false };
    const result = current
      ? await store.set(key, next, { onlyIfMatch: current.etag })
      : await store.set(key, next, { onlyIfNew: true });
    if (result.ok) return { value: next, changed: true, etag: result.etag };
  }
  throw new StoreConflictError(key);
}
