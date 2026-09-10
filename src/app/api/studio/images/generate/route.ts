import { NextRequest, NextResponse } from "next/server";
import { resolveCompanyContext } from "@/lib/company-context/resolve";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { createServerSupabaseClient, createSupabaseAdminClient } from "@/lib/supabase/server";
import { withMutationProtection } from "@/lib/workspaces/assert-not-preview";
import { createStudioVisual } from "@/lib/rec-os/studio/create-studio-visual";
import { createStudioVisualDryRun, isDryRunActive, isFullZeroCostDryRun } from "@/lib/rec-os/studio/dry-run";
import type { StudioBriefInput } from "@/lib/rec-os/studio";
import type { StudioImageAsset, StudioImageAssetKind } from "@/lib/rec-os/studio/image/types";

/**
 * Sprint REC OS Studio Image Generation MVP V0.3 — POST
 * /api/studio/images/generate. ÚNICA rota nova desta sprint (Fase 22):
 * roda o pipeline completo (texto Vidigal + imagem) num único request,
 * para que a UI pareça uma única criação (Fase 20). POST
 * /api/studio/skills/execute (texto isolado) continua existindo,
 * inalterado.
 *
 * DOIS MODOS (Fase 2): Company Mode (companyId no corpo ->
 * resolveCompanyContext(), único resolver de autorização) e Free
 * Creation Mode (sem companyId -> só getCurrentUser(), nunca Company
 * fictícia, nunca resolveCompanyContext() forçado). Os dois exigem
 * usuário autenticado -- nunca geração anônima.
 *
 * Custo maior que o runtime textual (Fase 37): rate-limit mais
 * restritivo que /skills/execute.
 */
export const dynamic = "force-dynamic";
/**
 * Prompt 09 (Studio Image Provider Compatibility) — 60s é o teto real
 * do plano Hobby da Vercel (confirmado via API: team "caio21" ->
 * plan:"hobby" -- `maxDuration` não pode passar disso neste projeto,
 * independente do valor escrito aqui). Mesmo valor já usado e validado
 * em produção por outra rota deste projeto (api/olaclick/orders).
 * Sem isso, a rota ficava no timeout DEFAULT da Vercel (bem menor que
 * 60s), o que já seria insuficiente pro pipeline completo (texto +
 * eventual análise de referência + imagem) mesmo antes de qualquer
 * chamada individual se aproximar do próprio limite dela.
 */
export const maxDuration = 60;

/**
 * Prompt 03 (Studio Release Fix) — P2: rate limit em memória local à
 * instância/função serverless (best-effort, não distribuído entre
 * instâncias). Auditado nesta tarefa: não existe Redis/Upstash/
 * Vercel KV/Edge Config nem nenhuma outra infraestrutura de quota
 * distribuída em uso no projeto -- este é o MESMO padrão já usado em
 * várias outras rotas (admin/accounts, meta/hub-assets, olaclick/*,
 * contato, meu-negocio/ai/analyze, studio/skills/execute), não uma
 * lacuna específica do Studio. Criar um banco/serviço novo só para
 * isto infla o escopo sem necessidade real hoje (custo real de
 * geração já é limitado pelo provider de imagem + timeout). Ponto de
 * extensão: se o Studio precisar de quota realmente distribuída no
 * futuro, trocar `buckets` por um client de KV/Redis aqui, mantendo a
 * mesma chave (`company:{id}|{workspaceId}` / `free:{userId}`).
 */
const buckets = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 3;
const MAX_FREEFORM_BRIEF_CHARS = 4000;
const MAX_HEADLINE_INPUT_CHARS = 200;
const MAX_CTA_INPUT_CHARS = 80;
const MAX_ASSETS_PER_KIND = 4;
const MAX_ASSET_URL_CHARS = 8_000_000; // ~6MB binário em base64
const ASSET_URL_PATTERN = /^data:image\/(png|jpe?g|webp|gif);base64,|^https:\/\//i;

interface AssetInputBody {
  label?: string;
  url: string;
}

interface GenerateBody {
  skillId: string;
  input: StudioBriefInput;
  companyId?: string;
  assets: { references: StudioImageAsset[]; protectedAssets: StudioImageAsset[] };
}

function parseAssetList(list: unknown, kind: StudioImageAssetKind): StudioImageAsset[] | null {
  if (list === undefined) return [];
  if (!Array.isArray(list) || list.length > MAX_ASSETS_PER_KIND) return null;
  const parsed: StudioImageAsset[] = [];
  for (let i = 0; i < list.length; i++) {
    const raw = list[i] as Partial<AssetInputBody> | null;
    if (!raw || typeof raw.url !== "string" || raw.url.length === 0 || raw.url.length > MAX_ASSET_URL_CHARS) return null;
    if (!ASSET_URL_PATTERN.test(raw.url)) return null;
    parsed.push({ id: `${kind}-${i}`, label: typeof raw.label === "string" ? raw.label.slice(0, 120) : `${kind} ${i + 1}`, kind, url: raw.url });
  }
  return parsed;
}

type ParsedBody =
  | { ok: true; body: GenerateBody }
  | { ok: false; error: string };

function parseBody(raw: unknown): ParsedBody {
  if (!raw || typeof raw !== "object") return { ok: false, error: "JSON inválido." };
  const b = raw as Record<string, unknown>;
  const skillId = typeof b.skillId === "string" ? b.skillId.trim() : "";
  if (!skillId) return { ok: false, error: "skillId obrigatório." };
  const rawInput = (b.input && typeof b.input === "object" ? b.input : {}) as Record<string, unknown>;
  const companyId = typeof b.companyId === "string" && b.companyId.trim() ? b.companyId.trim() : undefined;

  // Prompt 03 (P1) -- campos estruturados de texto determinístico:
  // validados explicitamente (nunca um cast cego), nunca truncados em
  // silêncio (o usuário preencheu de propósito -- rejeita com erro
  // claro em vez de cortar o texto que ele escreveu).
  if (rawInput.headline !== undefined && (typeof rawInput.headline !== "string" || rawInput.headline.length > MAX_HEADLINE_INPUT_CHARS)) {
    return { ok: false, error: `Headline inválida (texto, até ${MAX_HEADLINE_INPUT_CHARS} caracteres).` };
  }
  if (rawInput.cta !== undefined && (typeof rawInput.cta !== "string" || rawInput.cta.length > MAX_CTA_INPUT_CHARS)) {
    return { ok: false, error: `CTA inválido (texto, até ${MAX_CTA_INPUT_CHARS} caracteres).` };
  }
  const input = rawInput as StudioBriefInput;

  const assetsRaw = (b.assets as { references?: unknown; protectedAssets?: unknown } | undefined) ?? {};
  const references = parseAssetList(assetsRaw.references, "reference");
  const protectedAssets = parseAssetList(assetsRaw.protectedAssets, "protected");
  if (references === null || protectedAssets === null) {
    return { ok: false, error: `No máximo ${MAX_ASSETS_PER_KIND} assets por tipo, cada um com URL válida (imagem em base64 ou https).` };
  }

  return { ok: true, body: { skillId, input, companyId, assets: { references, protectedAssets } } };
}

export const POST = withMutationProtection(async function POST(request: NextRequest) {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "JSON inválido." }, { status: 400 });
  }

  const parsed = parseBody(rawBody);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error, code: "STUDIO_SKILL_INVALID_INPUT" }, { status: 400 });
  }
  const { skillId, input, companyId, assets } = parsed.body;
  if (input.freeformBrief && input.freeformBrief.length > MAX_FREEFORM_BRIEF_CHARS) {
    return NextResponse.json({ ok: false, error: `Briefing livre excede ${MAX_FREEFORM_BRIEF_CHARS} caracteres.`, code: "STUDIO_SKILL_INVALID_INPUT" }, { status: 400 });
  }

  // ── Autenticação/autorização (Fase 2/10) ──────────────────────────
  let resolvedCompanyId: string | null = null;
  let resolvedCompanyName: string | null = null;
  let rateLimitKey: string;

  if (companyId) {
    // Company Mode -- único resolver canônico, nunca um segundo.
    const resolution = await resolveCompanyContext(companyId);
    if (!resolution.valid || !resolution.context) {
      const unauthorized = resolution.reason === "role_not_supported";
      return NextResponse.json(
        {
          ok: false,
          error: unauthorized ? "Sem permissão para executar esta skill nesta Company." : "Contexto de Company necessário para executar esta skill.",
          code: unauthorized ? "STUDIO_COMPANY_CONTEXT_UNAUTHORIZED" : "STUDIO_COMPANY_CONTEXT_REQUIRED",
        },
        { status: unauthorized ? 403 : 401 },
      );
    }
    resolvedCompanyId = resolution.context.companyId;
    resolvedCompanyName = resolution.context.companyName;
    rateLimitKey = `company:${resolution.context.companyId}|${resolution.context.workspaceId ?? "none"}`;
  } else {
    // Free Creation Mode -- só autenticação, NUNCA Company fictícia,
    // NUNCA resolveCompanyContext() forçado (ele sempre exige Company
    // para admin/cliente -- ver company-context/resolve.ts).
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ ok: false, error: "Sessão necessária.", code: "STUDIO_COMPANY_CONTEXT_REQUIRED" }, { status: 401 });
    }
    rateLimitKey = `free:${user.id}`;
  }

  const now = Date.now();
  const bucket = buckets.get(rateLimitKey);
  if (bucket && bucket.resetAt > now && bucket.count >= MAX_REQUESTS_PER_WINDOW) {
    return NextResponse.json({ ok: false, error: "Limite temporário atingido. Tente novamente em um minuto." }, { status: 429 });
  }
  buckets.set(rateLimitKey, !bucket || bucket.resetAt <= now ? { count: 1, resetAt: now + WINDOW_MS } : { ...bucket, count: bucket.count + 1 });

  // Cliente admin só para o enriquecimento de DNA (best-effort, nunca
  // bloqueia a geração se o service role não estiver configurado --
  // ausência de DNA é um estado válido, "ausente permanece ausente").
  const sessionDb = await createServerSupabaseClient();
  let db = sessionDb;
  try {
    db = createSupabaseAdminClient();
  } catch {
    db = sessionDb;
  }

  try {
    const dryRun = isDryRunActive();
    const result = dryRun
      ? await createStudioVisualDryRun({
          skillId, input, companyId: resolvedCompanyId, companyName: resolvedCompanyName, assets, db,
          fullZeroCost: isFullZeroCostDryRun(),
        })
      : await createStudioVisual({
          skillId, input, companyId: resolvedCompanyId, companyName: resolvedCompanyName, assets, db,
        });

    const textOk = result.text.status === "completed";
    const imageOk = result.image?.status === "completed";
    const statusCode = !textOk
      ? (result.text.error?.code === "STUDIO_SKILL_NOT_FOUND" ? 404
        : result.text.error?.code === "STUDIO_SKILL_INVALID_INPUT" ? 400
        : result.text.error?.code === "STUDIO_AI_PROVIDER_UNAVAILABLE" || result.text.error?.code === "STUDIO_SKILL_RUNTIME_UNAVAILABLE" ? 503
        : 502)
      : !result.image
        ? 502
        : imageOk ? 200
        : result.image.error?.code === "STUDIO_IMAGE_PROVIDER_UNAVAILABLE" ? 503
        : result.image.error?.code === "STUDIO_OUTPUT_TOO_LARGE" ? 413
        : 502;

    return NextResponse.json(
      {
        ok: textOk && imageOk,
        text: result.text,
        image: result.image,
        // FASE 31G -- só presente quando o dry run está ativo; front real (Studio) nunca depende deste campo, apenas Codex/QA o inspeciona.
        ...(dryRun ? { dryRun: true, diagnostics: "packet" in result ? result.packet : null } : {}),
      },
      { status: statusCode },
    );
  } catch (error) {
    console.error("[api/studio/images/generate] falha inesperada", { message: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ ok: false, error: "Não foi possível criar a peça no momento." }, { status: 500 });
  }
});
