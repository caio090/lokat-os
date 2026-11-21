"use client";
import { useEffect, useState, useCallback } from "react";
import {
  Sparkles, BarChart3, CheckCircle2, Clock, AlertCircle, Link2,
  FileText, RefreshCw, Trash2, Info, ExternalLink, TrendingUp, Flame, Thermometer, Snowflake, MessageSquare, X,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { buildWhatsappUrl } from "@/lib/marketing-diagnostic";
import { CLIENT_VISIBLE_STATUSES } from "@/lib/client-visibility";
import { recoverDiagnosticLead } from "@/lib/commercial-leads/recover-diagnostic-lead";

// ── Tipos ─────────────────────────────────────────────────────────────────────
type StatusKey = "completo" | "parcial" | "pendente" | "aguardando_conexao" | "aguardando_leitura";

interface DiagAreas {
  presencaDigital: number;
  conteudo:        number;
  engajamento:     number;
  consistencia:    number;
  estrategia:      number;
}

interface ClientDiag {
  id:              string;
  clientId:        string;
  clientName:      string;
  avatar:          string;
  color:           string;
  score:           number | null;
  completedAt:     string | null;
  areas:           DiagAreas | null;
  recommendations: string[];
  hasMetaConn:     boolean;
  hasOlaClick:     boolean;
  isDemo:          boolean;
}

// ── Card demo fixo (tutorial) ────────────────────────────────────────────────
const DEMO_DIAG: ClientDiag = {
  id:          "demo",
  clientId:    "demo",
  clientName:  "Demo Loja",
  avatar:      "DL",
  color:       "bg-gray-400",
  score:       74,
  completedAt: "2025-01-01",
  areas: {
    presencaDigital: 80,
    conteudo:        70,
    engajamento:     75,
    consistencia:    68,
    estrategia:      77,
  },
  recommendations: [
    "Este é um cliente demonstrativo — explore o painel para entender o funcionamento",
    "Diagnóstico Digital analisa presença, conteúdo e engajamento da marca",
    "Diagnóstico Comercial mostra dados de vendas quando Cardápio Digital estiver conectado",
  ],
  hasMetaConn:  false,
  hasOlaClick:  false,
  isDemo:       true,
};

// ── Helpers visuais ───────────────────────────────────────────────────────────
const STATUS: Record<StatusKey, { label: string; color: string; bg: string }> = {
  completo:           { label: "Completo",          color: "text-emerald-700", bg: "bg-emerald-50 border-emerald-100" },
  parcial:            { label: "Parcial",            color: "text-amber-700",   bg: "bg-amber-50 border-amber-100"     },
  pendente:           { label: "Pendente",           color: "text-gray-500",    bg: "bg-gray-50 border-gray-200"       },
  aguardando_conexao: { label: "Aguardando conexão", color: "text-blue-700",    bg: "bg-blue-50 border-blue-100"       },
  aguardando_leitura: { label: "Aguardando leitura", color: "text-indigo-700",  bg: "bg-indigo-50 border-indigo-100"   },
};

function scoreStatus(score: number | null): StatusKey {
  if (score === null) return "pendente";
  if (score >= 80) return "completo";
  if (score >= 65) return "parcial";
  return "pendente";
}

function StatusBadge({ status }: { status: StatusKey }) {
  const cfg  = STATUS[status];
  const Icon = status === "completo" ? CheckCircle2 : status === "aguardando_conexao" ? Link2 : status === "aguardando_leitura" ? Clock : AlertCircle;
  return (
    <span className={`inline-flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.color}`}>
      <Icon className="w-2.5 h-2.5" />{cfg.label}
    </span>
  );
}

function SourceBadge({ label, active }: { label: string; active: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded-full border ${active ? "bg-purple-50 text-purple-700 border-purple-100" : "bg-gray-50 text-gray-400 border-gray-100"}`}>
      {active ? "✓" : "○"} {label}
    </span>
  );
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-gray-500">{label}</span>
        <span className="font-bold text-gray-700">{value}</span>
      </div>
      <div className="w-full bg-gray-100 rounded-full h-1.5">
        <div className={cn("h-1.5 rounded-full", value >= 80 ? "bg-emerald-500" : value >= 65 ? "bg-amber-400" : "bg-red-400")} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

// ── Card com score ────────────────────────────────────────────────────────────
function DiagCard({ d, onRemoveDemo }: { d: ClientDiag; onRemoveDemo?: () => void }) {
  const st = scoreStatus(d.score);
  return (
    <div className={cn("bg-white rounded-2xl border p-5 relative", d.isDemo ? "border-dashed border-gray-300" : "border-gray-100")}>
      {/* Badge demo */}
      {d.isDemo && (
        <div className="absolute top-3 right-3 flex items-center gap-1">
          <span className="text-[9px] font-bold bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full border border-gray-200">DEMO — tutorial</span>
          <button onClick={onRemoveDemo} title="Remover card demo" className="p-1 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-400 transition-colors">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className={cn("w-10 h-10 rounded-xl text-white text-sm font-bold flex items-center justify-center flex-shrink-0", d.color)}>
          {d.avatar}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-gray-900 truncate">{d.clientName}</h3>
          <p className="text-xs text-gray-400">
            {d.completedAt ? new Date(d.completedAt).toLocaleDateString("pt-BR") : "Sem diagnóstico ainda"}
          </p>
        </div>
        {d.score !== null && (
          <div className="text-center flex-shrink-0">
            <div className={cn("text-2xl font-black", d.score >= 80 ? "text-emerald-600" : d.score >= 65 ? "text-amber-500" : "text-red-500")}>{d.score}</div>
            <div className="text-[10px] text-gray-400">score</div>
          </div>
        )}
      </div>

      {/* Diagnóstico Digital */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-3 h-3 text-purple-500" strokeWidth={1.5} />
            <p className="text-[10px] font-black text-gray-500 uppercase tracking-wider">Saúde Digital</p>
          </div>
          <StatusBadge status={d.score !== null ? st : "pendente"} />
        </div>

        {d.areas ? (
          <div className="space-y-2">
            <ScoreBar label="Presença Digital" value={d.areas.presencaDigital} />
            <ScoreBar label="Conteúdo"         value={d.areas.conteudo} />
            <ScoreBar label="Engajamento"      value={d.areas.engajamento} />
            <ScoreBar label="Consistência"     value={d.areas.consistencia} />
            <ScoreBar label="Estratégia"       value={d.areas.estrategia} />
          </div>
        ) : (
          <p className="text-[11px] text-gray-400">Diagnóstico ainda não realizado para este cliente.</p>
        )}

        <div className="flex flex-wrap gap-1 mt-2">
          <SourceBadge label="Diagnóstico da marca" active={d.score !== null} />
          <SourceBadge label="REC OS"                 active={d.score !== null} />
          <SourceBadge label="Insights Meta"         active={d.hasMetaConn} />
        </div>
      </div>

      {/* Diagnóstico Comercial */}
      <div className="border-t border-gray-50 pt-3 mb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <BarChart3 className="w-3 h-3 text-emerald-500" strokeWidth={1.5} />
            <p className="text-[10px] font-black text-gray-500 uppercase tracking-wider">Saúde Comercial</p>
          </div>
          <StatusBadge status={d.hasOlaClick ? "aguardando_leitura" : "pendente"} />
        </div>
        <p className="text-[10px] text-gray-400 mb-1.5">
          {d.hasOlaClick
            ? "Cardápio Digital conectado — aguardando leitura de dados."
            : "Sem fonte de faturamento configurada. Envie um relatório manual ou conecte uma fonte."}
        </p>
        <div className="flex flex-wrap gap-1">
          <SourceBadge label="Cardápio Digital"  active={d.hasOlaClick} />
          <SourceBadge label="Relatório mensal" active={false} />
        </div>
      </div>

      {/* Recomendações */}
      {d.recommendations.length > 0 && (
        <div className="border-t border-gray-50 pt-3">
          <p className="text-[10px] font-black text-gray-500 uppercase tracking-wider mb-2">Recomendações</p>
          <ul className="space-y-1">
            {d.recommendations.map((r, i) => (
              <li key={i} className="text-[11px] text-gray-500 flex items-start gap-1.5">
                <span className={cn("mt-0.5 flex-shrink-0", d.isDemo ? "text-gray-300" : "text-indigo-400")}>→</span>{r}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Ações para cliente sem diagnóstico */}
      {d.score === null && !d.isDemo && (
        <div className="border-t border-gray-50 pt-3 flex flex-col gap-1.5">
          <button className="text-xs font-medium text-purple-600 bg-purple-50 px-3 py-1.5 rounded-lg hover:bg-purple-100 transition-colors w-full">
            Iniciar Diagnóstico Digital
          </button>
          <Link href="/admin/conexoes" className="text-xs font-medium text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-lg hover:bg-emerald-100 transition-colors w-full text-center">
            Conectar fonte comercial
          </Link>
        </div>
      )}
    </div>
  );
}

// ── Marketing Diagnostics (funil público) ─────────────────────────────────────
interface MktDiag {
  id: string;
  created_at: string;
  full_name: string;
  company_name: string;
  instagram: string | null;
  whatsapp: string;
  best_contact_time: string | null;
  business_type: string;
  marketing_responsible: string | null;
  main_problem: string;
  lead_score: number;
  lead_temperature: string;
  offer_suggestion: string | null;
  advice: string | null;
  status: string;
  /** LKT PROMPT 02, seção 15/16 -- único jeito hoje de saber se o lead foi mesmo criado/vinculado (best-effort em marketing-diagnostics/route.ts: pode falhar silenciosamente). null = diagnóstico salvo, mas sem vínculo comercial -- precisa de atenção manual. */
  commercial_lead_id: string | null;
}

const TEMP_ICON: Record<string, { icon: typeof Flame; color: string }> = {
  quente: { icon: Flame,       color: "text-red-500"   },
  morno:  { icon: Thermometer, color: "text-amber-500" },
  frio:   { icon: Snowflake,   color: "text-blue-400"  },
};

function MktDiagModal({ d: initial, onClose, onUpdated }: { d: MktDiag; onClose: () => void; onUpdated: (updated: MktDiag) => void }) {
  const [d, setD] = useState(initial);
  const [recovering, setRecovering] = useState(false);
  const [recoverError, setRecoverError] = useState<string | null>(null);
  const temp = TEMP_ICON[d.lead_temperature] ?? TEMP_ICON.morno;
  const TempIcon = temp.icon;
  const waMsg = `Olá, ${d.full_name}. Aqui é da Lokat. Recebemos o diagnóstico da ${d.company_name} e vi que o principal ponto hoje é ${d.main_problem}. Podemos te mostrar os próximos passos?`;
  const waUrl = buildWhatsappUrl(d.whatsapp, waMsg);

  /** PROMPT 03, seção 5 -- recuperação real, não só o aviso visual. */
  async function recoverLead() {
    if (!isSupabaseConfigured || recovering) return;
    setRecoverError(null);
    setRecovering(true);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      const result = await recoverDiagnosticLead(supabase, d, user?.id ?? null);
      if (!result.ok) { setRecoverError(result.message); return; }
      const updated = result.diagnostic as MktDiag;
      setD(updated);
      onUpdated(updated);
    } finally {
      setRecovering(false);
    }
  }

  return (
    <div onClick={onClose} className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl border border-gray-100 w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div>
            <h3 className="font-bold text-gray-900">{d.full_name}</h3>
            <p className="text-xs text-gray-400">{d.company_name}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {[
              ["WhatsApp", d.whatsapp],
              ["Instagram", d.instagram ?? "—"],
              ["Tipo de negócio", d.business_type],
              ["Responsável pelo mkt", d.marketing_responsible ?? "—"],
              ["Problema principal", d.main_problem],
              ["Melhor horário", d.best_contact_time ?? "—"],
              ["Data", new Date(d.created_at).toLocaleDateString("pt-BR")],
              ["Status", d.status],
            ].map(([k, v]) => (
              <div key={k}>
                <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">{k}</p>
                <p className="text-xs text-gray-700">{v}</p>
              </div>
            ))}
          </div>

          {!d.commercial_lead_id && (
            <div className="bg-red-50 border border-red-100 rounded-xl p-3 space-y-2">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-[11px] text-red-700">
                  Este diagnóstico não foi vinculado a nenhum lead comercial (falha no momento do envio). O contato chegou, mas não entrou no pipeline.
                </p>
              </div>
              <button
                onClick={recoverLead}
                disabled={recovering || !isSupabaseConfigured}
                className="text-[11px] font-bold px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {recovering ? "Recuperando…" : "Recuperar vínculo"}
              </button>
              {recoverError && <p className="text-[10px] text-red-600">{recoverError}</p>}
            </div>
          )}
          {d.commercial_lead_id && (
            <p className="text-[11px] text-emerald-600 font-medium">✓ Vinculado a um lead comercial</p>
          )}

          <div className="bg-purple-50 border border-purple-100 rounded-xl p-4 space-y-2">
            <div className="flex items-center gap-1.5">
              <TempIcon className={`w-3.5 h-3.5 ${temp.color}`} />
              <span className="text-xs font-bold text-gray-700">Score {d.lead_score} · Lead {d.lead_temperature}</span>
            </div>
            {d.offer_suggestion && <p className="text-xs text-purple-800 font-medium">{d.offer_suggestion}</p>}
            {d.advice && <p className="text-[11px] text-purple-600">{d.advice}</p>}
          </div>

          <a href={waUrl} target="_blank" rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full py-2.5 bg-green-500 hover:bg-green-600 text-white rounded-xl text-sm font-bold transition-colors">
            <MessageSquare className="w-4 h-4" /> Chamar no WhatsApp
          </a>
        </div>
      </div>
    </div>
  );
}

function MktDiagRow({ d, onSelect }: { d: MktDiag; onSelect: () => void }) {
  const temp = TEMP_ICON[d.lead_temperature] ?? TEMP_ICON.morno;
  const TempIcon = temp.icon;
  return (
    <tr className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors cursor-pointer" onClick={onSelect}>
      <td className="py-3 px-4">
        <p className="text-sm font-semibold text-gray-900 truncate max-w-[140px]">{d.full_name}</p>
        <p className="text-[11px] text-gray-400 truncate max-w-[140px]">{d.company_name}</p>
      </td>
      <td className="py-3 px-4 text-xs text-gray-500 hidden sm:table-cell">{d.business_type}</td>
      <td className="py-3 px-4 text-xs text-gray-500 hidden md:table-cell">{d.main_problem}</td>
      <td className="py-3 px-4">
        <div className="flex items-center gap-1">
          <TempIcon className={`w-3.5 h-3.5 ${temp.color}`} />
          <span className="text-xs font-semibold capitalize text-gray-700">{d.lead_temperature}</span>
        </div>
      </td>
      <td className="py-3 px-4 text-[11px] text-gray-400 hidden lg:table-cell">
        {new Date(d.created_at).toLocaleDateString("pt-BR")}
      </td>
      <td className="py-3 px-4">
        <span className={cn("text-[9px] font-bold px-2 py-0.5 rounded-full",
          d.status === "new" ? "bg-blue-50 text-blue-700 border border-blue-100" : "bg-gray-100 text-gray-500")}>
          {d.status === "new" ? "Novo" : d.status}
        </span>
        {!d.commercial_lead_id && (
          <span className="ml-1 text-[9px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-100" title="Diagnóstico sem lead vinculado">
            sem lead
          </span>
        )}
      </td>
    </tr>
  );
}

// ── Página ────────────────────────────────────────────────────────────────────
const DEMO_HIDDEN_KEY = "lokat_diag_demo_hidden";

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0] ?? "").join("").toUpperCase() || "??";
}

const COLORS = [
  "bg-indigo-500","bg-purple-500","bg-pink-500","bg-rose-500","bg-amber-500",
  "bg-emerald-500","bg-teal-500","bg-cyan-500","bg-blue-500","bg-violet-500",
];
function colorFor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffffffff;
  return COLORS[Math.abs(h) % COLORS.length];
}

export default function AdminDiagnosticosPage() {
  const [clients,     setClients]     = useState<ClientDiag[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [showDemo,    setShowDemo]    = useState(false);
  const [activeTab,   setActiveTab]   = useState<"clientes" | "marketing">("clientes");
  const [mktDiags,    setMktDiags]    = useState<MktDiag[]>([]);
  const [mktLoading,  setMktLoading]  = useState(false);
  const [mktSelected, setMktSelected] = useState<MktDiag | null>(null);

  // Demo pode ser ocultado pelo admin
  useEffect(() => {
    const hidden = localStorage.getItem(DEMO_HIDDEN_KEY) === "1";
    setShowDemo(!hidden);
  }, []);

  const removeDemo = () => {
    localStorage.setItem(DEMO_HIDDEN_KEY, "1");
    setShowDemo(false);
  };

  const load = useCallback(async () => {
    setLoading(true);
    if (!isSupabaseConfigured) {
      setClients([]);
      setLoading(false);
      return;
    }
    try {
      const supabase = createClient();

      // Busca clientes reais
      const { data: rawClients } = await supabase
        .from("clients")
        .select("id, company_name, created_at, deleted_at, archived_at")
        .in("status", CLIENT_VISIBLE_STATUSES)
        .is("deleted_at", null)
        .is("archived_at", null)
        .order("company_name");

      // Busca conexões Meta
      const { data: metaConns } = await supabase
        .from("meta_connections")
        .select("client_id")
        .eq("status", "active");

      // Busca conexões OlaClick
      const { data: olaConns } = await supabase
        .from("olaclick_connections")
        .select("client_id")
        .eq("status", "active");

      // Busca diagnósticos digitais se tabela existir
      const { data: diagData } = await supabase
        .from("client_diagnostics")
        .select("*")
        .eq("status", "active");

      const metaSet = new Set((metaConns ?? []).map((m: { client_id: string }) => m.client_id));
      const olaSet  = new Set((olaConns  ?? []).map((o: { client_id: string }) => o.client_id));
      const diagMap = new Map(
        (diagData ?? []).map((d: { client_id: string; [k: string]: unknown }) => [d.client_id, d])
      );

      const list: ClientDiag[] = (rawClients ?? []).map((c: { id: string; company_name: string; created_at: string }) => {
        const diag = diagMap.get(c.id) as Record<string, unknown> | undefined;
        return {
          id:          c.id,
          clientId:    c.id,
          clientName:  c.company_name,
          avatar:      initials(c.company_name),
          color:       colorFor(c.id),
          score:       diag?.score as number | null ?? null,
          completedAt: diag?.completed_at as string | null ?? null,
          areas:       diag?.areas as DiagAreas | null ?? null,
          recommendations: (diag?.recommendations as string[] | null) ?? [],
          hasMetaConn: metaSet.has(c.id),
          hasOlaClick: olaSet.has(c.id),
          isDemo:      false,
        };
      });

      setClients(list);
    } catch {
      setClients([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const loadMkt = useCallback(async () => {
    setMktLoading(true);
    try {
      const supabase = createClient();
      const { data } = await supabase
        .from("marketing_diagnostics")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      setMktDiags((data as MktDiag[]) ?? []);
    } catch {
      setMktDiags([]);
    } finally {
      setMktLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "marketing" && mktDiags.length === 0) void loadMkt();
  }, [activeTab, mktDiags.length, loadMkt]);

  // Separa clientes com diagnóstico dos sem
  const withDiag    = clients.filter((c) => c.score !== null);
  const withoutDiag = clients.filter((c) => c.score === null);

  return (
    <div>
      {mktSelected && (
        <MktDiagModal
          d={mktSelected}
          onClose={() => setMktSelected(null)}
          onUpdated={(updated) => {
            setMktSelected(updated);
            setMktDiags((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
          }}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Diagnósticos</h1>
          <p className="text-sm text-gray-400 mt-0.5">Saúde digital e comercial por cliente — dados reais</p>
        </div>
        <button
          onClick={() => activeTab === "clientes" ? void load() : void loadMkt()}
          disabled={loading || mktLoading}
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-indigo-600 transition-colors disabled:opacity-40"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", (loading || mktLoading) && "animate-spin")} />
          Atualizar
        </button>
      </div>

      {/* Abas */}
      <div className="flex gap-1 mb-6 border-b border-gray-100 pb-0">
        {([
          { key: "clientes", label: "Diagnóstico de Clientes", icon: Sparkles },
          { key: "marketing", label: "Marketing Local", icon: TrendingUp },
        ] as const).map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setActiveTab(key)}
            className={cn("flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors -mb-px",
              activeTab === key ? "border-indigo-500 text-indigo-600" : "border-transparent text-gray-400 hover:text-gray-600")}>
            <Icon className="w-3.5 h-3.5" strokeWidth={1.5} />
            {label}
            {key === "marketing" && mktDiags.length > 0 && (
              <span className="ml-1 bg-red-100 text-red-600 text-[9px] font-bold px-1.5 py-0.5 rounded-full">{mktDiags.filter(d => d.status === "new").length}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── ABA MARKETING LOCAL ──────────────────────────────────── */}
      {activeTab === "marketing" && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-xs font-bold text-gray-600">{mktDiags.length} diagnóstico{mktDiags.length !== 1 ? "s" : ""} recebido{mktDiags.length !== 1 ? "s" : ""}</p>
              <p className="text-[11px] text-gray-400">Funil público /diagnostico-marketing</p>
            </div>
            <a href="/diagnostico-marketing" target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-indigo-600 hover:underline">
              Ver página pública <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          {mktLoading && (
            <div className="flex items-center justify-center py-16 text-gray-400 text-sm">
              <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Carregando…
            </div>
          )}

          {!mktLoading && mktDiags.length === 0 && (
            <div className="bg-gray-50 border border-gray-100 rounded-xl p-8 text-center">
              <TrendingUp className="w-8 h-8 text-gray-300 mx-auto mb-3" strokeWidth={1.5} />
              <p className="text-sm font-semibold text-gray-500 mb-1">Nenhum diagnóstico ainda</p>
              <p className="text-xs text-gray-400">Quando alguém preencher o funil em /diagnostico-marketing, aparecerá aqui.</p>
            </div>
          )}

          {!mktLoading && mktDiags.length > 0 && (
            <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    {["Lead", "Segmento", "Problema", "Temperatura", "Data", "Status"].map((h) => (
                      <th key={h} className={cn("text-left py-2.5 px-4 text-[10px] font-bold text-gray-400 uppercase tracking-wider",
                        h === "Segmento" && "hidden sm:table-cell",
                        h === "Problema" && "hidden md:table-cell",
                        h === "Data" && "hidden lg:table-cell",
                      )}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {mktDiags.map((d) => (
                    <MktDiagRow key={d.id} d={d} onSelect={() => setMktSelected(d)} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── ABA CLIENTES ────────────────────────────────────────── */}
      {activeTab === "clientes" && (
      <div>
      {/* Explicação do sistema */}
      <div className="grid sm:grid-cols-2 gap-4 mb-6 p-5 bg-gradient-to-r from-purple-50 to-indigo-50 border border-purple-100 rounded-2xl">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 bg-purple-100 rounded-lg flex items-center justify-center">
              <Sparkles className="w-3.5 h-3.5 text-purple-600" strokeWidth={1.5} />
            </div>
            <p className="text-xs font-black text-purple-800">Diagnóstico Digital</p>
          </div>
          <p className="text-[11px] text-purple-700 leading-relaxed">
            Mede presença digital, conteúdo, engajamento, consistência e estratégia. Alimenta o <strong>REC OS</strong> com contexto.
          </p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {["Diagnóstico da marca", "REC OS", "Insights Meta", "Calendário editorial"].map((l) => (
              <span key={l} className="text-[9px] font-semibold bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">{l}</span>
            ))}
          </div>
        </div>
        <div>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 bg-emerald-100 rounded-lg flex items-center justify-center">
              <BarChart3 className="w-3.5 h-3.5 text-emerald-600" strokeWidth={1.5} />
            </div>
            <p className="text-xs font-black text-emerald-800">Diagnóstico Comercial</p>
          </div>
          <p className="text-[11px] text-emerald-700 leading-relaxed">
            Mede faturamento, ticket médio, produtos mais vendidos e gargalos de venda via Cardápio Digital ou relatório manual.
          </p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {["Cardápio Digital", "API de vendas", "Relatório anexado", "Dados manuais"].map((l) => (
              <span key={l} className="text-[9px] font-semibold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">{l}</span>
            ))}
          </div>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16 text-gray-400 text-sm">
          <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Carregando clientes reais…
        </div>
      )}

      {/* Aviso: cliente precisa estar cadastrado primeiro */}
      {!loading && clients.length === 0 && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-6 flex items-start gap-3">
          <Info className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-blue-800 space-y-1">
            <p className="font-bold">Nenhum cliente cadastrado ainda.</p>
            <p>Para usar os diagnósticos, cadastre o cliente primeiro em <strong>Clientes</strong>, conecte o Meta em <strong>Conexões</strong> e depois o diagnóstico digital pode ser iniciado.</p>
            <Link href="/admin/clientes" className="inline-flex items-center gap-1 text-blue-700 font-semibold hover:underline mt-1">
              Ir para Clientes <ExternalLink className="w-3 h-3" />
            </Link>
          </div>
        </div>
      )}

      {/* Grid — clientes COM diagnóstico */}
      {!loading && (withDiag.length > 0 || showDemo) && (
        <>
          {withDiag.length > 0 && (
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Com diagnóstico</p>
          )}
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-5 mb-6">
            {showDemo && <DiagCard key="demo" d={DEMO_DIAG} onRemoveDemo={removeDemo} />}
            {withDiag.map((d) => <DiagCard key={d.id} d={d} />)}
          </div>
        </>
      )}

      {/* Grid — clientes SEM diagnóstico */}
      {!loading && withoutDiag.length > 0 && (
        <>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Aguardando diagnóstico</p>
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-5 mb-6">
            {withoutDiag.map((d) => <DiagCard key={d.id} d={d} />)}
          </div>
        </>
      )}

      {/* Demo sozinho (quando não há outros clientes ainda) */}
      {!loading && clients.length === 0 && showDemo && (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-5 mb-6">
          <DiagCard d={DEMO_DIAG} onRemoveDemo={removeDemo} />
        </div>
      )}

      {/* Nota fluxo correto */}
      {!loading && (
        <div className="bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 flex items-start gap-2.5">
          <FileText className="w-3.5 h-3.5 text-gray-400 flex-shrink-0 mt-0.5" strokeWidth={1.5} />
          <div className="text-[11px] text-gray-400 space-y-1">
            <p>
              <strong className="text-gray-600">Fluxo correto:</strong> Cadastre o cliente em <Link href="/admin/clientes" className="text-indigo-500 hover:underline">Clientes</Link> → conecte o Meta em <Link href="/admin/conexoes" className="text-indigo-500 hover:underline">Conexões</Link> → inicie o diagnóstico digital → o comercial aparece automaticamente quando Cardápio Digital estiver conectado.
            </p>
            <p>
              <strong className="text-gray-600">Dados comerciais:</strong> Quando Cardápio Digital ou outro sistema estiver conectado, o Diagnóstico Comercial exibirá faturamento, ticket médio e produtos mais vendidos automaticamente.
            </p>
          </div>
        </div>
      )}
      </div>
      )}
    </div>
  );
}
