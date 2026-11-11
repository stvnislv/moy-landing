// POST /api/telegram — webhook бота. Логика — server/handlers/telegram.mjs.
import { telegramWebhookHandler } from "../../server/handlers/telegram.mjs";

export default (request) => telegramWebhookHandler(request);

export const config = { path: "/api/telegram" };
