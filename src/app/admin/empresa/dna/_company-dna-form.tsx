"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { AttachmentUploader, type AttachmentValue } from "@/components/attachment-uploader";
import type { OnboardingProfileRow } from "@/lib/rec-os/studio/business-context";

/**
 * FASE 31O (Admin Company DNA Editor) — form client-side. Sempre grava
 * via PUT /api/admin/clients/[id]/onboarding-profile, nunca grava direto
 * no Supabase do browser (autorização e validação real ficam só no
 * servidor). Grupos IDENTITY/BRAND/MARKET/PRODUCTS = exatamente as 16
 * colunas de ONBOARDING_PROFILE_FIELDS (business-context.ts), nenhum
 * campo inventado.
 */

interface BrandColor { label: string; hex: string }

function parseBrandColors(value: unknown): BrandColor[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is Record<string, unknown> => !!v && typeof v === "object")
    .map((v) => ({
      label: typeof v.label === "string" ? v.label : "",
      hex: typeof v.hex === "string" ? v.hex : "",
    }));
}

function hasAnyValue(profile: OnboardingProfileRow | null): boolean {
  if (!profile) return false;
  return Object.values(profile).some((v) => {
    if (v === null || v === undefined) return false;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === "string") return v.trim().length > 0;
    return true;
  });
}

export function CompanyDnaForm({
  clientId,
  companyName,
  profile,
}: {
  clientId: string;
  companyName: string | null;
  profile: OnboardingProfileRow | null;
}) {
  const router = useRouter();

  const [brandName, setBrandName] = useState(profile?.brand_name ?? "");
  const [logoValue, setLogoValue] = useState<AttachmentValue | null>(
    profile?.logo_url ? { url: profile.logo_url, name: "logo atual", type: "image", size: 0, source: "external_link" } : null,
  );
  const [brandColors, setBrandColors] = useState<BrandColor[]>(parseBrandColors(profile?.brand_colors));
  const [visualStyle, setVisualStyle] = useState(profile?.visual_style ?? "");
  const [visualReferences, setVisualReferences] = useState(profile?.visual_references ?? "");
  const [toneOfVoice, setToneOfVoice] = useState((profile?.tone_of_voice ?? []).join(", "));
  const [wordsUse, setWordsUse] = useState(profile?.words_use ?? "");
  const [wordsAvoid, setWordsAvoid] = useState(profile?.words_avoid ?? "");
  const [segment, setSegment] = useState(profile?.segment ?? "");
  const [idealCustomer, setIdealCustomer] = useState(profile?.ideal_customer ?? "");
  const [ageRange, setAgeRange] = useState(profile?.age_range ?? "");
  const [audienceLocation, setAudienceLocation] = useState(profile?.audience_location ?? "");
  const [pains, setPains] = useState(profile?.pains ?? "");
  const [desires, setDesires] = useState(profile?.desires ?? "");
  const [objections, setObjections] = useState(profile?.objections ?? "");
  const [productsServices, setProductsServices] = useState(profile?.products_services ?? "");

  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "ok" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isComplete = hasAnyValue(profile) || saveState === "ok";
  const shortId = clientId.length > 12 ? `${clientId.slice(0, 8)}…${clientId.slice(-4)}` : clientId;

  function addColor() {
    setBrandColors((prev) => [...prev, { label: "", hex: "" }]);
  }
  function updateColor(index: number, patch: Partial<BrandColor>) {
    setBrandColors((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }
  function removeColor(index: number) {
    setBrandColors((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveState("idle");
    setErrorMsg(null);

    const body = {
      brand_name: brandName,
      logo_url: logoValue?.url ?? null,
      brand_colors: brandColors.filter((c) => c.label || c.hex),
      visual_style: visualStyle,
      visual_references: visualReferences,
      tone_of_voice: toneOfVoice.split(",").map((s) => s.trim()).filter(Boolean),
      words_use: wordsUse,
      words_avoid: wordsAvoid,
      segment,
      ideal_customer: idealCustomer,
      age_range: ageRange,
      audience_location: audienceLocation,
      pains,
      desires,
      objections,
      products_services: productsServices,
    };

    try {
      const res = await fetch(`/api/admin/clients/${encodeURIComponent(clientId)}/onboarding-profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveState("error");
        setErrorMsg(typeof json?.error === "string" ? json.error : "Não foi possível salvar.");
      } else {
        setSaveState("ok");
        router.refresh();
      }
    } catch {
      setSaveState("error");
      setErrorMsg("Erro de conexão. Tente novamente.");
    }
    setSaving(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Company selecionada + status */}
      <section className="bg-white rounded-2xl border border-gray-100 p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-gray-800">{companyName ?? "Empresa"}</p>
          <p className="text-[11px] text-gray-400 font-mono">client_id: {shortId}</p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full ${
            isComplete ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"
          }`}
          data-testid="company-dna-status"
        >
          {isComplete ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
          {isComplete ? "Dados cadastrados" : "Dados ausentes"}
        </span>
      </section>

      {/* IDENTITY */}
      <section className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
        <h2 className="text-xs font-black uppercase tracking-wide text-gray-500">Identidade</h2>
        <Field label="Nome da marca">
          <input value={brandName} onChange={(e) => setBrandName(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Logo oficial">
          <AttachmentUploader value={logoValue} onChange={setLogoValue} storagePathPrefix={`company-dna/${clientId}`} />
          <p className="text-[10px] text-gray-400 mt-1">PNG, SVG ou WEBP com fundo transparente é o recomendado. Nunca gerado por IA.</p>
          {logoValue?.url && (
            <div className="mt-2 w-16 h-16 rounded-lg border border-gray-100 bg-[conic-gradient(#f3f4f6_0_25%,#fff_0_50%,#f3f4f6_0_75%,#fff_0)] bg-[length:12px_12px] flex items-center justify-center overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element -- preview de URL arbitrária (link externo ou storage), não um asset local otimizável */}
              <img src={logoValue.url} alt="Preview do logo" className="max-w-full max-h-full object-contain" />
            </div>
          )}
        </Field>
        <Field label="Cores da marca">
          <div className="space-y-1.5">
            {brandColors.map((color, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <input
                  type="text"
                  placeholder="Rótulo (ex.: Primária)"
                  value={color.label}
                  onChange={(e) => updateColor(i, { label: e.target.value })}
                  className={`${inputClass} flex-1`}
                />
                <input
                  type="text"
                  placeholder="#000000"
                  value={color.hex}
                  onChange={(e) => updateColor(i, { hex: e.target.value })}
                  className={`${inputClass} w-28 font-mono`}
                />
                {/^#[0-9a-fA-F]{3,8}$/.test(color.hex) && (
                  <span className="w-6 h-6 rounded-md border border-gray-200 flex-shrink-0" style={{ backgroundColor: color.hex }} />
                )}
                <button type="button" onClick={() => removeColor(i)} className="p-1.5 text-gray-400 hover:text-red-500 flex-shrink-0">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            <button type="button" onClick={addColor} className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-600">
              <Plus className="w-3.5 h-3.5" /> Adicionar cor
            </button>
          </div>
        </Field>
        <Field label="Estilo visual">
          <input value={visualStyle} onChange={(e) => setVisualStyle(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Referências visuais">
          <textarea value={visualReferences} onChange={(e) => setVisualReferences(e.target.value)} className={textareaClass} rows={2} />
        </Field>
      </section>

      {/* BRAND */}
      <section className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
        <h2 className="text-xs font-black uppercase tracking-wide text-gray-500">Marca</h2>
        <Field label="Tom de voz" hint="separado por vírgula">
          <input value={toneOfVoice} onChange={(e) => setToneOfVoice(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Palavras a usar">
          <textarea value={wordsUse} onChange={(e) => setWordsUse(e.target.value)} className={textareaClass} rows={2} />
        </Field>
        <Field label="Palavras a evitar">
          <textarea value={wordsAvoid} onChange={(e) => setWordsAvoid(e.target.value)} className={textareaClass} rows={2} />
        </Field>
      </section>

      {/* MARKET */}
      <section className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
        <h2 className="text-xs font-black uppercase tracking-wide text-gray-500">Mercado</h2>
        <Field label="Segmento">
          <input value={segment} onChange={(e) => setSegment(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Cliente ideal">
          <textarea value={idealCustomer} onChange={(e) => setIdealCustomer(e.target.value)} className={textareaClass} rows={2} />
        </Field>
        <Field label="Faixa etária">
          <input value={ageRange} onChange={(e) => setAgeRange(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Localização do público">
          <input value={audienceLocation} onChange={(e) => setAudienceLocation(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Dores">
          <textarea value={pains} onChange={(e) => setPains(e.target.value)} className={textareaClass} rows={2} />
        </Field>
        <Field label="Desejos">
          <textarea value={desires} onChange={(e) => setDesires(e.target.value)} className={textareaClass} rows={2} />
        </Field>
        <Field label="Objeções">
          <textarea value={objections} onChange={(e) => setObjections(e.target.value)} className={textareaClass} rows={2} />
        </Field>
      </section>

      {/* PRODUCTS */}
      <section className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
        <h2 className="text-xs font-black uppercase tracking-wide text-gray-500">Produtos e serviços</h2>
        <Field label="Produtos/serviços">
          <textarea value={productsServices} onChange={(e) => setProductsServices(e.target.value)} className={textareaClass} rows={3} />
        </Field>
      </section>

      {/* Actions */}
      <section className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-bold px-4 py-2 rounded-xl transition-colors"
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          Salvar Company DNA
        </button>
        {saveState === "ok" && <span className="text-xs font-medium text-emerald-600 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Salvo com sucesso.</span>}
        {saveState === "error" && <span className="text-xs font-medium text-red-600 flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" /> {errorMsg}</span>}
      </section>
    </form>
  );
}

const inputClass = "w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-indigo-300 bg-white placeholder-gray-400";
const textareaClass = `${inputClass} resize-none`;

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-semibold text-gray-600 mb-1">
        {label} {hint && <span className="font-normal text-gray-400">({hint})</span>}
      </p>
      {children}
    </div>
  );
}
