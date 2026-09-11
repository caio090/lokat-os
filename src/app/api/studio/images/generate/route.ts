import { NextRequest, NextResponse } from "next/server";
import { resolveCompanyContext } from "@/lib/company-context/resolve";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { createServerSupabaseClient, createSupabaseAdminClient } from "@/lib/supabase/server";
import { withMutationProtection } from "@/lib/workspaces/assert-not-preview";
import { createStudioVisual } from "@/lib/rec-os/studio/create-studio-visual";
import { createStudioVisualDryRun, isDryRunActive, isFullZeroCostDryRun } from "@/lib/rec-os/studio/dry-run";
import { isProductionQaFlagEnabled, evaluateProductionQaAccess, resolveRoleForCurrentUser } from "@/lib/rec-os/studio/production-qa-authorization";
import { canAccessPlatformCentral } from "@/lib/access-control";
import type { StudioBriefInput, StudioGenerationMode } from "@/lib/rec-os/studio";
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
 * Prompt 09 (Studio Image Provider Compatibility) — originalmente 60s,
 * o teto real do plano Hobby SEM Fluid Compute.
 *
 * FASE 31K (Sunburst Studio QA Readiness) — decisão de arquitetura já
 * tomada na FASE 31J: este projeto roda Hobby + Fluid Compute
 * (confirmado habilitado), que suporta até 300s de `maxDuration`, sem
 * upgrade de plano e sem custo adicional. Subiu pra 180s -- orçamento
 * validado matematicamente (referência até 20s + Vidigal 15s + imagem
 * até 120s + compositor ~1s + overhead de auth/resposta ≈ 158s, com
 * ~22s de margem real). Necessário pra permitir gpt-image-2.5-sunburst
 * (benchmark real observado: 77,9s) terminar sem abortar prematuramente.
 */
export const maxDuration = 180;

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

/** FASE 31G.2 -- único valor aceito; qualquer outra coisa é tratada como ausente (nunca um qaMode inventado/parcial). */
const QA_MODE_DRY_RUN = "dry_run" as const;

/**
 * FASE 31K (Sunburst Studio QA Readiness) §7/8/9 -- override de
 * model/quality pra UMA geração real controlada, autorizado SOMENTE
 * quando: (a) `LKT_PRODUCTION_SUNBURST_QA` ligada, (b) sessão real,
 * (c) role real === "super_admin" (canAccessPlatformCentral -- mais
 * restrito que o admin/super_admin do qaMode=dry_run, de propósito:
 * §7 pede especificamente Super Admin). Único valor aceito em cada
 * campo -- qualquer outro é tratado como ausente, nunca um override
 * parcial/inventado. Ausência de ambos preserva 100% do comportamento
 * normal (nenhuma checagem de flag/role roda nesse caso).
 */
const QA_SUNBURST_MODEL = "gpt-image-2.5-sunburst" as const;
const QA_SUNBURST_QUALITY = "high" as const;

function isProductionSunburstQaFlagEnabled(): boolean {
  const raw = process.env.LKT_PRODUCTION_SUNBURST_QA?.trim().toLowerCase();
  return raw === "1" || raw === "true";
}

interface GenerateBody {
  skillId: string;
  /**
   * FASE 31L -- mesmo tipo exportado em StudioImageGenerateRequestBody
   * (studio/types.ts), reaproveitado aqui como o shape real que a rota
   * de fato entende (assets já resolvidos pra StudioImageAsset[], nunca
   * o StudioImageAssetInputBody[] cru do request -- ver parseAssetList).
   */
  mode?: StudioGenerationMode;
  input: StudioBriefInput;
  companyId?: string;
  assets: { references: StudioImageAsset[]; protectedAssets: StudioImageAsset[] };
  qaMode?: typeof QA_MODE_DRY_RUN;
  qaImageModel?: typeof QA_SUNBURST_MODEL;
  qaImageQuality?: typeof QA_SUNBURST_QUALITY;
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
  // FASE 31L §2/3 -- SEMPRE lido do nível SUPERIOR do body, nunca de
  // dentro de `input` (StudioBriefInput.companyId é um campo diferente,
  // genérico, usado por outras rotas -- ver studio/types.ts). Este é o
  // único valor que autoriza Company Mode nesta rota.
  const companyId = typeof b.companyId === "string" && b.companyId.trim() ? b.companyId.trim() : undefined;
  const mode: StudioGenerationMode | undefined = b.mode === "company" || b.mode === "free" ? b.mode : undefined;

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

  const qaMode = b.qaMode === QA_MODE_DRY_RUN ? QA_MODE_DRY_RUN : undefined;
  const qaImageModel = b.qaImageModel === QA_SUNBURST_MODEL ? QA_SUNBURST_MODEL : undefined;
  const qaImageQuality = b.qaImageQuality === QA_SUNBURST_QUALITY ? QA_SUNBURST_QUALITY : undefined;

  return { ok: true, body: { skillId, mode, input, companyId, assets: { references, protectedAssets }, qaMode, qaImageModel, qaImageQuality } };
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
  const { skillId, mode, input, companyId, assets, qaMode, qaImageModel, qaImageQuality } = parsed.body;
  if (input.freeformBrief && input.freeformBrief.length > MAX_FREEFORM_BRIEF_CHARS) {
    return NextResponse.json({ ok: false, error: `Briefing livre excede ${MAX_FREEFORM_BRIEF_CHARS} caracteres.`, code: "STUDIO_SKILL_INVALID_INPUT" }, { status: 400 });
  }

  // FASE 31L §4 -- causa raiz real do bug "Company selecionada na UI
  // vira free_mode": mode==="company" enviado sem companyId (ou com um
  // valor que não sobreviveu à validação acima) NUNCA mais cai
  // silenciosamente em Free Mode -- erro explícito, 400, antes de
  // qualquer resolução/geração. mode ausente preserva o comportamento
  // de antes desta fase (decide só pela presença de companyId).
  if (mode === "company" && !companyId) {
    return NextResponse.json(
      { ok: false, error: "Nenhuma empresa selecionada para o modo Company -- selecione uma empresa ou troque para criação livre.", code: "STUDIO_COMPANY_MODE_ID_MISSING" },
      { status: 400 },
    );
  }

  // ── Autenticação/autorização (Fase 2/10) ──────────────────────────
  let resolvedCompanyId: string | null = null;
  let resolvedCompanyName: string | null = null;
  // FASE 31G.2 -- só usada quando qaMode=dry_run é pedido (Company Mode
  // já resolve a role de graça via resolveCompanyContext(); Free Mode
  // busca sob demanda em resolveRoleForCurrentUser(), nunca numa
  // requisição normal sem qaMode).
  let resolvedRole: string | null = null;
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
    resolvedRole = resolution.context.role;
    rateLimitKey = `company:${resolution.context.companyId}|${resolution.context.workspaceId ?? "none"}`;
    // FASE 31L §13 -- log seguro (nunca dados sensíveis) pra confirmar
    // no runtime que requestedCompanyId/resolvedCompanyId realmente
    // coincidem -- exatamente o que a FASE 31K.1 provou não acontecer.
    if (mode === "company") {
      console.info("[api/studio/images/generate] company mode", {
        companyMode: true,
        requestedCompanyId: companyId,
        resolvedCompanyId: resolution.context.companyId,
        companyName: resolution.context.companyName,
      });
    }
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

  // Reaproveitada pelos dois gates abaixo (qaMode e qaImageModel/Quality)
  // -- nunca duas queries de role pra mesma requisição. Company Mode já
  // resolveu `resolvedRole` de graça acima; Free Mode busca sob demanda,
  // só quando algum dos dois overrides é pedido.
  async function resolveRoleIfNeeded(): Promise<string | null> {
    if (resolvedRole === null && !companyId) {
      resolvedRole = await resolveRoleForCurrentUser();
    }
    return resolvedRole;
  }

  // FASE 31G.2 (Production-Safe QA Mode) -- qaMode="dry_run" só tem
  // efeito quando TODAS as condições batem (flag + autenticado + role
  // admin real, resolvida server-side, NUNCA confiada do cliente).
  // Ausência de qaMode nunca chega aqui -- comportamento normal
  // 100% preservado (evaluateProductionQaAccess retorna "not_requested"
  // e nada abaixo executa).
  let productionQaAuthorized = false;
  if (qaMode === QA_MODE_DRY_RUN) {
    const decision = evaluateProductionQaAccess({
      requested: true,
      flagEnabled: isProductionQaFlagEnabled(),
      authenticated: true, // ambos os modos acima já retornaram 401 antes de chegar aqui se não autenticado
      role: await resolveRoleIfNeeded(),
    });
    if (decision !== "allowed") {
      const status = decision === "unauthenticated" ? 401 : 403;
      return NextResponse.json(
        { ok: false, error: "Modo QA (Dry Run) não autorizado nesta conta/ambiente.", code: "STUDIO_QA_MODE_UNAUTHORIZED", reason: decision },
        { status },
      );
    }
    productionQaAuthorized = true;
    // FASE 31G.2 §13 -- metadata segura, nunca secrets/keys/cookies.
    console.info("[api/studio/images/generate] qaMode=dry_run autorizado", {
      qaMode, dryRun: true, provider: "mock", externalImageCalls: 0,
      company: resolvedCompanyId ?? "free_mode",
    });
  }

  // FASE 31K §7/8 -- qaImageModel/qaImageQuality (geração REAL, nunca
  // mock) só tem efeito com flag `LKT_PRODUCTION_SUNBURST_QA` ligada +
  // sessão real + role EXATAMENTE "super_admin" (mais restrito que o
  // admin/super_admin do qaMode acima, por pedido explícito desta
  // fase). Ausência de ambos os campos nunca chega aqui -- requisição
  // normal, comportamento 100% preservado.
  let imageOverride: { model?: string; highRes?: boolean } | undefined;
  if (qaImageModel || qaImageQuality) {
    const role = await resolveRoleIfNeeded();
    const flagEnabled = isProductionSunburstQaFlagEnabled();
    if (!flagEnabled || !role || !canAccessPlatformCentral(role)) {
      const status = !role ? 401 : 403;
      return NextResponse.json(
        { ok: false, error: "Override de modelo/quality (Sunburst QA) não autorizado nesta conta/ambiente.", code: "STUDIO_SUNBURST_QA_UNAUTHORIZED" },
        { status },
      );
    }
    imageOverride = { model: qaImageModel, highRes: qaImageQuality === QA_SUNBURST_QUALITY };
    // FASE 31K §11 -- metadata segura, nunca secrets/keys/cookies.
    console.info("[api/studio/images/generate] override Sunburst QA autorizado", {
      qaImageModel: qaImageModel ?? null, qaImageQuality: qaImageQuality ?? null,
      company: resolvedCompanyId ?? "free_mode",
    });
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
    // FASE 31G.2 -- dois caminhos, independentes, que chegam ao MESMO
    // mecanismo de dry run (createStudioVisualDryRun, FASE 31G, nunca
    // duplicado): (1) LKT_IMAGE_DRY_RUN, só Preview/dev, nunca
    // Production; (2) qaMode="dry_run" já autorizado acima (admin real +
    // flag + auth), SOMENTE esse caminho pode ativar em Production, e
    // sempre fullZeroCost (§5 -- "zero cost absoluto" pra QA em Production,
    // nunca uma opção configurável aqui).
    const previewDryRun = isDryRunActive();
    const dryRun = previewDryRun || productionQaAuthorized;
    const fullZeroCost = productionQaAuthorized ? true : isFullZeroCostDryRun();
    const result = dryRun
      ? await createStudioVisualDryRun({
          skillId, input, companyId: resolvedCompanyId, companyName: resolvedCompanyName, assets, db,
          fullZeroCost,
        })
      : await createStudioVisual({
          skillId, input, companyId: resolvedCompanyId, companyName: resolvedCompanyName, assets, db,
          // FASE 31K -- só presente quando já autorizado acima (Super Admin + flag); ausente em toda requisição normal.
          imageOverride,
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
        // FASE 31G/31G.2 -- só presente quando o dry run está ativo (Preview via LKT_IMAGE_DRY_RUN, OU Production via qaMode=dry_run já autorizado como admin acima). Front real (Studio) só lê `dryRun`/`qaMode` pra mostrar o badge "DRY RUN -- SEM CUSTO" (§9); `diagnostics` é só pra Codex/QA, nunca exigido pelo fluxo normal.
        ...(dryRun ? { dryRun: true, qaMode: productionQaAuthorized ? QA_MODE_DRY_RUN : undefined, provider: "mock", diagnostics: "packet" in result ? result.packet : null } : {}),
      },
      { status: statusCode },
    );
  } catch (error) {
    console.error("[api/studio/images/generate] falha inesperada", { message: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ ok: false, error: "Não foi possível criar a peça no momento." }, { status: 500 });
  }
});
