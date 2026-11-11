-- Хранилище сайта в Supabase: одна таблица «ключ — значение» (драйвер supabase в server/lib/store.mjs).
-- Выполнить один раз: Supabase → SQL Editor → New query → вставить → Run.
-- Устроено так же, как драйвер file: при переезде данные копируются между драйверами без изменений.

create table if not exists public.kv (
  store      text        not null,            -- раздел: leads, content, meta…
  key        text        not null,            -- ключ внутри раздела: lead/<id>, index, link/<token>…
  value      jsonb       not null,            -- данные
  etag       uuid        not null default gen_random_uuid(),  -- меняется при каждой записи; для условных обновлений
  updated_at timestamptz not null default now(),
  primary key (store, key)
);

-- Защита: RLS включён, политик нет. Публичный ключ (sb_publishable_…) таблицу не видит;
-- читать и писать может только сервер с секретным ключом (sb_secret_… / service_role).
alter table public.kv enable row level security;
revoke all on table public.kv from anon, authenticated;
