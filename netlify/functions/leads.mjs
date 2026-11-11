// POST /api/leads — заявка с сайта или из Mini App. Логика — server/handlers/leads.mjs (её же использует server.mjs на VPS).
import { createLeadHandler } from "../../server/handlers/leads.mjs";

export default (request, context) => createLeadHandler(request, { ip: context?.ip ?? null });

export const config = { path: "/api/leads" };
