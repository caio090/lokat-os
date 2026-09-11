/**
 * Sprint MVP Dogfood Spine V0.1 (Bloco D, Fase 29-34) — Company Central builder.
 * Builder PURO: recebe dados já buscados (identity/projects/workItems) e
 * monta a view -- nenhum fetch escondido aqui (Fase 52).
 */
import type { ProjectProjection } from "@/lib/project-projection/types";
import { isActiveProject } from "@/lib/project-projection/adapters";
import type { WorkItemProjection } from "@/lib/work-item-projection/types";
import type { CompanyCentralIdentity, CompanyCentralView, CompanyCentralModuleShortcut } from "./types";

export const COMPANY_CENTRAL_MODULE_SHORTCUTS_BASE: CompanyCentralModuleShortcut[] = [
  { label: "Meu Escritório", href: "/admin/escritorio" },
  { label: "Calendário", href: "/admin/calendario" },
  { label: "CRM", href: "/admin/leads" },
  { label: "REC OS", href: "/admin/contentos" },
  // FASE 31O — Admin Company DNA Editor.
  { label: "Company DNA", href: "/admin/empresa/dna" },
];

function moduleShortcuts(companyId: string): CompanyCentralModuleShortcut[] {
  return COMPANY_CENTRAL_MODULE_SHORTCUTS_BASE.map((s) => ({ ...s, href: `${s.href}?client=${companyId}` }));
}

/**
 * Fase 31 — ordena por urgência: atrasado primeiro (dueAt no passado e sem
 * completedAt), depois por dueAt mais próximo. Nunca reordena por "opinião".
 */
function orderByAttention(items: WorkItemProjection[], nowIso: string): WorkItemProjection[] {
  const now = new Date(nowIso).getTime();
  const isOverdue = (item: WorkItemProjection) => !!item.dueAt && !item.completedAt && new Date(item.dueAt).getTime() < now;
  return [...items]
    .filter((item) => !item.completedAt)
    .sort((a, b) => {
      const overdueDiff = Number(isOverdue(b)) - Number(isOverdue(a));
      if (overdueDiff !== 0) return overdueDiff;
      const aTime = a.dueAt ? new Date(a.dueAt).getTime() : Infinity;
      const bTime = b.dueAt ? new Date(b.dueAt).getTime() : Infinity;
      return aTime - bTime;
    });
}

export function buildCompanyCentralView(
  identity: CompanyCentralIdentity,
  projects: ProjectProjection[],
  workItems: WorkItemProjection[],
  nowIso: string,
): CompanyCentralView {
  const activeProjects = projects.filter(isActiveProject);
  const attention = orderByAttention(workItems, nowIso);
  const now = new Date(nowIso).getTime();
  const todayKey = nowIso.slice(0, 10);

  const workSummary = {
    pendingCount: workItems.filter((i) => !i.completedAt).length,
    approvalsCount: workItems.filter((i) => i.type === "approval" && !i.completedAt).length,
    todayCount: workItems.filter((i) => (i.dueAt ?? "").startsWith(todayKey)).length,
    overdueCount: workItems.filter((i) => !!i.dueAt && !i.completedAt && new Date(i.dueAt).getTime() < now).length,
  };

  return {
    identity,
    attention,
    activeProjects,
    workSummary,
    moduleShortcuts: moduleShortcuts(identity.companyId),
    hasProjects: projects.length > 0,
    hasWork: workItems.length > 0,
  };
}
