/**
 * Executar com: node .tmp/run-ts-test.cjs src/lib/ai/image-providers/__tests__/google-gemini-compat.structural.test.ts
 * Prompt 31 (Google Image Provider Migration) — funções puras de
 * compatibilidade: modelo default, mapeamento de aspect ratio,
 * resolução de imageSize, montagem do request body e URL do endpoint.
 */
import { buildGeminiImageRequestBody, buildGeminiGenerateContentUrl, resolveGoogleAspectRatio, resolveGoogleImageSize, DEFAULT_GOOGLE_IMAGE_MODEL, DEFAULT_GOOGLE_IMAGE_SIZE } from "../google-gemini-compat";

let passed = 0; let failed = 0;
const assert = (condition: boolean, label: string) => { if (condition) { passed++; console.log(`  ok - ${label}`); } else { failed++; console.error(`  FAIL - ${label}`); } };

async function main() {
  console.log("[test] modelo default é gemini-3-pro-image (nunca Imagen)");
  assert(DEFAULT_GOOGLE_IMAGE_MODEL === "gemini-3-pro-image", "DEFAULT_GOOGLE_IMAGE_MODEL correto");
  assert(!DEFAULT_GOOGLE_IMAGE_MODEL.includes("imagen"), "nunca Imagen 3 (obsoleto)");

  console.log("[test] [FASE 2] endpoint generateContent -- nunca :predict");
  {
    const url = buildGeminiGenerateContentUrl("https://generativelanguage.googleapis.com/v1beta", "gemini-3-pro-image");
    assert(url === "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image:generateContent", "URL exata do endpoint generateContent");
    assert(!url.includes(":predict"), "nunca o endpoint antigo do Imagen");
  }

  console.log("[test] [FASE 5] aspect ratio 4:5 mapeado corretamente");
  assert(resolveGoogleAspectRatio("4:5") === "4:5", "4:5 -> 4:5 (equivalente exato)");

  console.log("[test] [FASE 5] aspect ratio 9:16 mapeado corretamente");
  assert(resolveGoogleAspectRatio("9:16") === "9:16", "9:16 -> 9:16 (equivalente exato)");

  console.log("[test] [FASE 5] 1:1 e 16:9 mapeados corretamente");
  assert(resolveGoogleAspectRatio("1:1") === "1:1", "1:1 -> 1:1");
  assert(resolveGoogleAspectRatio("16:9") === "16:9", "16:9 -> 16:9");

  console.log("[test] [FASE 5] 1.91:1 (banner/ad, sem equivalente exato no Gemini) -- aproxima pra 16:9, nunca distorce");
  assert(resolveGoogleAspectRatio("1.91:1") === "16:9", "1.91:1 aproximado pra 16:9, mesma proporção suportada mais próxima já usada em outros formatos sem equivalente exato");

  console.log("[test] [FASE 6] imageSize -- default 2K, valores válidos aceitos, valor inválido cai pro default");
  assert(DEFAULT_GOOGLE_IMAGE_SIZE === "2K", "default é 2K (FASE 6 -- padrão de produção inicial)");
  assert(resolveGoogleImageSize(undefined) === "2K", "sem env -> 2K");
  assert(resolveGoogleImageSize("1K") === "1K", "1K aceito");
  assert(resolveGoogleImageSize("2K") === "2K", "2K aceito");
  assert(resolveGoogleImageSize("4K") === "4K", "4K aceito -- preparado pro futuro sem lógica espalhada");
  assert(resolveGoogleImageSize("8K") === "2K", "valor inválido nunca lança, cai pro default seguro");
  assert(resolveGoogleImageSize("2k") === "2K", "case-insensitive");

  console.log("[test] [FASE 1] chamada correta -- request body usa o modelo/aspectRatio/imageSize certos");
  {
    const body = buildGeminiImageRequestBody({ prompt: "peça de teste", aspectRatio: "4:5", imageSize: "2K" });
    assert(body.generationConfig.imageConfig.aspectRatio === "4:5", "aspectRatio correto no body");
    assert(body.generationConfig.imageConfig.imageSize === "2K", "imageSize correto no body");
    assert(body.generationConfig.imageConfig.imageOutputOptions.mimeType === "image/png", "mimeType de saída explícito");
  }

  console.log("[test] [FASE 7] prompt transportado exatamente, sem reescrita conceitual");
  {
    const prompt = "cena de hambúrguer real\n\nnegative space no topo\n\nREGRA OBRIGATÓRIA DE BACKGROUND: nunca texto/logo";
    const body = buildGeminiImageRequestBody({ prompt, aspectRatio: "1:1" });
    assert(body.contents.length === 1 && body.contents[0].role === "user", "um único turno 'user'");
    assert(body.contents[0].parts.length === 1 && body.contents[0].parts[0].text === prompt, "texto EXATO (mesma string, sem transformação) -- generationPrompt+composition-guidance+background-guard já vêm prontos de image-runtime.ts");
  }

  console.log("[test] imageSize omitido usa o default (2K)");
  {
    const body = buildGeminiImageRequestBody({ prompt: "x", aspectRatio: "1:1" });
    assert(body.generationConfig.imageConfig.imageSize === "2K", "default aplicado quando não informado explicitamente");
  }

  console.log(`\n[result] ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
