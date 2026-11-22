/**
 * Referências de planejamento de funis e lançamentos.
 *
 * Origem das ideias (para citar, não para prometer resultado):
 *  - Russell Brunson — "DotCom Secrets" (2015): escada de valor e tipos de
 *    funil; "Expert Secrets" (2017): webinar de vendas; "Traffic Secrets"
 *    (2020): tráfego que você controla, conquista e possui.
 *  - Érico Rocha — "Fórmula de Lançamento": adaptação brasileira do
 *    Product Launch Formula de Jeff Walker. Fases de pré-pré-lançamento,
 *    pré-lançamento com conteúdos (CPLs), abertura e encerramento de carrinho.
 *
 * São moldes de partida. Cada cliente ajusta etapas, prazos e canais ao
 * próprio contexto (ticket, ciclo de venda, público, recursos). Nenhum
 * número aqui é meta: os templates não carregam taxas de referência.
 */
import type { FunnelStageKind, LaunchModel, LaunchPhase, MarketingChannel, ValueLadderPosition } from "./types";

export interface StageTemplate {
  stageKey: string;
  name: string;
  kind: FunnelStageKind;
  entryEventKey: string;
  channel?: MarketingChannel;
  purpose: string;
}

export interface FunnelTemplate {
  key: string;
  name: string;
  origin: string;
  whenToConsider: string;
  whenToAvoid: string;
  ladderPosition: ValueLadderPosition;
  stages: StageTemplate[];
}

export const VALUE_LADDER: Array<{ position: ValueLadderPosition; name: string; description: string }> = [
  { position: "isca", name: "Isca / conteúdo gratuito", description: "Troca de valor por contato (lead). Abre relacionamento." },
  { position: "entrada", name: "Oferta de entrada", description: "Primeira compra de baixo risco; transforma lead em cliente." },
  { position: "principal", name: "Oferta principal", description: "Produto/serviço central do negócio." },
  { position: "premium", name: "Oferta premium", description: "Mais acompanhamento ou resultado, preço maior, menos clientes." },
  { position: "continuidade", name: "Continuidade / recorrência", description: "Receita recorrente que mantém o cliente (assinatura, manutenção)." },
];

const s = (stageKey: string, name: string, kind: FunnelStageKind, entryEventKey: string, purpose: string, channel?: MarketingChannel): StageTemplate =>
  ({ stageKey, name, kind, entryEventKey, purpose, channel });

export const FUNNEL_TEMPLATES: FunnelTemplate[] = [
  {
    key: "captura_lead", name: "Funil de captura (isca)", origin: "Brunson, DotCom Secrets — lead/squeeze funnel",
    whenToConsider: "Quando o público ainda não conhece a marca e a venda precisa de relacionamento.",
    whenToAvoid: "Quando a compra é imediata e de baixo envolvimento (o atrito da isca atrasa a venda).",
    ladderPosition: "isca",
    stages: [
      s("anuncio", "Anúncio", "trafego", "link_click", "Levar a pessoa certa até a página."),
      s("pagina_captura", "Página de captura", "captura", "lead", "Trocar a isca pelo contato."),
      s("nutricao", "Nutrição", "nutricao", "engaged", "Gerar confiança (e-mail, WhatsApp, conteúdo)."),
      s("oferta", "Oferta", "conversao", "purchase", "Apresentar a oferta de entrada ou principal."),
    ],
  },
  {
    key: "whatsapp_local", name: "Anúncio → WhatsApp → venda (negócio local)", origin: "Adaptação Lokat para negócios locais e de serviço",
    whenToConsider: "Negócio local ou de serviço em que a conversa fecha a venda.",
    whenToAvoid: "Quando não há gente para responder rápido: a conversa esfria e o custo por venda sobe.",
    ladderPosition: "principal",
    stages: [
      s("anuncio", "Anúncio", "trafego", "messaging_conversation_started", "Abrir conversa com quem tem interesse.", "meta"),
      s("conversa", "Conversa no WhatsApp", "captura", "lead", "Qualificar e registrar o contato no CRM.", "whatsapp"),
      s("orcamento", "Orçamento / proposta", "conversao", "proposal_sent", "Enviar proposta clara.", "whatsapp"),
      s("venda", "Venda", "conversao", "purchase", "Fechar e registrar valor no CRM."),
      s("recompra", "Recompra / indicação", "retencao", "repeat_purchase", "Voltar a comprar ou indicar."),
    ],
  },
  {
    key: "webinar", name: "Funil de webinar / aula", origin: "Brunson, Expert Secrets — webinar de vendas",
    whenToConsider: "Oferta de ticket médio/alto que precisa de explicação e quebra de objeções.",
    whenToAvoid: "Produto simples e barato, ou sem alguém capaz de apresentar bem ao vivo/gravado.",
    ladderPosition: "principal",
    stages: [
      s("anuncio", "Anúncio", "trafego", "link_click", "Convidar para a aula."),
      s("inscricao", "Inscrição", "captura", "complete_registration", "Registrar inscrito."),
      s("presenca", "Presença na aula", "nutricao", "webinar_attended", "Ensinar e preparar a oferta."),
      s("oferta", "Oferta", "conversao", "purchase", "Vender ao fim da aula / replay."),
    ],
  },
  {
    key: "aplicacao", name: "Funil de aplicação (alto valor)", origin: "Brunson, DotCom Secrets — application funnel",
    whenToConsider: "Serviço caro ou consultivo, com poucas vagas e venda por reunião.",
    whenToAvoid: "Ticket baixo: o custo da reunião não se paga.",
    ladderPosition: "premium",
    stages: [
      s("anuncio", "Anúncio / conteúdo", "trafego", "link_click", "Atrair quem tem o problema e orçamento."),
      s("aplicacao", "Formulário de aplicação", "captura", "lead", "Filtrar por perfil e momento."),
      s("reuniao", "Reunião / diagnóstico", "conversao", "meeting_held", "Entender e propor."),
      s("fechamento", "Fechamento", "conversao", "purchase", "Contrato assinado."),
    ],
  },
  {
    key: "oferta_entrada", name: "Oferta de entrada (tripwire)", origin: "Brunson, DotCom Secrets — front-end offer / tripwire",
    whenToConsider: "Quando existe produto barato que resolve uma parte do problema e leva à oferta principal.",
    whenToAvoid: "Sem oferta seguinte definida: vira só venda barata.",
    ladderPosition: "entrada",
    stages: [
      s("anuncio", "Anúncio", "trafego", "link_click", "Apresentar a oferta de baixo risco."),
      s("checkout", "Checkout", "conversao", "initiate_checkout", "Remover atrito na compra."),
      s("compra_entrada", "Compra de entrada", "conversao", "purchase", "Primeira compra."),
      s("upsell", "Oferta seguinte", "upsell", "upsell_purchase", "Subir na escada de valor."),
    ],
  },
];

export interface LaunchTemplate {
  model: LaunchModel;
  name: string;
  origin: string;
  whenToConsider: string;
  phases: LaunchPhase[];
  cautions: string[];
}

const LAUNCH_ORIGIN = "Érico Rocha, Fórmula de Lançamento (adaptação do Product Launch Formula de Jeff Walker)";

export const LAUNCH_TEMPLATES: LaunchTemplate[] = [
  {
    model: "semente", name: "Lançamento semente", origin: LAUNCH_ORIGIN,
    whenToConsider: "Validar uma oferta com público pequeno antes de investir em produção completa.",
    phases: [
      { key: "pesquisa", name: "Pesquisa com o público", goal: "Entender dor e linguagem; confirmar interesse." },
      { key: "convite", name: "Convite para evento/aula", goal: "Reunir interessados." },
      { key: "aula", name: "Aula / conteúdo de valor", goal: "Entregar valor e apresentar a oferta." },
      { key: "carrinho", name: "Abertura e encerramento de vendas", goal: "Vender com prazo claro." },
      { key: "aprendizado", name: "Registro de aprendizados", goal: "Ajustar oferta e produto com os primeiros clientes." },
    ],
    cautions: ["Vender só o que pode ser entregue no prazo prometido."],
  },
  {
    model: "interno", name: "Lançamento interno", origin: LAUNCH_ORIGIN,
    whenToConsider: "Quando já existe lista/audiência própria aquecida.",
    phases: [
      { key: "pre_pre", name: "Pré-pré-lançamento", goal: "Aquecer a audiência e gerar expectativa (pesquisa, conteúdo)." },
      { key: "pre", name: "Pré-lançamento (conteúdos / CPLs)", goal: "Sequência de conteúdos que ensinam e preparam a oferta." },
      { key: "carrinho_aberto", name: "Carrinho aberto", goal: "Período curto de vendas, com prazo e motivo reais." },
      { key: "encerramento", name: "Encerramento", goal: "Fechar vendas no prazo anunciado e cumprir o que foi dito." },
      { key: "pos", name: "Pós-lançamento", goal: "Entrega, suporte e análise de resultado por etapa." },
    ],
    cautions: [
      "Escassez e prazo precisam ser verdadeiros (CDC e regras de anúncio da Meta).",
      "Não prometer ganho financeiro ou resultado garantido.",
    ],
  },
  {
    model: "parceria", name: "Lançamento em parceria (afiliados / coprodução)", origin: LAUNCH_ORIGIN,
    whenToConsider: "Quando parceiros com audiência compatível divulgam a oferta.",
    phases: [
      { key: "recrutamento", name: "Recrutamento de parceiros", goal: "Combinar regras, comissão e materiais." },
      { key: "pre", name: "Pré-lançamento", goal: "Conteúdos distribuídos pelos parceiros com rastreamento por parceiro." },
      { key: "carrinho_aberto", name: "Carrinho aberto", goal: "Vendas atribuídas por link/cupom de parceiro." },
      { key: "acerto", name: "Acerto e análise", goal: "Pagar comissões e comparar parceiros." },
    ],
    cautions: ["Cada parceiro precisa de UTM/cupom próprio, senão a atribuição se perde."],
  },
  {
    model: "perpetuo", name: "Lançamento perpétuo (evergreen)", origin: LAUNCH_ORIGIN,
    whenToConsider: "Oferta validada que pode ser vendida continuamente com tráfego constante.",
    phases: [
      { key: "captura", name: "Captura contínua", goal: "Anúncios levando a uma isca ou aula gravada." },
      { key: "sequencia", name: "Sequência automática", goal: "Conteúdos e oferta com prazo individual por lead." },
      { key: "otimizacao", name: "Otimização por etapa", goal: "Revisar gargalos com dados do funil." },
    ],
    cautions: ["Prazo individual precisa ser real para cada pessoa (não reiniciar contador falso)."],
  },
];

export function findFunnelTemplate(key: string): FunnelTemplate | undefined {
  return FUNNEL_TEMPLATES.find((t) => t.key === key);
}

export function findLaunchTemplate(model: LaunchModel): LaunchTemplate | undefined {
  return LAUNCH_TEMPLATES.find((t) => t.model === model);
}
