/**
 * Meu PP V2 — navegação aprovada (docs/meu-pp/README.md): 5 itens, no máximo.
 * Deals vivem DENTRO de Capital; Decisões aparecem em Hoje (pendentes) e no
 * Mapa (histórico). Na Fase 0 só HOJE está ativa — as demais aparecem como
 * "em breve", sem rota e sem tela vazia.
 */
export const MEU_PP_ROUTE = "/admin/meu-pp" as const;

export type MeuPpSection = {
  id: "hoje" | "capital" | "mapa" | "biblioteca" | "revisao";
  label: string;
  /** o que a seção responde — usado como descrição acessível */
  question: string;
  active: boolean;
  href: string | null;
};

export const MEU_PP_SECTIONS: readonly MeuPpSection[] = [
  { id: "hoje", label: "Hoje", question: "O que importa agora?", active: true, href: MEU_PP_ROUTE },
  { id: "capital", label: "Capital", question: "Onde meu capital está e que movimentos estou considerando?", active: false, href: null },
  { id: "mapa", label: "Mapa", question: "De onde vim, onde estou e que caminhos existem?", active: false, href: null },
  { id: "biblioteca", label: "Biblioteca", question: "O que estou aprendendo e onde já usei?", active: false, href: null },
  { id: "revisao", label: "Revisão", question: "O que mudou, o que aprendi, o que levo adiante?", active: false, href: null },
];

export const MEU_PP_MAX_SECTIONS = 5;
if (MEU_PP_SECTIONS.length > MEU_PP_MAX_SECTIONS) {
  throw new Error(`Meu PP: a navegação não pode passar de ${MEU_PP_MAX_SECTIONS} itens.`);
}
