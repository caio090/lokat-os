import { redirect } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight, AlertTriangle, FolderKanban, ClipboardList,
  CheckSquare, Clock, CalendarClock, ClipboardCheck,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { CompanyContextRequiredState } from "@/components/company-context-required-state";
import { resolveCompanyContext } from "@/lib/company-context/resolve";
import { createSupabaseAdminClient, hasSupabaseServiceRoleKey } from "@/lib/supabase/server";
import { getProjectProjections } from "@/lib/project-projection/adapters";
import { getWorkItemProjections } from "@/lib/work-item-projection/adapters";
import { buildCompanyCentralView } from "@/lib/company-central/builder";
import { SURFACE_LABELS } from "@/config/workspace-capabilities";
import { getLatestCompanyDiagnostic, getCompanyFindings, getCompanyRoadmap } from "@/lib/company-diagnostic/adapters";
import { getCompanyDecisions } from "@/lib/company-decisions/adapters";
import { getClientTimeline } from "@/lib/client-timeline/adapters";
import { getClientOpportunities } from "@/lib/client-opportunities/adapters";
import { getClientProjects } from "@/lib/client-projects-admin/adapters";
import { getClientMeetings, getClientProposals } from "@/lib/client-commercial/adapters";
import { EmpresaRelationshipPanel } from "./_empresa-relationship-panel";

/**
 * Sprint MVP Dogfood Spine V0.1 (Bloco D) — Company Central mínima.
 * Auditoria (Fase 26) confirmou que /admin/meu-negocio já existe mas serve
 * um propósito diferente (simulação financeira/estoque por nicho,
 * inteiramente fixture-based: COMMAND_CENTER_METRICS, COMPANY_SELECTION_FIXTURES)
 * -- reaproveitá-la misturaria dado real com dado demonstrativo. Rota nova
 * escolhida: /admin/empresa. COCKPIT/PROJECTION -- nenhum banco próprio,
 * nenhuma mutação, nenhum chat da Gota (Fase 36).
 */
export default async function AdminEmpresaPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>;
}) {
  const params = await searchParams;
  const clientId = params.client ?? null;
  const nextPath = clientId ? `/admin/empresa?client=${clientId}` : "/admin/empresa";

  const resolution = await resolveCompanyContext(clientId);
  if (!resolution.valid) {
    if (resolution.reason === "not_authenticated") redirect("/login");
    if (resolution.reason === "role_not_supported") redirect("/admin/dashboard");
    return (
      <>
        <PageHeader title="Empresa" description="Central da empresa: o que está acontecendo agora." />
        <CompanyContextRequiredState reason={resolution.reason ?? "company_required"} nextPath={nextPath} />
      </>
    );
  }
  const context = resolution.context!;

  if (!hasSupabaseServiceRoleKey()) {
    return (
      <>
        <PageHeader title="Empresa" />
        <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 text-xs text-amber-700 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          Este recurso está temporariamente indisponível. Sua sessão continua ativa.
        </div>
      </>
    );
  }

  const adminDb = createSupabaseAdminClient();
  const [
    projects, workItems, diagnosticResult,
    decisionsResult, roadmapResult, timelineResult, opportunitiesResult, clientProjectsResult,
    meetingsResult, proposalsResult,
  ] = await Promise.all([
    getProjectProjections(adminDb, context.companyId),
    getWorkItemProjections(adminDb, context.companyId),
    getLatestCompanyDiagnostic(adminDb, context.companyId),
    getCompanyDecisions(adminDb, context.companyId),
    getCompanyRoadmap(adminDb, context.companyId),
    getClientTimeline(adminDb, context.companyId),
    getClientOpportunities(adminDb, context.companyId),
    getClientProjects(adminDb, context.companyId),
    getClientMeetings(adminDb, context.companyId),
    getClientProposals(adminDb, context.companyId),
  ]);
  // Fase 27/68 — só busca Findings quando já existe um diagnóstico real
  // (evita uma segunda query condenada a "unavailable" quando o schema 91
  // ainda não foi aplicado, ou quando a Company nunca iniciou um).
  const findingsResult = diagnosticResult.status === "available" && diagnosticResult.data
    ? await getCompanyFindings(adminDb, context.companyId)
    : null;

  const view = buildCompanyCentralView(
    { companyId: context.companyId, companyName: context.companyName, surface: context.surface },
    projects,
    workItems,
    new Date().toISOString(),
  );

  return (
    <>
      <PageHeader
        title={view.identity.companyName ?? "Empresa"}
        description={`Painel da Empresa · ${SURFACE_LABELS[view.identity.surface]}${context.preview ? " · Visualização (somente leitura)" : ""}`}
      />

      {/* Diagnóstico (Fase 26/27/68) — só renderiza quando o schema 91 já
          foi aplicado (status "available"); enquanto "unavailable", omite
          a seção inteira em vez de mostrar um botão que falharia. */}
      {diagnosticResult.status === "available" && (
        <section className="bg-white rounded-2xl border border-gray-100 p-4 mb-4" data-testid="company-panel-diagnostic">
          <h2 className="text-xs font-black uppercase tracking-wide text-gray-500 mb-3">Diagnóstico</h2>
          {!diagnosticResult.data ? (
            <div className="flex items-center gap-2" data-testid="company-panel-start-diagnostic">
              <ClipboardCheck className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
              <p className="text-sm text-gray-500">Esta empresa ainda não tem um diagnóstico. Iniciar diagnóstico chega em uma próxima versão.</p>
            </div>
          ) : (
            <div className="space-y-1">
              <p className="text-sm text-gray-700">
                Status: <span className="font-semibold">{
                  diagnosticResult.data.status === "completed" ? "Concluído"
                  : diagnosticResult.data.status === "archived" ? "Arquivado"
                  : diagnosticResult.data.status === "draft" ? "Rascunho"
                  : "Em andamento"
                }</span>
              </p>
              {findingsResult?.status === "available" && (
                <p className="text-xs text-gray-500">
                  {findingsResult.data.length > 0
                    ? `${findingsResult.data.length} achado(s) em aberto.`
                    : "Nenhum achado em aberto registrado."}
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {/* Precisa de atenção */}
      <section className="bg-white rounded-2xl border border-gray-100 p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-black uppercase tracking-wide text-gray-500">O que precisa de atenção</h2>
          {view.workSummary.overdueCount > 0 && (
            <span className="text-[11px] font-bold text-red-600 flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" /> {view.workSummary.overdueCount} atrasado(s)
            </span>
          )}
        </div>
        {!view.hasWork ? (
          <EmptyState icon={ClipboardList} title="Sem pendências neste contexto." />
        ) : (
          <div className="space-y-2">
            {view.attention.slice(0, 8).map((item) => (
              <Link
                key={item.id}
                href={item.sourceUrl}
                data-testid="company-central-attention-item"
                className="flex items-center gap-3 border border-gray-100 rounded-xl p-3 hover:border-indigo-200 transition-colors"
              >
                <div className="w-8 h-8 bg-indigo-50 rounded-lg flex items-center justify-center flex-shrink-0">
                  <ClipboardList className="w-4 h-4 text-indigo-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-800 truncate">{item.title}</p>
                  <p className="text-[11px] text-gray-400">{item.module} · {item.status}</p>
                </div>
                {item.dueAt && (
                  <span className="text-[11px] text-gray-400 flex-shrink-0">
                    {new Date(item.dueAt).toLocaleDateString("pt-BR")}
                  </span>
                )}
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Work summary */}
      {view.hasWork && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <SummaryCard icon={ClipboardList} label="Pendências" value={view.workSummary.pendingCount} />
          <SummaryCard icon={CheckSquare} label="Aprovações" value={view.workSummary.approvalsCount} />
          <SummaryCard icon={Clock} label="Hoje" value={view.workSummary.todayCount} />
          <SummaryCard icon={CalendarClock} label="Atrasados" value={view.workSummary.overdueCount} tone={view.workSummary.overdueCount > 0 ? "warning" : undefined} />
        </div>
      )}

      {/* Projetos ativos */}
      <section className="bg-white rounded-2xl border border-gray-100 p-4 mb-4">
        <h2 className="text-xs font-black uppercase tracking-wide text-gray-500 mb-3">Projetos ativos</h2>
        {!view.hasProjects ? (
          <EmptyState icon={FolderKanban} title="Nenhum projeto estruturado ainda." />
        ) : view.activeProjects.length === 0 ? (
          <EmptyState icon={FolderKanban} title="Nenhum projeto ativo no momento." />
        ) : (
          <div className="space-y-2">
            {view.activeProjects.map((project) => (
              <Link
                key={project.id}
                href={`/admin/projetos/${encodeURIComponent(project.sourceEntityId)}?client=${context.companyId}`}
                data-testid="company-central-project-item"
                className="flex items-center gap-3 border border-gray-100 rounded-xl p-3 hover:border-indigo-200 transition-colors"
              >
                <div className="w-8 h-8 bg-emerald-50 rounded-lg flex items-center justify-center flex-shrink-0">
                  <FolderKanban className="w-4 h-4 text-emerald-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-800 truncate">{project.title}</p>
                  <p className="text-[11px] text-gray-400">{project.status}</p>
                </div>
                <ArrowRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
              </Link>
            ))}
          </div>
        )}
        <Link href={`/admin/projetos?client=${context.companyId}`} className="inline-flex items-center gap-1 text-xs font-bold text-indigo-600 mt-3">
          Ver todos os projetos <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </section>

      {/* Retomada do produto — Decisões, Próxima Janela, Relacionamento
          Comercial (reunião/proposta pós-venda), Oportunidades, Projetos
          do Cliente (escopo) e Timeline. Tudo client-scoped via
          context.companyId, nenhuma segunda Company-seleção. */}
      <EmpresaRelationshipPanel
        companyId={context.companyId}
        decisionsResult={decisionsResult}
        roadmapResult={roadmapResult}
        timelineResult={timelineResult}
        opportunitiesResult={opportunitiesResult}
        clientProjectsResult={clientProjectsResult}
        meetingsResult={meetingsResult}
        proposalsResult={proposalsResult}
      />

      {/* Atalhos */}
      <section className="bg-white rounded-2xl border border-gray-100 p-4">
        <h2 className="text-xs font-black uppercase tracking-wide text-gray-500 mb-3">Para onde ir agora</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {view.moduleShortcuts.map((shortcut) => (
            <Link
              key={shortcut.label}
              href={shortcut.href}
              className="flex items-center justify-center gap-1.5 text-xs font-bold text-gray-700 bg-gray-50 hover:bg-gray-100 rounded-xl px-3 py-2.5 transition-colors"
            >
              {shortcut.label}
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}

function SummaryCard({
  icon: Icon, label, value, tone,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  tone?: "warning";
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-4">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className={`w-3.5 h-3.5 ${tone === "warning" ? "text-amber-500" : "text-gray-400"}`} />
        <p className="text-[11px] font-bold text-gray-400 uppercase">{label}</p>
      </div>
      <p className={`text-xl font-black ${tone === "warning" && value > 0 ? "text-amber-600" : "text-gray-900"}`}>{value}</p>
    </div>
  );
}

