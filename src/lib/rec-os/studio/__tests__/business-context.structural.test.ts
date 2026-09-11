/**
 * Executar com: node .tmp/run-ts-test.cjs src/lib/rec-os/studio/__tests__/business-context.structural.test.ts
 * Sprint REC OS Studio Image Generation MVP V0.3 — buildStudioCreativeBusinessContext()
 * não importa Supabase diretamente no tipo (recebe o client já pronto),
 * então roda com um fixture mínimo, sem mock de módulo.
 */
import { buildStudioCreativeBusinessContext } from "../business-context";

let passed = 0; let failed = 0;
const assert = (condition: boolean, label: string) => { if (condition) { passed++; console.log(`  ok - ${label}`); } else { failed++; console.error(`  FAIL - ${label}`); } };

/** Fixture mínimo: simula .from("onboarding_profiles").select(...).eq(...).maybeSingle(). */
function fakeDb(result: { data: unknown; error: unknown } | "throw") {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (result === "throw") throw new Error("boom");
            return result;
          },
        }),
      }),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

async function main() {
  console.log("[test] 3 — free mode (companyId null): nunca consulta, nunca inventa Company");
  {
    let queried = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = { from: () => { queried = true; return {} as any; } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await buildStudioCreativeBusinessContext(db as any, null, null);
    assert(result.company === null, "company é null em Free Mode");
    assert(result.identity === null && result.brand === null && result.market === null && result.products === null, "nenhum campo de DNA é inventado em Free Mode");
    assert(!queried, "nenhuma query é feita quando companyId é null");
  }

  console.log("[test] 6 — DNA canônico é usado quando disponível (linha real de onboarding_profiles)");
  {
    const row = {
      brand_name: "Duh Lanches", logo_url: "https://cdn.example.com/logo.png", brand_colors: { primary: "#ff0000" },
      visual_style: "moderno", visual_references: "https://ref.example.com/1.png",
      tone_of_voice: ["descontraído", "direto"], words_use: "combo, promo", words_avoid: "barato",
      segment: "food service", ideal_customer: "jovens 18-30", age_range: "18-30", audience_location: "Teresina",
      pains: "fome rápida", desires: "praticidade", objections: "preço",
      products_services: "lanches, combos",
    };
    const db = fakeDb({ data: row, error: null });
    const result = await buildStudioCreativeBusinessContext(db, "company-a", "Duh Lanches");
    assert(result.company?.id === "company-a", "company.id preservado");
    assert(result.identity?.brandName === "Duh Lanches", "identity.brandName vem da linha real");
    assert(result.identity?.logoUrl === "https://cdn.example.com/logo.png", "identity.logoUrl vem da linha real");
    assert(JSON.stringify(result.identity?.brandColors) === JSON.stringify({ primary: "#ff0000" }), "identity.brandColors vem da linha real (jsonb passthrough)");
    assert(result.brand?.toneOfVoice?.[0] === "descontraído", "brand.toneOfVoice vem da linha real");
    assert(result.market?.segment === "food service", "market.segment vem da linha real");
    assert(result.products?.productsServices === "lanches, combos", "products.productsServices vem da linha real");
  }

  console.log("[test] 7 — DNA ausente (sem linha em onboarding_profiles) permanece null, nunca inventado");
  {
    const db = fakeDb({ data: null, error: null });
    const result = await buildStudioCreativeBusinessContext(db, "company-sem-dna", "Empresa Sem DNA");
    assert(result.company?.id === "company-sem-dna", "company ainda é preenchido (id/nome já vinham resolvidos/autorizados)");
    assert(result.identity === null, "identity permanece null -- nunca um objeto com campos fabricados");
    assert(result.brand === null && result.market === null && result.products === null, "brand/market/products permanecem null");
  }

  console.log("[test] — falha na query nunca lança, degrada para 'sem DNA' (fail-closed de enriquecimento)");
  {
    const db = fakeDb("throw");
    const result = await buildStudioCreativeBusinessContext(db, "company-a", "Empresa A");
    assert(result.company?.id === "company-a", "company ainda preenchido mesmo com falha na query de DNA");
    assert(result.identity === null, "identity null quando a query falha -- nunca trava a geração por causa do enriquecimento");
  }

  console.log("[test] [FASE 31O] linha gravada pelo novo editor administrativo (ONBOARDING_PROFILE_FIELDS + brand_colors [{label,hex}]) é lida corretamente");
  {
    const row = {
      brand_name: "Empresa A", logo_url: "https://cdn.example.com/logo-fase31o.png",
      brand_colors: [{ label: "Primária", hex: "#ff0000" }, { label: "Secundária", hex: "#00ff00" }],
      visual_style: "clean", visual_references: null,
      tone_of_voice: ["direto"], words_use: null, words_avoid: null,
      segment: "varejo", ideal_customer: null, age_range: null, audience_location: null, pains: null, desires: null, objections: null,
      products_services: "produto A",
    };
    const db = fakeDb({ data: row, error: null });
    const result = await buildStudioCreativeBusinessContext(db, "company-a", "Empresa A");
    assert(result.identity?.logoUrl === "https://cdn.example.com/logo-fase31o.png", "identity.logoUrl vem da linha gravada pelo editor administrativo (FASE 31O)");
    const colors = result.identity?.brandColors as { label: string; hex: string }[] | null;
    assert(Array.isArray(colors) && colors.length === 2 && colors[0]?.hex === "#ff0000", "brand_colors no formato [{label,hex}] do editor chega intacto (passthrough jsonb)");
    assert(result.brand?.toneOfVoice?.[0] === "direto", "tone_of_voice chega intacto");
    assert(result.products?.productsServices === "produto A", "products_services chega intacto");
  }

  console.log(`\n[result] ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
