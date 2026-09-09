/**
 * Executar com: node .tmp/run-ts-test.cjs src/lib/ai/image-providers/__tests__/google-gemini-response.structural.test.ts
 * Prompt 31 (Google Image Provider Migration) — normalizeGeminiImageResponse
 * roda Sharp DE VERDADE (mesmo princípio de compositor.structural.test.ts:
 * nunca mocka a etapa que mais importa provar -- "as dimensões
 * devolvidas são as dimensões reais da imagem decodificada"). [TEST 7]
 * extração de inlineData; [TEST 8] erro quando não há imagem.
 */
import sharp from "sharp";
import { normalizeGeminiImageResponse, mapGeminiHttpErrorToSafeMessage } from "../google-gemini-response";

let passed = 0; let failed = 0;
const assert = (condition: boolean, label: string) => { if (condition) { passed++; console.log(`  ok - ${label}`); } else { failed++; console.error(`  FAIL - ${label}`); } };

async function realPngBase64(width: number, height: number): Promise<string> {
  const buf = await sharp({ create: { width, height, channels: 3, background: { r: 10, g: 20, b: 30 } } }).png().toBuffer();
  return buf.toString("base64");
}

async function main() {
  console.log("[test] [TEST 7] extração correta de inlineData -- imagem real, dimensões REAIS (nunca fixas/chutadas)");
  {
    const base64 = await realPngBase64(1234, 987);
    const result = await normalizeGeminiImageResponse({
      candidates: [{ content: { parts: [{ text: "Aqui está a imagem." }, { inlineData: { mimeType: "image/png", data: base64 } }] } }],
    });
    assert(result.ok === true, "resolve com sucesso");
    if (result.ok) {
      assert(result.images.length === 1, "uma imagem extraída");
      assert(result.images[0].width === 1234 && result.images[0].height === 987, "dimensões REAIS lidas do buffer decodificado -- exatamente o que foi gerado, nunca um valor fixo (corrige o problema da auditoria)");
      assert(result.images[0].mimeType === "image/png", "MIME real detectado por magic bytes");
      assert(result.images[0].url.startsWith("data:image/png;base64,"), "data: URL bem formada");
    }
  }

  console.log("[test] [TEST 8] erro quando não há imagem -- candidates vazio");
  {
    const result = await normalizeGeminiImageResponse({ candidates: [] });
    assert(!result.ok, "nenhuma imagem -> ok:false");
  }

  console.log("[test] [TEST 8] erro quando não há imagem -- parts sem inlineData (só texto)");
  {
    const result = await normalizeGeminiImageResponse({ candidates: [{ content: { parts: [{ text: "Não consegui gerar." }] } }] });
    assert(!result.ok, "sem inlineData -> ok:false, nunca finge sucesso");
  }

  console.log("[test] resposta null/vazia -- nunca lança");
  {
    const result = await normalizeGeminiImageResponse(null);
    assert(!result.ok, "resposta null -> ok:false, sem exceção");
  }

  console.log("[test] safety block via promptFeedback.blockReason -- nunca tratado como sucesso vazio genérico");
  {
    const result = await normalizeGeminiImageResponse({ promptFeedback: { blockReason: "SAFETY" }, candidates: [] });
    assert(!result.ok, "bloqueado por segurança -> ok:false");
    if (!result.ok) assert(/segurança/i.test(result.error), "mensagem específica de bloqueio de segurança");
  }

  console.log("[test] safety block via candidate.finishReason -- mesma cobertura");
  {
    const result = await normalizeGeminiImageResponse({ candidates: [{ finishReason: "IMAGE_SAFETY", content: { parts: [] } }] });
    assert(!result.ok, "finishReason de segurança -> ok:false");
  }

  console.log("[test] base64 inválido -- nunca lança, vira erro explícito");
  {
    // Buffer.from com base64 tolerante nunca lança -- mas o resultado
    // decodificado precisa falhar no magic-byte check (não é uma
    // imagem de verdade), então o teste real é: string claramente não-
    // imagem produz ok:false.
    const result = await normalizeGeminiImageResponse({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "isto-nao-e-base64-de-imagem-nenhuma" } }] } }] });
    assert(!result.ok, "bytes decodificados não são uma imagem real -- ok:false, nunca aceito cegamente");
  }

  console.log("[test] inlineData.data vazio -- ok:false");
  {
    const result = await normalizeGeminiImageResponse({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "" } }] } }] });
    assert(!result.ok, "data vazia -> ok:false");
  }

  console.log("[test] [TEST 9] mapGeminiHttpErrorToSafeMessage -- mensagens seguras por status, nunca a mensagem bruta do Google");
  {
    assert(/autenticação/i.test(mapGeminiHttpErrorToSafeMessage(401, {})), "401 -> autenticação");
    assert(/autenticação/i.test(mapGeminiHttpErrorToSafeMessage(403, {})), "403 -> autenticação");
    assert(/não está disponível/i.test(mapGeminiHttpErrorToSafeMessage(404, {})), "404 -> modelo indisponível");
    assert(/parâmetros inválidos/i.test(mapGeminiHttpErrorToSafeMessage(400, {})), "400 -> parâmetros inválidos");
    assert(/limite/i.test(mapGeminiHttpErrorToSafeMessage(429, {})), "429 -> limite/quota");
    assert(/indisponível/i.test(mapGeminiHttpErrorToSafeMessage(500, {})), "5xx -> indisponível");
    assert(/limite/i.test(mapGeminiHttpErrorToSafeMessage(200, { error: { status: "RESOURCE_EXHAUSTED" } })), "RESOURCE_EXHAUSTED (status do Google) -> limite/quota, mesmo com HTTP 200 hipotético");
    const msg400 = mapGeminiHttpErrorToSafeMessage(400, { error: { message: "detalhe interno sensível do Google" } });
    assert(!msg400.includes("detalhe interno sensível"), "nunca vaza a mensagem bruta do provider");
  }

  console.log(`\n[result] ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
