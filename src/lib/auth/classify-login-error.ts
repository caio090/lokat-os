/**
 * HOTFIX — login colapsava TODO erro de signInWithPassword() na mesma
 * mensagem genérica "E-mail ou senha incorretos.", mascarando causas
 * reais (confirmado em Production: Supabase retornando 402 por
 * restrição de billing/quota, exibido como se fosse senha errada).
 * Pura e testável sem React/rede -- nunca expõe status bruto, resposta
 * técnica, billing/quota ou stack trace ao usuário final.
 */
export type LoginErrorCategory =
  | "invalid_credentials"
  | "service_restricted"
  | "rate_limited"
  | "service_error"
  | "network_error";

export interface LoginErrorClassification {
  category: LoginErrorCategory;
  message: string;
}

const MESSAGES: Record<LoginErrorCategory, string> = {
  invalid_credentials: "E-mail ou senha incorretos.",
  service_restricted: "O serviço de autenticação está temporariamente indisponível. Tente novamente em breve.",
  rate_limited: "Muitas tentativas de acesso. Aguarde um pouco e tente novamente.",
  service_error: "Não foi possível acessar o serviço de login agora. Tente novamente em breve.",
  network_error: "Erro de conexão. Verifique sua internet e tente novamente.",
};

/** signInWithPassword() retornou um erro (ou nenhum usuário) -- classifica pelo status HTTP, nunca pelo texto da mensagem (que pode mudar/vazar detalhe técnico). */
export function classifyLoginAuthError(authError: unknown): LoginErrorClassification {
  const status = (authError as { status?: number } | null | undefined)?.status;
  if (status === 402) return { category: "service_restricted", message: MESSAGES.service_restricted };
  if (status === 429) return { category: "rate_limited", message: MESSAGES.rate_limited };
  if (status === 400 || status === 401) return { category: "invalid_credentials", message: MESSAGES.invalid_credentials };
  // 5xx, status ausente ou qualquer valor inesperado -- nunca finge "credencial inválida" sem ter certeza; cai no genérico de serviço.
  return { category: "service_error", message: MESSAGES.service_error };
}

/** Exceção lançada antes de qualquer resposta HTTP chegar (rede indisponível, DNS, etc.). */
export function classifyLoginNetworkError(): LoginErrorClassification {
  return { category: "network_error", message: MESSAGES.network_error };
}
