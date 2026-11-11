// Ограничение числа действий (например, заявок) с одного адреса или Telegram-аккаунта за окно времени.
// Сам IP не хранится: ключ — хэш с солью IP_HASH_SALT. Старые окна удаляет уборка (этап 7).

import { createHash } from "node:crypto";
import { updateJSON } from "./store.mjs";

export function getSalt(env = process.env) {
  const salt = env.IP_HASH_SALT?.trim();
  if (!salt || salt.length < 16) throw new Error("Не задан IP_HASH_SALT (не короче 16 символов).");
  return salt;
}

/**
 * Засчитать одно действие. true — можно, false — лимит исчерпан (действие не засчитывается).
 * subject — «ip:1.2.3.4» или «tg:123».
 */
export async function hitRateLimit(store, { subject, salt, limit, windowMs, now = Date.now() }) {
  const hash = createHash("sha256").update(`${salt}:${subject}`).digest("base64url").slice(0, 22);
  const windowStart = Math.floor(now / windowMs) * windowMs;
  let allowed = false;
  await updateJSON(store, `rate/${hash}/${windowStart}`, (count) => {
    const current = count ?? 0;
    allowed = current < limit;
    return allowed ? current + 1 : undefined;
  });
  return allowed;
}
