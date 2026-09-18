// Número e construção de URL centralizados — o mesmo usado em RecContact desde
// o início; antes duplicado ali (form dinâmico + link estático), agora também
// reutilizado pelo CTA imediato do Hero/Header. Não é um número novo.
export const WHATSAPP_NUMBER = "5589994217181";

export function whatsappUrl(message: string): string {
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}
