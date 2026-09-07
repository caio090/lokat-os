"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { Building2, ChevronDown } from "lucide-react";
import { COMPANY_CONTEXT_QUERY_KEY, withCompanyContext } from "@/lib/company-context/navigation";
import { InlineCompanyPicker } from "@/components/command-center/inline-company-picker";

/**
 * Sprint MVP Dogfood Final — Company Context Transversal (Fase 4/5/34).
 * Barra global, montada uma única vez na shell autenticada (nunca dentro
 * do REC OS) -- resolve o gap real que o QA encontrou: cada módulo já
 * sabia ler `?client=` (resolveCompanyContext), mas nada mostrava QUAL
 * empresa está ativa fora das páginas que já incluíam CompanyContextHeader,
 * e trocar de módulo perdia o parâmetro.
 *
 * LOKAT OS — Company Context Selector + Local Preview Audit: o botão
 * "Selecionar empresa" não navega mais para a rota de seleção de cliente do
 * ContentOS. Abre um popover local com o MESMO InlineCompanyPicker
 * (tema claro) reaproveitado em CompanyContextRequiredState -- uma única UI
 * de seleção de Company em todo o produto (header, Company Central, Meu
 * Escritório, Command Center). Não duplica a consulta de clientes nem cria
 * um segundo resolver: o picker usa useAuthorizedCompanies(), que já chama
 * /api/command-center/authorized-companies (listAuthorizedCompanies()); o
 * nome da Company ativa continua vindo de GET /api/company-context (wrapper
 * fino sobre resolveCompanyContext).
 */
export function CompanyContextBar() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const companyId = searchParams.get(COMPANY_CONTEXT_QUERY_KEY);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    setLoading(true);
    fetch(`/api/company-context?${COMPANY_CONTEXT_QUERY_KEY}=${encodeURIComponent(companyId)}`)
      .then((r) => r.json())
      .then((data: { valid: boolean; companyName?: string | null }) => {
        if (cancelled) return;
        setCompanyName(data.valid ? (data.companyName ?? "Empresa") : null);
      })
      .catch(() => { if (!cancelled) setCompanyName(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [companyId]);

  // Fecha o popover ao clicar fora -- nunca captura clique dentro do próprio picker.
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  // companyId ausente sempre renderiza o estado vazio, mesmo que
  // `companyName` guarde um valor obsoleto de uma Company anterior --
  // nunca depende de resetar state dentro do efeito.
  const displayName = companyId ? companyName : null;

  function handleSelect(selectedId: string) {
    setOpen(false);
    // Preserva o pathname atual (Part L) -- nunca navega para outra rota
    // só por trocar de Company.
    //
    // Prompt 24 (Dedicated Creative Series Workspace) -- REGRA: "Trocar
    // Company = SAIR DA SÉRIE." O workspace canônico de uma série
    // (/admin/contentos/visual/series/[seriesId]) nunca lê `?client=`
    // pra decidir a Company (ela vem de `series.client_id`, resolvido
    // pelo servidor) -- então preservar o pathname aqui deixaria um
    // `?client=` pendurado que a série simplesmente ignora, sem indicar
    // ao usuário que nada mudou. Único ponto especial: trocar Company
    // enquanto uma série está aberta navega pra fora dela (raiz do
    // Studio, mesma Company nova), nunca muta o conteúdo da série "por
    // baixo".
    const target = pathname.startsWith("/admin/contentos/visual/series/") ? "/admin/contentos/visual" : pathname;
    router.push(withCompanyContext(target, selectedId));
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-testid={companyId && displayName ? "company-context-bar-active" : "company-context-bar-empty"}
        className={
          companyId && displayName
            ? "inline-flex items-center gap-1.5 rounded-full bg-purple-50 border border-purple-100 hover:border-purple-200 px-3 py-1.5 text-xs font-bold text-purple-700 transition-colors"
            : companyId && loading
            ? "inline-flex items-center gap-1.5 rounded-full bg-gray-50 border border-gray-100 px-3 py-1.5 text-xs font-medium text-gray-400"
            : "inline-flex items-center gap-1.5 rounded-full bg-gray-50 border border-gray-100 hover:border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-500 transition-colors"
        }
        title={companyId && displayName ? "Trocar empresa" : undefined}
      >
        <Building2 className="w-3.5 h-3.5" />
        {companyId && loading ? "Carregando…" : (displayName ?? "Selecionar empresa")}
        <ChevronDown className="w-3 h-3 opacity-60" />
      </button>

      {open && (
        <div
          data-testid="company-context-bar-popover"
          className="absolute z-50 top-full left-0 mt-2 w-72 bg-white border border-gray-100 rounded-2xl shadow-lg p-3"
        >
          <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-2">Empresas autorizadas</p>
          <InlineCompanyPicker
            theme="light"
            onSelect={handleSelect}
            onNewClient={() => { setOpen(false); router.push("/admin/clientes"); }}
          />
        </div>
      )}
    </div>
  );
}
