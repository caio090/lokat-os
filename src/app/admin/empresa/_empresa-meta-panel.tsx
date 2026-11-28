"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AtSign, Globe, BarChart3, Link2, ArrowRight, Loader2 } from "lucide-react";

/**
 * PROMPT LKT 17 (seção 12/15) — /admin/empresa (Company Central) nunca
 * mostrava nenhum dado de Meta: a central do cliente e a central de
 * conexões Meta (PROMPT LKT 14/16) evoluíram separadas. Este painel só
 * LÊ o que já existe (/api/meta/client-assets, já testado e com
 * isolamento por client_id) -- nenhuma tabela nova, nenhuma rota nova.
 */

type ClientAssetsResponse = {
  ok: boolean;
  assets?: {
    facebookPage: { name: string | null } | null;
    instagramBusiness: { username: string | null; name: string | null } | null;
    adAccount: { name: string | null; id: string } | null;
  };
} | null;

export function EmpresaMetaPanel({ companyId }: { companyId: string }) {
  const [result, setResult] = useState<ClientAssetsResponse>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetch(`/api/meta/client-assets?client_id=${companyId}`)
      .then((r) => r.json())
      .then((d: ClientAssetsResponse) => { if (active) setResult(d); })
      .catch(() => { if (active) setResult({ ok: false }); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [companyId]);

  const assets = result?.ok ? result.assets : null;
  const hasAnyAsset = !!(assets?.facebookPage || assets?.instagramBusiness || assets?.adAccount);

  return (
    <section className="bg-white rounded-2xl border border-gray-100 p-4 mb-4">
      <h2 className="text-xs font-black uppercase tracking-wide text-gray-500 mb-3">Meta: ativos e campanhas</h2>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-gray-400 py-1">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Consultando vínculos Meta…
        </div>
      ) : !result?.ok ? (
        <p className="text-xs text-gray-400">Não foi possível consultar os vínculos Meta agora.</p>
      ) : !hasAnyAsset ? (
        <p className="text-xs text-gray-500">
          Nenhuma Página, Instagram ou conta de anúncio vinculada a este cliente ainda.{" "}
          <Link href={`/admin/conexoes?provider=meta&client=${companyId}`} className="text-indigo-600 font-semibold hover:underline">
            Vincular agora
          </Link>
        </p>
      ) : (
        <div className="space-y-1.5 mb-3">
          {assets?.facebookPage && (
            <div className="flex items-center gap-2 text-xs text-gray-700">
              <Globe className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
              {assets.facebookPage.name ?? "Página Facebook vinculada"}
            </div>
          )}
          {assets?.instagramBusiness && (
            <div className="flex items-center gap-2 text-xs text-gray-700">
              <AtSign className="w-3.5 h-3.5 text-pink-500 flex-shrink-0" />
              @{assets.instagramBusiness.username ?? assets.instagramBusiness.name ?? "Instagram vinculado"}
            </div>
          )}
          {assets?.adAccount && (
            <div className="flex items-center gap-2 text-xs text-gray-700">
              <BarChart3 className="w-3.5 h-3.5 text-indigo-500 flex-shrink-0" />
              {assets.adAccount.name ?? assets.adAccount.id}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-3 mt-2">
        <Link href={`/admin/conexoes?provider=meta&client=${companyId}`} className="inline-flex items-center gap-1 text-xs font-bold text-indigo-600 hover:underline">
          <Link2 className="w-3.5 h-3.5" /> Gerenciar vínculos
        </Link>
        {assets?.adAccount && (
          <Link href={`/admin/conexoes?provider=campanhas&client=${companyId}`} className="inline-flex items-center gap-1 text-xs font-bold text-indigo-600 hover:underline">
            Ver campanhas e resultados <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        )}
      </div>
    </section>
  );
}
