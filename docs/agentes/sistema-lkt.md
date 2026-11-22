# Sistema LKT dentro do lokat-os

O Sistema LKT (biblioteca `caio090/skill-LKT`, que já incorpora o MazyOS
migrado) roda aqui como sistema operacional de trabalho da Lokat: estratégia,
marketing, tráfego, conteúdo, comercial, operação e financeiro. Ele **não faz
parte do site**: nada disso é importado pelo app nem vai para o deploy.

Instalar ou atualizar (Mac ou Windows): `node scripts/sistema-lkt.mjs`.
Conferir sem escrever: `node scripts/sistema-lkt.mjs --check`.

## Onde fica cada coisa

| O quê | Onde | No Git? |
|---|---|---|
| Skills LKT (166 aprovadas) | `.claude/skills/` | não, reinstalável pelo script |
| Manifesto do instalador | `.lkt/` | não |
| Memória, arquivos, catálogo, templates, workflows, workspaces | `sistema-lkt/` | não, contém dados internos e de clientes |

**Regra de caminhos:** quando uma skill LKT citar `_memoria/`, `arquivos/`,
`catalogo/`, `knowledge/`, `schemas/`, `prompts/`, `templates/`,
`workflows/`, `workspaces/` ou `exports/`, o caminho real é dentro de
`sistema-lkt/` (ex.: `_memoria/empresa.md` → `sistema-lkt/_memoria/empresa.md`).
Os `templates/` citados pelas skills são os de `sistema-lkt/templates/`, não
qualquer pasta de templates do app.

## Contexto do negócio

Em tarefas de negócio (marketing, tráfego, conteúdo, comercial, clientes,
financeiro, operação), ler antes, quando estiverem preenchidos:

1. `sistema-lkt/_memoria/empresa.md`
2. `sistema-lkt/_memoria/preferencias.md`
3. `sistema-lkt/_memoria/estrategia.md`
4. `sistema-lkt/_memoria/marca.md`
5. `sistema-lkt/_memoria/produtos-e-servicos.md`

Trabalho de cliente: carregar também `sistema-lkt/_memoria/clientes/<cliente>.md`
e o workspace em `sistema-lkt/workspaces/clientes/<cliente>/`. Contexto de um
cliente nunca vira regra geral da empresa.

Se a memória estiver em branco, sugerir rodar `/instalar` antes de entregar
estratégia. Não listar nem confirmar o que foi lido.

Tarefas de código do app (src/, testes, banco) seguem `AGENTS.md`; não
precisam carregar a memória do negócio.

## Skills

Antes de uma tarefa, procurar skill relevante em `.claude/skills/` e segui-la;
encadear quando precisar de mais de uma. Precedência entre skills parecidas:
`~/skill-LKT/docs/roteamento.md`.

- Páginas, landing pages, dashboards e interfaces: `pagina-e-site` →
  `design-front-end` → `texto-natural-pt-br`.
- Todo texto para público final (anúncio, legenda, e-mail, proposta,
  WhatsApp, interface): terminar com `texto-natural-pt-br`.
- Ativação de cliente novo começa por contexto e diagnóstico, nunca direto
  por produção de conteúdo ou anúncio.

## Memória

Correção ou instrução permanente ("sempre...", "não faça mais...",
"prefiro..."): perguntar se deve salvar e gravar uma linha no arquivo certo
de `sistema-lkt/_memoria/` (empresa, preferencias, estrategia, marca,
clientes/, projetos/, decisoes, aprendizados, pendencias...). Mostrar a linha
antes de salvar; não reformatar o arquivo.

## Padrão de entrega

Toda recomendação diz: o que fazer, por quê, quem executa, custo estimado,
prazo, como medir, risco e prioridade. Estimativa é marcada como estimativa.
Diferenciar receita, faturamento, lucro, margem, CAC, LTV, ROI, ROAS, ticket
médio e conversão.

Usar a identidade visual oficial do cliente; nunca recriar logo por
inferência. A sigla LKT não aparece em peça entregue ao cliente.

## Arquivos recebidos

Material novo entra em `sistema-lkt/arquivos/entrada/` e nunca é alterado.
Resultado vai para `sistema-lkt/arquivos/processados/`; material permanente
para `sistema-lkt/arquivos/biblioteca/<categoria>/`; registrar em
`sistema-lkt/arquivos/INDICE.md`.

## Não fazer

- Não commitar `.claude/skills/`, `.lkt/` nem `sistema-lkt/` (repositório
  público; parte das skills ainda tem texto do MazyOS sem licença, e a
  memória tem dados internos).
- Não editar skills em `.claude/skills/` aqui: o instalador marca como
  conflito. Mudança de skill é feita no skill-LKT e reinstalada.
