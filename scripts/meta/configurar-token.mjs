#!/usr/bin/env node
// Configura o token de publicação da Meta (Instagram + Facebook) no .env.local.
// Usado pela skill aprovar-post via scripts/meta/publicar.mjs. Não faz parte do site.
//
// 1. No Graph API Explorer (developers.facebook.com/tools/explorer), com o app
//    deste projeto (META_APP_ID), gere um token de USUÁRIO com as permissões:
//    pages_show_list, pages_read_engagement, pages_manage_posts,
//    instagram_basic, instagram_content_publish, business_management
// 2. Cole no .env.local:   META_USER_TOKEN=<token>
// 3. Rode:  node scripts/meta/configurar-token.mjs            (lista as Páginas)
//           node scripts/meta/configurar-token.mjs --page <ID>  (grava a escolhida)
//
// Grava META_PAGE_ID, META_PAGE_ACCESS_TOKEN (token de Página de longa duração)
// e META_IG_USER_ID, e apaga META_USER_TOKEN. Nunca imprime tokens.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ENV = join(resolve(dirname(fileURLToPath(import.meta.url)), "..", ".."), ".env.local");
const PUBLICAR = ["pages_manage_posts", "instagram_content_publish", "pages_show_list", "instagram_basic"];

function lerEnv() {
  if (!existsSync(ENV)) throw new Error(".env.local não encontrado na raiz do projeto.");
  const env = {};
  for (const linha of readFileSync(ENV, "utf8").split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

function gravarEnv(valores, remover = []) {
  let linhas = readFileSync(ENV, "utf8").split(/\r?\n/);
  linhas = linhas.filter((l) => !remover.some((k) => l.startsWith(`${k}=`)));
  for (const [k, v] of Object.entries(valores)) {
    const i = linhas.findIndex((l) => l.startsWith(`${k}=`));
    if (i >= 0) linhas[i] = `${k}=${v}`;
    else linhas.push(`${k}=${v}`);
  }
  writeFileSync(ENV, linhas.join("\n").replace(/\n*$/, "\n"));
}

async function graph(caminho, params, versao) {
  const url = new URL(`https://graph.facebook.com/${versao}/${caminho}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url);
  const j = await r.json();
  if (j.error) throw new Error(`Meta: ${j.error.message}`);
  return j;
}

const env = lerEnv();
const versao = env.META_API_VERSION || "v21.0";
const argPage = process.argv[process.argv.indexOf("--page") + 1];
const pageEscolhida = process.argv.includes("--page") ? argPage : null;

try {
  if (!env.META_APP_ID || !env.META_APP_SECRET) throw new Error("META_APP_ID/META_APP_SECRET ausentes no .env.local.");
  if (!env.META_USER_TOKEN) throw new Error("Cole META_USER_TOKEN=<token do Graph API Explorer> no .env.local e rode de novo.");

  const perms = await graph("me/permissions", { access_token: env.META_USER_TOKEN }, versao);
  const concedidas = new Set(perms.data.filter((p) => p.status === "granted").map((p) => p.permission));
  const faltando = PUBLICAR.filter((p) => !concedidas.has(p));
  if (faltando.length) throw new Error(`Token sem as permissões: ${faltando.join(", ")}. Gere de novo marcando todas.`);

  // Token de usuário de longa duração → tokens de Página derivados dele não expiram.
  const longo = await graph("oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: env.META_APP_ID,
    client_secret: env.META_APP_SECRET,
    fb_exchange_token: env.META_USER_TOKEN,
  }, versao);
  const contas = await graph("me/accounts", {
    access_token: longo.access_token,
    fields: "id,name,access_token,instagram_business_account{id,username}",
    limit: "100",
  }, versao);

  if (!contas.data.length) throw new Error("Nenhuma Página do Facebook acessível com esse token.");
  if (!pageEscolhida && contas.data.length > 1) {
    console.log("Páginas disponíveis (rode de novo com --page <ID>):\n");
    for (const p of contas.data) {
      const ig = p.instagram_business_account;
      console.log(`  ${p.id}  ${p.name}  ${ig ? `→ Instagram @${ig.username}` : "→ (sem Instagram Business vinculado)"}`);
    }
    process.exit(0);
  }
  const page = pageEscolhida ? contas.data.find((p) => p.id === pageEscolhida) : contas.data[0];
  if (!page) throw new Error(`Página ${pageEscolhida} não encontrada nesse token.`);
  const ig = page.instagram_business_account;

  gravarEnv({
    META_PAGE_ID: page.id,
    META_PAGE_ACCESS_TOKEN: page.access_token,
    ...(ig ? { META_IG_USER_ID: ig.id } : {}),
  }, ["META_USER_TOKEN"]);

  console.log(`✓ Configurado: Página "${page.name}" (${page.id})`);
  console.log(ig ? `✓ Instagram @${ig.username} (${ig.id})` : "! Página sem Instagram Business vinculado: só Facebook vai funcionar.");
  console.log("✓ Token de Página de longa duração gravado no .env.local; META_USER_TOKEN removido.");
  console.log("Teste: node scripts/meta/publicar.mjs <pasta-do-conteudo> --dry-run");
} catch (e) {
  console.error(`Erro: ${e.message}`);
  process.exit(1);
}
