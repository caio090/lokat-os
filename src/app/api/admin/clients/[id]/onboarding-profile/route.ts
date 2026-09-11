import { NextResponse } from "next/server";
import { createServerSupabaseClient, createSupabaseAdminClient, hasSupabaseServiceRoleKey } from "@/lib/supabase/server";
import { withMutationProtection } from "@/lib/workspaces/assert-not-preview";
import { resolveRoleForCurrentUser } from "@/lib/rec-os/studio/production-qa-authorization";
import { canAccessAdmin } from "@/lib/access-control";
import { ONBOARDING_PROFILE_FIELDS } from "@/lib/rec-os/studio/business-context";

/**
 * FASE 31O (Admin Company DNA Editor) — GET/PUT do "Company DNA" de
 * UMA Company EXISTENTE (`onboarding_profiles`, mesma tabela e mesmas
 * colunas que business-context.ts já lê -- ver ONBOARDING_PROFILE_FIELDS,
 * fonte única). NUNCA cria uma Company nova (`clients` é só lido, nunca
 * escrito aqui) -- `client_id` vem SEMPRE do path param, nunca do body
 * (mesmo se o body tentar enviar `client_id`/`id`, é ignorado -- só os
 * campos em ONBOARDING_PROFILE_FIELDS são aceitos). Nunca muda
 * `clients.status` -- essa é uma decisão de produto explicitamente fora
 * de escopo desta fase (ver relatório).
 *
 * Autorização: role real (profiles.role, nunca confiada do cliente) via
 * resolveRoleForCurrentUser() + canAccessAdmin() (admin/super_admin) --
 * mesma autoridade central de src/lib/access-control.ts, nunca uma
 * segunda lista de roles duplicada aqui.
 */

const MAX_TEXT_FIELD_CHARS = 4000;
const MAX_ARRAY_ITEMS = 30;
const MAX_ARRAY_ITEM_CHARS = 120;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{3,8}$/;
/** FASE 31O §7/8 -- logo é PNG/SVG/WEBP (nunca gerado/redesenhado por IA); JPEG aceito por ser o que attachment-uploader.tsx já permite em geral, mas nunca vídeo/PDF/zip/etc. */
const LOGO_URL_EXTENSION_PATTERN = /\.(png|svg|webp|jpe?g)(\?.*)?$/i;

type RouteParams = { params: Promise<{ id: string }> };

async function authorize() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, status: 401 as const, error: "unauthenticated" };
  const role = await resolveRoleForCurrentUser();
  if (!role || !canAccessAdmin(role)) return { ok: false as const, status: 403 as const, error: "forbidden" };
  return { ok: true as const, role };
}

/** Sempre tenta o client admin (bypassa RLS pra ler/escrever uma Company arbitrária, nunca só a "própria") -- cai pro client de sessão só se a service role key não estiver configurada (mesmo padrão de admin/empresa/page.tsx e create-studio-visual.ts). */
function resolveDbClient(session: Awaited<ReturnType<typeof createServerSupabaseClient>>) {
  try {
    return createSupabaseAdminClient();
  } catch {
    return session;
  }
}

// GET /api/admin/clients/[id]/onboarding-profile
export async function GET(_req: Request, { params }: RouteParams) {
  const { id } = await params;
  try {
    const auth = await authorize();
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const session = await createServerSupabaseClient();
    const db = resolveDbClient(session);

    const clientResult = await db.from("clients").select("id, company_name").eq("id", id).maybeSingle();
    if (!clientResult.data) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const profileResult = await db.from("onboarding_profiles").select(ONBOARDING_PROFILE_FIELDS.join(", ")).eq("client_id", id).maybeSingle();

    return NextResponse.json({
      clientId: (clientResult.data as { id: string }).id,
      companyName: (clientResult.data as { company_name: string | null }).company_name,
      profile: profileResult.data ?? null,
    });
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

/** `undefined` = campo ausente do body (nunca tocado no upsert). `null`/string = valor real (inclusive limpar o campo enviando ""/null). Valor de tipo errado é tratado como ausente -- nunca grava lixo. */
function sanitizeText(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().slice(0, MAX_TEXT_FIELD_CHARS);
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizeStringArray(value: unknown): string[] | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!Array.isArray(value)) return undefined;
  return value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim().slice(0, MAX_ARRAY_ITEM_CHARS))
    .filter((v) => v.length > 0)
    .slice(0, MAX_ARRAY_ITEMS);
}

/**
 * FASE 31O §7/8 -- valida a URL resultante do logo (extensão de imagem
 * permitida + protocolo http(s)) server-side, nunca confiando só no
 * client-side do AttachmentUploader (que é genérico e aceita vídeo/PDF/
 * ZIP para outros usos). Nunca faz uma requisição de rede aqui -- só
 * valida a forma da string, mesmo padrão fail-closed dos outros
 * sanitizers desta rota.
 */
function sanitizeLogoUrl(value: unknown): string | null | undefined {
  const sanitized = sanitizeText(value);
  if (!sanitized) return sanitized;
  let parsed: URL;
  try {
    parsed = new URL(sanitized);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined;
  if (!LOGO_URL_EXTENSION_PATTERN.test(parsed.pathname)) return undefined;
  return sanitized;
}

/**
 * FASE 31O §6/9 -- `brand_colors` é `jsonb`, mas nenhum código hoje lê
 * uma chave interna específica (business-context.ts só repassa
 * `row.brand_colors` como `unknown`, opaco). Convenção adotada AQUI,
 * pela primeira vez, pra ter uma UI editável: array de `{label, hex}`.
 * Documentada explicitamente -- nunca inventa um formato incompatível
 * com o que já existe, porque nada mais ainda depende de um formato.
 */
function sanitizeBrandColors(value: unknown): { label: string; hex: string }[] | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!Array.isArray(value)) return undefined;
  return value
    .filter((v): v is Record<string, unknown> => !!v && typeof v === "object")
    .map((v) => ({
      label: typeof v.label === "string" ? v.label.trim().slice(0, 60) : "",
      hex: typeof v.hex === "string" && HEX_COLOR_PATTERN.test(v.hex.trim()) ? v.hex.trim() : "",
    }))
    .filter((v) => v.label || v.hex)
    .slice(0, MAX_ARRAY_ITEMS);
}

// PUT /api/admin/clients/[id]/onboarding-profile
export const PUT = withMutationProtection(async function PUT(req: Request, { params }: RouteParams) {
  const { id } = await params;
  try {
    const auth = await authorize();
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const session = await createServerSupabaseClient();
    const db = resolveDbClient(session);

    // FASE 31O §1 -- nunca cria Company nova: a linha em `clients` precisa já existir.
    const clientResult = await db.from("clients").select("id").eq("id", id).maybeSingle();
    if (!clientResult.data) return NextResponse.json({ error: "not_found" }, { status: 404 });

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    }

    // FASE 31O §6/13 -- whitelist EXATA (ONBOARDING_PROFILE_FIELDS, a
    // mesma lista que business-context.ts lê) -- client_id NUNCA vem do
    // body, mesmo se enviado; sempre o path param.
    const update: Record<string, unknown> = {};
    for (const field of ONBOARDING_PROFILE_FIELDS) {
      const raw = body[field];
      const sanitized =
        field === "tone_of_voice" ? sanitizeStringArray(raw)
        : field === "brand_colors" ? sanitizeBrandColors(raw)
        : field === "logo_url" ? sanitizeLogoUrl(raw)
        : sanitizeText(raw);
      if (sanitized !== undefined) update[field] = sanitized;
    }

    const serviceRolePresent = hasSupabaseServiceRoleKey();
    // FASE 31O §5 -- upsert por client_id: INSERT quando a Company ainda
    // não tem onboarding_profile (a maioria hoje -- a tabela está vazia
    // em Production), UPDATE quando já existe. Mesma convenção de
    // onConflict já usada em onboarding/conclusao/page.tsx, nunca uma
    // segunda lógica de upsert inventada aqui.
    const { error } = await db.from("onboarding_profiles").upsert({ client_id: id, ...update }, { onConflict: "client_id" });

    if (error) {
      console.error("[api/admin/clients/[id]/onboarding-profile PUT] erro ao salvar Company DNA", {
        clientId: id, role: auth.role, serviceRolePresent, supabaseError: error,
      });
      return NextResponse.json({ error: "Não foi possível salvar o Company DNA. Verifique permissões do banco.", technical: error }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
});
