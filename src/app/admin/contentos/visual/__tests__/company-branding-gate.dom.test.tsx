/**
 * Executar com: node .tmp/run-tsx-dom-test.cjs src/app/admin/contentos/visual/__tests__/company-branding-gate.dom.test.tsx
 * FASE 31P (Company Branding Gate) — monta StudioExecutionForm DE
 * VERDADE em jsdom (mesmo padrão de recent-series-section.dom.test.tsx:
 * "não usar apenas regex/source tests"), mockando só `fetch` (o
 * endpoint de onboarding-profile já reutilizado da FASE 31O, nenhuma
 * rota nova). Prova, contra o DOM real, que Company Mode sem logo
 * bloqueia "Criar arte", Free Mode nunca é afetado, o upload inline
 * (via a aba "Link" do AttachmentUploader, sem precisar de rede real
 * pro Storage) salva no client_id correto e libera a geração sem
 * reload manual, e que trocar de Company reavalia do zero.
 */
import * as React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { StudioExecutionForm } from "../_studio-execution-form";
import type { StudioLaunchContext } from "@/lib/rec-os/studio/launch-context";

let passed = 0; let failed = 0;
const assert = (condition: boolean, label: string) => { if (condition) { passed++; console.log(`  ok - ${label}`); } else { failed++; console.error(`  FAIL - ${label}`); } };

const LAUNCH_CONTEXT: StudioLaunchContext = { clientId: null, contentId: null, campaignId: null, socialProfileId: null, format: null, returnRoute: "/admin/contentos/visual" };
const SKILLS = [{ id: "vidigal_png", name: "Vidigal PNG" }];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function flush() {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

function fillBrief() {
  fireEvent.change(screen.getByLabelText("O que vamos criar?"), { target: { value: "teste" } });
}

async function main() {
  console.log("\n[dom] [1] Company com logo -- botão 'Criar arte' liberado, preview mostrado");
  {
    const originalFetch = global.fetch;
    global.fetch = (async (input: unknown) => {
      const url = String(input);
      if (url.includes("/onboarding-profile")) return jsonResponse({ clientId: "company-a", companyName: "Empresa A", profile: { logo_url: "https://cdn.example.com/logo.png" } });
      return jsonResponse({ ok: false });
    }) as typeof fetch;
    try {
      render(<StudioExecutionForm skills={SKILLS} clientId="company-a" launchContext={LAUNCH_CONTEXT} />);
      await flush();
      assert(screen.getByText("Logo oficial carregada") !== null, "[11] preview/confirmação de logo carregada aparece");
      fillBrief();
      const submit = screen.getByRole("button", { name: /criar arte/i }) as HTMLButtonElement;
      assert(!submit.disabled, "[10] botão 'Criar arte' habilitado quando a Company tem logo");
      cleanup();
    } finally { global.fetch = originalFetch; }
  }

  console.log("\n[dom] [2] Company SEM logo -- botão 'Criar arte' bloqueado, bloco de cadastro inline aparece");
  {
    const originalFetch = global.fetch;
    global.fetch = (async (input: unknown) => {
      const url = String(input);
      if (url.includes("/onboarding-profile")) return jsonResponse({ clientId: "duh-lanches-id", companyName: "Duh Lanches", profile: null });
      return jsonResponse({ ok: false });
    }) as typeof fetch;
    try {
      render(<StudioExecutionForm skills={SKILLS} clientId="duh-lanches-id" launchContext={LAUNCH_CONTEXT} />);
      await flush();
      assert(screen.getByText(/logo oficial não cadastrada/i) !== null, "bloco 'LOGO OFICIAL NÃO CADASTRADA' aparece");
      fillBrief();
      const submit = screen.getByRole("button", { name: /criar arte/i }) as HTMLButtonElement;
      assert(submit.disabled, "[9] botão 'Criar arte' bloqueado sem logo -- sem botão 'Continuar sem logo'");
      assert(screen.getByText("Cadastre a logo oficial da empresa para continuar.") !== null, "motivo visível perto do botão");
      assert(screen.queryByText(/continuar sem logo/i) === null, "[8] nenhum override 'Continuar sem logo' existe");
      cleanup();
    } finally { global.fetch = originalFetch; }
  }

  console.log("\n[dom] [3] Free Mode -- geração liberada, gate nunca é consultado nem exibido");
  {
    const originalFetch = global.fetch;
    let onboardingProfileCalled = false;
    global.fetch = (async (input: unknown) => {
      const url = String(input);
      if (url.includes("/onboarding-profile")) { onboardingProfileCalled = true; return jsonResponse({ profile: null }); }
      return jsonResponse({ ok: false });
    }) as typeof fetch;
    try {
      render(<StudioExecutionForm skills={SKILLS} clientId={null} launchContext={LAUNCH_CONTEXT} />);
      await flush();
      fillBrief();
      const submit = screen.getByRole("button", { name: /criar arte/i }) as HTMLButtonElement;
      assert(!submit.disabled, "Free Mode nunca exige logo");
      assert(!onboardingProfileCalled, "endpoint de logo nunca é consultado em Free Mode");
      assert(screen.queryByTestId("company-branding-section") === null, "bloco de identidade nunca aparece em Free Mode");
      cleanup();
    } finally { global.fetch = originalFetch; }
  }

  console.log("\n[dom] [12] trocar de Company reavalia a logo do zero (nunca reaproveita o resultado da Company anterior)");
  {
    const originalFetch = global.fetch;
    global.fetch = (async (input: unknown) => {
      const url = String(input);
      if (url.includes("company-a/onboarding-profile")) return jsonResponse({ profile: { logo_url: "https://cdn.example.com/logo.png" } });
      if (url.includes("company-b/onboarding-profile")) return jsonResponse({ profile: null });
      return jsonResponse({ ok: false });
    }) as typeof fetch;
    try {
      const { rerender } = render(<StudioExecutionForm skills={SKILLS} clientId="company-a" launchContext={LAUNCH_CONTEXT} />);
      await flush();
      assert(screen.getByText("Logo oficial carregada") !== null, "company-a tem logo");
      rerender(<StudioExecutionForm skills={SKILLS} clientId="company-b" launchContext={LAUNCH_CONTEXT} />);
      await flush();
      assert(screen.getByText(/logo oficial não cadastrada/i) !== null, "ao trocar pra company-b (sem logo), o gate reavalia -- nunca herda 'presente' da company-a");
      cleanup();
    } finally { global.fetch = originalFetch; }
  }

  console.log("\n[dom] [4/5/6/7/11] upload inline (link direto, sem rede pro Storage) + salvar -- persiste no client_id certo, revalida e libera a geração sem reload manual");
  {
    const originalFetch = global.fetch;
    const captured: { putUrl: string | null; putBody: { logo_url?: string } | null } = { putUrl: null, putBody: null };
    let getCallCount = 0;
    global.fetch = (async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/onboarding-profile")) {
        if (init?.method === "PUT") {
          captured.putUrl = url;
          captured.putBody = JSON.parse(String(init.body));
          return jsonResponse({ ok: true });
        }
        getCallCount++;
        return jsonResponse({ profile: getCallCount === 1 ? { logo_url: null } : { logo_url: "https://cdn.example.com/nova-logo.png" } });
      }
      return jsonResponse({ ok: false });
    }) as typeof fetch;
    try {
      render(<StudioExecutionForm skills={SKILLS} clientId="duh-lanches-id" launchContext={LAUNCH_CONTEXT} />);
      await flush();
      assert(screen.getByText(/logo oficial não cadastrada/i) !== null, "estado inicial: sem logo");

      const linkInput = screen.getByPlaceholderText(/cole o link do arquivo/i) as HTMLInputElement;
      fireEvent.change(linkInput, { target: { value: "https://cdn.example.com/nova-logo.png" } });
      const saveBtn = screen.getByRole("button", { name: /^salvar logo$/i }) as HTMLButtonElement;
      assert(!saveBtn.disabled, "botão 'Salvar logo' habilita assim que um valor é escolhido no uploader inline");

      fireEvent.click(saveBtn);
      await flush();

      assert(captured.putUrl?.includes("duh-lanches-id/onboarding-profile") ?? false, "[5] logo salva no client_id correto (o mesmo da Company atual)");
      assert(captured.putBody?.logo_url === "https://cdn.example.com/nova-logo.png", "URL enviada é exatamente a escolhida no upload inline");
      assert(getCallCount === 2, "[6/11] após salvar, revalida (GET de novo) -- não confia só na resposta do PUT");
      assert(screen.getByText("Logo oficial carregada") !== null, "[7] após salvar, o Studio mostra a logo sem exigir reload manual da página");

      fillBrief();
      const submit = screen.getByRole("button", { name: /criar arte/i }) as HTMLButtonElement;
      assert(!submit.disabled, "geração liberada imediatamente após o upload inline, sem sair do Studio");
      cleanup();
    } finally { global.fetch = originalFetch; }
  }

  console.log(`\n[dom result] ${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

void main();
