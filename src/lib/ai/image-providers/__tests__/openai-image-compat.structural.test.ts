/**
 * Executar com: node .tmp/run-ts-test.cjs src/lib/ai/image-providers/__tests__/openai-image-compat.structural.test.ts
 * Prompt 09 (Studio Image Provider Compatibility) — resolveOpenAIImageModelFamily/
 * buildOpenAIImageRequest são puros, sem I/O.
 * Prompt 11 (GPT-Image-2 Production Migration) — dall-e-2/dall-e-3 foram
 * removidos da API real da OpenAI (incidente de Production
 * `dpl_EHFbxtcH6Czf2xFfmmDrb9UzmTtC`, HTTP 400 code:"invalid_value"
 * param:"model"). Reescrito: nenhuma família "dall_e_2"/"dall_e_3"
 * mais existe -- ambos resolvem pra "removed" e nunca constroem um
 * request. Default do módulo (`DEFAULT_OPENAI_IMAGE_MODEL`) precisa
 * ser gpt-image-2, nunca dall-e-3 (exatamente a causa raiz real).
 */
import { resolveOpenAIImageModelFamily, buildOpenAIImageRequest, DEFAULT_OPENAI_IMAGE_MODEL } from "../openai-image-compat";

let passed = 0; let failed = 0;
const assert = (condition: boolean, label: string) => { if (condition) { passed++; console.log(`  ok - ${label}`); } else { failed++; console.error(`  FAIL - ${label}`); } };

async function main() {
  console.log("[test] DEFAULT_OPENAI_IMAGE_MODEL -- gpt-image-2, nunca dall-e-3 (causa raiz do incidente real)");
  {
    assert(DEFAULT_OPENAI_IMAGE_MODEL === "gpt-image-2", "default é gpt-image-2");
    assert(resolveOpenAIImageModelFamily(DEFAULT_OPENAI_IMAGE_MODEL) === "gpt_image", "o default sempre resolve pra família gpt_image");
  }

  console.log("[test] resolveOpenAIImageModelFamily -- família correta por modelo real do SDK instalado");
  {
    assert(resolveOpenAIImageModelFamily("dall-e-2") === "removed", "dall-e-2 -> removed (removido da API real, nunca 'unknown' genérico)");
    assert(resolveOpenAIImageModelFamily("dall-e-3") === "removed", "dall-e-3 -> removed (removido da API real, causa raiz do incidente)");
    assert(resolveOpenAIImageModelFamily("gpt-image-1") === "gpt_image", "gpt-image-1");
    assert(resolveOpenAIImageModelFamily("gpt-image-1-mini") === "gpt_image", "gpt-image-1-mini");
    assert(resolveOpenAIImageModelFamily("gpt-image-1.5") === "gpt_image", "gpt-image-1.5");
    assert(resolveOpenAIImageModelFamily("gpt-image-2") === "gpt_image", "gpt-image-2");
    assert(resolveOpenAIImageModelFamily("gpt-image-2-2026-04-21") === "gpt_image", "gpt-image-2-2026-04-21");
    assert(resolveOpenAIImageModelFamily("chatgpt-image-latest") === "gpt_image", "chatgpt-image-latest");
    assert(resolveOpenAIImageModelFamily("nao-existe-esse-modelo") === "unknown", "modelo desconhecido nunca ganha família inventada");
  }

  console.log("[test] [PRODUCTION_INCIDENT_OPENAI_RESPONSE_FORMAT] nenhuma família válida envia response_format, nunca");
  {
    for (const model of ["gpt-image-1", "gpt-image-2", "gpt-image-2-2026-04-21"]) {
      const result = buildOpenAIImageRequest({ model, prompt: "x", aspectRatio: "1:1" });
      assert(result.ok, `${model}: build não falha`);
      if (result.ok) {
        assert(!("response_format" in result.request), `${model}: response_format NUNCA está no request (causa raiz do 1º incidente real de Production)`);
      }
    }
  }

  console.log("[test] GPT Image -- só parâmetros válidos pra essa família (matriz)");
  {
    const result = buildOpenAIImageRequest({ model: "gpt-image-1", prompt: "cenário", aspectRatio: "9:16", highRes: true, outputCount: 3 });
    assert(result.ok, "build ok");
    if (result.ok) {
      assert(result.family === "gpt_image", "família correta");
      assert(result.request.model === "gpt-image-1", "model preservado");
      assert(result.request.size === "1024x1536", "size 9:16 mapeado pro preset real do GPT Image");
      assert(result.request.quality === "high", "highRes:true -> quality high (vocabulário real do GPT Image)");
      assert(result.request.n === 3, "n respeitado dentro do limite");
      assert(!("style" in result.request), "style nunca enviado pro GPT Image (só dall-e-3, removido da API)");
      assert(!("response_format" in result.request), "response_format nunca enviado");
    }
  }

  console.log("[test] GPT Image -- quality auto quando highRes ausente");
  {
    const result = buildOpenAIImageRequest({ model: "gpt-image-1-mini", prompt: "x", aspectRatio: "1:1" });
    assert(result.ok && result.request.quality === "auto", "quality auto (vocabulário real do GPT Image, nunca 'hd'/'standard')");
  }

  console.log("[test] gpt-image-2 -- modelo default da migração, matriz completa de aspect ratio");
  {
    // FASE 31H.2 -- "4:5" corrigido de "1024x1024" (quadrado, bug real confirmado em Production) para "1024x1536" (retrato, numericamente mais perto de 0.8 que o quadrado 1.0 -- ver comentário de GPT_IMAGE_SIZE_MAP).
    for (const [ar, expectedSize] of [["1:1", "1024x1024"], ["9:16", "1024x1536"], ["16:9", "1536x1024"], ["4:5", "1024x1536"], ["1.91:1", "1536x1024"]] as const) {
      const result = buildOpenAIImageRequest({ model: "gpt-image-2", prompt: "x", aspectRatio: ar });
      assert(result.ok, `gpt-image-2 (${ar}): build ok`);
      if (result.ok) {
        assert(result.family === "gpt_image", `gpt-image-2 (${ar}): família gpt_image`);
        assert(result.request.size === expectedSize, `gpt-image-2 (${ar}): size ${expectedSize} (preset padrão, nunca WIDTHxHEIGHT arbitrário não pedido)`);
      }
    }
  }

  console.log("[test] gpt-image-2-2026-04-21 -- snapshot, resolve pra mesma família gpt_image");
  {
    const result = buildOpenAIImageRequest({ model: "gpt-image-2-2026-04-21", prompt: "x", aspectRatio: "1:1", highRes: true, outputCount: 2 });
    assert(result.ok, "build ok");
    if (result.ok) {
      assert(result.family === "gpt_image", "família gpt_image");
      assert(result.request.model === "gpt-image-2-2026-04-21", "model preservado exatamente");
      assert(result.request.quality === "high", "highRes:true -> quality high");
      assert(result.request.n === 2, "n respeitado");
      assert(!("response_format" in result.request), "response_format nunca enviado");
    }
  }

  console.log("[test] [PRODUCTION_INCIDENT_MODEL_REMOVED] dall-e-2/dall-e-3 -- nunca constroem request, erro sanitizado + detalhe interno técnico");
  {
    for (const model of ["dall-e-2", "dall-e-3"]) {
      const result = buildOpenAIImageRequest({ model, prompt: "x", aspectRatio: "1:1" });
      assert(!result.ok, `${model}: build falha explicitamente, nunca gera um request pra um modelo removido da API`);
      if (!result.ok) {
        assert(result.family === "removed", `${model}: family === "removed"`);
        assert(result.error === "O modelo de geração de imagem configurado não está disponível.", `${model}: mensagem sanitizada exata (nunca vaza detalhe técnico pro cliente)`);
        assert(/removed from the API/.test(result.internalDetail), `${model}: internalDetail menciona remoção da API (só server-side, nunca no client)`);
        assert(result.internalDetail.includes(model), `${model}: internalDetail cita o model id real recebido`);
        assert(result.internalDetail.includes(DEFAULT_OPENAI_IMAGE_MODEL), `${model}: internalDetail aponta o modelo recomendado atual`);
      }
    }
  }

  console.log("[test] modelo desconhecido -- falha explícita, nunca compatibilidade inventada, family 'unknown' distinta de 'removed'");
  {
    const result = buildOpenAIImageRequest({ model: "modelo-futuro-inexistente", prompt: "x", aspectRatio: "1:1" });
    assert(!result.ok, "build falha explicitamente");
    if (!result.ok) {
      assert(result.family === "unknown", "family 'unknown' (nunca confundido com 'removed', que tem causa raiz conhecida)");
      assert(typeof result.error === "string" && result.error.length > 0, "mensagem de erro explicativa presente");
      assert(!result.internalDetail.includes("removed from the API"), "internalDetail de 'unknown' não afirma remoção -- só não reconhecido");
    }
  }

  console.log(`\n[result] ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
