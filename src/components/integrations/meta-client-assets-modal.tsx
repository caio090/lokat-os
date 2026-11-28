"use client";

import { useState, useEffect, useCallback } from "react";
import {
  X, Loader2, CheckCircle2, AlertCircle, Link2,
  AtSign, Globe, ChevronRight, Trash2, Info, Plus, RefreshCw,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AvailablePage {
  id:          string;
  name:        string;
  picture_url: string | null;
  instagram: {
    id:          string;
    name:        string | null;
    username:    string | null;
    picture_url: string | null;
  } | null;
}

interface CurrentAssets {
  facebookPage:      { asset_record_id: string; id: string; name: string | null } | null;
  instagramBusiness: { asset_record_id: string; id: string; username: string | null } | null;
  adAccount:         { asset_record_id: string; id: string; name: string | null } | null;
}

interface AvailableAdAccount {
  accountId: string;
  name:      string | null;
  currency:  string | null;
}

interface Connection {
  id:                   string;
  display_name:         string;
  status:               string;
  created_at:           string;
  linked_clients_count: number;
}

type Step = "choose_mode" | "pick_connection" | "loading_pages" | "select" | "confirm" | "saving" | "success";

// ── Modal ─────────────────────────────────────────────────────────────────────

export function MetaClientAssetsModal({
  clientId,
  clientName,
  onSaved,
  onClose,
  preferredConnectionId,
}: {
  clientId:               string;
  clientName:             string;
  onSaved:                () => void;
  onClose:                () => void;
  preferredConnectionId?: string; // pre-seleciona após retorno de OAuth
}) {
  const [step,           setStep]           = useState<Step>("choose_mode");
  const [connections,    setConnections]    = useState<Connection[]>([]);
  const [selectedConnId, setSelectedConnId] = useState<string | null>(preferredConnectionId ?? null);
  const [pages,          setPages]          = useState<AvailablePage[]>([]);
  const [currentAssets,  setCurrentAssets]  = useState<CurrentAssets | null>(null);
  const [connectionId,   setConnectionId]   = useState<string | null>(null);
  const [loadingInit,    setLoadingInit]    = useState(true);
  const [loadingPages,   setLoadingPages]   = useState(false);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [error,          setError]          = useState("");
  const [unlinking,      setUnlinking]      = useState(false);

  // Conta de anúncio (PROMPT LKT 16) -- vínculo independente do fluxo de
  // Página/Instagram: client_meta_assets e admin_link_meta_asset já
  // aceitavam asset_type='ad_account' (SQL 37/60); só não havia UI.
  const [adAccounts,            setAdAccounts]            = useState<AvailableAdAccount[]>([]);
  const [loadingAdAccounts,     setLoadingAdAccounts]     = useState(false);
  const [adAccountsError,       setAdAccountsError]       = useState("");
  const [selectedAdAccountId,   setSelectedAdAccountId]   = useState<string | null>(null);
  const [adAccountSaving,       setAdAccountSaving]       = useState(false);

  const selectedPage = pages.find((p) => p.id === selectedPageId) ?? null;

  // ── Carga inicial: conexões disponíveis + ativos atuais do cliente ────
  useEffect(() => {
    let active = true;
    setLoadingInit(true);
    setError("");

    Promise.all([
      fetch("/api/meta/connections").then((r) => r.json()),
      fetch(`/api/meta/client-assets?client_id=${clientId}`).then((r) => r.json()),
    ])
      .then(([connsData, assetsData]) => {
        if (!active) return;

        const cd = connsData as {
          ok: boolean;
          connections?: Connection[];
          reason?: string;
          message?: string;
        };
        const ca = assetsData as { ok: boolean; assets?: CurrentAssets };

        if (!cd.ok) {
          setError(cd.message ?? "Não foi possível carregar conexões Meta.");
        } else {
          const list = cd.connections ?? [];
          setConnections(list);

          // Se voltou de OAuth com uma conexão preferida, vai direto para páginas
          if (preferredConnectionId && list.find((c) => c.id === preferredConnectionId)) {
            setSelectedConnId(preferredConnectionId);
            setStep("loading_pages");
          } else if (list.length === 1 && !cd.connections?.length) {
            // Uma única conexão — vai para seleção direta
            setSelectedConnId(list[0].id);
            setStep("loading_pages");
          }
          // else: mostra tela de escolha de modo
        }

        if (ca.ok && ca.assets) {
          setCurrentAssets(ca.assets);
          if (ca.assets.facebookPage?.id) setSelectedPageId(ca.assets.facebookPage.id);
        }
      })
      .catch(() => { if (active) setError("Erro de rede ao carregar dados."); })
      .finally(() => { if (active) setLoadingInit(false); });

    return () => { active = false; };
  }, [clientId, preferredConnectionId]);

  // ── Carrega contas de anúncio da mesma conexão (independente de páginas) ──
  const loadAdAccountsForConnection = useCallback(async (connId: string) => {
    setLoadingAdAccounts(true);
    setAdAccountsError("");
    setAdAccounts([]);
    try {
      const r = await fetch(`/api/meta/ad-accounts?connection_id=${connId}`);
      const d = await r.json() as {
        ok: boolean; accounts?: AvailableAdAccount[]; reason?: string; message?: string;
      };
      if (!d.ok) {
        setAdAccountsError(d.message ?? "Conta de anúncio indisponível para esta conexão.");
        return;
      }
      setAdAccounts(d.accounts ?? []);
    } catch {
      setAdAccountsError("Erro de rede ao consultar contas de anúncio.");
    } finally {
      setLoadingAdAccounts(false);
    }
  }, []);

  // ── Carrega páginas de uma conexão específica ─────────────────────────
  const loadPagesForConnection = useCallback(async (connId: string) => {
    setLoadingPages(true);
    setError("");
    setPages([]);
    try {
      const r = await fetch(`/api/meta/accounts?connection_id=${connId}`);
      const d = await r.json() as {
        ok: boolean; connection_id?: string;
        pages?: AvailablePage[];
        reason?: string; message?: string;
      };
      if (!d.ok) {
        setError(d.message ?? "Falha ao carregar páginas desta conexão.");
        setStep("pick_connection");
        return;
      }
      setPages(d.pages ?? []);
      setConnectionId(d.connection_id ?? null);
      setStep("select");
      if (d.connection_id) void loadAdAccountsForConnection(d.connection_id);
    } catch {
      setError("Erro de rede ao carregar páginas.");
      setStep("pick_connection");
    } finally {
      setLoadingPages(false);
    }
  }, [loadAdAccountsForConnection]);

  // ── Vincular conta de anúncio (independente do salvar de Página/Instagram) ──
  async function linkAdAccount() {
    if (!selectedAdAccountId) return;
    const account = adAccounts.find((a) => a.accountId === selectedAdAccountId);
    setAdAccountSaving(true);
    setError("");
    try {
      const r = await fetch("/api/meta/assets/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id:          clientId,
          asset_type:         "ad_account",
          asset_id:           selectedAdAccountId,
          asset_name:         account?.name ?? undefined,
          meta_connection_id: connectionId ?? undefined,
          is_primary:         true,
        }),
      });
      const d = await r.json() as { ok: boolean; message?: string };
      if (!d.ok) {
        setError(d.message ?? "Erro ao vincular conta de anúncio.");
        return;
      }
      setSelectedAdAccountId(null);
      const ca = await fetch(`/api/meta/client-assets?client_id=${clientId}`).then((r2) => r2.json()) as { ok: boolean; assets?: CurrentAssets };
      if (ca.ok && ca.assets) setCurrentAssets(ca.assets);
    } catch {
      setError("Erro de rede ao vincular conta de anúncio.");
    } finally {
      setAdAccountSaving(false);
    }
  }

  // Dispara quando step muda para loading_pages
  useEffect(() => {
    if (step === "loading_pages" && selectedConnId) {
      void loadPagesForConnection(selectedConnId);
    }
  }, [step, selectedConnId, loadPagesForConnection]);

  // ── Salvar vínculo ────────────────────────────────────────────────────
  async function handleSave() {
    if (!selectedPage) { setError("Selecione uma Página Facebook."); return; }
    setStep("saving");
    setError("");

    try {
      const fbRes = await fetch("/api/meta/assets/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id:          clientId,
          asset_type:         "facebook_page",
          asset_id:           selectedPage.id,
          asset_name:         selectedPage.name,
          picture_url:        selectedPage.picture_url,
          meta_connection_id: connectionId ?? undefined,
          is_primary:         !selectedPage.instagram,
        }),
      });
      const fbData = await fbRes.json() as { ok: boolean; reason?: string; message?: string };
      if (!fbData.ok) {
        setError(fbData.message ?? "Erro ao vincular Página Facebook.");
        setStep("select");
        return;
      }

      if (selectedPage.instagram) {
        const igRes = await fetch("/api/meta/assets/link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id:          clientId,
            asset_type:         "instagram_business",
            asset_id:           selectedPage.instagram.id,
            asset_name:         selectedPage.instagram.name ?? selectedPage.instagram.username,
            username:           selectedPage.instagram.username,
            picture_url:        selectedPage.instagram.picture_url,
            meta_connection_id: connectionId ?? undefined,
            is_primary:         true,
          }),
        });
        const igData = await igRes.json() as { ok: boolean; reason?: string; message?: string };
        if (!igData.ok) {
          setError(igData.message ?? "Página vinculada, mas falha ao vincular Instagram.");
          setStep("select");
          return;
        }
      }

      setStep("success");
    } catch {
      setError("Erro de rede. Tente novamente.");
      setStep("select");
    }
  }

  // ── Desvincular ativo ─────────────────────────────────────────────────
  async function handleUnlink(assetRecordId: string) {
    setUnlinking(true);
    setError("");
    try {
      const r = await fetch(`/api/meta/assets/link?id=${assetRecordId}`, { method: "DELETE" });
      const d = await r.json() as { ok: boolean; message?: string };
      if (!d.ok) { setError(d.message ?? "Erro ao desvincular."); return; }
      const ca = await fetch(`/api/meta/client-assets?client_id=${clientId}`).then((r2) => r2.json()) as { ok: boolean; assets?: CurrentAssets };
      if (ca.ok && ca.assets) setCurrentAssets(ca.assets);
    } catch { setError("Erro de rede ao desvincular."); }
    finally { setUnlinking(false); }
  }

  // ── Iniciar nova conexão OAuth ────────────────────────────────────────
  function startNewOAuth() {
    const params = new URLSearchParams({
      return_to: "/admin/clientes",
      client_id: clientId,
    });
    window.location.href = `/api/meta/connect?${params.toString()}`;
  }

  const isCurrentlyLinked = (pageId: string) =>
    currentAssets?.facebookPage?.id === pageId;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onClick={(e) => { if (e.target === e.currentTarget && step !== "saving") onClose(); }}
    >
      <div
        className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden"
        style={{ maxHeight: "90vh" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100">
          <div>
            <p className="text-sm font-bold text-gray-900">Vincular Meta</p>
            <p className="text-xs text-gray-400 mt-0.5">
              {step === "success" ? "Vínculo salvo" : `Cliente: ${clientName}`}
            </p>
          </div>
          {step !== "saving" && (
            <button
              onClick={onClose}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="px-5 py-4 overflow-y-auto" style={{ maxHeight: "calc(90vh - 120px)" }}>

          {/* Carregando inicial */}
          {loadingInit && (
            <div className="flex items-center gap-3 py-8 justify-center">
              <Loader2 className="w-5 h-5 text-indigo-500 animate-spin" />
              <span className="text-sm text-gray-400">Carregando…</span>
            </div>
          )}

          {/* Erro */}
          {error && !loadingInit && (
            <div className="mb-4 flex items-start gap-2 p-3 bg-red-50 border border-red-100 rounded-xl text-xs text-red-700">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Sucesso */}
          {step === "success" && (
            <div className="py-4 text-center space-y-3">
              <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-6 h-6 text-emerald-600" />
              </div>
              <p className="text-sm font-bold text-gray-900">Meta vinculada com sucesso!</p>
              {selectedPage && (
                <div className="text-xs text-gray-500 space-y-0.5">
                  <p><span className="font-semibold text-gray-700">Página:</span> {selectedPage.name}</p>
                  {selectedPage.instagram && (
                    <p><span className="font-semibold text-gray-700">Instagram:</span> @{selectedPage.instagram.username}</p>
                  )}
                </div>
              )}
              <button
                onClick={() => { onSaved(); onClose(); }}
                className="mt-2 px-5 py-2 rounded-xl text-sm font-bold bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
              >
                Concluir
              </button>
            </div>
          )}

          {/* Salvando */}
          {step === "saving" && (
            <div className="flex items-center gap-3 py-8 justify-center">
              <Loader2 className="w-5 h-5 text-indigo-500 animate-spin" />
              <span className="text-sm text-gray-500">Salvando vínculos…</span>
            </div>
          )}

          {/* Carregando páginas */}
          {(step === "loading_pages" || loadingPages) && !loadingInit && (
            <div className="flex items-center gap-3 py-8 justify-center">
              <Loader2 className="w-5 h-5 text-indigo-500 animate-spin" />
              <span className="text-sm text-gray-400">Carregando páginas da conta Meta…</span>
            </div>
          )}

          {/* ETAPA: escolha de modo */}
          {!loadingInit && step === "choose_mode" && (
            <>
              {/* Ativos atuais */}
              {(currentAssets?.facebookPage || currentAssets?.instagramBusiness || currentAssets?.adAccount) && (
                <div className="mb-4 p-3 bg-emerald-50 border border-emerald-100 rounded-xl">
                  <p className="text-[10px] font-bold text-emerald-700 uppercase tracking-wide mb-2">Ativos atuais de {clientName}</p>
                  <div className="space-y-1.5">
                    {currentAssets.facebookPage && (
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <Globe className="w-3.5 h-3.5 text-blue-500" />
                          <span className="text-gray-700 font-medium">{currentAssets.facebookPage.name ?? currentAssets.facebookPage.id}</span>
                        </div>
                        <button
                          onClick={() => void handleUnlink(currentAssets.facebookPage!.asset_record_id)}
                          disabled={unlinking}
                          className="text-[10px] text-red-400 hover:text-red-600 flex items-center gap-1 transition-colors"
                        >
                          {unlinking ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                          Desvincular
                        </button>
                      </div>
                    )}
                    {currentAssets.instagramBusiness && (
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <AtSign className="w-3.5 h-3.5 text-pink-500" />
                          <span className="text-gray-700 font-medium">@{currentAssets.instagramBusiness.username ?? currentAssets.instagramBusiness.id}</span>
                        </div>
                        <button
                          onClick={() => void handleUnlink(currentAssets.instagramBusiness!.asset_record_id)}
                          disabled={unlinking}
                          className="text-[10px] text-red-400 hover:text-red-600 flex items-center gap-1 transition-colors"
                        >
                          {unlinking ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                          Desvincular
                        </button>
                      </div>
                    )}
                    {currentAssets.adAccount && (
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <Link2 className="w-3.5 h-3.5 text-indigo-500" />
                          <span className="text-gray-700 font-medium">{currentAssets.adAccount.name ?? currentAssets.adAccount.id}</span>
                        </div>
                        <button
                          onClick={() => void handleUnlink(currentAssets.adAccount!.asset_record_id)}
                          disabled={unlinking}
                          className="text-[10px] text-red-400 hover:text-red-600 flex items-center gap-1 transition-colors"
                        >
                          {unlinking ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                          Desvincular
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <p className="text-sm font-semibold text-gray-800 mb-3">Como deseja conectar?</p>

              <div className="space-y-2">
                {/* Usar conexão existente */}
                {connections.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setStep("pick_connection")}
                    className="w-full text-left p-4 rounded-xl border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50/40 transition-all group"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center flex-shrink-0">
                        <Link2 className="w-4 h-4 text-indigo-600" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-gray-800 group-hover:text-indigo-700">Usar uma conexão Meta existente</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {connections.length === 1
                            ? `1 conta Meta disponível`
                            : `${connections.length} contas Meta disponíveis`}
                        </p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-gray-300 ml-auto flex-shrink-0 mt-1" />
                    </div>
                  </button>
                )}

                {/* Conectar nova conta */}
                <button
                  type="button"
                  onClick={startNewOAuth}
                  className="w-full text-left p-4 rounded-xl border border-gray-200 hover:border-blue-300 hover:bg-blue-50/40 transition-all group"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                      <Plus className="w-4 h-4 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-800 group-hover:text-blue-700">Conectar outra conta Meta</p>
                      <p className="text-xs text-gray-400 mt-0.5">Autorizar uma conta Facebook com acesso às Páginas do cliente</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-300 ml-auto flex-shrink-0 mt-1" />
                  </div>
                </button>

                {connections.length === 0 && (
                  <div className="p-3 bg-amber-50 border border-amber-100 rounded-xl">
                    <p className="text-xs text-amber-700">
                      Nenhuma conta Meta conectada ainda. Entre com o Facebook que tem acesso à Página do cliente.
                    </p>
                  </div>
                )}
              </div>

              {/* Disclaimer */}
              <div className="mt-4 p-3 bg-gray-50 rounded-xl">
                <p className="text-[10px] text-gray-400">
                  Entre com um perfil Facebook que tenha acesso à Página ou ao portfólio empresarial do cliente.
                  A LOKAT OS não recebe nem armazena sua senha da Meta.
                </p>
              </div>
            </>
          )}

          {/* ETAPA: selecionar conexão */}
          {!loadingInit && step === "pick_connection" && (
            <>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-3">Contas Meta disponíveis</p>
              <div className="space-y-2 mb-4">
                {connections.map((conn) => {
                  const selected = selectedConnId === conn.id;
                  return (
                    <button
                      key={conn.id}
                      type="button"
                      onClick={() => setSelectedConnId(conn.id)}
                      className={`w-full text-left p-3.5 rounded-xl border transition-all ${
                        selected
                          ? "border-indigo-400 bg-indigo-50 ring-1 ring-indigo-300"
                          : "border-gray-200 bg-white hover:border-indigo-200 hover:bg-indigo-50/30"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold text-gray-800">{conn.display_name}</p>
                          <p className="text-[10px] text-gray-400 mt-0.5">
                            {conn.linked_clients_count > 0
                              ? `${conn.linked_clients_count} cliente${conn.linked_clients_count > 1 ? "s" : ""} vinculado${conn.linked_clients_count > 1 ? "s" : ""}`
                              : "Sem vínculos"}
                            {" · "}
                            Conectada em {new Date(conn.created_at).toLocaleDateString("pt-BR")}
                          </p>
                        </div>
                        {selected && <CheckCircle2 className="w-4 h-4 text-indigo-500 flex-shrink-0" />}
                      </div>
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={startNewOAuth}
                className="w-full flex items-center justify-center gap-2 p-3 text-xs text-gray-500 border border-dashed border-gray-300 rounded-xl hover:border-blue-300 hover:text-blue-600 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Conectar outra conta Meta
              </button>
            </>
          )}

          {/* ETAPA: selecionar página */}
          {!loadingInit && !loadingPages && step === "select" && (
            <>
              {/* Ativos atuais */}
              {(currentAssets?.facebookPage || currentAssets?.instagramBusiness || currentAssets?.adAccount) && (
                <div className="mb-4 p-3 bg-emerald-50 border border-emerald-100 rounded-xl">
                  <p className="text-[10px] font-bold text-emerald-700 uppercase tracking-wide mb-2">Ativos atuais de {clientName}</p>
                  <div className="space-y-1.5">
                    {currentAssets.facebookPage && (
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <Globe className="w-3.5 h-3.5 text-blue-500" />
                          <span className="text-gray-700 font-medium">{currentAssets.facebookPage.name ?? currentAssets.facebookPage.id}</span>
                        </div>
                        <button
                          onClick={() => void handleUnlink(currentAssets.facebookPage!.asset_record_id)}
                          disabled={unlinking}
                          className="text-[10px] text-red-400 hover:text-red-600 flex items-center gap-1"
                        >
                          {unlinking ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                          Desvincular
                        </button>
                      </div>
                    )}
                    {currentAssets.instagramBusiness && (
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <AtSign className="w-3.5 h-3.5 text-pink-500" />
                          <span className="text-gray-700 font-medium">@{currentAssets.instagramBusiness.username ?? currentAssets.instagramBusiness.id}</span>
                        </div>
                        <button
                          onClick={() => void handleUnlink(currentAssets.instagramBusiness!.asset_record_id)}
                          disabled={unlinking}
                          className="text-[10px] text-red-400 hover:text-red-600 flex items-center gap-1"
                        >
                          {unlinking ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                          Desvincular
                        </button>
                      </div>
                    )}
                    {currentAssets.adAccount && (
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <Link2 className="w-3.5 h-3.5 text-indigo-500" />
                          <span className="text-gray-700 font-medium">{currentAssets.adAccount.name ?? currentAssets.adAccount.id}</span>
                        </div>
                        <button
                          onClick={() => void handleUnlink(currentAssets.adAccount!.asset_record_id)}
                          disabled={unlinking}
                          className="text-[10px] text-red-400 hover:text-red-600 flex items-center gap-1"
                        >
                          {unlinking ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                          Desvincular
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Sem páginas */}
              {pages.length === 0 && (
                <div className="py-6 text-center space-y-2">
                  <Info className="w-8 h-8 text-gray-300 mx-auto" />
                  <p className="text-sm font-medium text-gray-600">Nenhuma Página encontrada</p>
                  <p className="text-xs text-gray-400">
                    A conta Meta selecionada não tem Páginas acessíveis. Tente outra conta.
                  </p>
                  <button
                    onClick={() => setStep("pick_connection")}
                    className="mt-2 flex items-center gap-1.5 mx-auto text-xs text-indigo-600 hover:underline"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Escolher outra conexão
                  </button>
                </div>
              )}

              {/* Lista de páginas */}
              {pages.length > 0 && (
                <>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">
                      Selecione a Página Facebook do cliente
                    </p>
                    {connections.length > 1 && (
                      <button
                        onClick={() => setStep("pick_connection")}
                        className="text-[10px] text-indigo-500 hover:underline flex items-center gap-1"
                      >
                        <RefreshCw className="w-2.5 h-2.5" />
                        Trocar conta
                      </button>
                    )}
                  </div>
                  <div className="space-y-2 mb-5">
                    {pages.map((page) => {
                      const linked   = isCurrentlyLinked(page.id);
                      const selected = selectedPageId === page.id;
                      return (
                        <button
                          key={page.id}
                          type="button"
                          onClick={() => setSelectedPageId(selected ? null : page.id)}
                          className={`w-full text-left p-3 rounded-xl border transition-all ${
                            selected
                              ? "border-indigo-400 bg-indigo-50 ring-1 ring-indigo-300"
                              : "border-gray-200 bg-white hover:border-indigo-200 hover:bg-indigo-50/30"
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            {page.picture_url ? (
                              <img src={page.picture_url} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                            ) : (
                              <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                                <Globe className="w-4 h-4 text-blue-500" />
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-gray-800 truncate">{page.name}</p>
                              <p className="text-[10px] text-gray-400">
                                Página Facebook
                                {linked && <span className="ml-1.5 text-emerald-600 font-medium">· Já vinculada</span>}
                              </p>
                            </div>
                            {selected && <CheckCircle2 className="w-4 h-4 text-indigo-500 flex-shrink-0" />}
                          </div>

                          {page.instagram ? (
                            <div className={`mt-2 ml-10 flex items-center gap-2 text-xs ${selected ? "text-pink-700" : "text-gray-500"}`}>
                              <AtSign className="w-3.5 h-3.5 text-pink-500 flex-shrink-0" />
                              <span>@{page.instagram.username ?? page.instagram.name ?? page.instagram.id}</span>
                              <ChevronRight className="w-3 h-3 text-gray-300" />
                              <span className="text-[10px] text-gray-400">Instagram Business — será vinculado</span>
                            </div>
                          ) : (
                            <p className="mt-1.5 ml-10 text-[10px] text-gray-400">
                              Esta página não possui Instagram Business vinculado.
                            </p>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  <div className="mb-4 p-3 bg-gray-50 border border-gray-100 rounded-xl">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">Conta de anúncio (opcional)</p>
                    {currentAssets?.adAccount ? (
                      <p className="text-xs text-emerald-700 font-medium flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {currentAssets.adAccount.name ?? currentAssets.adAccount.id} · já vinculada
                      </p>
                    ) : loadingAdAccounts ? (
                      <p className="text-xs text-gray-400 flex items-center gap-2">
                        <Loader2 className="w-3 h-3 animate-spin" /> Consultando contas de anúncio…
                      </p>
                    ) : adAccountsError ? (
                      <p className="text-xs text-amber-600">{adAccountsError}</p>
                    ) : adAccounts.length === 0 ? (
                      <p className="text-xs text-gray-400">Nenhuma conta de anúncio encontrada nesta conexão.</p>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <select
                          value={selectedAdAccountId ?? ""}
                          onChange={(e) => setSelectedAdAccountId(e.target.value || null)}
                          className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white outline-none focus:border-indigo-400"
                        >
                          <option value="">Selecione a conta de anúncio…</option>
                          {adAccounts.map((a) => (
                            <option key={a.accountId} value={a.accountId}>
                              {a.name ?? a.accountId} ({a.currency ?? "—"})
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => void linkAdAccount()}
                          disabled={!selectedAdAccountId || adAccountSaving}
                          className="text-[10px] px-3 py-1.5 bg-indigo-500 text-white rounded-lg disabled:opacity-50 hover:bg-indigo-600 whitespace-nowrap transition-colors"
                        >
                          {adAccountSaving ? "Salvando…" : "Vincular"}
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          )}

          {/* ETAPA: confirmar */}
          {step === "confirm" && selectedPage && (
            <div className="space-y-4">
              <p className="text-sm font-bold text-gray-900 mb-3">Confirmar vínculo</p>
              <div className="divide-y divide-gray-100 rounded-xl border border-gray-100 overflow-hidden text-sm">
                <div className="flex items-center justify-between px-4 py-3 bg-gray-50">
                  <span className="text-gray-500 text-xs font-medium">Cliente</span>
                  <span className="text-gray-800 font-semibold">{clientName}</span>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-gray-500 text-xs font-medium">Página Facebook</span>
                  <span className="text-gray-800">{selectedPage.name}</span>
                </div>
                <div className="flex items-center justify-between px-4 py-3 bg-gray-50">
                  <span className="text-gray-500 text-xs font-medium">Instagram</span>
                  <span className="text-gray-800">
                    {selectedPage.instagram
                      ? `@${selectedPage.instagram.username ?? selectedPage.instagram.name}`
                      : <span className="text-gray-400">Não disponível</span>
                    }
                  </span>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-gray-500 text-xs font-medium">Conta de anúncio</span>
                  <span className="text-gray-400 text-xs">
                    {currentAssets?.adAccount ? (currentAssets.adAccount.name ?? currentAssets.adAccount.id) : "Não vinculada (vincule depois na tela anterior)"}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {!loadingInit && !loadingPages && step !== "saving" && step !== "success" && step !== "loading_pages" && (
          <div className="px-5 pb-5 pt-3 border-t border-gray-100 flex items-center justify-between gap-3">
            {step === "choose_mode" && (
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-sm font-medium text-gray-500 hover:bg-gray-100 transition-colors"
              >
                Fechar
              </button>
            )}

            {step === "pick_connection" && (
              <>
                <button
                  onClick={() => setStep("choose_mode")}
                  className="px-4 py-2 rounded-xl text-sm font-medium text-gray-500 hover:bg-gray-100 transition-colors"
                >
                  Voltar
                </button>
                <button
                  disabled={!selectedConnId}
                  onClick={() => { if (selectedConnId) setStep("loading_pages"); }}
                  className="px-5 py-2 rounded-xl text-sm font-bold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                >
                  <Link2 className="w-3.5 h-3.5" />
                  Usar esta conexão
                </button>
              </>
            )}

            {step === "select" && (
              <>
                <button
                  onClick={() => connections.length > 1 ? setStep("pick_connection") : setStep("choose_mode")}
                  className="px-4 py-2 rounded-xl text-sm font-medium text-gray-500 hover:bg-gray-100 transition-colors"
                >
                  Voltar
                </button>
                <button
                  onClick={() => { if (selectedPage) setStep("confirm"); else setError("Selecione uma Página Facebook."); }}
                  disabled={!selectedPageId}
                  className="px-5 py-2 rounded-xl text-sm font-bold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                >
                  <Link2 className="w-3.5 h-3.5" />
                  Continuar
                </button>
              </>
            )}

            {step === "confirm" && (
              <>
                <button
                  onClick={() => setStep("select")}
                  className="px-4 py-2 rounded-xl text-sm font-medium text-gray-500 hover:bg-gray-100 transition-colors"
                >
                  Voltar
                </button>
                <button
                  onClick={() => void handleSave()}
                  className="px-5 py-2 rounded-xl text-sm font-bold bg-indigo-600 text-white hover:bg-indigo-700 transition-colors flex items-center gap-2"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Salvar vínculo
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
