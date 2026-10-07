/**
 * Executar com: node --import ./.tmp/preload-ts-loader.mjs src/lib/integration-events/__tests__/signature.structural.test.ts
 * FASE 1B — verificação de assinatura HMAC-SHA256 + proteção contra
 * replay (timestamp). Puro, sem I/O.
 */
import { computeSignature, verifyWebhookSignature, MAX_TIMESTAMP_SKEW_SECONDS } from "../signature";

let passed = 0; let failed = 0;
const assert = (condition: boolean, label: string) => { if (condition) { passed++; console.log(`  ok - ${label}`); } else { failed++; console.error(`  FAIL - ${label}`); } };

const SECRET = "test-secret-do-not-use-in-real-life";
const BODY = JSON.stringify({ event_id: "evt_1", event_type: "UPSELL_INTERESTED" });

async function main() {
  console.log("[test] assinatura correta -- aceita");
  {
    const now = Date.now();
    const timestamp = String(Math.floor(now / 1000));
    const signature = computeSignature(SECRET, timestamp, BODY);
    const result = verifyWebhookSignature({ secret: SECRET, timestampHeader: timestamp, signatureHeader: signature, rawBody: BODY, now });
    assert(result.ok === true, "assinatura válida é aceita");
  }

  console.log("[test] assinatura incorreta -- rejeitada");
  {
    const now = Date.now();
    const timestamp = String(Math.floor(now / 1000));
    const result = verifyWebhookSignature({ secret: SECRET, timestampHeader: timestamp, signatureHeader: "0".repeat(64), rawBody: BODY, now });
    assert(result.ok === false, "assinatura incorreta é rejeitada");
    assert(!result.ok && result.reason === "invalid_signature", "motivo correto reportado");
  }

  console.log("[test] segredo errado -- rejeitada (prova que a verificação usa o segredo de verdade)");
  {
    const now = Date.now();
    const timestamp = String(Math.floor(now / 1000));
    const signature = computeSignature("outro-segredo", timestamp, BODY);
    const result = verifyWebhookSignature({ secret: SECRET, timestampHeader: timestamp, signatureHeader: signature, rawBody: BODY, now });
    assert(result.ok === false, "assinatura calculada com outro segredo é rejeitada");
  }

  console.log("[test] corpo alterado depois de assinado -- rejeitado (integridade)");
  {
    const now = Date.now();
    const timestamp = String(Math.floor(now / 1000));
    const signature = computeSignature(SECRET, timestamp, BODY);
    const tamperedBody = JSON.stringify({ event_id: "evt_1", event_type: "UPSELL_INTERESTED", title: "injetado" });
    const result = verifyWebhookSignature({ secret: SECRET, timestampHeader: timestamp, signatureHeader: signature, rawBody: tamperedBody, now });
    assert(result.ok === false, "corpo alterado invalida a assinatura mesmo com timestamp/segredo corretos");
  }

  console.log("[test] timestamp vencido -- rejeitado (proteção contra replay)");
  {
    const now = Date.now();
    const oldTimestamp = String(Math.floor(now / 1000) - MAX_TIMESTAMP_SKEW_SECONDS - 60);
    const signature = computeSignature(SECRET, oldTimestamp, BODY);
    const result = verifyWebhookSignature({ secret: SECRET, timestampHeader: oldTimestamp, signatureHeader: signature, rawBody: BODY, now });
    assert(result.ok === false, "timestamp muito antigo é rejeitado");
    assert(!result.ok && result.reason === "timestamp_out_of_range", "motivo correto (replay)");
  }

  console.log("[test] timestamp no futuro distante -- rejeitado");
  {
    const now = Date.now();
    const futureTimestamp = String(Math.floor(now / 1000) + MAX_TIMESTAMP_SKEW_SECONDS + 60);
    const signature = computeSignature(SECRET, futureTimestamp, BODY);
    const result = verifyWebhookSignature({ secret: SECRET, timestampHeader: futureTimestamp, signatureHeader: signature, rawBody: BODY, now });
    assert(result.ok === false, "timestamp no futuro distante é rejeitado -- nunca só checa 'não está vencido'");
  }

  console.log("[test] headers ausentes -- rejeitado");
  {
    const result = verifyWebhookSignature({ secret: SECRET, timestampHeader: null, signatureHeader: null, rawBody: BODY });
    assert(result.ok === false, "sem timestamp/assinatura, nunca aceita");
    assert(!result.ok && result.reason === "missing_headers", "motivo correto");
  }

  console.log("[test] assinatura com tamanho diferente do esperado -- rejeitado, nunca lança (timingSafeEqual exige mesmo tamanho)");
  {
    const now = Date.now();
    const timestamp = String(Math.floor(now / 1000));
    const result = verifyWebhookSignature({ secret: SECRET, timestampHeader: timestamp, signatureHeader: "abcd", rawBody: BODY, now });
    assert(result.ok === false, "assinatura curta demais é rejeitada sem lançar exceção");
  }

  console.log(`\n[result] ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
