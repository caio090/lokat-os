/**
 * Sprint REC OS Studio Image Generation MVP V0.3 — assembler de DNA
 * criativo (Fase 8/9). Único arquivo do domínio Studio (fora de
 * neural-executor.ts/image-runtime.ts) que faz I/O real -- consulta
 * `onboarding_profiles` (mesma tabela e mesmo padrão de query já usado
 * de verdade em src/app/contentos/base-estrategica/page.tsx:
 * .from("onboarding_profiles").select("*").eq("client_id", id).maybeSingle()),
 * nunca um resolver paralelo, nunca um mock.
 *
 * "Ausente permanece ausente" (Fase 8): quando não existe linha para a
 * Company, ou quando é Free Creation Mode (sem Company), retorna
 * { company: ... , identity: null, brand: null, market: null, products: null }
 * -- nunca inventa um valor plausível.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StudioSkillBusinessContext } from "./runtime";

/**
 * FASE 31O (Admin Company DNA Editor) — exportado pra ser a fonte
 * única do que "Company DNA" significa nesta versão: o novo editor
 * administrativo (admin/empresa/dna) e sua API (api/admin/clients/[id]/
 * onboarding-profile) usam EXATAMENTE esta lista de colunas, nunca uma
 * segunda lista divergente -- garante por construção que tudo editável
 * pelo Super Admin é exatamente o que este arquivo realmente lê.
 */
export interface OnboardingProfileRow {
  brand_name: string | null;
  logo_url: string | null;
  brand_colors: unknown;
  visual_style: string | null;
  visual_references: string | null;
  tone_of_voice: string[] | null;
  words_use: string | null;
  words_avoid: string | null;
  segment: string | null;
  ideal_customer: string | null;
  age_range: string | null;
  audience_location: string | null;
  pains: string | null;
  desires: string | null;
  objections: string | null;
  products_services: string | null;
}

export const ONBOARDING_PROFILE_FIELDS = [
  "brand_name", "logo_url", "brand_colors", "visual_style", "visual_references",
  "tone_of_voice", "words_use", "words_avoid",
  "segment", "ideal_customer", "age_range", "audience_location", "pains", "desires", "objections",
  "products_services",
] as const;
const ONBOARDING_PROFILE_COLUMNS = ONBOARDING_PROFILE_FIELDS.join(", ");

export async function buildStudioCreativeBusinessContext(
  db: SupabaseClient,
  companyId: string | null,
  companyName: string | null,
): Promise<StudioSkillBusinessContext> {
  if (!companyId) {
    // Free Creation Mode -- nunca consulta, nunca inventa Company.
    return { company: null, identity: null, brand: null, market: null, products: null };
  }

  const base: StudioSkillBusinessContext = {
    company: { id: companyId, name: companyName },
    identity: null, brand: null, market: null, products: null,
  };

  let row: OnboardingProfileRow | null = null;
  try {
    const { data } = await db
      .from("onboarding_profiles")
      .select(ONBOARDING_PROFILE_COLUMNS)
      .eq("client_id", companyId)
      .maybeSingle();
    row = (data as unknown as OnboardingProfileRow | null) ?? null;
  } catch {
    // Tabela pode não existir/estar acessível neste ambiente -- nunca
    // trata isso como Company sem DNA "confirmado vazio", só não
    // enriquece (mesmo fail-closed de outros resolvers do projeto).
    row = null;
  }

  if (!row) return base;

  return {
    ...base,
    identity: {
      brandName: row.brand_name, logoUrl: row.logo_url, brandColors: row.brand_colors,
      visualStyle: row.visual_style, visualReferences: row.visual_references,
    },
    brand: {
      toneOfVoice: row.tone_of_voice, wordsToUse: row.words_use, wordsToAvoid: row.words_avoid,
    },
    market: {
      segment: row.segment, idealCustomer: row.ideal_customer, ageRange: row.age_range,
      audienceLocation: row.audience_location, pains: row.pains, desires: row.desires, objections: row.objections,
    },
    products: { productsServices: row.products_services },
  };
}
