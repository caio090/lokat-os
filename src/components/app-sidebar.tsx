"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { withCompanyContext, readCompanyContextParam } from "@/lib/company-context/navigation";
import { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, Users, Target, FolderOpen, BarChart3,
  FileText, DollarSign, Settings,
  Home, Image, CheckSquare, TrendingUp, Wallet,
  Archive, MessageSquare, HelpCircle, BookOpen,
  Sparkles,
  Map, ShoppingBag, Eye, Flag,
  CreditCard, FileSignature, Receipt, AlertTriangle,
  GraduationCap, BookMarked, Play, Package, Activity,
  LogOut, KanbanSquare, ClipboardList, CalendarDays, UserCheck,
  ScrollText, Palette, Video, MousePointerClick, Link2, SlidersHorizontal,
  Shield, Clapperboard, UsersRound, Briefcase, Building2, FolderKanban,
  NotebookPen,
} from "lucide-react";
import { RecDropIcon } from "@/components/icons/RecDropIcon";

export type SidebarVariant = "admin" | "client" | "contentos" | "growth" | "financeiro" | "academy" | "operacional";

export const configs: Record<SidebarVariant, {
  logo: string;
  logoColor: string;
  title: string;
  /** `tag`: rótulo discreto exibido com a sidebar aberta (ex.: "Pessoal" — não é um módulo de Company). */
  nav: { href: string; label: string; icon: React.ElementType; tag?: string }[];
}> = {
  admin: {
    logo: "L",
    logoColor: "bg-indigo-600",
    title: "LOKAT OS",
    nav: [
      { href: "/admin/inicio",            label: "Início",           icon: Home },
      // Meu PP V2 — espaço PESSOAL (docs/meu-pp/README.md). Fora de COMPANY_SCOPED_ROUTES: nunca recebe ?client=.
      { href: "/admin/meu-pp",            label: "Meu PP",           icon: NotebookPen, tag: "Pessoal" },
      { href: "/admin/dashboard",         label: "Dashboard",        icon: LayoutDashboard },
      { href: "/admin/empresa",           label: "Empresa",          icon: Building2 },
      { href: "/admin/escritorio",        label: "Meu Escritório",   icon: Briefcase },
      { href: "/admin/projetos",          label: "Projetos",         icon: FolderKanban },
      { href: "/admin/meu-negocio",       label: "Meu Negócio",      icon: Sparkles },
      { href: "/admin/calendario",        label: "Calendário Global", icon: CalendarDays },
      { href: "/admin/contentos",         label: "REC OS",           icon: RecDropIcon },
      { href: "/admin/contentos/aprovacoes", label: "Aprovações",    icon: CheckSquare },
      { href: "/admin/audiovisual",       label: "Audiovisual",      icon: Clapperboard },
      { href: "/admin/operacional",       label: "Operacional",      icon: KanbanSquare },
      { href: "/admin/leads",             label: "CRM",              icon: Target },
      { href: "/admin/clientes",          label: "Clientes",         icon: Users },
      { href: "/admin/equipe",            label: "Equipe",           icon: UsersRound },
      { href: "/admin/diagnosticos",      label: "Diagnósticos",     icon: Activity },
      { href: "/admin/relatorios",        label: "Relatórios",       icon: BarChart3 },
      { href: "/admin/status",            label: "Status",           icon: Activity },
      { href: "/admin/financeiro",        label: "Financeiro",       icon: DollarSign },
      { href: "/admin/super/billing",     label: "Billing & Planos", icon: CreditCard },
      { href: "/admin/super/accounts",    label: "Contas",           icon: Shield },
      { href: "/admin/conexoes",          label: "Integrações",      icon: Link2 },
      { href: "/admin/configuracoes",     label: "Configurações",    icon: Settings },
    ],
  },
  client: {
    logo: "C",
    logoColor: "bg-pink-500",
    title: "Meu Portal",
    nav: [
      { href: "/client/home",          label: "Início",        icon: Home },
      { href: "/client/projeto",       label: "Projeto",       icon: FolderOpen },
      { href: "/client/conteudos",     label: "Conteúdos",     icon: Image },
      { href: "/client/aprovacoes",    label: "Aprovações",    icon: CheckSquare },
      { href: "/client/calendario",    label: "Calendário",    icon: CalendarDays },
      { href: "/client/resultados",    label: "Resultados",    icon: TrendingUp },
      { href: "/client/financeiro",    label: "Financeiro",    icon: Wallet },
      { href: "/client/arquivos",      label: "Arquivos",      icon: Archive },
      { href: "/client/solicitacoes",  label: "Solicitações",  icon: MessageSquare },
      { href: "/client/suporte",       label: "Suporte",       icon: HelpCircle },
      { href: "/client/configuracoes", label: "Configurações", icon: SlidersHorizontal },
    ],
  },
  contentos: {
    logo: "R",
    logoColor: "bg-red-600",
    title: "REC OS",
    nav: [
      { href: "/contentos/home",             label: "Visão Geral",      icon: Home },
      { href: "/contentos/base-estrategica", label: "Base Estratégica", icon: BookOpen },
      { href: "/contentos/campanhas",        label: "Campanhas",        icon: Flag },
      { href: "/contentos/calendario",       label: "Calendário",       icon: CalendarDays },
      { href: "/contentos/producao",         label: "Produção",         icon: ScrollText },
      { href: "/contentos/distribuicao",     label: "Distribuição",     icon: MousePointerClick },
      { href: "/contentos/insights",         label: "Insights",         icon: BarChart3 },
      { href: "/contentos/aprovacoes",       label: "Aprovações",       icon: CheckSquare },
      { href: "/contentos/relatorios",       label: "Relatórios",       icon: FileText },
    ],
  },
  operacional: {
    logo: "L",
    logoColor: "bg-slate-700",
    title: "LOKAT OS",
    nav: [
      { href: "/operacional/dashboard",      label: "Dashboard",            icon: LayoutDashboard },
      { href: "/operacional/briefings",      label: "Briefings & Demandas", icon: ScrollText },
      { href: "/operacional/recos",          label: "Audiovisual",          icon: Clapperboard },
      { href: "/operacional/minhas-tarefas", label: "Minhas Tarefas",       icon: ClipboardList },
      { href: "/operacional/calendario",     label: "Calendário",           icon: CalendarDays },
      { href: "/operacional/perfil",         label: "Meu Perfil",           icon: UserCheck },
      { href: "/operacional/comercial",      label: "Comercial",            icon: TrendingUp },
    ],
  },
  growth: {
    logo: "G",
    logoColor: "bg-emerald-600",
    title: "GrowthOS",
    nav: [
      { href: "/growth/diagnosticos",  label: "Diagnósticos",    icon: Eye },
      { href: "/growth/plano-de-acao", label: "Plano de Ação",   icon: Map },
      { href: "/growth/funil",         label: "Funil de Vendas", icon: Target },
      { href: "/growth/ofertas",       label: "Ofertas",         icon: ShoppingBag },
      { href: "/growth/concorrentes",  label: "Concorrentes",    icon: Eye },
      { href: "/growth/metas",         label: "Metas",           icon: Flag },
    ],
  },
  financeiro: {
    logo: "F",
    logoColor: "bg-emerald-600",
    title: "FinanceOS",
    nav: [
      { href: "/financeiro/pagamentos",    label: "Pagamentos",    icon: CreditCard },
      { href: "/financeiro/contratos",     label: "Contratos",     icon: FileSignature },
      { href: "/financeiro/recibos",       label: "Recibos",       icon: Receipt },
      { href: "/financeiro/planos",        label: "Planos",        icon: ShoppingBag },
      { href: "/financeiro/inadimplencia", label: "Inadimplência", icon: AlertTriangle },
    ],
  },
  academy: {
    logo: "A",
    logoColor: "bg-amber-500",
    title: "Academy",
    nav: [
      { href: "/academy/home",      label: "Home",       icon: Home },
      { href: "/academy/cursos",    label: "Cursos",     icon: GraduationCap },
      { href: "/academy/curso",     label: "Meu Curso",  icon: BookMarked },
      { href: "/academy/aula",      label: "Aula Atual", icon: Play },
      { href: "/academy/materiais", label: "Materiais",  icon: Package },
      { href: "/academy/progresso", label: "Progresso",  icon: Activity },
    ],
  },
};

// Exports for icon re-use in operacional pages
export { Palette, Video, ScrollText, MousePointerClick, UserCheck, ClipboardList };

/**
 * Sprint MVP Dogfood Final — Company Context Transversal (Fase 10).
 * Rotas cuja navegação deve preservar a Company ativa (`?client=`). Nunca
 * inclui rotas que não são Company-scoped (Início, Clientes, Equipe,
 * Financeiro, Status, Super Admin, Integrações, Configurações, etc.).
 */
const COMPANY_SCOPED_ROUTES = new Set([
  "/admin/empresa",
  "/admin/escritorio",
  "/admin/projetos",
  "/admin/calendario",
  "/admin/contentos",
  "/admin/relatorios",
]);
// Nota: /admin/leads é o funil de aquisição da própria LOKAT (waitlist/beta
// -- name/email/phone/source), nunca dados de uma Company cliente. Não é
// Company-scoped por natureza (confirmado lendo o page.tsx real antes de
// incluir aqui -- ver commercial_leads/operacional/comercial para o CRM
// real de clientes, auditado separadamente).

interface AppSidebarProps {
  variant: SidebarVariant;
  userName?: string;
  userRole?: string;
  /** Fase 57 (Final Closure) — rotula "/admin/organizacao" como Minha Agência quando account_type = 'agencia', senão Meu Negócio. */
  accountType?: string | null;
  onSignOut?: () => void;
  badges?: Record<string, number>;
  hideRoutes?: string[];
  transparent?: boolean;
}

const SIDEBAR_W_CLOSED = 64;
const SIDEBAR_W_OPEN   = 248;

export function AppSidebar({
  variant, userName = "Usuário", userRole = "", onSignOut, badges, hideRoutes, transparent,
}: AppSidebarProps) {
  const pathname = usePathname();
  const activeCompanyId = readCompanyContextParam(useSearchParams());
  const config   = configs[variant];

  const [expanded,      setExpanded]      = useState(false);
  const expandTimer  = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const handleMouseEnter = useCallback(() => {
    clearTimeout(collapseTimer.current);
    expandTimer.current = setTimeout(() => setExpanded(true), 80);
  }, []);

  const handleMouseLeave = useCallback(() => {
    clearTimeout(expandTimer.current);
    collapseTimer.current = setTimeout(() => setExpanded(false), 120);
  }, []);

  const handleFocusIn = useCallback(() => {
    clearTimeout(collapseTimer.current);
    setExpanded(true);
  }, []);

  const handleFocusOut = useCallback((e: React.FocusEvent) => {
    if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) {
      collapseTimer.current = setTimeout(() => setExpanded(false), 120);
    }
  }, []);

  const bg = transparent ? "bg-black/25 backdrop-blur-md border-r border-white/10" : "bg-slate-900";

  return (
    <motion.aside
      aria-label="Navegação principal"
      aria-expanded={expanded}
      className={cn("flex flex-col h-full flex-shrink-0 relative overflow-hidden", bg)}
      animate={{ width: expanded ? SIDEBAR_W_OPEN : SIDEBAR_W_CLOSED }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleFocusIn}
      onBlur={handleFocusOut}
      style={{ willChange: "width" }}
    >
      {/* Logo */}
      <div className="py-4 border-b border-slate-800 w-full flex items-center px-4 gap-3 overflow-hidden flex-shrink-0">
        <div className={cn(
          "w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-black flex-shrink-0",
          config.logoColor,
        )}>
          {config.logo}
        </div>
        <AnimatePresence>
          {expanded && (
            <motion.span
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="text-white text-sm font-black whitespace-nowrap overflow-hidden"
            >
              {config.title}
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      {/* Nav */}
      <nav
        aria-label="Menu"
        className="flex-1 overflow-y-auto scrollbar-thin py-2 flex flex-col gap-0.5 w-full px-2"
      >
        {config.nav.filter(({ href }) => !hideRoutes?.includes(href)).map(({ href, label: baseLabel, icon: Icon, tag }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          const badge  = badges?.[href] ?? 0;
          const resolvedHref = COMPANY_SCOPED_ROUTES.has(href) ? withCompanyContext(href, activeCompanyId) : href;
          const label = baseLabel;
          return (
            <Link
              key={href}
              href={resolvedHref}
              aria-label={label}
              data-active={active ? "true" : "false"}
              className={cn(
                "relative flex items-center gap-3 rounded-xl transition-all overflow-hidden",
                "h-11 px-3",
                active
                  ? "bg-white/10 text-white"
                  : "text-slate-400 hover:text-white hover:bg-white/5",
              )}
            >
              <Icon className="w-[18px] h-[18px] flex-shrink-0" />
              {badge > 0 && !expanded && (
                <span className="absolute top-1.5 right-1.5 bg-red-500 text-white text-[9px] font-bold rounded-full min-w-[15px] h-[15px] flex items-center justify-center px-0.5">
                  {badge > 9 ? "9+" : badge}
                </span>
              )}
              <AnimatePresence>
                {expanded && (
                  <motion.span
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -6 }}
                    transition={{ duration: 0.15, ease: "easeOut" }}
                    className="text-sm font-medium whitespace-nowrap overflow-hidden flex-1"
                  >
                    {label}
                    {tag ? (
                      <span className="ml-2 rounded-full border border-slate-600 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider text-slate-400">
                        {tag}
                      </span>
                    ) : null}
                  </motion.span>
                )}
              </AnimatePresence>
              {/* Badge visible when expanded */}
              {badge > 0 && expanded && (
                <span className="ml-auto bg-red-500 text-white text-[9px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 flex-shrink-0">
                  {badge > 9 ? "9+" : badge}
                </span>
              )}
              {/* Active indicator */}
              {active && (
                <span className="absolute left-0 top-2 bottom-2 w-[3px] bg-indigo-400 rounded-r-full" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-slate-800 px-2 py-3 flex flex-col gap-1 overflow-hidden flex-shrink-0">
        <div className="flex items-center gap-3 px-2 py-1 rounded-lg overflow-hidden">
          <div
            className="w-8 h-8 rounded-lg bg-slate-700 flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
            title={`${userName}${userRole ? ` · ${userRole}` : ""}`}
          >
            {userName.slice(0, 2).toUpperCase()}
          </div>
          <AnimatePresence>
            {expanded && (
              <motion.div
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -6 }}
                transition={{ duration: 0.15 }}
                className="flex-1 min-w-0 overflow-hidden"
              >
                <p className="text-xs font-semibold text-white truncate">{userName}</p>
                {userRole && <p className="text-[10px] text-slate-400 truncate">{userRole}</p>}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        {onSignOut && (
          <button
            onClick={onSignOut}
            aria-label="Sair"
            className={cn(
              "flex items-center gap-3 px-2 py-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors overflow-hidden",
            )}
          >
            <LogOut className="w-4 h-4 flex-shrink-0" />
            <AnimatePresence>
              {expanded && (
                <motion.span
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -6 }}
                  transition={{ duration: 0.15 }}
                  className="text-sm whitespace-nowrap"
                >
                  Sair
                </motion.span>
              )}
            </AnimatePresence>
          </button>
        )}
      </div>
    </motion.aside>
  );
}
