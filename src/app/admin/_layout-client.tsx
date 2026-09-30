"use client";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Bell, ArrowLeft, CheckSquare,
  UserRoundPlus, X, UsersRound, Activity, Target,
} from "lucide-react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { AppSidebar } from "@/components/app-sidebar";
import { MobileBottomNav } from "@/components/mobile-nav";
import { AdminSearchSheet } from "@/components/admin-search-sheet";
import { CompanyContextBar } from "@/components/company-context-bar";
import { JarvisPanel } from "@/components/jarvis/jarvis-panel";
import { WorkspaceViewSwitcher } from "@/components/workspaces/workspace-view-switcher";
import { WorkspaceExitButton } from "@/components/workspaces/workspace-exit-button";
import { WorkspacePreviewBanner } from "@/components/workspaces/workspace-preview-banner";
import type { WorkspaceContext } from "@/lib/workspaces/types";
import { isSupabaseConfigured, createClient } from "@/lib/supabase/client";
import { performSignOut } from "@/lib/sign-out";
import { ACTIVE_CLIENT_KEY, ACTIVE_CLIENT_NAME_KEY } from "@/lib/active-client";
import { cn } from "@/lib/utils";
import { V1_PROGRESS, getDaysRemainingV1, PROJECT_DEADLINE_V1 } from "@/lib/project-status";
// getDaysRemainingV1 uses Date.now() — must not be called during SSR to avoid React #418

// ── Admin notification helpers ────────────────────────────────
const ADMIN_SEEN_KEY = "lokat_admin_notif_seen_count";
function getAdminSeenCount(): number {
  if (typeof window === "undefined") return 0;
  return parseInt(localStorage.getItem(ADMIN_SEEN_KEY) ?? "0", 10);
}
function markAdminSeen(total: number) {
  if (typeof window === "undefined") return;
  localStorage.setItem(ADMIN_SEEN_KEY, String(total));
}

// ── CRM badge helpers ─────────────────────────────────────────
const CRM_SEEN_KEY = "lokat_crm_seen_at";
function getCrmSeenAt(): number {
  if (typeof window === "undefined") return 0;
  return parseInt(localStorage.getItem(CRM_SEEN_KEY) ?? "0", 10);
}
function markCrmSeen() {
  if (typeof window === "undefined") return;
  localStorage.setItem(CRM_SEEN_KEY, String(Date.now()));
}

interface AdminNotif {
  type: "team_request" | "approval";
  title: string;
  message: string;
  href: string;
  clientName?: string;
  count?: number;
  urgency?: "normal" | "high";
}

interface Props {
  children: React.ReactNode;
  /**
   * Fase 7 do hotfix 1.0.4 — antes, WorkspacePreviewBanner só era renderizado
   * dentro de /admin/visualizar/page.tsx. Os cards do shell de demonstração
   * linkam para páginas REAIS fora dessa rota (/admin/contentos,
   * /admin/relatorios, /admin/financeiro, /admin/conexoes, /admin/meu-negocio)
   * — nelas, o banner simplesmente não existia, e o Super Admin perdia todo
   * indício visual de estar em preview. Resolvido no servidor (layout.tsx,
   * via getWorkspacePreviewContext()) e passado como prop para que TODA
   * página admin renderize o mesmo banner, uma única vez, no mesmo lugar.
   */
  previewContext: WorkspaceContext | null;
  /**
   * Sprint Workspaces 1.0.7 — resolved server-side in src/app/admin/layout.tsx
   * via resolveEffectiveUserRole() (the same canonical precedence src/proxy.ts
   * and the login redirect use), and used to initialize userRole below so the
   * FIRST render already knows whether to show "Painel ADM" / "Visualizar
   * como" — a client-side fetch is never the gate for that decision anymore.
   * Only the resolved role string is passed — never a token, cookie, or the
   * full user/profile object.
   */
  initialUserRole: string | null;
  /** Fase 57 (Final Closure) — rótulo dinâmico Minha Agência/Meu Negócio na sidebar. */
  initialAccountType?: string | null;
}

export function AdminLayoutShell({ children, previewContext, initialUserRole, initialAccountType = null }: Props) {
  const [userName,         setUserName]         = useState("Admin");
  const [initials,         setInitials]         = useState("A");
  // No setter: role comes exclusively from the server-resolved prop and
  // never changes during this component's lifetime (a session/role change
  // means a fresh server render, which passes a fresh initialUserRole).
  const userRole = initialUserRole;
  const [activeClientName, setActiveClientName] = useState<string | null>(null);
  const pathname = usePathname();

  // CRM new-lead count (topbar badge)
  const [newLeadCount, setNewLeadCount] = useState(0);

  // Bell state
  const [notifs,           setNotifs]           = useState<AdminNotif[]>([]);
  const [notifTotal,       setNotifTotal]       = useState(0);
  const [hasUnread,        setHasUnread]        = useState(false);
  const [showBell,         setShowBell]         = useState(false);
  const [pendingTeamCount, setPendingTeamCount] = useState(0);
  const [daysRemaining, setDaysRemaining] = useState<number | null>(null);
  const bellRef = useRef<HTMLDivElement>(null);

  const isOnContentosPage = pathname.startsWith("/admin/contentos");
  const isSelectingClient = pathname === "/admin/contentos/selecionar-cliente";
  const isRecOSHubPage    = pathname === "/admin/contentos";
  const isInicioPage      = pathname === "/admin/inicio";
  // Meu PP V2 — espaço PESSOAL: nunca mostra Company/cliente ativo (docs/meu-pp/README.md).
  const isMeuPpPage       = pathname === "/admin/meu-pp" || pathname.startsWith("/admin/meu-pp/");

  // Efeito "spotlight" — luz suave seguindo o mouse, só na tela Início
  const spotlightRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isInicioPage) return;
    function handleMove(e: MouseEvent) {
      spotlightRef.current?.style.setProperty("--spot-x", `${e.clientX}px`);
      spotlightRef.current?.style.setProperty("--spot-y", `${e.clientY}px`);
    }
    window.addEventListener("mousemove", handleMove);
    return () => window.removeEventListener("mousemove", handleMove);
  }, [isInicioPage]);

  // Fetch new-lead count for CRM topbar badge
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    fetch("/api/admin/waitlist")
      .then((r) => r.json())
      .then((d: { ok?: boolean; entries?: Array<{ status: string; created_at?: string }> }) => {
        if (cancelled || !d.ok) return;
        const seenAt = getCrmSeenAt();
        const count = (d.entries ?? []).filter((e) => {
          if (e.status !== "new") return false;
          if (!seenAt) return true;
          const leadTime = e.created_at ? new Date(e.created_at).getTime() : 0;
          return leadTime > seenAt;
        }).length;
        if (!cancelled) setNewLeadCount(count);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Fetch display name/initials only.
  //
  // Sprint Workspaces 1.0.6 found the root cause of "Painel ADM" /
  // "Visualizar como" never appearing for a genuine Super Admin: this used
  // to be the only place in the app that resolved role from profiles.role
  // alone, with no fallback, and it returned early when `profile` was null
  // — so userRole stayed null forever even though src/proxy.ts had already
  // let the same user reach /admin/dashboard via a more permissive check.
  // 1.0.7 removes the class of bug entirely rather than patching this
  // fallback further: role now comes exclusively from the initialUserRole
  // prop (server-resolved in src/app/admin/layout.tsx, before first render)
  // and is never touched here. This effect only fills in name/initials —
  // authorization and identity display are deliberately separate, so a
  // failure here can never hide an administrative control.
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || cancelled) return;
        const { data: profile } = await supabase
          .from("profiles").select("name").eq("id", user.id).maybeSingle();
        if (cancelled) return;
        const name = profile?.name ?? user.email ?? "Admin";
        const ini  = name.split(/\s+/).slice(0, 2).map((w: string) => w[0] ?? "").join("").toUpperCase() || "A";
        setUserName(name); setInitials(ini);
      } catch {
        // Non-blocking: initialUserRole (and therefore every
        // super_admin-gated control) is unaffected by this failing — only
        // the display name falls back to its "Admin" default. No email,
        // user id, token, or Supabase payload is logged.
        console.warn("[AdminLayoutShell] falha ao carregar nome de exibição (não afeta permissões)");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Fetch notification counts from existing tables (no separate notif table needed for V1)
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();

        const [teamRes, approvalRes] = await Promise.all([
          supabase
            .from("team_access_requests")
            .select("id", { count: "exact", head: true })
            .eq("status", "pending"),
          supabase
            .from("approvals")
            .select("client_id, clients(company_name)")
            .eq("status", "aguardando"),
        ]);

        if (cancelled) return;

        // team_access_requests may not exist yet (503/404) — treat as 0
        const teamCount = teamRes.error ? 0 : (teamRes.count ?? 0);
        const rawApprovals = approvalRes.data ?? [];

        // Agrupa aprovações por cliente
        const byClient = new Map<string, { name: string; count: number }>();
        for (const a of rawApprovals) {
          const id   = a.client_id as string;
          const name = (a.clients as { company_name?: string } | null)?.company_name ?? "Cliente";
          const cur  = byClient.get(id) ?? { name, count: 0 };
          byClient.set(id, { name: cur.name, count: cur.count + 1 });
        }
        const approvalCount = rawApprovals.length;
        const total         = teamCount + approvalCount;

        const built: AdminNotif[] = [];
        if (teamCount > 0) {
          built.push({
            type:    "team_request",
            title:   `${teamCount} solicitação${teamCount > 1 ? "ões" : ""} de equipe`,
            message: `${teamCount} pessoa${teamCount > 1 ? "s" : ""} aguardando aprovação de acesso.`,
            href:    "/admin/equipe",
          });
        }
        if (byClient.size === 1) {
          const [clientId, info] = [...byClient.entries()][0];
          built.push({
            type:       "approval",
            title:      `${info.count} aprovação${info.count > 1 ? "ões" : ""} — ${info.name}`,
            message:    `${info.count} conteúdo${info.count > 1 ? "s" : ""} de ${info.name} aguardando revisão.`,
            href:       `/admin/contentos/aprovacoes?client=${clientId}`,
            clientName: info.name,
            count:      info.count,
            urgency:    info.count >= 3 ? "high" : "normal",
          });
        } else if (byClient.size > 1) {
          for (const [clientId, info] of byClient.entries()) {
            built.push({
              type:       "approval",
              title:      `${info.count} aprovação${info.count > 1 ? "ões" : ""} — ${info.name}`,
              message:    `${info.count} conteúdo${info.count > 1 ? "s" : ""} aguardando.`,
              href:       `/admin/contentos/aprovacoes?client=${clientId}`,
              clientName: info.name,
              count:      info.count,
              urgency:    info.count >= 3 ? "high" : "normal",
            });
          }
        } else if (approvalCount > 0) {
          built.push({
            type:    "approval",
            title:   `${approvalCount} aprovação${approvalCount > 1 ? "ões" : ""} pendente${approvalCount > 1 ? "s" : ""}`,
            message: "Conteúdos aguardando revisão do cliente.",
            href:    "/admin/contentos/aprovacoes",
          });
        }

        setNotifs(built);
        setNotifTotal(total);
        setPendingTeamCount(teamCount);
        setHasUnread(total > getAdminSeenCount());
      } catch {
        // Tables may not exist yet — silently skip
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Compute days remaining client-side only to avoid React #418 (Date.now() differs between SSR and hydration)
  useEffect(() => {
    // Intentional hydration boundary: Date.now() cannot run during SSR without diverging.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDaysRemaining(getDaysRemainingV1());
  }, []);

  // Close bell on outside click
  useEffect(() => {
    if (!showBell) return;
    function handleClick(e: MouseEvent) {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) {
        setShowBell(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showBell]);

  function handleBellToggle() {
    setShowBell((v) => {
      const opening = !v;
      if (opening) {
        markAdminSeen(notifTotal);
        setHasUnread(false);
      }
      return opening;
    });
  }

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!isOnContentosPage || isSelectingClient) {
      setActiveClientName(null);
      return;
    }
    // URL ?client= is the ONLY source of truth (Sprint 4.0A.1) — no
    // localStorage fallback. The Hub (/admin/contentos) legitimately has no
    // client in the URL when showing "todos os clientes"; falling back to a
    // stale localStorage value from a previous session caused the header to
    // show a client the current page/selector didn't have selected.
    const urlParams   = new URLSearchParams(window.location.search);
    const urlClientId = urlParams.get("client");

    if (!urlClientId) { setActiveClientName(null); return; }

    const storedClientId = localStorage.getItem(ACTIVE_CLIENT_KEY);
    if (urlClientId === storedClientId) {
      const storedName = localStorage.getItem(ACTIVE_CLIENT_NAME_KEY);
      if (storedName) { setActiveClientName(storedName); return; }
    }

    // Resolve name from server (URL client differs from stored, or name missing)
    fetch(`/api/admin/clients/${urlClientId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { company_name?: string } | null) => {
        if (data?.company_name) {
          localStorage.setItem(ACTIVE_CLIENT_KEY, urlClientId);
          localStorage.setItem(ACTIVE_CLIENT_NAME_KEY, data.company_name);
          setActiveClientName(data.company_name);
        }
      })
      .catch(() => {});
  }, [isOnContentosPage, isSelectingClient, pathname]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleSignOut = async () => {
    await performSignOut();
    window.location.href = "/login";
  };

  // Badge on sidebar equipe link = pending team requests
  const badges = pendingTeamCount > 0 ? { "/admin/equipe": pendingTeamCount } : undefined;

  return (
    <div ref={spotlightRef} className={cn("lk-dark flex h-screen overflow-hidden bg-gray-50 relative", isInicioPage && "lk-spotlight")}>
      {isInicioPage && (
        <div
          className="pointer-events-none fixed inset-0 z-40 transition-opacity duration-300"
          style={{
            background: "radial-gradient(600px circle at var(--spot-x, 50%) var(--spot-y, 50%), rgba(165,148,249,0.10), transparent 70%)",
          }}
        />
      )}
      <div className="hidden md:flex">
        <AppSidebar
          variant="admin"
          userName={userName}
          userRole={userRole === "super_admin" ? "Super Admin" : userRole === "admin" ? "Admin" : "Usuário"}
          accountType={initialAccountType}
          onSignOut={handleSignOut}
          badges={badges}
          transparent={isInicioPage}
        />
      </div>
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <header className={cn(
          "h-14 flex items-center justify-between px-4 md:px-6 flex-shrink-0 transition-colors",
          isInicioPage
            ? "bg-black/20 backdrop-blur-md border-b border-white/10"
            : "bg-white border-b border-gray-100"
        )}>
          <div className="flex items-center gap-3 min-w-0">
            <AdminSearchSheet dark={isInicioPage} />
            {isMeuPpPage ? (
              <span className="inline-flex items-center rounded-full border border-stone-300 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-stone-500">
                Pessoal · privado
              </span>
            ) : (
              <CompanyContextBar />
            )}
          </div>

          <div className="flex items-center gap-2 md:gap-3">
            {/* Admin notification bell — matches client pattern */}
            <div ref={bellRef} className="relative">
              <button
                onClick={handleBellToggle}
                className="relative p-2 rounded-xl hover:bg-gray-50 transition-colors"
                aria-label="Notificações"
              >
                <Bell className="w-4 h-4 text-gray-500" />
                {hasUnread && (
                  <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
                )}
              </button>

              <AnimatePresence>
              {showBell && (
                <motion.div
                  initial={{ opacity: 0, y: -8, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.97 }}
                  transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                  className="absolute right-0 top-10 z-50 w-80 bg-white border border-gray-200 rounded-2xl shadow-xl overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                    <span className="text-xs font-bold text-gray-800">Notificações</span>
                    <button
                      onClick={() => setShowBell(false)}
                      className="text-gray-400 hover:text-gray-600 p-0.5 rounded"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {notifs.length > 0 ? (
                    <div className="p-3 space-y-2">
                      {notifs.map((n, i) => (
                        <Link
                          key={i}
                          href={n.href}
                          onClick={() => setShowBell(false)}
                          className={`flex items-start gap-3 border rounded-xl p-3 no-underline transition-colors ${
                            n.type === "team_request"
                              ? "bg-indigo-50 border-indigo-100 hover:bg-indigo-100"
                              : n.urgency === "high"
                              ? "bg-red-50 border-red-100 hover:bg-red-100"
                              : "bg-amber-50 border-amber-100 hover:bg-amber-100"
                          }`}
                        >
                          {n.type === "team_request"
                            ? <UserRoundPlus className="w-4 h-4 text-indigo-500 flex-shrink-0 mt-0.5" />
                            : <CheckSquare className={`w-4 h-4 flex-shrink-0 mt-0.5 ${n.urgency === "high" ? "text-red-500" : "text-amber-500"}`} />
                          }
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-gray-800">{n.title}</p>
                            <p className="text-xs text-gray-500 mt-0.5">{n.message}</p>
                            {n.urgency === "high" && (
                              <span className="inline-block mt-1 text-[10px] font-bold text-red-600 bg-red-100 px-1.5 py-0.5 rounded">Urgente</span>
                            )}
                          </div>
                        </Link>
                      ))}

                      <div className="flex gap-2 pt-1">
                        {notifs.some((n) => n.type === "team_request") && (
                          <Link
                            href="/admin/equipe"
                            onClick={() => setShowBell(false)}
                            className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-indigo-600 text-white text-xs font-semibold rounded-xl hover:bg-indigo-700 transition-colors"
                          >
                            <UsersRound className="w-3.5 h-3.5" />
                            Ver equipe
                          </Link>
                        )}
                        {notifs.some((n) => n.type === "approval") && (
                          <Link
                            href="/admin/contentos/aprovacoes"
                            onClick={() => setShowBell(false)}
                            className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-amber-500 text-white text-xs font-semibold rounded-xl hover:bg-amber-600 transition-colors"
                          >
                            <CheckSquare className="w-3.5 h-3.5" />
                            Ver aprovações
                          </Link>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="p-6 text-center text-gray-400">
                      <Bell className="w-7 h-7 mx-auto mb-2 text-gray-200" />
                      <p className="text-xs">Nenhuma notificação no momento.</p>
                    </div>
                  )}
                </motion.div>
              )}
              </AnimatePresence>
            </div>

            {/* Sprint Navegação e Experiência 3.0.1.2 (Fase 25/30) — antes,
                este botão mostrava o texto "CRM" ao lado do ícone, duplicando
                a entrada de texto "CRM" que a sidebar já tem para a mesma
                rota. Mantido como indicador (ícone + contador de leads
                novos — função realmente distinta de um item de navegação),
                sem o rótulo de texto que competia com a sidebar. */}
            <Link
              href="/admin/leads"
              title="Novos leads no CRM"
              aria-label="Novos leads no CRM"
              onClick={() => { markCrmSeen(); setNewLeadCount(0); }}
              className="relative p-2 rounded-xl hover:bg-gray-50 transition-colors flex items-center text-indigo-500"
            >
              <Target className="w-4 h-4" />
              {newLeadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[9px] font-bold rounded-full min-w-[14px] h-[14px] flex items-center justify-center leading-none px-0.5">
                  {newLeadCount > 9 ? "9+" : newLeadCount}
                </span>
              )}
            </Link>

            {/* Fase 10/11 do hotfix 1.0.5 — a 1.0.4 tentou caber Painel ADM
                e Visualizar como na MESMA linha do header ao lado de busca,
                sino, CRM, Status V1 e avatar, contando com margem de
                pixels calculada mas nunca confirmada num navegador real —
                o QA em 390x844 continuou reprovando os dois. Solução mais
                robusta (Opção C do ticket): em mobile, estes dois controles
                saem inteiramente da linha do header (que volta a ter
                exatamente a mesma composição de antes da 1.0.4: busca,
                sino, CRM, Status V1, avatar — sem "Mais", sem disputa de
                espaço) e ganham uma barra dedicada, só deles, logo abaixo
                do header. Nenhum handler é duplicado: são os MESMOS
                componentes WorkspaceExitButton/WorkspaceViewSwitcher,
                renderizados aqui (hidden md:flex, some no desktop) e de
                novo mais abaixo (md:hidden, some no mobile). */}
            {userRole === "super_admin" && (
              <div className="hidden md:flex items-center gap-2">
                <WorkspaceExitButton />
                <WorkspaceViewSwitcher />
              </div>
            )}

            {userRole === "super_admin" && (
              <Link
                href="/admin/status"
                title={`Status V1 — Prazo ${PROJECT_DEADLINE_V1}`}
                className="p-2 rounded-xl hover:bg-gray-50 transition-colors flex items-center gap-1.5 text-emerald-600"
              >
                <Activity className="w-4 h-4" />
                <div className="hidden md:block leading-none">
                  <p className="text-[10px] font-black">V1 {V1_PROGRESS}%</p>
                  <p className="text-[9px] text-gray-400">{daysRemaining !== null ? `${daysRemaining}d restantes` : "—"}</p>
                </div>
              </Link>
            )}

            <button
              onClick={handleSignOut}
              className="w-8 h-8 bg-indigo-600 rounded-xl flex items-center justify-center text-white text-xs font-bold hover:bg-indigo-700 transition-colors"
              title={`${userName} — Clique para sair`}
            >
              {initials}
            </button>
          </div>
        </header>

        {userRole === "super_admin" && (
          // justify-end (não center): WorkspaceViewSwitcher posiciona seu
          // próprio dropdown com `absolute right-0 w-72` relativo ao botão —
          // centralizado nesta barra, o dropdown de 288px estouraria a
          // borda esquerda da viewport em 390px. Alinhado à direita, ele
          // replica a mesma posição (perto da borda direita) que já tinha
          // dentro do header no desktop, onde o dropdown sempre coube.
          <div className="md:hidden flex items-center justify-end gap-2 px-4 py-2 border-b border-gray-100 bg-white flex-shrink-0">
            <WorkspaceExitButton />
            <WorkspaceViewSwitcher />
          </div>
        )}

        {previewContext?.isPreview && <WorkspacePreviewBanner context={previewContext} />}

        {isOnContentosPage && (
          <div className="bg-purple-700 border-b border-purple-600 flex items-center justify-between px-4 md:px-6 py-2 flex-shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-white">REC OS</span>
              {isSelectingClient ? (
                <span className="text-xs text-purple-300">· Selecione um cliente</span>
              ) : activeClientName ? (
                <span className="text-xs text-purple-200">
                  · Visualizando: <span className="font-bold text-white">{activeClientName}</span>
                </span>
              ) : isRecOSHubPage ? (
                <span className="text-xs text-purple-200">
                  · Visualizando: <span className="font-bold text-white">Todos os clientes</span>
                </span>
              ) : (
                <span className="text-xs text-purple-300">· Nenhum cliente selecionado</span>
              )}
            </div>
            {!isSelectingClient && (
              <div className="flex items-center gap-4">
                <Link
                  href="/admin/contentos?clientPicker=open"
                  className="text-xs text-purple-200 hover:text-white transition-colors"
                >
                  ↔ Trocar cliente
                </Link>
                <Link
                  href="/admin/dashboard"
                  className="text-xs text-purple-200 hover:text-white transition-colors flex items-center gap-1"
                >
                  <ArrowLeft className="w-3 h-3" />
                  Sair da REC OS
                </Link>
              </div>
            )}
          </div>
        )}

        <main className="flex-1 overflow-y-auto p-4 md:p-6 pb-20 md:pb-6">{children}</main>
      </div>
      <MobileBottomNav
        variant="admin"
        // Fase 31 (Sprint REC OS 3.0.1): a superfície só é conhecida com
        // segurança em dois casos — preview ativo do Super Admin (já
        // resolvido no servidor em previewContext.surface) ou a própria
        // sessão real de super_admin. Para agency/agency_client/
        // direct_business fora de preview, a superfície real ainda não é
        // resolvida por este layout compartilhado — cai no comportamento
        // anterior (ADMIN_PRIMARY fixo), sem regressão.
        surface={previewContext?.surface ?? (userRole === "super_admin" ? "super_admin" : undefined)}
      />
      <JarvisPanel />
    </div>
  );
}
