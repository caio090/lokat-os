# Sistema LKT dentro do lokat-os

O Sistema LKT (biblioteca `caio090/skill-LKT`, que já incorpora o MazyOS
migrado) roda aqui como sistema operacional de trabalho da Lokat: estratégia,
marketing, tráfego, conteúdo, comercial, operação e financeiro. Ele **não faz
parte do site**: nada disso é importado pelo app nem vai para o deploy.

Instalar/atualizar (cada máquina, enquanto as pastas estiverem fora do Git): `node scripts/sistema-lkt.mjs`.
Conferir sem escrever: `node scripts/sistema-lkt.mjs --check`.

## Onde fica cada coisa

| O quê | Onde | No Git? |
|---|---|---|
| Skills LKT (168 aprovadas) | `.claude/skills/` | ainda não (repo público) |
| Manifesto do instalador | `.lkt/` | ainda não (repo público) |
| Memória, arquivos, catálogo, templates, workflows, workspaces | `sistema-lkt/` | ainda não (repo público; dados internos) |

**Regra de caminhos:** quando uma skill LKT citar `_memoria/`, `arquivos/`,
`catalogo/`, `knowledge/`, `schemas/`, `prompts/`, `templates/`,
`workflows/`, `workspaces/` ou `exports/`, o caminho real é dentro de
`sistema-lkt/` (ex.: `_memoria/empresa.md` → `sistema-lkt/_memoria/empresa.md`).
Os `templates/` citados pelas skills são os de `sistema-lkt/templates/`, não
qualquer pasta de templates do app.

**Estas pastas só entram no Git quando o repositório for PRIVADO**: `sistema-lkt/` tem dados internos
e de clientes, e parte das skills tem texto do MazyOS sem licença. Nunca
torná-lo público sem antes remover essas pastas do histórico. Nada disso vai
para o site: as três pastas estão na `.vercelignore`.

Depois de alterar a memória ou um workspace, fazer commit e push normal do
lokat-os para o outro computador receber.

## Google Drive

O material da Lokat e dos clientes (reuniões, planejamentos, planilhas,
fotos, vídeos, identidade de clientes) está no Google Drive da Lokat, lido
pelo conector Google Drive do Claude. O mapa da pasta e as regras de uso
estão em `sistema-lkt/arquivos/drive-lokat-rec.md`. Consultar o Drive antes
de perguntar ao usuário algo que pode estar lá; não alterar nada no Drive.

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

## Publicação no Instagram e Facebook (Meta)

A skill `aprovar-post` publica direto só quando existe integração
configurada e o usuário confirma naquela execução. A integração aqui é:

- `node scripts/meta/configurar-token.mjs`: grava `META_PAGE_ID`,
  `META_PAGE_ACCESS_TOKEN` e `META_IG_USER_ID` no `.env.local` a partir de um
  token gerado no Graph API Explorer (instruções no topo do script).
- `node scripts/meta/publicar.mjs <pasta> --dry-run` valida; com
  `--instagram` e/ou `--facebook` publica `instagram/slide-NN.png` +
  `legenda.md`. As imagens sobem para o bucket público `lkt-publicacoes` do
  Supabase (a Meta exige URL pública).

Sempre rodar `--dry-run` e mostrar o resumo antes de publicar. Publicar é
irreversível: nunca repetir `--instagram` se o post já subiu. Estes scripts
não fazem commit, push nem deploy, e não são usados pelo app.

## Arquivos recebidos

Material novo entra em `sistema-lkt/arquivos/entrada/` e nunca é alterado.
Resultado vai para `sistema-lkt/arquivos/processados/`; material permanente
para `sistema-lkt/arquivos/biblioteca/<categoria>/`; registrar em
`sistema-lkt/arquivos/INDICE.md`.

## Não fazer

- Não tornar o repositório público (ver acima).
- Não editar skills em `.claude/skills/` aqui: o instalador marca como
  conflito. Mudança de skill é feita no skill-LKT e reinstalada com o script.
- Não importar nada de `sistema-lkt/` ou `.claude/` no código do app.
