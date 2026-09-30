import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { loadPersonalToday } from "@/lib/meu-pp/today";
import { MeuPpShell } from "./_shell";

/**
 * Meu PP V2 — Fase 0 (docs/meu-pp/README.md). Shell mínimo do espaço
 * PESSOAL: prova roteamento, sessão, escopo pessoal e isolamento.
 *
 * - Sem Company: não lê `?client=`, não chama resolveCompanyContext(), não
 *   mostra cliente/workspace (a barra de Company é ocultada nesta rota em
 *   src/app/admin/_layout-client.tsx).
 * - Leitura só pela sessão do próprio usuário (src/lib/meu-pp/today.ts).
 * - Só HOJE está ativa; as outras seções aparecem como "em breve", sem rota.
 * - Nenhum dado falso: zero dados = estado vazio honesto.
 */
export const metadata: Metadata = {
  title: "Meu PP",
  description: "Espaço pessoal de estratégia, memória e decisão.",
};

export default async function MeuPpPage() {
  const today = await loadPersonalToday();
  if (today.status === "unauthenticated") redirect("/login");
  return <MeuPpShell today={today} />;
}
