import { PageHeader } from "@/components/page-header";
import { DashboardCard } from "@/components/dashboard-card";
import {
  Users, Target, FolderOpen, CheckSquare, BarChart3,
  DollarSign, AlertTriangle, TrendingUp, UserRoundPlus, Clock,
  Sparkles, Video, GraduationCap, Link2, FileText,
  Package, Truck, ShoppingBag, MapPin, BarChart2, Eye, Bot,
} from "lucide-react";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAdminContentOSClients } from "@/lib/admin-contentos-clients";
import { ContentOSAdminCard } from "./_contentos-card";
import { SmartSuggestionsPanel } from "@/components/smart-suggestions-panel";
import { getAdminSuggestions } from "@/lib/ai-suggestions";
import { CurrentUserCard } from "@/components/current-user-card";
import { MeuDiaBlock } from "./_meu-dia";
import { QuickActionMenu } from "@/components/quick-action-menu";
import { getWorkspacePreviewContext } from "@/lib/workspaces/context";
import type { WorkspaceSurface } from "@/lib/workspaces/types";
import { createSupabaseAdminClient, hasSupabaseServiceRoleKey } from "@/lib/supabase/server";
import { getOnboardingAttentionItems } from "@/lib/client-onboarding/adapters";
import type { OnboardingAttentionItem } from "@/lib/client-onboarding/types";

interface RealApproval {
  id: string;
  client_id: string | null;
  content_items: { title: string | null }[] | null;
}

interface RealContent {
  id: string;
  title: string | null;
  type: string | null;
  channel: string | null;
  status: string | null;
}

export default async function AdminDashboardPage() {
  let firstName        = "";
  let userRole: string | null = null;
  let userAvatarUrl: string | null = null;
  let clients          = [] as Awaited<ReturnType<typeof getAdminContentOSClients>>;
  let pendingApprovals: RealApproval[] = [];
  let recentContents:  RealContent[]  = [];
  let approvalsCount   = 0;
  let contentsCount    = 0;
  let pendingTeamCount = 0;
  let adminSuggestions: Awaited<ReturnType<typeof getAdminSuggestions>> = [];
  let onboardingAttentionItems: OnboardingAttentionItem[] = [];

  if (isSupabaseConfigured) {
    try {
      const supabase = await createServerSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("name, role, avatar_url")
          .eq("id", user.id)
          .maybeSingle();
        const fullName = profile?.name ?? user.email ?? "";
        firstName     = fullName.split(/\s+/)[0] ?? "";
        userRole      = profile?.role ?? null;
        userAvatarUrl = profile?.avatar_url ?? null;
      }

      const [clientsResult, approvalsRes, contentsRes, teamReqRes] = await Promise.all([
        getAdminContentOSClients(),
        supabase
          .from("approvals")
          .select("id, client_id, content_items(title)")
          .eq("status", "aguardando")
          .order("created_at", { ascending: false })
          .limit(3),
        supabase
          .from("content_items")
          .select("id, title, type, channel, status")
          .in("status", ["in_review", "draft"])
          .order("created_at", { ascending: false })
          .limit(3),
        supabase
          .from("team_access_requests")
          .select("id", { count: "exact", head: true })
          .eq("status", "pending"),
      ]);

      clients          = clientsResult;
      pendingApprovals = (approvalsRes.data ?? []) as RealApproval[];
      recentContents   = contentsRes.data ?? [];
      approvalsCount   = pendingApprovals.length;
      contentsCount    = recentContents.length;
      pendingTeamCount = teamReqRes.count ?? 0;
      adminSuggestions = await getAdminSuggestions(supabase);

      // FASE 1C, seção 12 -- onboardings parados entram na Central do Dia
      // da agência. DB MIGRATION PENDING (SQL 101) -- degrada para lista
      // vazia honestamente enquanto a tabela não existe, nunca quebra o resto do dashboard.
      if (hasSupabaseServiceRoleKey()) {
        const attentionResult = await getOnboardingAttentionItems(createSupabaseAdminClient());
        if (attentionResult.status === "available") onboardingAttentionItems = attentionResult.data;
      }
    } catch {}
  }

  const fullNameForCard = firstName || null;

  // Fase 23 — mesmo padrão já usado para a bottom navigation (Sprint REC OS
  // 3.0.1): superfície só é considerada conhecida com segurança nos casos
  // já resolvidos pelo preview do Super Admin ou pela própria sessão real
  // de super_admin. Nos demais casos, cai no conjunto de ações "default".
  let surface: WorkspaceSurface | undefined;
  if (isSupabaseConfigured) {
    try {
      const preview = await getWorkspacePreviewContext();
      surface = preview.context?.surface ?? (userRole === "super_admin" ? "super_admin" : undefined);
    } catch { surface = userRole === "super_admin" ? "super_admin" : undefined; }
  }

  return (
    <div>
      <CurrentUserCard
        name={fullNameForCard}
        role={userRole}
        avatarUrl={userAvatarUrl}
        className="mb-5"
      />
      {adminSuggestions.length > 0 && (
        <SmartSuggestionsPanel suggestions={adminSuggestions} className="mb-5" />
      )}
      <PageHeader title="Dashboard" description="Visão geral da agência">
        <QuickActionMenu surface={surface} />
      </PageHeader>

      {/* KPIs — row 1 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <DashboardCard
          title="MRR"
          value="—"
          subtitle="Em breve"
          icon={TrendingUp}
          iconColor="text-emerald-600"
          iconBg="bg-emerald-50"
        />
        <DashboardCard
          title="Clientes Ativos"
          value={isSupabaseConfigured ? clients.length : "—"}
          subtitle={clients.length === 0 && isSupabaseConfigured ? "Nenhum cadastrado" : undefined}
          icon={Users}
          iconColor="text-indigo-600"
          iconBg="bg-indigo-50"
        />
        <DashboardCard
          title="Projetos em Andamento"
          value="—"
          subtitle="Em breve"
          icon={FolderOpen}
          iconColor="text-blue-600"
          iconBg="bg-blue-50"
        />
        <DashboardCard
          title="Inadimplência"
          value="—"
          subtitle="Em breve"
          icon={AlertTriangle}
          iconColor="text-red-600"
          iconBg="bg-red-50"
          alert
        />
      </div>

      {/* KPIs — row 2 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <DashboardCard
          title="Aprovações Pendentes"
          value={isSupabaseConfigured ? approvalsCount : "—"}
          icon={CheckSquare}
          iconColor="text-amber-600"
          iconBg="bg-amber-50"
        />
        <DashboardCard
          title="Conteúdos em Produção"
          value={isSupabaseConfigured ? contentsCount : "—"}
          icon={BarChart3}
          iconColor="text-purple-600"
          iconBg="bg-purple-50"
        />
        <DashboardCard title="Leads em Negociação" value="—" icon={Target} iconColor="text-emerald-600" iconBg="bg-emerald-50" />
        <DashboardCard
          title="Solicitações de Equipe"
          value={isSupabaseConfigured ? pendingTeamCount : "—"}
          subtitle={pendingTeamCount > 0 ? "Aguardando aprovação" : pendingTeamCount === 0 && isSupabaseConfigured ? "Nenhuma pendente" : undefined}
          icon={UserRoundPlus}
          iconColor="text-indigo-600"
          iconBg="bg-indigo-50"
          alert={pendingTeamCount > 0}
        />
      </div>

      {/* ── Meu Dia / Produtividade ── */}
      <MeuDiaBlock pendingApprovals={pendingApprovals} onboardingAttentionItems={onboardingAttentionItems} />

      {/* ContentOS quick access */}
      <ContentOSAdminCard clients={clients} />

      {/* ── Plataforma: módulos ativos e em breve ── */}
      <div className="mb-8">
        <h2 className="text-sm font-bold text-gray-800 mb-1">Plataforma LOKAT OS</h2>
        <p className="text-xs text-gray-400 mb-4">Módulos disponíveis e próximos na sua conta.</p>

        {/* Ativos */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-3">
          {[
            { href: "/admin/dashboard",     icon: BarChart2,  label: "Dashboard",    color: "indigo" },
            { href: "/admin/contentos",     icon: Sparkles,   label: "REC OS",       color: "red"    },
            { href: "/admin/audiovisual",   icon: Video,      label: "Audiovisual",  color: "red"    },
            { href: "/admin/leads",         icon: Target,     label: "GrowthOS",     color: "emerald"},
            { href: "/admin/financeiro",    icon: DollarSign, label: "FinanceOS",    color: "teal"   },
            { href: "/admin/conexoes",      icon: Link2,      label: "Conexoes",     color: "blue"   },
            { href: "/admin/relatorios",    icon: FileText,   label: "Relatorios",   color: "gray"   },
            { href: "/admin/configuracoes", icon: Bot,        label: "IA / Config",  color: "violet" },
            { href: "/admin/status",        icon: CheckSquare, label: "Status V1",    color: "gray"   },
          ].map(({ href, icon: Icon, label, color }) => (
            <a
              key={label}
              href={href}
              className={`flex items-center gap-2.5 bg-white border border-gray-100 rounded-xl px-3 py-2.5 hover:border-${color}-200 hover:bg-${color}-50 transition-colors group`}
            >
              <div className={`w-7 h-7 bg-${color}-50 rounded-lg flex items-center justify-center flex-shrink-0`}>
                <Icon className={`w-3.5 h-3.5 text-${color}-500`} strokeWidth={1.5} />
              </div>
              <span className="text-xs font-medium text-gray-700 group-hover:text-gray-900 truncate">{label}</span>
            </a>
          ))}
        </div>

        {/* Em breve */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {[
            { icon: Package,   label: "Estoque",                note: "Em breve"           },
            { icon: Truck,     label: "Fornecedores",           note: "Em breve"           },
            { icon: ShoppingBag, label: "Produtos",             note: "Em breve"           },
            { icon: TrendingUp,  label: "Google Ads",           note: "Precisa conectar"   },
            { icon: MapPin,    label: "Google Meu Negocio",     note: "Precisa conectar"   },
            { icon: Eye,       label: "Visual Merchandising",   note: "Em breve"           },
            { icon: BarChart3, label: "Trend Radar",            note: "Em breve"           },
            { icon: GraduationCap, label: "Academy",            note: "Em breve"           },
          ].map(({ icon: Icon, label, note }) => (
            <div
              key={label}
              className="flex items-center gap-2.5 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2.5 opacity-60 cursor-default"
            >
              <div className="w-7 h-7 bg-white border border-gray-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <Icon className="w-3.5 h-3.5 text-gray-400" strokeWidth={1.5} />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-gray-500 truncate">{label}</p>
                <p className="text-[10px] text-gray-400">{note}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Clientes */}
        <div className="lg:col-span-1">
          <h2 className="text-sm font-bold text-gray-800 mb-3 flex items-center gap-2">
            <Users className="w-4 h-4 text-indigo-500" />
            Clientes Cadastrados
          </h2>
          {clients.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 p-6 text-center">
              <p className="text-xs text-gray-400">
                {isSupabaseConfigured ? "Nenhum cliente cadastrado ainda." : "Modo demonstração ativo."}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {clients.slice(0, 8).map((c) => (
                <div key={c.id} className="bg-white rounded-xl border border-gray-100 px-3 py-2.5 flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-indigo-100 text-indigo-700 text-xs font-bold flex items-center justify-center flex-shrink-0">
                    {(c.company_name ?? "?")[0]?.toUpperCase()}
                  </div>
                  <span className="text-xs font-medium text-gray-700 flex-1 truncate">
                    {c.company_name || "Sem nome"}
                  </span>
                </div>
              ))}
              {clients.length > 8 && (
                <p className="text-xs text-gray-400 text-center pt-1">+{clients.length - 8} mais</p>
              )}
            </div>
          )}
        </div>

        {/* Aprovações pendentes */}
        <div className="lg:col-span-1">
          <h2 className="text-sm font-bold text-gray-800 mb-3 flex items-center gap-2">
            <CheckSquare className="w-4 h-4 text-purple-500" />
            Aprovações Pendentes
          </h2>
          {pendingApprovals.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 p-6 text-center">
              <p className="text-xs text-gray-400">
                {isSupabaseConfigured ? "Nenhuma aprovação pendente." : "Modo demonstração ativo."}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {pendingApprovals.map((a) => (
                <div key={a.id} className="bg-amber-50 border border-amber-100 rounded-xl px-3 py-2.5 text-xs">
                  <span className="font-medium text-amber-700 flex items-center gap-1"><Clock className="w-3 h-3" /> Aprovação pendente</span>
                  <p className="text-amber-600 mt-0.5 truncate">{a.content_items?.[0]?.title ?? "Conteúdo sem título"}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Financeiro placeholder */}
        <div className="lg:col-span-1">
          <h2 className="text-sm font-bold text-gray-800 mb-3 flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-emerald-500" />
            Cobranças Recentes
          </h2>
          <div className="bg-white rounded-2xl border border-gray-100 p-6 text-center">
            <p className="text-xs text-gray-400">Módulo financeiro em breve.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
