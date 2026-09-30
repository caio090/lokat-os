/**
 * Meu PP — base das rotas /api/admin/meu-pp/*.
 *
 * REGRA: toda leitura/escrita pessoal passa pela SESSÃO do próprio usuário
 * (createServerSupabaseClient). Nunca admin client/service role (o banco
 * também revoga service_role nas tabelas pessoais), nunca Company context,
 * nunca activity_logs/productivity_*. `user_id` nunca vem do cliente.
 */
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

type ServerClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;
export type PersonalSession = { supabase: ServerClient; userId: string };

export const fail = (code: string, status: number, message?: string) => NextResponse.json({ ok: false, code, ...(message ? { message } : {}) }, { status });
export const done = (data: Record<string, unknown> = {}) => NextResponse.json({ ok: true, ...data });

export async function personalSession(): Promise<PersonalSession | NextResponse> {
  if (!isSupabaseConfigured) return fail("unavailable", 503);
  const supabase = await createServerSupabaseClient().catch(() => null);
  if (!supabase) return fail("unavailable", 503);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return fail("unauthenticated", 401);
  return { supabase, userId: user.id };
}

export async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/* ── validação mínima (sem dependência nova) ── */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** texto aparado; undefined/"" → null; corta no limite. */
export function text(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}
export const uuid = (v: unknown) => (typeof v === "string" && UUID_RE.test(v) ? v : null);
export const dateKey = (v: unknown) => (typeof v === "string" && DATE_RE.test(v) ? v : null);
export const time = (v: unknown) => (typeof v === "string" && TIME_RE.test(v) ? v : null);

/** Erro do banco → resposta sem vazar detalhe interno. */
export function dbFail(error: { code?: string; message?: string } | null) {
  if (!error) return fail("db_error", 500);
  if (error.code === "42501") return fail("forbidden", 403);
  if (error.code === "P0002") return fail("not_found", 404);
  if (error.code === "22023" || error.code === "23514" || error.code === "23505" || error.code === "22P02" || error.code === "22007") return fail("invalid", 400);
  if (error.code === "P0001") return fail("history_locked", 409, "Decisões antigas não são reescritas — registre uma nova decisão.");
  return fail("db_error", 500);
}
