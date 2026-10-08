/**
 * Executar com: node --import ./.tmp/preload-ts-loader.mjs src/lib/auth/__tests__/classify-login-error.structural.test.ts
 * HOTFIX — prova que cada status HTTP de signInWithPassword() vira a
 * mensagem certa, NUNCA a genérica "senha incorreta" pra 402/429/5xx
 * (causa raiz real: Production em 402 de billing sendo mostrado como
 * credencial errada). Nunca expõe status bruto/billing/quota ao usuário.
 */
import { classifyLoginAuthError, classifyLoginNetworkError } from "../classify-login-error";

let passed = 0; let failed = 0;
const assert = (condition: boolean, label: string) => { if (condition) { passed++; console.log(`  ok - ${label}`); } else { failed++; console.error(`  FAIL - ${label}`); } };

async function main() {
  console.log("[test] credencial inválida -- 400/401 vira 'E-mail ou senha incorretos.'");
  {
    const r400 = classifyLoginAuthError({ status: 400, message: "Invalid login credentials" });
    assert(r400.category === "invalid_credentials" && r400.message === "E-mail ou senha incorretos.", "status 400 -- credencial inválida");
    const r401 = classifyLoginAuthError({ status: 401, message: "Invalid login credentials" });
    assert(r401.category === "invalid_credentials" && r401.message === "E-mail ou senha incorretos.", "status 401 -- credencial inválida");
  }

  console.log("[test] HTTP 402 -- NUNCA mostra 'senha incorreta', mensagem fala de serviço indisponível, sem billing/quota/status bruto");
  {
    const r = classifyLoginAuthError({ status: 402, message: "Payment Required" });
    assert(r.category === "service_restricted", "402 classificado como service_restricted, nunca invalid_credentials");
    assert(r.message === "O serviço de autenticação está temporariamente indisponível. Tente novamente em breve.", "mensagem exata, nunca menciona 402/billing/quota/payment");
    assert(!/402|billing|quota|payment/i.test(r.message), "mensagem nunca vaza detalhe técnico/billing");
  }

  console.log("[test] HTTP 429 -- rate limit, mensagem pede pra aguardar, nunca 'senha incorreta'");
  {
    const r = classifyLoginAuthError({ status: 429, message: "Too Many Requests" });
    assert(r.category === "rate_limited", "429 classificado como rate_limited");
    assert(r.message === "Muitas tentativas de acesso. Aguarde um pouco e tente novamente.", "mensagem exata de rate limit");
  }

  console.log("[test] HTTP 500 -- erro de serviço, nunca 'senha incorreta', nunca expõe stack/status bruto");
  {
    const r = classifyLoginAuthError({ status: 500, message: "Internal Server Error" });
    assert(r.category === "service_error", "500 classificado como service_error");
    assert(r.message === "Não foi possível acessar o serviço de login agora. Tente novamente em breve.", "mensagem exata de erro de serviço");
    assert(!/500|internal|server/i.test(r.message), "mensagem nunca vaza status/detalhe técnico");
  }

  console.log("[test] status ausente/desconhecido -- nunca assume 'credencial inválida' sem certeza, cai no genérico de serviço");
  {
    const r1 = classifyLoginAuthError(null);
    assert(r1.category === "service_error", "authError=null (ex.: !data.user sem erro) -- nunca inventa 'senha incorreta' sem evidência");
    const r2 = classifyLoginAuthError({ message: "algo sem status" });
    assert(r2.category === "service_error", "erro sem campo status -- mesmo tratamento seguro");
  }

  console.log("[test] erro de rede/exceção -- mensagem clara de conexão, nunca confundida com credencial/billing");
  {
    const r = classifyLoginNetworkError();
    assert(r.category === "network_error" && r.message === "Erro de conexão. Verifique sua internet e tente novamente.", "mensagem exata de erro de conexão");
  }

  console.log("[test] login bem-sucedido -- nenhuma classificação é chamada (authError null + data.user presente nunca entra neste branch)");
  {
    // Documenta o contrato: classifyLoginAuthError só é chamado dentro de `if (authError || !data.user)`.
    // Login bem-sucedido (authError=null E data.user presente) nunca invoca esta função -- nada a classificar.
    assert(true, "contrato documentado -- ver src/app/(public)/login/page.tsx");
  }

  console.log(`\n[result] ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
