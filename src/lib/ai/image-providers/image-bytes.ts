/**
 * Prompt 31 (Google Image Provider Migration) — extraído de
 * openai-image-response.ts (era privado ali) pra ser reaproveitado
 * também por google-gemini-response.ts. Mesmo comportamento, mesmo
 * texto -- nenhuma mudança funcional, só compartilhado entre os dois
 * providers em vez de duplicado.
 */

/** Detecta magic bytes -- nunca aceita uma string base64 arbitrária como imagem válida só porque decodificou sem lançar. */
export function detectMimeFromMagicBytes(buf: Buffer): string | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) {
    return "image/png";
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  return null;
}
