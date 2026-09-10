import { Palette, Sparkles, ExternalLink, AtSign } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ContentosSubNavServer } from "../_contentos-subnav-server";
import { getStudioSkills, isStudioSkillContractAvailable, isStudioSkillRuntimeAvailable } from "@/lib/rec-os/studio";
import { VIDIGAL_PNG_DELIVERY_STEPS } from "@/lib/rec-os/studio/skills/vidigal-png/instructions";
import { StudioExecutionForm } from "./_studio-execution-form";
import { parseStudioLaunchContext } from "@/lib/rec-os/studio/launch-context";
import { resolveSocialProfileContext } from "@/lib/rec-os/social-profile/resolve";
import { resolveFeedDnaProfile } from "@/lib/rec-os/social-profile/feed-dna";
import { resolveCompanyContext } from "@/lib/company-context/resolve";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { FirstRunNote, HelpLauncher, EmptyStateGuide } from "@/components/guided-experience/guided-experience";
import { FeedDnaSection } from "./_feed-dna-section";
import { resolveLegacySeriesRedirectTarget } from "./legacy-redirect";
import { canAccessPlatformCentral } from "@/lib/access-control";

/**
 * Sprint REC OS Studio Foundation V0.1/V0.2 — reaproveita
 * /admin/contentos/visual (antes um redirect puro para
 * /admin/contentos/criar?step=visual) como a landing real do Studio.
 * Nenhuma rota nova criada (/admin/contentos/studio é só destino
 * conceitual futuro, ver docs/product-roadmap/vidigal-png-master-
 * prompt.txt, STUDIO_ARCHITECTURE_DECISION_V1).
 *
 * A skill listada vem do Studio Skill Registry (nunca hardcoded
 * aqui). V0.2: o bloco "Nova criação visual" agora executa de verdade
 * (StudioExecutionForm, client component -- chama só a própria API do
 * projeto, nunca um provider diretamente) -- o resultado é sempre
 * direção visual/texto estruturado, nunca o PNG final.
 */
export default async function StudioPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; content_id?: string; campaign_id?: string; social_profile_id?: string; source_format?: string; return_to?: string; series_id?: string }>;
}) {
  const params = await searchParams;

  // Prompt 24 (Dedicated Creative Series Workspace) -- PARTE F: uma
  // série tem endereço próprio (/admin/contentos/visual/series/
  // [seriesId]) desde este prompt. `?series_id=` na rota genérica é só
  // ENTRADA LEGADA (link antigo, favorito salvo) -- nunca mais a
  // identidade operacional. A rota genérica nunca tenta carregar/
  // hidratar uma série existente (essa era a causa raiz recorrente dos
  // Prompts 20/21/22: Company Context do cliente disputando autoridade
  // com uma série vivendo como estado transitório aqui).
  const legacyRedirectTarget = resolveLegacySeriesRedirectTarget(params);
  if (legacyRedirectTarget) redirect(legacyRedirectTarget);

  const skills = getStudioSkills();
  const launchContext = parseStudioLaunchContext(params);
  const clientId = params.client ?? null;
  const db = await createServerSupabaseClient();

  // Fase 06/19/50/51/53 (Prompt 16) -- Social Profile First View + Studio Top
  // Bar (Company Mode apenas). Autoriza a Company ANTES de ler qualquer dado
  // Company-scoped (Fase 06: "resolver Company autorizada... só depois
  // acessar feed_dna_profiles") e usa sempre o client Supabase da SESSÃO
  // (nunca o admin/service role) pra respeitar RLS de verdade como segunda
  // camada (Fase 53) -- gap corrigido nesta sprint: a versão do Prompt 13
  // lia com o client admin sem checar resolveCompanyContext antes.
  const companyAuthorized = clientId ? (await resolveCompanyContext(clientId)).valid : false;
  const socialProfile = clientId && companyAuthorized ? await resolveSocialProfileContext(db, clientId) : null;
  const feedDna = clientId && companyAuthorized ? await resolveFeedDnaProfile(db, clientId) : null;

  // FASE 31G.2 -- só pra decidir se mostra o controle "Modo QA" (admin-only,
  // nunca visível pra usuário comum). Mesmo padrão de leitura de role já
  // usado em admin/contentos/home/page.tsx (profiles.role, nunca uma
  // segunda fonte de verdade). A autorização REAL continua 100% server-side
  // em production-qa-authorization.ts -- esconder o botão aqui é só UX,
  // nunca a camada de segurança.
  let userRole = "";
  const { data: { user } } = await db.auth.getUser();
  if (user) {
    const { data: profileData } = await db.from("profiles").select("role").eq("id", user.id).maybeSingle();
    userRole = profileData?.role ?? "";
  }
  const isAdmin = userRole === "admin" || userRole === "super_admin";
  /** FASE 31K -- controle "Sunburst QA / High" é mais restrito que "Modo QA" (§7 pede especificamente Super Admin, mesma autoridade central de access-control.ts usada na validação real server-side). */
  const isSuperAdmin = canAccessPlatformCentral(userRole);

  return (
    <>
      <ContentosSubNavServer initialClientId={clientId ?? undefined} />

      <div className="space-y-4">
        <div className="bg-purple-50 border border-purple-100 rounded-2xl p-5 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold text-purple-800 mb-1 flex items-center gap-1.5">
              <Palette className="w-3.5 h-3.5" /> STUDIO
            </p>
            <p className="text-xs text-purple-600">
              Direção criativa e produção visual do REC OS.
            </p>
            {/* Fase 50 -- Studio Top Bar: Company/Social Profile visíveis quando existentes, Free Mode continua simples. */}
            {clientId && socialProfile?.status === "connected" && (
              <p className="text-[11px] text-purple-500 mt-1 flex items-center gap-1">
                <AtSign className="w-3 h-3" /> {socialProfile.handle ?? socialProfile.displayName ?? "conectado"}
              </p>
            )}
          </div>
          <HelpLauncher featureId="studio" />
        </div>

        <FirstRunNote featureId="studio" />

        {/* Fase 09/35 -- empty states discretos, nunca bloqueiam o Studio. */}
        {clientId && socialProfile?.status === "not_connected" && (
          <EmptyStateGuide featureId="studio" stateId="instagram_not_connected" />
        )}

        {/* Fase 10-17/46 (Prompt 16) -- fecha o P1-A: editor real de Feed DNA (não mais só um empty state estático). */}
        {clientId && companyAuthorized && <FeedDnaSection clientId={clientId} initial={feedDna} />}

        {/* Nova criação visual */}
        <StudioExecutionForm skills={skills.map((s) => ({ id: s.id, name: s.name }))} clientId={clientId} launchContext={launchContext} isAdmin={isAdmin} isSuperAdmin={isSuperAdmin} />

        {/* Skills disponíveis */}
        <div>
          <h2 className="text-xs font-black uppercase tracking-wide text-gray-500 mb-3">Skills</h2>
          <div className="space-y-3">
            {skills.map((skill) => {
              const contractAvailable = isStudioSkillContractAvailable(skill);
              const runtimeAvailable = isStudioSkillRuntimeAvailable(skill);
              return (
                <div key={skill.id} className="bg-white border border-gray-100 rounded-2xl p-4">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div>
                      <p className="text-sm font-bold text-gray-800 flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-purple-500" /> {skill.name}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">{skill.description}</p>
                    </div>
                    <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full whitespace-nowrap shrink-0">
                      v{skill.version}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-2 mb-3">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${contractAvailable ? "bg-emerald-50 text-emerald-600" : "bg-gray-100 text-gray-500"}`}>
                      {contractAvailable ? "Estrutura disponível" : "Estrutura indisponível"}
                    </span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${runtimeAvailable ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"}`}>
                      {runtimeAvailable ? "IA conectada" : "IA ainda não conectada"}
                    </span>
                  </div>

                  <div>
                    <p className="text-[10px] font-black uppercase tracking-wide text-gray-400 mb-2">Estrutura da entrega</p>
                    <div className="flex flex-wrap gap-1.5">
                      {VIDIGAL_PNG_DELIVERY_STEPS.map((step) => (
                        <span key={step.id} className="text-[10px] bg-gray-50 border border-gray-100 text-gray-500 px-2 py-1 rounded-lg">
                          {String(step.order).padStart(2, "0")} {step.label}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="mt-3">
                    <p className="text-[10px] font-black uppercase tracking-wide text-gray-400 mb-2">Módulos</p>
                    <div className="flex flex-wrap gap-1.5">
                      {skill.modules.map((mod) => (
                        <span
                          key={mod.id}
                          title={mod.description}
                          className={`text-[10px] px-2 py-1 rounded-lg border ${
                            mod.status === "placeholder_contract"
                              ? "bg-gray-50 border-gray-100 text-gray-400"
                              : "bg-purple-50 border-purple-100 text-purple-600"
                          }`}
                        >
                          {mod.label}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Integração com EditorOS */}
        <div className="bg-white border border-gray-100 rounded-2xl p-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-gray-800">EditorOS</p>
            <p className="text-xs text-gray-400 mt-0.5">Edição, composição, ajuste e acabamento visual da peça.</p>
          </div>
          <Link
            href={`/admin/contentos/editor-os${clientId ? `?client=${clientId}` : ""}`}
            className="text-xs font-bold text-purple-600 flex items-center gap-1 whitespace-nowrap"
          >
            Abrir EditorOS <ExternalLink className="w-3 h-3" />
          </Link>
        </div>
      </div>
    </>
  );
}
