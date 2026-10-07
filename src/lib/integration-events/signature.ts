/**
 * FASE 1B — autenticação de webhook por HMAC-SHA256, segredo
 * compartilhado por integração (nunca um segredo global único --
 * cada source_system tem o seu, ver sources.ts). Puro/sem I/O --
 * testável sem rede/banco.
 *
 * Headers (seção 4 do brief):
 *   x-lokat-source     -- source_system (ex.: "tayannara-brain")
 *   x-lokat-timestamp  -- epoch seconds (string)
 *   x-lokat-signature  -- hex(HMAC-SHA256(secret, `${timestamp}.${rawBody}`))
 *
 * Nunca comparar a assinatura com === (timing attack) -- sempre
 * crypto.timingSafeEqual sobre buffers do MESMO tamanho.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** Seção 4 -- proteção contra replay: timestamp não pode ser nem futuro demais nem velho demais. */
export const MAX_TIMESTAMP_SKEW_SECONDS = 5 * 60;

export function computeSignature(secret: string, timestamp: string, rawBody: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
}

export type SignatureVerificationResult =
  | { ok: true }
  | { ok: false; reason: "missing_headers" | "invalid_timestamp" | "timestamp_out_of_range" | "invalid_signature" };

export function verifyWebhookSignature(params: {
  secret: string;
  timestampHeader: string | null;
  signatureHeader: string | null;
  rawBody: string;
  now?: number;
}): SignatureVerificationResult {
  const { secret, timestampHeader, signatureHeader, rawBody } = params;
  if (!timestampHeader || !signatureHeader) return { ok: false, reason: "missing_headers" };

  const timestampSeconds = Number(timestampHeader);
  if (!Number.isFinite(timestampSeconds) || timestampSeconds <= 0) return { ok: false, reason: "invalid_timestamp" };

  const nowSeconds = (params.now ?? Date.now()) / 1000;
  if (Math.abs(nowSeconds - timestampSeconds) > MAX_TIMESTAMP_SKEW_SECONDS) return { ok: false, reason: "timestamp_out_of_range" };

  const expected = computeSignature(secret, timestampHeader, rawBody);
  const expectedBuf = Buffer.from(expected, "hex");
  const receivedBuf = Buffer.from(signatureHeader, "hex");
  if (expectedBuf.length !== receivedBuf.length || !timingSafeEqual(expectedBuf, receivedBuf)) {
    return { ok: false, reason: "invalid_signature" };
  }
  return { ok: true };
}
