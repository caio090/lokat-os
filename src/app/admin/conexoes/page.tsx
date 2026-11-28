"use client";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import {
  CheckCircle2, XCircle, AlertCircle, Loader2, RefreshCw,
  Link2, Link2Off, AtSign, Bot, Palette, BarChart3, HardDrive,
  ChevronRight, Clock, Zap, TrendingUp, MapPin, Copy, Info,
  ShieldCheck, CalendarDays, User, Globe, Layers,
  UtensilsCrossed, X, Eye, EyeOff, ShieldAlert, Lock, ChevronDown,
} from "lucide-react";
import { DigitalMenuConnectionModal } from "@/components/integrations/digital-menu-connection-modal";
import { MetaClientAssetsModal } from "@/components/integrations/meta-client-assets-modal";
import { ClientIntegrationSelector } from "@/components/integrations/client-integration-selector";
import { IntegrationProviderCard } from "@/components/integrations/integration-provider-card";

// ── Tipos ──────────────────────────────────────────────────────
type MetaStatusResponse = {
  ok: boolean;
  configured: {
    META_APP_ID: boolean;
    META_APP_SECRET: boolean;
    META_REDIRECT_URI: boolean;
    META_API_VERSION: boolean;
  };
  connected: boolean;
  canConnect: boolean;
  sqlPending: boolean;
  message: string;
  redirectConfigured?: boolean;
  redirectHost?: string | null;
  hasLocalhostRedirect?: boolean;
  missing?: string[];
} | null;

type AiResponse = { openaiConfigured: boolean; environment: string } | null;

type InsightsConnection = {
  id: string;
  meta_user_id: string | null;
  page_id: string | null;
  page_name: string | null;
  instagram_business_account_id: string | null;
  instagram_username: string | null;
  created_at: string | null;
  api_version: string;
};

type InsightsResponse = {
  ok: boolean;
  reason?: string;
  message?: string;
  connection?: InsightsConnection;
  metrics_available?: string[];
  publish_available?: boolean;
  publish_note?: string;
} | null;

type MetaPage = {
  id: string;
  name: string;
  picture_url: string | null;
  instagram: {
    id: string;
    name: string | null;
    username: string | null;
    picture_url: string | null;
  } | null;
};

type AccountsResponse = {
  ok: boolean;
  reason?: string;
  message?: string;
  connection_id?: string;
  connection_count?: number;
  pages?: MetaPage[];
  instagram_accounts?: { id: string; name: string | null; username: string | null; picture_url: string | null }[];
  total_pages?: number;
  total_instagram?: number;
} | null;

type MetaConnectionOption = {
  id: string;
  display_name: string;
  status: string;
  created_at: string;
  linked_clients_count: number;
};
type ConnectionsResponse = { ok: boolean; reason?: string; message?: string; connections?: MetaConnectionOption[] } | null;

type AssetLink = { id: string; client_id: string; client_name: string | null };
type AssetsResponse = {
  ok: boolean;
  connection_id?: string;
  assets?: Array<{
    id: string; name: string; picture_url: string | null;
    link: AssetLink | null;
    instagram: { id: string; name: string | null; username: string | null; picture_url: string | null; link: AssetLink | null } | null;
  }>;
} | null;

type HubAssetsResponse = {
  ok: boolean;
  items?: Array<{
    client_id:          string;
    facebook_page_name: string | null;
    instagram_username: string | null;
    ad_account_asset_id?: string | null;
    ad_account_name?:     string | null;
    meta_status:        "complete" | "partial" | "not_connected";
  }>;
} | null;

// ── Helpers visuais ────────────────────────────────────────────
function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return ok ? (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-full">
      <CheckCircle2 className="w-3 h-3" /> {label}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-400 bg-gray-50 border border-gray-100 px-2 py-0.5 rounded-full">
      <Clock className="w-3 h-3" /> {label}
    </span>
  );
}

function ComingSoonBadge() {
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-full">
      <Zap className="w-3 h-3" /> Em breve
    </span>
  );
}

function StepRow({
  ok, label, detail,
}: { ok: boolean | null; label: string; detail?: string }) {
  return (
    <div className="flex items-start gap-2">
      {ok === null
        ? <Clock className="w-3.5 h-3.5 text-gray-300 flex-shrink-0 mt-0.5" />
        : ok
          ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0 mt-0.5" />
          : <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
      }
      <div>
        <p className={`text-xs font-medium leading-tight ${ok ? "text-gray-700" : ok === false ? "text-red-700" : "text-gray-400"}`}>
          {label}
        </p>
        {detail && <p className="text-[11px] text-gray-400 mt-0.5 leading-snug">{detail}</p>}
      </div>
    </div>
  );
}

function CopyBtn({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { void navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="inline-flex items-center gap-1 text-[11px] text-indigo-600 hover:text-indigo-800 transition-colors whitespace-nowrap"
    >
      <Copy className="w-3 h-3" /> {copied ? "Copiado!" : "Copiar"}
    </button>
  );
}

function maskId(id: string | null | undefined): string {
  if (!id) return "—";
  if (id.length <= 6) return "••••••";
  return id.slice(0, 4) + "••••••••" + id.slice(-4);
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("pt-BR", {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch { return "—"; }
}

// ── Tipos Cardápio Digital ──────────────────────────────────────
type ClientOption = {
  id: string;
  company_name: string;
  email?: string | null;
  meta_status?: "complete" | "partial" | "not_connected" | "unknown";
  has_meta_page?: boolean;
  has_instagram?: boolean;
};

// Representa uma conexão de provedor de Cardápio Digital.
// Tabela: olaclick_connections (provider_slug = 'olaclick' por padrão).
// No futuro pode vir de digital_menu_connections para outros provedores.
type DigitalMenuConnectionRow = {
  id: string;
  client_id: string;
  provider: string;          // 'olaclick' | 'anotaai' | ...
  client_name: string | null;
  client_email: string | null;
  connection_name: string;
  token_last_four: string | null;
  api_base_url: string | null;
  status: string;
  last_sync_at: string | null;
  created_at: string | null;
  notes: string | null;
};

// Provedores disponíveis de Cardápio Digital
const DIGITAL_MENU_PROVIDERS = [
  { slug: "olaclick", name: "OlaClick" },
  // futuros: { slug: "anotaai", name: "Anota AI" }, { slug: "deliverydireto", name: "Delivery Direto" }
] as const;

// ── Modal de edição de conexão existente ───────────────────────
const OLACLICK_DEFAULT_BASE_URL = "https://public-api.olaclick.app";

function DigitalMenuEditModal({ conn, onClose, onSaved }: {
  conn: DigitalMenuConnectionRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [connName,    setConnName]    = useState(conn.connection_name);
  const [token,       setToken]       = useState("");
  const [apiBaseUrl,  setApiBaseUrl]  = useState(conn.api_base_url ?? "");
  const [notes,       setNotes]       = useState(conn.notes ?? "");
  const [showToken,   setShowToken]   = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState("");
  const [testing,     setTesting]     = useState(false);
  const [testResult,  setTestResult]  = useState<{
    ok: boolean;
    message?: string;
    reason?: string;
    code?: string;
    httpStatus?: number | null;
    providerErrorMessage?: string | null;
    endpoint?: string;
  } | null>(null);

  async function handleSave() {
    if (!connName.trim()) { setError("Nome da conexão é obrigatório."); return; }
    setSaving(true);
    setError("");
    try {
      const body: Record<string, unknown> = {
        connection_name: connName.trim(),
        notes:           notes.trim() || null,
        api_base_url:    apiBaseUrl.trim() || null,
      };
      if (token.trim()) body["access_token"] = token.trim();

      const r = await fetch(`/api/olaclick/connections/${conn.id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });
      const d = await r.json() as { ok: boolean; reason?: string; message?: string };
      if (d.ok) { onSaved(); }
      else { setError(d.message ?? "Erro ao atualizar conexão."); }
    } catch { setError("Erro de rede. Tente novamente."); }
    finally { setSaving(false); }
  }

  const providerName = conn.provider === "olaclick" ? "OlaClick" : conn.provider;

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    setError("");
    try {
      const r = await fetch("/api/olaclick/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: conn.client_id }),
      });
      const d = await r.json() as typeof testResult;
      setTestResult(d);
    } catch {
      setTestResult({ ok: false, reason: "network_error", message: "Erro de rede ao testar conexão." });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-orange-50 rounded-xl flex items-center justify-center">
              <UtensilsCrossed className="w-4 h-4 text-orange-500" strokeWidth={1.5} />
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900">Gerenciar Conexão</p>
              <p className="text-[10px] text-gray-400">{conn.client_name ?? "Cliente"} · {providerName}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Info readonly */}
          <div className="p-3 bg-gray-50 rounded-xl space-y-1 text-xs text-gray-600">
            <p><span className="font-semibold text-gray-700">Cliente:</span> {conn.client_name ?? "—"}</p>
            <p><span className="font-semibold text-gray-700">Provedor:</span> {providerName}</p>
            <p><span className="font-semibold text-gray-700">Token atual:</span> <span className="font-mono">…{conn.token_last_four ?? "****"}</span></p>
          </div>

          {/* Nome da conexão */}
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1.5">Nome da conexão <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={connName}
              onChange={(e) => setConnName(e.target.value)}
              className="w-full text-xs border border-gray-200 rounded-xl px-3 py-2.5 outline-none focus:border-orange-400"
            />
          </div>

          {/* Token — opcional */}
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1.5">Novo token / API Key</label>
            <div className="relative">
              <input
                type={showToken ? "text" : "password"}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Preencha apenas se quiser substituir o token"
                className="w-full text-xs border border-gray-200 rounded-xl px-3 py-2.5 pr-10 outline-none focus:border-orange-400 font-mono"
              />
              <button
                type="button"
                onClick={() => setShowToken((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
            <p className="text-[10px] text-gray-400 mt-1 flex items-center gap-1">
              <Lock className="w-2.5 h-2.5" /> Deixe vazio para manter o token atual.
            </p>
          </div>

          {/* Configurações avançadas */}
          <div className="border border-gray-100 rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
            >
              <span className="text-xs font-semibold text-gray-700">Configurações avançadas</span>
              <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
            </button>
            {showAdvanced && (
              <div className="p-4 space-y-3">
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1.5">URL da API do provedor</label>
                  <input
                    type="url"
                    value={apiBaseUrl}
                    onChange={(e) => setApiBaseUrl(e.target.value)}
                    placeholder={`Padrão do provider: ${OLACLICK_DEFAULT_BASE_URL}`}
                    className="w-full text-xs border border-gray-200 rounded-xl px-3 py-2.5 outline-none focus:border-orange-400 font-mono"
                  />
                  <p className="text-[10px] text-gray-400 mt-1">
                    {conn.api_base_url
                      ? <><span className="text-orange-600 font-medium">URL personalizada:</span> {conn.api_base_url}</>
                      : <>Usando padrão do provider OlaClick: <span className="font-mono">{OLACLICK_DEFAULT_BASE_URL}</span></>
                    }
                  </p>
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    Deixe vazio para usar o padrão do provider.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Observações */}
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1.5">Observações internas</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notas sobre essa conexão..."
              rows={2}
              className="w-full text-xs border border-gray-200 rounded-xl px-3 py-2 outline-none resize-none focus:border-orange-400"
            />
          </div>

          {/* Testar conexão */}
          <div className="pt-1">
            <button
              type="button"
              onClick={() => void handleTest()}
              disabled={testing || saving}
              className="w-full py-2.5 border border-orange-200 text-orange-700 text-xs font-medium rounded-xl hover:bg-orange-50 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
              {testing ? "Testando..." : "Testar conexão"}
            </button>

            {testResult && (
              <div className={`mt-2 p-3 rounded-xl text-xs space-y-0.5 ${testResult.ok ? "bg-emerald-50 border border-emerald-100 text-emerald-700" : "bg-red-50 border border-red-100 text-red-700"}`}>
                <p className="font-semibold">{testResult.ok ? "✓ Conexão funcionando" : `✗ ${testResult.message ?? "Falha na conexão"}`}</p>
                {!testResult.ok && testResult.endpoint   && <p className="text-[10px] text-gray-500">Endpoint: {testResult.endpoint}</p>}
                {!testResult.ok && testResult.httpStatus != null && <p className="text-[10px] text-gray-500">HTTP Status: {testResult.httpStatus ?? "—"}</p>}
                {!testResult.ok && testResult.providerErrorMessage && (
                  <p className="text-[10px] text-gray-500 font-mono break-all">{testResult.providerErrorMessage}</p>
                )}
              </div>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl p-3">
              <XCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-700">{error}</p>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button onClick={onClose}
              className="flex-1 py-2.5 border border-gray-200 text-xs font-medium text-gray-600 rounded-xl hover:bg-gray-50 transition-colors">
              Cancelar
            </button>
            <button
              onClick={() => void handleSave()}
              disabled={saving || !connName.trim()}
              className="flex-1 py-2.5 bg-orange-500 text-white text-xs font-bold rounded-xl hover:bg-orange-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
              {saving ? "Salvando..." : "Salvar alterações"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Componente principal ───────────────────────────────────────
function ConexoesContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const flashOk      = searchParams.get("meta_ok");
  const flashWarn    = searchParams.get("meta_warn");
  const flashErr     = searchParams.get("meta_error");
  // clientParam and providerParam: used ONLY for deep-links, not for global filtering
  const clientParam  = searchParams.get("client");
  const providerParam = searchParams.get("provider");
  const deepLinkFired = useRef(false);

  const [aiData,    setAiData]    = useState<AiResponse>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiTested,  setAiTested]  = useState(false);

  const [metaStatus,    setMetaStatus]    = useState<MetaStatusResponse>(null);
  const [metaLoading,   setMetaLoading]   = useState(false);
  const [metaTested,    setMetaTested]    = useState(false);

  const [insights,        setInsights]        = useState<InsightsResponse>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsTested,  setInsightsTested]  = useState(false);

  const [showSetup, setShowSetup] = useState(false);

  const [accounts,        setAccounts]        = useState<AccountsResponse>(null);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [accountsTested,  setAccountsTested]  = useState(false);

  const [showOlaModal,   setShowOlaModal]   = useState(false);
  const [editingConn,   setEditingConn]    = useState<DigitalMenuConnectionRow | null>(null);
  const [olaClients,     setOlaClients]     = useState<ClientOption[]>([]);
  const [olaConnections, setOlaConnections] = useState<DigitalMenuConnectionRow[]>([]);
  const [olaLoading,     setOlaLoading]     = useState(false);
  const [olaEnv,         setOlaEnv]         = useState<{ hasBaseUrl: boolean } | null>(null);
  const [olaModalClientId, setOlaModalClientId] = useState<string | undefined>(undefined);

  const [assets,        setAssets]        = useState<AssetsResponse>(null);
  const [hubAssets,     setHubAssets]     = useState<HubAssetsResponse>(null);
  const [linkingKey,    setLinkingKey]    = useState<string | null>(null); // "fb:{pageId}" ou "ig:{igId}"
  const [linkClientId,  setLinkClientId]  = useState("");
  const [linkSaving,    setLinkSaving]    = useState(false);
  const [linkError,     setLinkError]     = useState("");
  const [assetsSearch,  setAssetsSearch]  = useState("");
  const [assetsFilter,  setAssetsFilter]  = useState<"todos" | "complete" | "partial" | "not_connected" | "unknown">("todos");
  const [metaHubClient, setMetaHubClient] = useState<{ id: string; company_name: string } | null>(null);

  // Client selector: which provider is currently requesting a client selection
  const [clientSelectorFor, setClientSelectorFor] = useState<"meta" | "olaclick" | null>(null);

  // Seleção de conexão Meta (quando há mais de uma ativa na plataforma)
  // Guarda a resposta inteira (não só connections[]) para distinguir "lista
  // vazia de verdade" de falha de permissão/banco/rede -- antes, qualquer
  // resposta sem d.connections (inclusive ok:false) virava [] e a tela
  // sempre dizia "Nenhuma conexão retornada", escondendo a causa real
  // (achado do PROMPT LKT 14, confirmado lendo /api/meta/connections/route.ts).
  const [metaConnectionsResult,  setMetaConnectionsResult]  = useState<ConnectionsResponse>(null);
  const [metaConnectionsLoading, setMetaConnectionsLoading] = useState(false);
  const [metaConnectionsTested,  setMetaConnectionsTested]  = useState(false);
  const [selectedConnectionId,   setSelectedConnectionId]   = useState<string | null>(null);
  const metaConnections = metaConnectionsResult?.connections ?? [];

  // Teste real de insights por cliente (substitui o antigo /api/meta/insights
  // sem client_id, que SEMPRE retornava missing_client_id e nunca refletia o
  // estado real de nenhum ativo -- achado confirmado em 2026-11-23).
  type ClientInsightsResult = {
    client_id: string; client_name: string; ok: boolean; safeMessage: string;
    assetType?: string; username?: string | null;
  };
  const [clientInsightsResults, setClientInsightsResults] = useState<ClientInsightsResult[] | null>(null);
  const [clientInsightsLoading, setClientInsightsLoading] = useState(false);

  // Teste real de contas de anúncio (via /api/meta/ad-accounts -- usa
  // listAdAccounts, que já existia em marketing-api.ts mas nunca estava
  // conectado a nenhuma rota; "indisponível nesta versão" era texto fixo).
  type AdAccountsResponse = {
    ok: boolean; reason?: string; message?: string; howToEnable?: string[];
    accounts?: Array<{ accountId: string; name: string | null; currency: string | null }>;
  } | null;
  const [adAccounts,        setAdAccounts]        = useState<AdAccountsResponse>(null);
  const [adAccountsLoading, setAdAccountsLoading] = useState(false);

  // Leitura real de campanhas por cliente (PROMPT LKT 16) -- nenhuma rota
  // lia campanha nenhuma antes desta; listAdAccounts só dava nome de conta.
  type CampaignsResponse = {
    ok: boolean; reason?: string; message?: string;
    account?: { name: string | null; currency: string | null; timezoneName: string | null };
    period?: { since: string; until: string };
    queriedAt?: string; total?: number;
    campaigns?: Array<{
      id: string; name: string; status: string | null; effectiveStatus: string | null; objective: string | null;
      hasData: boolean;
      metrics: {
        spend: number; impressions: number; reach: number | null; clicks: number;
        currency: string | null;
        actions: Array<{ action_type: string; value: string }>;
        costPerActionType: Array<{ action_type: string; value: string }>;
      } | null;
    }>;
  } | null;
  function defaultSince() { const d = new Date(); d.setDate(d.getDate() - 6); return d.toISOString().slice(0, 10); }
  function defaultUntil() { return new Date().toISOString().slice(0, 10); }
  const [campaignsClientId,      setCampaignsClientId]      = useState("");
  const [campaignsAdAccount,     setCampaignsAdAccount]     = useState<{ id: string; name: string | null } | null>(null);
  const [campaignsAdAccountTested, setCampaignsAdAccountTested] = useState(false);
  const [campaignsSince,         setCampaignsSince]         = useState(defaultSince());
  const [campaignsUntil,         setCampaignsUntil]         = useState(defaultUntil());
  const [campaignsResult,        setCampaignsResult]        = useState<CampaignsResponse>(null);
  const [campaignsLoading,       setCampaignsLoading]       = useState(false);

  async function pickCampaignsClient(clientId: string) {
    setCampaignsClientId(clientId);
    setCampaignsResult(null);
    setCampaignsAdAccount(null);
    setCampaignsAdAccountTested(false);
    if (!clientId) return;
    try {
      const d = await fetch(`/api/meta/client-assets?client_id=${clientId}`).then((r) => r.json()) as {
        ok: boolean; assets?: { adAccount: { id: string; name: string | null } | null };
      };
      if (d.ok) setCampaignsAdAccount(d.assets?.adAccount ?? null);
    } catch { /* silent -- campaignsAdAccountTested já cobre o estado de erro */ }
    finally { setCampaignsAdAccountTested(true); }
  }

  async function searchCampaigns() {
    if (!campaignsClientId || !campaignsAdAccount) return;
    setCampaignsLoading(true);
    try {
      const qs = new URLSearchParams({
        client_id: campaignsClientId,
        ad_account_id: campaignsAdAccount.id,
        since: campaignsSince,
        until: campaignsUntil,
      }).toString();
      const d = await fetch(`/api/meta/campaigns?${qs}`).then((r) => r.json()) as CampaignsResponse;
      setCampaignsResult(d);
    } catch {
      setCampaignsResult({ ok: false, reason: "network_error", message: "Erro de rede ao consultar campanhas." });
    } finally {
      setCampaignsLoading(false);
    }
  }

  // Carrega conexões OlaClick do banco no mount
  const loadOlaConnections = useCallback(async () => {
    setOlaLoading(true);
    try {
      const [connRes, envRes] = await Promise.all([
        fetch("/api/olaclick/connections").then((r) => r.json()) as Promise<{ ok: boolean; connections?: DigitalMenuConnectionRow[] }>,
        fetch("/api/olaclick/env-status").then((r) => r.json()) as Promise<{ ok: boolean; hasBaseUrl?: boolean }>,
      ]);
      if (connRes.ok) setOlaConnections(connRes.connections ?? []);
      if (envRes.ok) setOlaEnv({ hasBaseUrl: envRes.hasBaseUrl ?? false });
    } catch { /* silent */ }
    finally { setOlaLoading(false); }
  }, []);

  useEffect(() => { void loadOlaConnections(); }, [loadOlaConnections]);

  // Carrega lista de clientes — usada no hub Meta e nos seletores
  const refreshOlaClients = useCallback(() => {
    void fetch("/api/admin/clients")
      .then((r) => r.json())
      .then((d: { clients?: ClientOption[] }) => setOlaClients(d.clients ?? []))
      .catch(() => undefined);
  }, []);

  useEffect(() => { refreshOlaClients(); }, [refreshOlaClients]);

  // ── Fetches ────────────────────────────────────────────────
  const checkAi = useCallback(async () => {
    setAiLoading(true);
    try {
      setAiData(await fetch("/api/ai/status").then((r) => r.json()) as AiResponse);
      setAiTested(true);
    } catch { setAiTested(true); }
    finally { setAiLoading(false); }
  }, []);

  const checkMeta = useCallback(async () => {
    setMetaLoading(true);
    try {
      setMetaStatus(await fetch("/api/meta/status").then((r) => r.json()) as MetaStatusResponse);
      setMetaTested(true);
    } catch { setMetaTested(true); }
    finally { setMetaLoading(false); }
  }, []);

  const checkInsights = useCallback(async () => {
    setInsightsLoading(true);
    try {
      setInsights(await fetch("/api/meta/insights").then((r) => r.json()) as InsightsResponse);
      setInsightsTested(true);
    } catch { setInsightsTested(true); }
    finally { setInsightsLoading(false); }
  }, []);

  const checkAccounts = useCallback(async (connectionId?: string) => {
    setAccountsLoading(true);
    try {
      const qs = connectionId ? `?connection_id=${encodeURIComponent(connectionId)}` : "";
      const [acct, assetData, hubData] = await Promise.all([
        fetch(`/api/meta/accounts${qs}`).then((r) => r.json()) as Promise<AccountsResponse>,
        fetch(`/api/meta/assets${qs}`).then((r) => r.json()) as Promise<AssetsResponse>,
        fetch("/api/meta/hub-assets").then((r) => r.json()) as Promise<HubAssetsResponse>,
      ]);
      setAccounts(acct);
      setAssets(assetData);
      setHubAssets(hubData);
      setAccountsTested(true);
    } catch { setAccountsTested(true); }
    finally { setAccountsLoading(false); }
  }, []);

  // Busca a lista real de conexões Meta disponíveis (via /api/meta/connections,
  // já existia no backend mas nunca era chamada pelo painel -- era por isso
  // que "Há mais de uma conta Meta disponível" nunca tinha onde selecionar).
  const checkMetaConnections = useCallback(async () => {
    setMetaConnectionsLoading(true);
    try {
      const d = await fetch("/api/meta/connections").then((r) => r.json()) as ConnectionsResponse;
      setMetaConnectionsResult(d);
      setMetaConnectionsTested(true);
    } catch {
      setMetaConnectionsResult({ ok: false, reason: "network_error", message: "Erro de rede ao consultar conexões Meta." });
      setMetaConnectionsTested(true);
    } finally { setMetaConnectionsLoading(false); }
  }, []);

  async function selectMetaConnection(connectionId: string) {
    setSelectedConnectionId(connectionId);
    await checkAccounts(connectionId);
  }

  const checkAdAccounts = useCallback(async () => {
    setAdAccountsLoading(true);
    try {
      const qs = selectedConnectionId ? `?connection_id=${encodeURIComponent(selectedConnectionId)}` : "";
      const d = await fetch(`/api/meta/ad-accounts${qs}`).then((r) => r.json()) as AdAccountsResponse;
      setAdAccounts(d);
    } catch {
      setAdAccounts({ ok: false, reason: "network_error", message: "Erro de rede ao consultar contas de anúncio." });
    } finally {
      setAdAccountsLoading(false);
    }
  }, [selectedConnectionId]);

  // Teste real de insights, cliente por cliente (substitui o antigo teste
  // global que sempre chamava /api/meta/insights sem client_id e caía em
  // "missing_client_id", mostrando pro usuário uma mensagem genérica que
  // nunca refletia o estado real de nenhum ativo).
  const checkRealInsightsPerClient = useCallback(async () => {
    setClientInsightsLoading(true);
    try {
      const candidates = olaClients.filter((c) => c.meta_status && c.meta_status !== "not_connected");
      if (candidates.length === 0) {
        setClientInsightsResults([]);
        return;
      }
      const results = await Promise.all(
        candidates.map(async (c): Promise<ClientInsightsResult> => {
          try {
            const d = await fetch(`/api/meta/insights/status?client_id=${encodeURIComponent(c.id)}`).then((r) => r.json()) as {
              ok: boolean; safeMessage?: string; assetType?: string; username?: string | null;
            };
            return {
              client_id: c.id, client_name: c.company_name,
              ok: !!d.ok, safeMessage: d.safeMessage ?? (d.ok ? "Pronto para ler insights." : "Não foi possível confirmar."),
              assetType: d.assetType, username: d.username,
            };
          } catch {
            return { client_id: c.id, client_name: c.company_name, ok: false, safeMessage: "Erro de rede ao testar este cliente." };
          }
        }),
      );
      setClientInsightsResults(results);
    } finally {
      setClientInsightsLoading(false);
    }
  }, [olaClients]);

  // Carrega tudo ao montar, incluindo insights
  useEffect(() => {
    void checkAi();
    void checkMeta();
    void checkInsights();
  }, [checkAi, checkMeta, checkInsights]);

  // Deep-link: ?provider=meta&client=uuid → abre modal do cliente automaticamente (uma vez)
  useEffect(() => {
    if (deepLinkFired.current) return;
    if (!providerParam || !clientParam || olaClients.length === 0) return;
    deepLinkFired.current = true;
    const client = olaClients.find((c) => c.id === clientParam);
    if (providerParam === "meta" && client) {
      setMetaHubClient({ id: client.id, company_name: client.company_name });
    } else if (providerParam === "olaclick" && client) {
      setOlaModalClientId(client.id);
      setShowOlaModal(true);
    } else if (providerParam === "campanhas" && client) {
      // Deep-link vindo de /admin/empresa (Company Central) -- PROMPT LKT 17.
      void pickCampaignsClient(client.id);
    }
  }, [providerParam, clientParam, olaClients]);

  // Enrich clients with OlaClick connection status for ClientIntegrationSelector
  const clientsWithOlaStatus = useMemo(
    () =>
      olaClients.map((c) => ({
        ...c,
        has_olaclick: olaConnections.some((conn) => conn.client_id === c.id),
      })),
    [olaClients, olaConnections],
  );

  // ── Estado derivado Meta ───────────────────────────────────
  // Considera conectado se: status route diz connected=true OU insights ok
  const isConnected = Boolean(
    (metaTested && metaStatus?.connected) ||
    (insightsTested && insights?.ok)
  );
  const insightReason = insights?.reason ?? "";
  const envOk  = metaTested && !!metaStatus?.ok;
  const sqlOk  = metaTested && !metaStatus?.sqlPending;
  const conn   = insights?.connection;

  // Busca ativos da Meta após confirmar conexão real (metaStatus.connected
  // -- antes dependia de insights?.ok, que nunca era true porque o teste
  // global de insights sempre batia em missing_client_id; achado confirmado
  // em 2026-11-23, corrigido junto com o teste de insights por cliente).
  useEffect(() => {
    if (isConnected) {
      void checkAccounts();
    }
  }, [isConnected, checkAccounts]);

  // Quando a Meta sinaliza mais de uma conexão ativa, busca a lista real
  // para o usuário escolher (antes não existia nenhuma forma de selecionar).
  useEffect(() => {
    if (!(accountsTested && accounts?.reason === "connection_selection_required" && !metaConnectionsTested)) return;
    // setTimeout(0) em vez de chamar direto: evita o setState síncrono
    // dentro do corpo do efeito (react-hooks/set-state-in-effect) sem
    // desabilitar a regra -- a chamada só dispara depois que o React já
    // terminou de commitar este efeito.
    const timer = setTimeout(() => { void checkMetaConnections(); }, 0);
    return () => clearTimeout(timer);
  }, [accountsTested, accounts?.reason, metaConnectionsTested, checkMetaConnections]);

  // Carrega o painel "o que funciona agora" (insights por cliente + contas
  // de anúncio) sozinho, assim que a conexão está confirmada -- antes
  // exigia 2 cliques extras ("Testar insights"/"Testar anúncios") que
  // mostravam uma mensagem genérica (ver achado de 2026-11-23). Um único
  // efeito pros dois -- não um pra cada -- pra não multiplicar o padrão
  // já existente de fetch-on-mount deste arquivo.
  useEffect(() => {
    if (!isConnected) return;
    // Mesmo motivo do efeito acima: setTimeout(0) tira a chamada do
    // caminho síncrono do efeito, corrigindo de verdade (não suprimindo)
    // o erro do react-hooks/set-state-in-effect.
    const timer = setTimeout(() => {
      if (olaClients.length > 0 && clientInsightsResults === null) void checkRealInsightsPerClient();
      if (adAccounts === null) void checkAdAccounts();
    }, 0);
    return () => clearTimeout(timer);
  }, [isConnected, olaClients.length, clientInsightsResults, adAccounts, checkRealInsightsPerClient, checkAdAccounts]);

  const isDomainError = Boolean(
    flashErr &&
    (flashErr.toLowerCase().includes("domain") ||
     flashErr.toLowerCase().includes("url") ||
     flashErr.toLowerCase().includes("redirect") ||
     flashErr.toLowerCase().includes("nao esta incluido") ||
     flashErr.toLowerCase().includes("não está incluído"))
  );

  // Cor do badge Meta
  const metaColor = (): "gray" | "red" | "emerald" | "amber" | "blue" => {
    if (!metaTested) return "gray";
    if (!metaStatus?.ok) return "red";
    if (isConnected && insightReason !== "token_expired") return "emerald";
    if (insightReason === "token_expired") return "red";
    if (metaStatus?.sqlPending) return "amber";
    return "blue";
  };

  const colorBg: Record<string, string> = {
    gray: "bg-gray-50", red: "bg-red-50", emerald: "bg-emerald-50", amber: "bg-amber-50", blue: "bg-blue-50",
  };
  const colorIcon: Record<string, string> = {
    gray: "text-gray-400", red: "text-red-400", emerald: "text-emerald-500", amber: "text-amber-500", blue: "text-blue-500",
  };
  const colorBadge: Record<string, string> = {
    gray:    "text-gray-500 bg-gray-50 border-gray-100",
    red:     "text-red-700 bg-red-50 border-red-100",
    emerald: "text-emerald-700 bg-emerald-50 border-emerald-100",
    amber:   "text-amber-700 bg-amber-50 border-amber-100",
    blue:    "text-blue-700 bg-blue-50 border-blue-100",
  };

  const REDIRECT_URI = "https://www.lokat.com.br/api/meta/callback";
  const isLoading = metaLoading || insightsLoading;

  async function linkAsset(
    assetType: "facebook_page" | "instagram_business",
    assetId: string,
    assetName: string | null,
    assetUsername?: string | null,
  ) {
    if (!linkClientId) return;
    setLinkSaving(true);
    setLinkError("");
    try {
      const r = await fetch("/api/meta/assets/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id:          linkClientId,
          meta_connection_id: assets?.connection_id ?? undefined,
          asset_type:         assetType,
          asset_id:           assetId,
          asset_name:         assetName    ?? undefined,
          username:           assetUsername ?? undefined,
          is_primary:         true,
        }),
      });
      const d = await r.json() as { ok: boolean; reason?: string; message?: string };
      if (d.ok) {
        setLinkingKey(null);
        setLinkClientId("");
        void checkAccounts();
      } else {
        setLinkError(d.message ?? "Erro ao vincular ativo.");
      }
    } catch { setLinkError("Erro de rede. Tente novamente."); }
    finally { setLinkSaving(false); }
  }

  return (
    <div>
      <PageHeader title="Central de Conexões" description="Conecte e gerencie os serviços utilizados por cada cliente." />

      {/* Flash messages */}
      {flashOk && (
        <div className="max-w-2xl mb-4 p-3.5 bg-emerald-50 border border-emerald-100 rounded-2xl flex items-start gap-2.5">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-emerald-800">{decodeURIComponent(flashOk)}</p>
        </div>
      )}
      {flashWarn && (
        <div className="max-w-2xl mb-4 p-3.5 bg-amber-50 border border-amber-100 rounded-2xl flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-amber-800">{decodeURIComponent(flashWarn)}</p>
        </div>
      )}
      {flashErr && !isDomainError && (
        <div className="max-w-2xl mb-4 p-3.5 bg-red-50 border border-red-100 rounded-2xl flex items-start gap-2.5">
          <XCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-red-700">{decodeURIComponent(flashErr)}</p>
        </div>
      )}
      {isDomainError && (
        <div className="max-w-2xl mb-4 p-3.5 bg-red-50 border border-red-100 rounded-2xl flex items-start gap-2.5">
          <XCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-red-700">Meta recusou a conexao</p>
            <p className="text-xs text-red-600 mt-0.5">
              O dominio ou Redirect URI ainda nao esta cadastrado no App da Meta.
              Abra as instrucoes no card abaixo e configure antes de tentar novamente.
            </p>
          </div>
        </div>
      )}

      {/* Alerta: META_REDIRECT_URI aponta para localhost em produção */}
      {metaTested && metaStatus?.hasLocalhostRedirect && (
        <div className="max-w-2xl mb-4 p-3.5 bg-amber-50 border border-amber-100 rounded-2xl flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-amber-800">Redirect URI de produção incorreto</p>
            <p className="text-xs text-amber-700 mt-1 leading-relaxed">
              <code className="font-mono bg-amber-100 px-1 rounded">META_REDIRECT_URI</code> está apontando para{" "}
              <strong>{metaStatus.redirectHost ?? "localhost"}</strong>. Em produção, atualize na Vercel para:{" "}
              <code className="font-mono bg-amber-100 px-1 rounded">https://www.lokat.com.br/api/meta/callback</code>
            </p>
            <p className="text-xs text-amber-600 mt-1">Depois de corrigir a variável e fazer redeploy, reconecte a Meta.</p>
          </div>
        </div>
      )}

      {/* ── Resumo de provedores ─────────────────────────────── */}
      {(metaTested || olaConnections.length > 0) && (
        <div className="flex flex-wrap gap-5 mb-6 max-w-2xl">
          {(() => {
            const activeProviders = [isConnected, olaConnections.length > 0].filter(Boolean).length;
            const olaIds = new Set(olaConnections.map((c) => c.client_id));
            const metaIds = new Set(
              (hubAssets?.items ?? []).map((item) => item.client_id)
            );
            const totalIntegrated = new Set([...olaIds, ...metaIds]).size;
            const needsAttention = insightReason === "token_expired" ? 1 : 0;
            return (
              <>
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-indigo-50 rounded-xl flex items-center justify-center">
                    <Zap className="w-4 h-4 text-indigo-500" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-gray-900">{activeProviders}</p>
                    <p className="text-xs text-gray-400">provedor{activeProviders !== 1 ? "es" : ""} ativo{activeProviders !== 1 ? "s" : ""}</p>
                  </div>
                </div>
                {totalIntegrated > 0 && (
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-emerald-50 rounded-xl flex items-center justify-center">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-gray-900">{totalIntegrated}</p>
                      <p className="text-xs text-gray-400">cliente{totalIntegrated !== 1 ? "s" : ""} integrado{totalIntegrated !== 1 ? "s" : ""}</p>
                    </div>
                  </div>
                )}
                {needsAttention > 0 && (
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-amber-50 rounded-xl flex items-center justify-center">
                      <AlertCircle className="w-4 h-4 text-amber-500" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-gray-900">{needsAttention}</p>
                      <p className="text-xs text-gray-400">com atenção</p>
                    </div>
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}

      <div className="max-w-2xl space-y-4">

        {/* ══ OpenAI ══════════════════════════════════════════ */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-violet-50 rounded-xl flex items-center justify-center flex-shrink-0">
                <Bot className={`w-5 h-5 ${aiTested && aiData?.openaiConfigured ? "text-violet-500" : "text-gray-400"}`} strokeWidth={1.5} />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-800">OpenAI</p>
                <p className="text-xs text-gray-400">Motor de IA da LOKAT OS</p>
              </div>
            </div>
            {aiTested
              ? <StatusBadge ok={!!aiData?.openaiConfigured} label={aiData?.openaiConfigured ? "Configurado" : "Nao configurado"} />
              : <span className="text-xs text-gray-400">Verificando...</span>
            }
          </div>
          <div className="space-y-1 mb-4 text-xs text-gray-500">
            <p className="flex items-center gap-1.5"><ChevronRight className="w-3 h-3 text-violet-400" />Diagnostico, briefings, legendas e sugestoes de conteudo</p>
            <p className="flex items-center gap-1.5"><ChevronRight className="w-3 h-3 text-violet-400" />Lokat Voice — assistente no painel</p>
          </div>
          {aiTested && !aiData?.openaiConfigured && (
            <p className="text-xs text-gray-500 mb-3">
              Adicione <code className="font-mono bg-gray-50 border border-gray-200 px-1 rounded">OPENAI_API_KEY</code> na Vercel e faca redeploy.
            </p>
          )}
          <button onClick={() => void checkAi()} disabled={aiLoading}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-xl transition-colors disabled:opacity-50">
            {aiLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Testar configuracao
          </button>
        </div>

        {/* ══ Meta / Instagram ════════════════════════════════ */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5">

          {/* Header */}
          <div className="flex items-start justify-between gap-3 mb-4">
            <div className="flex items-center gap-3">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${colorBg[metaColor()]}`}>
                <AtSign className={`w-5 h-5 ${colorIcon[metaColor()]}`} strokeWidth={1.5} />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-800">Meta / Instagram</p>
                <p className="text-xs text-gray-400">Instagram Business, Páginas e Anúncios</p>
              </div>
            </div>
            <span className={`inline-flex items-center gap-1 text-xs font-medium border px-2 py-0.5 rounded-full flex-shrink-0 ${colorBadge[metaColor()]}`}>
              {isLoading && !insightsTested
                ? <><Loader2 className="w-3 h-3 animate-spin" /> Verificando</>
                : isConnected
                  ? <><CheckCircle2 className="w-3 h-3" /> OAuth conectado</>
                  : !metaStatus?.ok
                    ? <><XCircle className="w-3 h-3" /> Vars faltando</>
                    : metaStatus?.sqlPending
                      ? <><AlertCircle className="w-3 h-3" /> SQL pendente</>
                      : <><Clock className="w-3 h-3" /> Aguardando conexão</>
              }
            </span>
          </div>

          {/* ── ESTADO: CONECTADO ── */}
          {isConnected && (
            <>
              {/* Resumo da conexão */}
              <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-xl mb-4 space-y-2.5">
                <div className="flex items-center gap-1.5 mb-1">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <p className="text-xs font-bold text-emerald-800">
                    {clientParam ? "OAuth da plataforma LOKAT OS conectado" : "Conta conectada com sucesso"}
                  </p>
                </div>
                <p className="text-[11px] text-emerald-700 leading-snug">
                    OAuth da plataforma LOKAT OS. Os ativos de cada cliente aparecem no hub abaixo.
                  </p>

                {conn?.instagram_username && (
                  <div className="flex items-center gap-2 text-xs text-emerald-800">
                    <AtSign className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                    <span>Instagram: <strong>@{conn.instagram_username}</strong></span>
                  </div>
                )}
                {conn?.page_name && (
                  <div className="flex items-center gap-2 text-xs text-emerald-800">
                    <Link2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                    <span>Pagina: <strong>{conn.page_name}</strong></span>
                  </div>
                )}
                {conn?.meta_user_id && (
                  <div className="flex items-center gap-2 text-xs text-emerald-800">
                    <User className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                    <span>Meta User ID: <strong>{maskId(conn.meta_user_id)}</strong></span>
                  </div>
                )}
                {conn?.created_at && (
                  <div className="flex items-center gap-2 text-xs text-emerald-700">
                    <CalendarDays className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                    <span>Conectado em: {formatDate(conn.created_at)}</span>
                  </div>
                )}

                {insightReason === "connected_no_pages" && !accounts?.ok && (
                  <p className="text-[11px] text-emerald-700 mt-1 leading-snug">
                    Conta conectada. Para vincular Páginas ou Instagram Business, reconecte a Meta e autorize o escopo de páginas no fluxo OAuth.
                  </p>
                )}
              </div>

              {/* ── Botão Conectar cliente (Meta) ── */}
              <div className="flex flex-wrap gap-2 mb-4">
                <button
                  onClick={() => setClientSelectorFor("meta")}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 rounded-xl transition-colors"
                >
                  <AtSign className="w-3.5 h-3.5" /> Vincular cliente
                </button>
              </div>

              {/* ── Hub: Status Meta por cliente ── */}
              {accountsTested && (
                <div className="mb-4">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Status Meta por cliente</p>
                    <div className="flex-1" />
                    {/* Search */}
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="Buscar cliente, Página ou Instagram…"
                        value={assetsSearch}
                        onChange={(e) => setAssetsSearch(e.target.value)}
                        className="text-xs border border-gray-200 rounded-lg px-2.5 py-1 pr-6 focus:outline-none focus:border-indigo-400 w-56"
                      />
                      {assetsSearch && (
                        <button onClick={() => setAssetsSearch("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700">
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    {/* Filter chips with counts */}
                    {(() => {
                      // Fonte: client_meta_assets via /api/meta/hub-assets (persistido, não Graph API)
                      const hubMap = new Map((hubAssets?.items ?? []).map((item) => [item.client_id, item]));
                      const counts = { todos: olaClients.length, complete: 0, partial: 0, not_connected: 0, unknown: 0 };
                      for (const c of olaClients) {
                        const ms = c.meta_status ?? hubMap.get(c.id)?.meta_status ?? "not_connected";
                        if (ms === "complete") counts.complete++;
                        else if (ms === "partial") counts.partial++;
                        else if (ms === "unknown") counts.unknown++;
                        else counts.not_connected++;
                      }
                      return (["todos", "complete", "partial", "not_connected", "unknown"] as const).map((f) => (
                        <button key={f} onClick={() => setAssetsFilter(f)}
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border transition-colors ${assetsFilter === f ? "bg-indigo-600 text-white border-indigo-600" : "text-gray-500 border-gray-200 hover:border-indigo-300"}`}
                        >
                          {f === "todos" ? "Todos" : f === "complete" ? "Completos" : f === "partial" ? "Parciais" : f === "not_connected" ? "Não conectados" : "Indisponível"}
                          {" "}<span className={assetsFilter === f ? "opacity-80" : "opacity-60"}>{counts[f]}</span>
                        </button>
                      ));
                    })()}
                  </div>
                  <div className="rounded-xl border border-gray-100 overflow-x-auto">
                    <table className="w-full text-xs" style={{ minWidth: 640 }}>
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-100">
                          <th className="text-left px-3 py-2 text-gray-500 font-semibold">Cliente</th>
                          <th className="text-left px-3 py-2 text-gray-500 font-semibold">Página Facebook</th>
                          <th className="text-left px-3 py-2 text-gray-500 font-semibold">Instagram Business</th>
                          <th className="text-left px-3 py-2 text-gray-500 font-semibold">Conta de anúncio</th>
                          <th className="text-left px-3 py-2 text-gray-500 font-semibold">Status</th>
                          <th className="text-left px-3 py-2 text-gray-500 font-semibold">Ação</th>
                        </tr>
                      </thead>
                      <tbody>
                        {olaClients.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="px-3 py-4 text-center text-gray-400 text-xs">
                              Nenhum cliente disponível.
                            </td>
                          </tr>
                        ) : (() => {
                          // Fonte: client_meta_assets via /api/meta/hub-assets (persistido, não Graph API)
                          const hubMap = new Map((hubAssets?.items ?? []).map((item) => [item.client_id, item]));
                          // Full list from olaClients (source of truth)
                          const allRows = olaClients.map(c => {
                            const hubItem = hubMap.get(c.id);
                            const fb = hubItem?.facebook_page_name ?? null;
                            const igUsername = hubItem?.instagram_username ?? null;
                            const ms: "complete" | "partial" | "not_connected" | "unknown" =
                              c.meta_status ?? hubItem?.meta_status ?? "not_connected";
                            return {
                              clientId:   c.id,
                              clientName: c.company_name,
                              fbPage:     fb,
                              igAccount:  igUsername ?? null,
                              igUsername: igUsername,
                              adAccountName: hubItem?.ad_account_name ?? null,
                              ms,
                            };
                          });
                          // Filter
                          const q = assetsSearch.trim().toLowerCase();
                          const filtered = allRows.filter(row => {
                            if (q) {
                              const noQ = q.replace(/^@/, "");
                              if (
                                !row.clientName.toLowerCase().includes(q) &&
                                !(row.fbPage ?? "").toLowerCase().includes(q) &&
                                !(row.igAccount ?? "").toLowerCase().includes(q) &&
                                !(row.igUsername ?? "").toLowerCase().includes(noQ)
                              ) return false;
                            }
                            if (assetsFilter !== "todos" && row.ms !== assetsFilter) return false;
                            return true;
                          });
                          if (filtered.length === 0) {
                            return (
                              <tr>
                                <td colSpan={6} className="px-3 py-4 text-center text-gray-400 text-xs">
                                  Nenhum cliente encontrado{q ? ` para "${assetsSearch}"` : ""}.
                                </td>
                              </tr>
                            );
                          }
                          return filtered.map(row => (
                            <tr key={row.clientId} className="border-b border-gray-50 last:border-0">
                              <td className="px-3 py-2 font-medium text-gray-800 whitespace-nowrap">{row.clientName}</td>
                              <td className="px-3 py-2 text-gray-600">{row.fbPage ?? <span className="text-gray-300">—</span>}</td>
                              <td className="px-3 py-2 text-gray-600">
                                {row.igAccount
                                  ? <span>{row.igUsername ? `@${row.igUsername}` : row.igAccount}</span>
                                  : <span className="text-gray-300">—</span>}
                              </td>
                              <td className="px-3 py-2 text-gray-600 whitespace-nowrap">
                                {row.adAccountName ?? <span className="text-gray-300">—</span>}
                              </td>
                              <td className="px-3 py-2">
                                <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                                  row.ms === "complete"      ? "text-emerald-700 bg-emerald-50 border-emerald-100"
                                  : row.ms === "partial"     ? "text-amber-700 bg-amber-50 border-amber-100"
                                  : row.ms === "unknown"     ? "text-gray-400 bg-gray-50 border-gray-100"
                                  : "text-gray-400 bg-gray-50 border-gray-100"
                                }`}>
                                  {row.ms === "complete" ? <CheckCircle2 className="w-3 h-3" />
                                    : row.ms === "partial" ? <AlertCircle className="w-3 h-3" />
                                    : <Clock className="w-3 h-3" />}
                                  {row.ms === "complete" ? "Completo" : row.ms === "partial" ? "Parcial" : row.ms === "unknown" ? "Indisponível" : "Não conectado"}
                                </span>
                              </td>
                              <td className="px-3 py-2">
                                <button
                                  onClick={() => setMetaHubClient({ id: row.clientId, company_name: row.clientName })}
                                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-lg border transition-colors ${
                                    row.ms === "complete" ? "text-gray-600 border-gray-200 hover:border-indigo-400 hover:text-indigo-600"
                                    : row.ms === "partial" ? "text-amber-700 border-amber-200 hover:bg-amber-50"
                                    : "text-indigo-600 border-indigo-200 hover:bg-indigo-50"
                                  }`}
                                >
                                  {row.ms === "complete" ? "Gerenciar" : row.ms === "partial" ? "Completar" : "Vincular"}
                                </button>
                              </td>
                            </tr>
                          ));
                        })()}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* ── Ativos encontrados na Meta ── */}
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Ativos encontrados na Meta</p>
                  <button
                    onClick={() => void checkAccounts()}
                    disabled={accountsLoading}
                    className="inline-flex items-center gap-1 text-[10px] text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
                  >
                    {accountsLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                    Atualizar
                  </button>
                </div>

                {!accountsTested && accountsLoading && (
                  <div className="flex items-center gap-2 text-xs text-gray-400 py-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Buscando ativos...
                  </div>
                )}

                {accountsTested && accounts?.reason === "connection_selection_required" && (
                  <div className="p-3.5 bg-amber-50 border border-amber-100 rounded-xl">
                    <p className="text-xs font-semibold text-amber-800 mb-1">
                      {accounts.connection_count ?? "Várias"} contas Meta conectadas nesta plataforma
                    </p>
                    <p className="text-[11px] text-amber-700 mb-3 leading-snug">
                      Todas pertencem à mesma conta que fez o OAuth em momentos diferentes. Escolha qual conexão usar para listar os ativos — isso não desconecta as outras.
                    </p>
                    {metaConnectionsLoading && !metaConnectionsTested ? (
                      <div className="flex items-center gap-2 text-xs text-amber-600 py-1">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Carregando conexões…
                      </div>
                    ) : metaConnectionsTested && !metaConnectionsResult?.ok ? (
                      // Falha real (permissão/banco/rede) — nunca mostrar como lista vazia.
                      <div className="p-2.5 bg-red-50 border border-red-100 rounded-lg">
                        <p className="text-[11px] text-red-700 mb-2">
                          {metaConnectionsResult?.reason === "unauthenticated"
                            ? "Sessão expirada. Atualize a página e faça login novamente."
                            : metaConnectionsResult?.reason === "forbidden"
                              ? "Seu perfil não tem permissão para listar conexões Meta."
                              : metaConnectionsResult?.reason === "sql_pending"
                                ? (metaConnectionsResult?.message ?? "Tabela de conexões Meta ainda não existe no banco.")
                                : metaConnectionsResult?.reason === "db_error"
                                  ? "Erro ao consultar o banco de dados ao listar conexões."
                                  : metaConnectionsResult?.reason === "network_error"
                                    ? "Erro de rede ao consultar conexões Meta."
                                    : metaConnectionsResult?.message ?? "Não foi possível carregar as conexões Meta."}
                        </p>
                        <button
                          onClick={() => void checkMetaConnections()}
                          disabled={metaConnectionsLoading}
                          className="text-[11px] font-medium text-red-700 hover:text-red-900 underline disabled:opacity-50"
                        >
                          Tentar novamente
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {metaConnections.map((c) => (
                          <button
                            key={c.id}
                            onClick={() => void selectMetaConnection(c.id)}
                            disabled={accountsLoading}
                            className={`w-full text-left px-3 py-2 rounded-lg border text-xs transition-colors flex items-center justify-between gap-2 disabled:opacity-50 ${
                              selectedConnectionId === c.id
                                ? "bg-indigo-600 border-indigo-600 text-white"
                                : "bg-white border-amber-200 text-amber-800 hover:border-indigo-300"
                            }`}
                          >
                            <span className="truncate">
                              {c.display_name} · {formatDate(c.created_at)}
                              {c.linked_clients_count > 0 ? ` · ${c.linked_clients_count} cliente(s) vinculado(s)` : ""}
                            </span>
                            {selectedConnectionId === c.id && <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />}
                          </button>
                        ))}
                        {metaConnectionsTested && metaConnections.length === 0 && (
                          <p className="text-[11px] text-amber-600">Nenhuma conexão Meta ativa encontrada. Reconecte em &quot;Conectar Meta&quot;.</p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {accountsTested && !accounts?.ok && accounts?.reason !== "connection_selection_required" && (
                  <div className="p-3 bg-amber-50 border border-amber-100 rounded-xl text-xs text-amber-700">
                    {accounts?.reason === "graph_error"
                      ? <>Erro na Graph API: {accounts.message}</>
                      : accounts?.message ?? "Nao foi possivel buscar ativos da Meta."}
                  </div>
                )}

                {accountsTested && accounts?.ok && (
                  <div className="space-y-2">
                    {/* Banner contextual */}
                    {(accounts.pages ?? []).length > 0 ? (
                      <div className="p-2.5 bg-blue-50 border border-blue-100 rounded-xl text-xs text-blue-700 flex items-center gap-2 mb-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                        Ativos encontrados na Meta. Vincule cada Página/Instagram ao cliente correspondente na LOKAT OS.
                      </div>
                    ) : (
                      <div className="p-2.5 bg-gray-50 border border-gray-100 rounded-xl text-xs text-gray-400 flex items-center gap-2 mb-2">
                        <Layers className="w-3.5 h-3.5 flex-shrink-0" />
                        Nenhuma Página ou Instagram Business encontrada. Reconecte a Meta e selecione páginas no fluxo OAuth.
                      </div>
                    )}
                    {/* Páginas Facebook */}
                    {(accounts.pages ?? []).length > 0 ? (
                      (accounts.pages ?? []).map((page) => {
                        const assetInfo = assets?.assets?.find((a) => a.id === page.id);
                        const fbLink = assetInfo?.link ?? null;
                        const igLink = page.instagram ? (assetInfo?.instagram?.link ?? null) : null;
                        const fbKey = `fb:${page.id}`;
                        const igKey = `ig:${page.instagram?.id ?? ""}`;
                        return (
                          <div key={page.id} className="p-3 bg-blue-50 border border-blue-100 rounded-xl">
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <div className="flex items-center gap-2">
                                {page.picture_url
                                  ? <img src={page.picture_url} alt="" className="w-6 h-6 rounded-full object-cover flex-shrink-0" />
                                  : <div className="w-6 h-6 bg-blue-200 rounded-full flex items-center justify-center flex-shrink-0"><Globe className="w-3.5 h-3.5 text-blue-600" /></div>
                                }
                                <div>
                                  <p className="text-xs font-semibold text-blue-800">{page.name}</p>
                                  <p className="text-[10px] text-blue-500">Pagina Facebook · ID {page.id}</p>
                                </div>
                              </div>
                              <div className="flex-shrink-0">
                                {fbLink
                                  ? <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-full"><CheckCircle2 className="w-3 h-3" />{fbLink.client_name ?? "Vinculado"}</span>
                                  : <button onClick={() => { setLinkingKey(fbKey === linkingKey ? null : fbKey); setLinkClientId(""); setLinkError(""); }} className="inline-flex items-center gap-1 text-[10px] text-blue-600 hover:text-blue-800 bg-white border border-blue-200 px-2 py-0.5 rounded-full transition-colors"><Link2 className="w-3 h-3" />Vincular</button>
                                }
                              </div>
                            </div>
                            {linkingKey === fbKey && (
                              <div className="mt-2 ml-8 space-y-1.5">
                                <p className="text-[10px] text-amber-600 flex items-start gap-1"><AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />Se esta Página for da própria LOKAT (não de um cliente), não vincule aqui — este hub é só para ativos de clientes.</p>
                                <select value={linkClientId} onChange={(e) => setLinkClientId(e.target.value)} className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white outline-none focus:border-blue-400">
                                  <option value="">Selecione o cliente…</option>
                                  {olaClients.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
                                </select>
                                {linkError && <p className="text-[10px] text-red-600">{linkError}</p>}
                                <div className="flex gap-1.5">
                                  <button onClick={() => void linkAsset("facebook_page", page.id, page.name, null)} disabled={linkSaving || !linkClientId} className="text-[10px] px-3 py-1 bg-blue-500 text-white rounded-lg disabled:opacity-50 hover:bg-blue-600 transition-colors">
                                    {linkSaving ? "Salvando…" : "Salvar"}
                                  </button>
                                  <button onClick={() => { setLinkingKey(null); setLinkError(""); }} className="text-[10px] px-3 py-1 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors">Cancelar</button>
                                </div>
                              </div>
                            )}
                            {page.instagram && (
                              <div className="mt-1.5 pl-8">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2">
                                    {page.instagram.picture_url
                                      ? <img src={page.instagram.picture_url} alt="" className="w-5 h-5 rounded-full object-cover flex-shrink-0" />
                                      : <div className="w-5 h-5 bg-pink-100 rounded-full flex items-center justify-center flex-shrink-0"><AtSign className="w-3 h-3 text-pink-500" /></div>
                                    }
                                    <div>
                                      <p className="text-[11px] font-medium text-gray-700">
                                        {page.instagram.username ? `@${page.instagram.username}` : page.instagram.name ?? "Instagram Business"}
                                      </p>
                                      <p className="text-[10px] text-gray-400">Instagram Business</p>
                                    </div>
                                  </div>
                                  <div className="flex-shrink-0">
                                    {igLink
                                      ? <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-full"><CheckCircle2 className="w-3 h-3" />{igLink.client_name ?? "Vinculado"}</span>
                                      : <button onClick={() => { setLinkingKey(igKey === linkingKey ? null : igKey); setLinkClientId(""); setLinkError(""); }} className="inline-flex items-center gap-1 text-[10px] text-pink-600 hover:text-pink-800 bg-white border border-pink-200 px-2 py-0.5 rounded-full transition-colors"><Link2 className="w-3 h-3" />Vincular</button>
                                    }
                                  </div>
                                </div>
                                {linkingKey === igKey && (
                                  <div className="mt-2 space-y-1.5">
                                    <p className="text-[10px] text-amber-600 flex items-start gap-1"><AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />Se este Instagram for da própria LOKAT (não de um cliente), não vincule aqui — este hub é só para ativos de clientes.</p>
                                    <select value={linkClientId} onChange={(e) => setLinkClientId(e.target.value)} className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white outline-none focus:border-pink-400">
                                      <option value="">Selecione o cliente…</option>
                                      {olaClients.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
                                    </select>
                                    {linkError && <p className="text-[10px] text-red-600">{linkError}</p>}
                                    <div className="flex gap-1.5">
                                      <button onClick={() => void linkAsset("instagram_business", page.instagram!.id, page.instagram!.name, page.instagram!.username)} disabled={linkSaving || !linkClientId} className="text-[10px] px-3 py-1 bg-pink-500 text-white rounded-lg disabled:opacity-50 hover:bg-pink-600 transition-colors">
                                        {linkSaving ? "Salvando…" : "Salvar"}
                                      </button>
                                      <button onClick={() => { setLinkingKey(null); setLinkError(""); }} className="text-[10px] px-3 py-1 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors">Cancelar</button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })
                    ) : null}
                  </div>
                )}
              </div>

              {/* ── O que funciona agora, de verdade (substitui a antiga lista
                  estática "o que esta conexão habilita" + os dois painéis que
                  só apareciam depois de clicar em "Testar X" -- carrega sozinho
                  assim que a conexão é confirmada, sem exigir clique nenhum) ── */}
              <div className="p-3.5 bg-gray-50 border border-gray-100 rounded-xl mb-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">O que funciona agora</p>
                  <button
                    onClick={() => { void checkRealInsightsPerClient(); void checkAdAccounts(); }}
                    disabled={clientInsightsLoading || adAccountsLoading}
                    className="inline-flex items-center gap-1 text-[10px] text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
                  >
                    {(clientInsightsLoading || adAccountsLoading) ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                    Atualizar
                  </button>
                </div>

                {/* Insights por cliente */}
                <p className="text-xs font-semibold text-gray-700 mb-1.5">Leitura de métricas (Instagram/Facebook)</p>
                {clientInsightsLoading && clientInsightsResults === null ? (
                  <div className="flex items-center gap-2 text-xs text-gray-400 py-1 mb-3">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checando cada cliente com ativo vinculado…
                  </div>
                ) : clientInsightsResults === null || clientInsightsResults.length === 0 ? (
                  <p className="text-xs text-gray-500 mb-3">Nenhum cliente tem Página ou Instagram vinculado ainda — vincule em &quot;Status Meta por cliente&quot; acima.</p>
                ) : (
                  <div className="space-y-1.5 mb-3">
                    {clientInsightsResults.map((r) => (
                      <div key={r.client_id} className={`flex items-start gap-2 text-xs p-2 rounded-lg border ${r.ok ? "bg-emerald-50 border-emerald-100 text-emerald-800" : "bg-red-50 border-red-100 text-red-700"}`}>
                        {r.ok ? <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> : <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />}
                        <div>
                          <p className="font-semibold">{r.client_name}{r.username ? ` (@${r.username})` : ""}</p>
                          <p className="text-[11px] opacity-90">{r.safeMessage}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Contas de anúncio */}
                <p className="text-xs font-semibold text-gray-700 mb-1.5">Contas de anúncio</p>
                {adAccountsLoading && adAccounts === null ? (
                  <div className="flex items-center gap-2 text-xs text-gray-400 py-1">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Consultando Graph API…
                  </div>
                ) : adAccounts?.ok ? (
                  adAccounts.accounts && adAccounts.accounts.length > 0 ? (
                    <div className="space-y-1">
                      {adAccounts.accounts.map((a) => (
                        <div key={a.accountId} className="text-xs text-gray-700 flex items-center justify-between bg-white border border-gray-100 rounded-lg px-2.5 py-1.5">
                          <span>{a.name ?? a.accountId} <span className="text-gray-400">· {a.currency ?? "—"}</span></span>
                          <span className="text-[10px] text-gray-400">act_{a.accountId}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-500">Permissão concedida, mas nenhuma conta de anúncio encontrada para esta conexão.</p>
                  )
                ) : adAccounts?.reason === "ads_scope_not_granted" ? (
                  <div>
                    <p className="text-xs text-amber-700 font-medium mb-2">Ainda não disponível — falta uma permissão extra.</p>
                    <ol className="text-[11px] text-gray-600 space-y-1 list-decimal list-inside">
                      {(adAccounts.howToEnable ?? []).map((step, i) => <li key={i}>{step.replace(/^\d+\.\s*/, "")}</li>)}
                    </ol>
                  </div>
                ) : (
                  <p className="text-xs text-gray-500">{adAccounts?.message ?? "Verificando…"}</p>
                )}
              </div>

              {/* ── Campanhas e resultados por cliente (PROMPT LKT 16) ──
                  Leitura real via /api/meta/campaigns -- usa a conta de
                  anúncio JÁ VINCULADA ao cliente selecionado (client_meta_assets),
                  nunca "qualquer conta que a conexão acessa". */}
              <div className="p-3.5 bg-gray-50 border border-gray-100 rounded-xl mb-4">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                  <BarChart3 className="w-3 h-3" /> Campanhas e resultados por cliente
                </p>
                <div className="flex flex-wrap items-end gap-2 mb-3">
                  <select
                    value={campaignsClientId}
                    onChange={(e) => void pickCampaignsClient(e.target.value)}
                    className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white outline-none focus:border-indigo-400"
                  >
                    <option value="">Selecione o cliente…</option>
                    {olaClients.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
                  </select>
                  <input type="date" value={campaignsSince} onChange={(e) => setCampaignsSince(e.target.value)}
                    className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white outline-none focus:border-indigo-400" />
                  <span className="text-xs text-gray-400">até</span>
                  <input type="date" value={campaignsUntil} onChange={(e) => setCampaignsUntil(e.target.value)}
                    className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white outline-none focus:border-indigo-400" />
                  <button
                    onClick={() => void searchCampaigns()}
                    disabled={!campaignsClientId || !campaignsAdAccount || campaignsLoading}
                    className="text-[11px] font-semibold px-3 py-1.5 bg-indigo-600 text-white rounded-lg disabled:opacity-40 hover:bg-indigo-700 transition-colors flex items-center gap-1.5"
                  >
                    {campaignsLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <BarChart3 className="w-3 h-3" />}
                    Buscar campanhas
                  </button>
                </div>

                {!campaignsClientId ? (
                  <p className="text-xs text-gray-400">Selecione um cliente para consultar as campanhas da conta de anúncio vinculada a ele.</p>
                ) : !campaignsAdAccountTested ? (
                  <p className="text-xs text-gray-400 flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" /> Verificando conta de anúncio vinculada…</p>
                ) : !campaignsAdAccount ? (
                  <p className="text-xs text-amber-700">Este cliente ainda não tem conta de anúncio vinculada. Vincule em &quot;Status Meta por cliente&quot; → Gerenciar/Vincular, na seção acima.</p>
                ) : (
                  <p className="text-[11px] text-emerald-700 mb-2">Conta vinculada: <span className="font-semibold">{campaignsAdAccount.name ?? campaignsAdAccount.id}</span></p>
                )}

                {campaignsResult && (
                  campaignsResult.ok ? (
                    <div className="mt-2">
                      <p className="text-[10px] text-gray-400 mb-2">
                        {campaignsResult.account?.name ?? "Conta"} · {campaignsResult.account?.currency ?? "—"} · fuso {campaignsResult.account?.timezoneName ?? "—"} ·
                        {" "}período {campaignsResult.period?.since} a {campaignsResult.period?.until} ·
                        {" "}consultado em {campaignsResult.queriedAt ? new Date(campaignsResult.queriedAt).toLocaleString("pt-BR") : "—"} · Graph API
                      </p>
                      {!campaignsResult.campaigns || campaignsResult.campaigns.length === 0 ? (
                        <p className="text-xs text-gray-500">Nenhuma campanha encontrada nesta conta de anúncio.</p>
                      ) : (
                        <div className="space-y-1.5">
                          {campaignsResult.campaigns.map((c) => (
                            <div key={c.id} className="bg-white border border-gray-100 rounded-lg px-3 py-2 text-xs">
                              <div className="flex items-center justify-between">
                                <span className="font-semibold text-gray-800">{c.name}</span>
                                <span className="text-[10px] text-gray-400">{c.effectiveStatus ?? c.status ?? "—"} · {c.objective ?? "—"}</span>
                              </div>
                              {c.hasData && c.metrics ? (
                                <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-gray-600">
                                  <span>Gasto: {c.metrics.spend.toLocaleString("pt-BR", { style: "currency", currency: c.metrics.currency ?? "BRL" })}</span>
                                  <span>Impressões: {c.metrics.impressions.toLocaleString("pt-BR")}</span>
                                  {c.metrics.reach != null && <span>Alcance: {c.metrics.reach.toLocaleString("pt-BR")}</span>}
                                  <span>Cliques: {c.metrics.clicks.toLocaleString("pt-BR")}</span>
                                  {c.metrics.actions.length > 0 && (
                                    <span>Resultados: {c.metrics.actions.map((a) => `${a.action_type}: ${a.value}`).join(", ")}</span>
                                  )}
                                </div>
                              ) : (
                                <p className="mt-1 text-[11px] text-gray-400">Sem dados da Meta para este período.</p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="mt-2 p-2.5 bg-red-50 border border-red-100 rounded-lg">
                      <p className="text-xs text-red-700">{campaignsResult.message ?? "Erro ao consultar campanhas."}</p>
                    </div>
                  )
                )}
              </div>

              {/* Botões pós-conexão */}
              <div className="flex flex-wrap gap-2 mb-4">
                <button
                  onClick={async () => { await checkMeta(); }}
                  disabled={metaLoading}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-xl transition-colors disabled:opacity-50"
                >
                  {metaLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  Testar status
                </button>
                <a
                  href="/api/meta/connect"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 px-3 py-1.5 rounded-xl transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Reconectar Meta
                </a>
                <button
                  onClick={() => alert("Desconectar: em breve. Para revogar agora, acesse facebook.com/settings > Apps e Sites.")}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 border border-red-100 px-3 py-1.5 rounded-xl transition-colors"
                >
                  <Link2Off className="w-3.5 h-3.5" /> Desconectar
                </button>
              </div>
            </>
          )}

          {/* ── ESTADO: CARREGANDO (antes dos fetches retornarem) ── */}
          {!isConnected && !metaTested && !insightsTested && (
            <div className="flex items-center gap-2 text-xs text-gray-400 mb-4 py-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Verificando conexao...
            </div>
          )}

          {/* ── ESTADO: TOKEN EXPIRADO ── */}
          {!isConnected && insightReason === "token_expired" && (metaTested || insightsTested) && (
            <div className="p-3 bg-red-50 border border-red-100 rounded-xl mb-4">
              <p className="text-xs font-semibold text-red-700 mb-1">Token expirado</p>
              <p className="text-xs text-red-600">Reconecte a conta Meta para renovar o acesso.</p>
            </div>
          )}

          {/* ── ESTADO: NAO CONECTADO ── só renderiza após termos dados reais */}
          {!isConnected && insightReason !== "token_expired" && (metaTested || insightsTested) && (
            <>
              {/* Checklist de etapas */}
              <div className="space-y-2.5 mb-4 p-3.5 bg-gray-50 rounded-xl">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Status da configuracao</p>
                <StepRow
                  ok={metaTested ? (metaStatus?.configured
                    ? Object.values(metaStatus.configured).every(Boolean)
                    : false) : null}
                  label="Variaveis Vercel configuradas"
                  detail={metaTested && !metaStatus?.ok && metaStatus?.configured
                    ? `Faltando: ${Object.entries(metaStatus.configured).filter(([,v]) => !v).map(([k]) => k).join(", ")}`
                    : undefined
                  }
                />
                <StepRow
                  ok={metaTested ? sqlOk : null}
                  label="SQL 35 rodado no Supabase"
                  detail={metaStatus?.sqlPending ? "Rode docs/supabase/35-meta-connections.sql no Supabase SQL Editor" : undefined}
                />
                <StepRow
                  ok={null}
                  label="Dominio e Redirect URI no Meta Developers"
                  detail="Verificacao manual — veja instrucoes abaixo"
                />
                <StepRow
                  ok={false}
                  label="Conta Meta nao conectada"
                  detail={insightsTested ? (insights?.message ?? undefined) : undefined}
                />
              </div>

              {/* Instrução de conexão */}
              {envOk && sqlOk && (
                <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl text-xs text-blue-800 mb-4">
                  Para conectar Meta/Instagram, clique em <strong>Conectar Meta</strong> abaixo.
                  Voce sera redirecionado para autenticacao da Meta e voltara automaticamente.
                </div>
              )}

              {/* Botões */}
              <div className="flex flex-wrap gap-2 mb-4">
                <button
                  onClick={() => { void checkMeta(); void checkInsights(); }}
                  disabled={isLoading}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-xl transition-colors disabled:opacity-50"
                >
                  {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  Testar status
                </button>
                {envOk && (
                  <a href="/api/meta/connect"
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 rounded-xl transition-colors">
                    <Link2 className="w-3.5 h-3.5" /> Conectar Meta
                  </a>
                )}
                {insightReason === "token_expired" && (
                  <a href="/api/meta/connect"
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 px-3 py-1.5 rounded-xl transition-colors">
                    <RefreshCw className="w-3.5 h-3.5" /> Reconectar
                  </a>
                )}
              </div>
            </>
          )}

          {/* Mini-grid funcionalidades */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4 pt-3 border-t border-gray-50">
            {[
              {
                label:  "Insights",
                status: isConnected
                  ? insightReason === "ready"
                    ? "Pronto para teste"
                    : "Aguardando leitura de dados"
                  : "Conecte a Meta",
                ok: isConnected,
              },
              { label: "Publicacao automatica", status: "Em breve", ok: false },
              { label: "Trafego / Anuncios",    status: "Em breve", ok: false },
            ].map(({ label, status, ok }) => (
              <div key={label} className="p-2.5 bg-gray-50 rounded-xl">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">{label}</p>
                <p className={`text-xs font-medium ${ok ? "text-emerald-600" : "text-gray-400"}`}>{status}</p>
              </div>
            ))}
          </div>

          {/* Funcionalidades detalhadas */}
          <div className="space-y-1 mb-4 text-xs text-gray-500">
            {[
              { label: "Insights do Instagram", ready: isConnected && insightReason === "ready" },
              { label: "Paginas do Facebook",   ready: isConnected && !!conn?.page_name },
              { label: "Meta Business Manager", ready: false },
              { label: "Publicacao automatica", ready: false, soon: true },
              { label: "Gerenciar anuncios",    ready: false, soon: true },
            ].map(({ label, ready, soon }) => (
              <p key={label} className="flex items-center gap-1.5">
                <ChevronRight className={`w-3 h-3 ${ready ? "text-emerald-500" : soon ? "text-amber-400" : "text-gray-300"}`} />
                <span className={ready ? "text-gray-700 font-medium" : ""}>{label}</span>
                {soon && <span className="text-amber-500 text-[10px]">· em breve</span>}
              </p>
            ))}
          </div>

          {/* Bloco expansível de instruções */}
          <div className="border border-indigo-100 rounded-xl overflow-hidden">
            <button
              onClick={() => setShowSetup((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-3 bg-indigo-50 hover:bg-indigo-100 transition-colors text-left"
            >
              <div className="flex items-center gap-2">
                <Info className="w-4 h-4 text-indigo-500 flex-shrink-0" />
                <span className="text-xs font-semibold text-indigo-800">Como configurar no Meta Developers</span>
              </div>
              <ChevronRight className={`w-4 h-4 text-indigo-400 transition-transform ${showSetup ? "rotate-90" : ""}`} />
            </button>

            {showSetup && (
              <div className="p-4 space-y-4 text-xs text-gray-700">
                <div>
                  <p className="font-semibold text-gray-800 mb-1.5">1. App Domains</p>
                  <p className="text-gray-500 mb-2">Meta for Developers → Seu App → Configuracoes → Basico → App Domains:</p>
                  <div className="space-y-1">
                    {["lokat.com.br", "www.lokat.com.br"].map((d) => (
                      <div key={d} className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5">
                        <code className="font-mono text-gray-700">{d}</code>
                        <CopyBtn value={d} />
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="font-semibold text-gray-800 mb-1.5">2. Redirect URI</p>
                  <p className="text-gray-500 mb-2">Login com o Facebook → Configuracoes do OAuth → URIs validos:</p>
                  <div className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5">
                    <code className="font-mono text-gray-700 text-[11px] break-all">{REDIRECT_URI}</code>
                    <CopyBtn value={REDIRECT_URI} />
                  </div>
                </div>
                <div>
                  <p className="font-semibold text-gray-800 mb-1.5">3. Variaveis na Vercel</p>
                  <div className="space-y-1">
                    {[
                      { key: "META_APP_ID",       note: "ID do app no Meta Developers" },
                      { key: "META_APP_SECRET",    note: "★ nunca exposto em tela" },
                      { key: "META_REDIRECT_URI",  note: REDIRECT_URI },
                      { key: "META_API_VERSION",   note: "v21.0" },
                    ].map(({ key, note }) => (
                      <div key={key} className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5">
                        <code className="font-mono text-gray-700">{key}</code>
                        <span className="text-gray-400 text-[10px] italic truncate max-w-[140px] text-right">{note}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="font-semibold text-gray-800 mb-1.5">4. SQL 35 no Supabase</p>
                  <p className="text-gray-500">Rode <code className="font-mono bg-gray-100 px-1 rounded">docs/supabase/35-meta-connections.sql</code> no Supabase SQL Editor.</p>
                </div>
                <div className="p-3 bg-amber-50 border border-amber-100 rounded-xl">
                  <p className="font-semibold text-amber-800 mb-1">Permissoes avancadas (App Review)</p>
                  <p className="text-amber-700">
                    <code className="font-mono">instagram_manage_insights</code> e <code className="font-mono">business_management</code> exigem
                    aprovacao pelo Meta App Review para usuarios fora do time de desenvolvimento.
                    Adicione seu usuario como Testador no App para testar agora.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ══ Google Drive ════════════════════════════════════ */}
        <IntegrationProviderCard
          providerId="google-drive"
          title="Google Drive"
          description="Arquivos, ativos de campanha e mídia por cliente"
          icon={<HardDrive className="w-5 h-5 text-blue-400" strokeWidth={1.5} />}
          platformStatus="in_preparation"
          accentColor="blue"
          inPreparation
          features={[
            "Pasta raiz por cliente",
            "Sincronização de briefs e arquivos",
            "Entrega de conteúdo via Drive",
          ]}
        />

        {/* ══ Google Agenda ═══════════════════════════════════ */}
        <IntegrationProviderCard
          providerId="google-agenda"
          title="Google Agenda"
          description="Calendário e agendamentos por cliente"
          icon={<CalendarDays className="w-5 h-5 text-green-400" strokeWidth={1.5} />}
          platformStatus="in_preparation"
          accentColor="green"
          inPreparation
          features={[
            "Calendário editorial vinculado ao cliente",
            "Lembretes de entrega de conteúdo",
            "Agendamentos e reuniões",
          ]}
        />

        {/* ══ WhatsApp ════════════════════════════════════════ */}
        <IntegrationProviderCard
          providerId="whatsapp"
          title="WhatsApp Business"
          description="Atendimento e notificações por cliente"
          icon={<Bot className="w-5 h-5 text-gray-400" strokeWidth={1.5} />}
          platformStatus="coming_soon"
          accentColor="gray"
          comingSoon
          features={[
            "Número de WhatsApp Business por cliente",
            "Notificações automáticas de relatório",
            "Integração com Typebot",
          ]}
        />

        {/* ══ Google Meu Negocio ══════════════════════════════ */}
        <IntegrationProviderCard
          providerId="google-business"
          title="Google Meu Negócio"
          description="Presença local, avaliações e posts"
          icon={<MapPin className="w-5 h-5 text-gray-400" strokeWidth={1.5} />}
          platformStatus="coming_soon"
          accentColor="gray"
          comingSoon
          features={[
            "Perfil local vinculado ao cliente",
            "Avaliações e respostas",
            "Posts e atualizações",
          ]}
        />

        {/* ══ Google Analytics ════════════════════════════════ */}
        <IntegrationProviderCard
          providerId="google-analytics"
          title="Google Analytics"
          description="Métricas de tráfego e conversão"
          icon={<BarChart3 className="w-5 h-5 text-gray-400" strokeWidth={1.5} />}
          platformStatus="coming_soon"
          accentColor="gray"
          comingSoon
          features={[
            "Tráfego orgânico e pago",
            "Taxas de conversão por cliente",
          ]}
        />

        {/* ══ Google Ads ══════════════════════════════════════ */}
        <IntegrationProviderCard
          providerId="google-ads"
          title="Google Ads"
          description="Campanhas de tráfego pago"
          icon={<TrendingUp className="w-5 h-5 text-gray-400" strokeWidth={1.5} />}
          platformStatus="coming_soon"
          accentColor="gray"
          comingSoon
          features={[
            "Performance de campanhas por cliente",
            "ROAS e CPL",
          ]}
        />

        {/* ══ Canva ═══════════════════════════════════════════ */}
        <IntegrationProviderCard
          providerId="canva"
          title="Canva"
          description="Design e templates visuais"
          icon={<Palette className="w-5 h-5 text-gray-400" strokeWidth={1.5} />}
          platformStatus="coming_soon"
          accentColor="gray"
          comingSoon
          features={["Templates por cliente", "Aprovação de artes"]}
        />

        {/* ══ Cardápio Digital / OlaClick ═════════════════════ */}
        {(() => {
          const visibleConns = olaConnections;
          const hasConns = visibleConns.length > 0;
          const connectedClientCount = new Set(olaConnections.map((c) => c.client_id)).size;
          return (
            <div className={`bg-white rounded-2xl border p-5 ${hasConns ? "border-orange-100" : "border-gray-100"}`}>
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${hasConns ? "bg-orange-50" : "bg-gray-50"}`}>
                    <UtensilsCrossed className={`w-5 h-5 ${hasConns ? "text-orange-500" : "text-gray-400"}`} strokeWidth={1.5} />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-gray-800">Cardápio Digital</p>
                    <p className="text-xs text-gray-400">Pedidos, produtos e faturamento</p>
                  </div>
                </div>
                {olaLoading
                  ? <span className="inline-flex items-center gap-1 text-xs text-gray-400"><Loader2 className="w-3 h-3 animate-spin" /> Verificando…</span>
                  : hasConns
                    ? <StatusBadge ok={true} label={`${connectedClientCount} de ${olaClients.length} clientes`} />
                    : <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 bg-gray-50 border border-gray-100 px-2 py-0.5 rounded-full"><Clock className="w-3 h-3" /> Não conectado</span>
                }
              </div>

              <div className="space-y-1 mb-4 text-xs text-gray-500">
                <p className="flex items-center gap-1.5"><ChevronRight className="w-3 h-3 text-orange-400" />Cardápio, categorias e produtos</p>
                <p className="flex items-center gap-1.5"><ChevronRight className="w-3 h-3 text-orange-400" />Pedidos e faturamento do período</p>
                <p className="flex items-center gap-1.5"><ChevronRight className="w-3 h-3 text-orange-400" />Clientes recorrentes e frequência</p>
                <p className="flex items-center gap-1.5 text-gray-300"><ChevronRight className="w-3 h-3" />Publicação no cardápio · em breve</p>
              </div>

              {/* Grid de status */}
              <div className="grid grid-cols-3 gap-2 mb-4 pt-3 border-t border-gray-50">
                {[
                  { label: "Cardápio",    ok: hasConns },
                  { label: "Pedidos",     ok: hasConns },
                  { label: "Faturamento", ok: hasConns },
                ].map(({ label, ok }) => (
                  <div key={label} className="p-2.5 bg-gray-50 rounded-xl">
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">{label}</p>
                    <p className={`text-xs font-medium ${ok ? "text-emerald-600" : "text-gray-400"}`}>
                      {ok ? "Disponível" : "Conectar"}
                    </p>
                  </div>
                ))}
              </div>


              {/* Multi-client hub — grid quando todos, lista quando filtrado */}
              {!clientParam ? (
                <div className="mb-4 space-y-3">
                  {olaClients.length > 0 && (
                    <p className="text-xs text-gray-500">
                      <strong className="text-gray-800">{connectedClientCount} de {olaClients.length}</strong>{" "}
                      clientes com Cardápio Digital conectado
                    </p>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {olaClients.map((client) => {
                      const clientConns = olaConnections.filter((c) => c.client_id === client.id);
                      const hasClientConn = clientConns.length > 0;
                      return (
                        <div key={client.id} className={`p-3 rounded-xl border ${hasClientConn ? "bg-orange-50 border-orange-100" : "bg-gray-50 border-gray-100"}`}>
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <div className="flex-1 min-w-0">
                              <p className={`text-xs font-semibold truncate ${hasClientConn ? "text-orange-800" : "text-gray-600"}`}>
                                {client.company_name}
                              </p>
                              {hasClientConn ? (
                                <p className="text-[10px] text-orange-600 mt-0.5">
                                  {clientConns[0].connection_name} · {(clientConns[0].provider ?? "olaclick").toUpperCase()}
                                </p>
                              ) : (
                                <p className="text-[10px] text-gray-400 mt-0.5">Sem conexão</p>
                              )}
                            </div>
                            {hasClientConn
                              ? <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-100 px-1.5 py-0.5 rounded-full flex-shrink-0"><CheckCircle2 className="w-2.5 h-2.5" /> Ativo</span>
                              : <span className="inline-flex items-center gap-1 text-[10px] text-gray-400 bg-white border border-gray-200 px-1.5 py-0.5 rounded-full flex-shrink-0"><Clock className="w-2.5 h-2.5" /> Não conectado</span>
                            }
                          </div>
                          {hasClientConn ? (
                            <div className="flex items-center justify-between mt-1.5">
                              <p className="text-[10px] text-orange-500 font-mono">…{clientConns[0].token_last_four ?? "****"}</p>
                              <button
                                onClick={() => setEditingConn(clientConns[0])}
                                className="text-[10px] font-medium text-orange-600 hover:text-orange-800 bg-white border border-orange-100 hover:border-orange-200 px-2 py-0.5 rounded-full transition-colors"
                              >
                                Gerenciar
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => { setOlaModalClientId(client.id); setShowOlaModal(true); }}
                              className="mt-1.5 text-[10px] font-medium text-gray-500 hover:text-orange-600 transition-colors"
                            >
                              + Conectar
                            </button>
                          )}
                        </div>
                      );
                    })}
                    {olaClients.length === 0 && (
                      <p className="text-xs text-gray-400 col-span-2 py-2">Nenhum cliente cadastrado.</p>
                    )}
                  </div>
                </div>
              ) : hasConns ? (
                <div className="mb-4 space-y-2">
                  <div className="flex items-start gap-2 p-3 bg-emerald-50 border border-emerald-100 rounded-xl text-xs text-emerald-700">
                    <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-emerald-500" />
                    <p>
                      URL da API configurada automaticamente via preset do provedor.
                      Clique em <strong>Gerenciar</strong> para usar uma URL personalizada ou atualizar o token.
                    </p>
                  </div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Conexões ativas</p>
                  {visibleConns.map((conn) => (
                    <div key={conn.id} className="p-3 bg-orange-50 border border-orange-100 rounded-xl">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-orange-800">
                            {conn.client_name ?? "Cliente desconhecido"}
                          </p>
                          {conn.client_email && (
                            <p className="text-[10px] text-orange-600">{conn.client_email}</p>
                          )}
                          <p className="text-[10px] text-orange-700 mt-0.5">
                            <span className="font-semibold uppercase tracking-wide text-orange-500 mr-1">{conn.provider ?? "olaclick"}</span>
                            {conn.connection_name}
                            {conn.token_last_four && <span className="font-mono ml-1 opacity-60">…{conn.token_last_four}</span>}
                          </p>
                          <p className="text-[10px] mt-1">
                            {conn.api_base_url
                              ? <span className="text-orange-600">URL personalizada ✓</span>
                              : <span className="text-emerald-600">URL padrão do provider ✓</span>
                            }
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                          <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-100 px-1.5 py-0.5 rounded-full">
                            <CheckCircle2 className="w-2.5 h-2.5" /> Ativo
                          </span>
                          <button
                            onClick={() => setEditingConn(conn)}
                            className="inline-flex items-center gap-1 text-[10px] font-medium text-orange-600 hover:text-orange-800 bg-white border border-orange-100 hover:border-orange-200 px-2 py-0.5 rounded-full transition-colors"
                          >
                            Gerenciar
                          </button>
                        </div>
                      </div>
                      {conn.created_at && (
                        <p className="text-[10px] text-orange-500 mt-1">
                          Conectado em {formatDate(conn.created_at)}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setClientSelectorFor("olaclick")}
                  className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-xl transition-colors ${
                    hasConns
                      ? "text-orange-700 bg-orange-50 hover:bg-orange-100 border border-orange-100"
                      : "text-white bg-orange-500 hover:bg-orange-600"
                  }`}
                >
                  <Link2 className="w-3.5 h-3.5" /> {hasConns ? "Conectar cliente" : "Conectar Cardápio Digital"}
                </button>
                <button
                  onClick={() => void loadOlaConnections()}
                  disabled={olaLoading}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-xl transition-colors disabled:opacity-50"
                >
                  {olaLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  Atualizar
                </button>
              </div>
            </div>
          );
        })()}

        {/* ══ CRM Externo ═════════════════════════════════════ */}
        <IntegrationProviderCard
          providerId="crm"
          title="CRM Externo"
          description="HubSpot, RD Station, Pipedrive e similares"
          icon={<Globe className="w-5 h-5 text-gray-400" strokeWidth={1.5} />}
          platformStatus="coming_soon"
          accentColor="gray"
          comingSoon
          features={["Contatos e pipeline por cliente", "Histórico de leads"]}
        />

      </div>

      {/* Seletor de cliente por provedor */}
      {clientSelectorFor === "meta" && (
        <ClientIntegrationSelector
          clients={clientsWithOlaStatus}
          loading={olaClients.length === 0}
          title="Vincular cliente ao Meta"
          description="Selecione o cliente para configurar Página Facebook e Instagram Business."
          onSelect={(client) => {
            setMetaHubClient({ id: client.id, company_name: client.company_name });
            setClientSelectorFor(null);
          }}
          onClose={() => setClientSelectorFor(null)}
        />
      )}
      {clientSelectorFor === "olaclick" && (
        <ClientIntegrationSelector
          clients={clientsWithOlaStatus}
          loading={olaClients.length === 0}
          title="Conectar cliente ao Cardápio Digital"
          description="Selecione o cliente e configure a conexão com o Cardápio Digital."
          filterStatus="unconnected_olaclick"
          onSelect={(client) => {
            setOlaModalClientId(client.id);
            setShowOlaModal(true);
            setClientSelectorFor(null);
          }}
          onClose={() => setClientSelectorFor(null)}
        />
      )}

      {/* Modal nova conexão */}
      {showOlaModal && (
        <DigitalMenuConnectionModal
          onClose={() => { setShowOlaModal(false); setOlaModalClientId(undefined); }}
          onSaved={() => { setShowOlaModal(false); setOlaModalClientId(undefined); void loadOlaConnections(); }}
          clients={olaClients}
          preselectedClientId={olaModalClientId}
        />
      )}

      {/* Modal editar conexão existente */}
      {editingConn && (
        <DigitalMenuEditModal
          conn={editingConn}
          onClose={() => setEditingConn(null)}
          onSaved={() => { setEditingConn(null); void loadOlaConnections(); }}
        />
      )}

      {/* Modal vincular ativos Meta ao cliente */}
      {metaHubClient && (
        <MetaClientAssetsModal
          clientId={metaHubClient.id}
          clientName={metaHubClient.company_name}
          onClose={() => setMetaHubClient(null)}
          onSaved={() => {
            setMetaHubClient(null);
            refreshOlaClients();
            void checkMeta();
          }}
        />
      )}
    </div>
  );
}

export default function ConexoesPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center gap-2 text-sm text-gray-400 p-8">
        <Loader2 className="w-4 h-4 animate-spin" /> Carregando...
      </div>
    }>
      <ConexoesContent />
    </Suspense>
  );
}
