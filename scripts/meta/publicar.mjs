#!/usr/bin/env node
// Publica um carrossel (ou imagem única) no Instagram e/ou Facebook pela Graph API.
// Usado pela skill aprovar-post, sempre depois de confirmação explícita. Não faz parte do site.
//
//   node scripts/meta/publicar.mjs <pasta> --dry-run            # valida tudo, não sobe nada
//   node scripts/meta/publicar.mjs <pasta> --instagram --facebook
//
// <pasta> precisa ter instagram/slide-01.png ... (1 a 10) e legenda.md.
// As imagens precisam de URL pública: sobem para o bucket público
// "lkt-publicacoes" do Supabase (criado na 1ª vez só com --criar-bucket).
// Requer no .env.local: META_PAGE_ID, META_PAGE_ACCESS_TOKEN, META_IG_USER_ID
// (scripts/meta/configurar-token.mjs), NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BUCKET = "lkt-publicacoes";
const args = process.argv.slice(2);
const pasta = args.find((a) => !a.startsWith("--"));
const DRY = args.includes("--dry-run");
const IG = args.includes("--instagram");
const FB = args.includes("--facebook");
const CRIAR_BUCKET = args.includes("--criar-bucket");

function lerEnv() {
  const env = {};
  const arq = join(RAIZ, ".env.local");
  if (!existsSync(arq)) throw new Error(".env.local não encontrado.");
  for (const linha of readFileSync(arq, "utf8").split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

const env = lerEnv();
const V = env.META_API_VERSION || "v21.0";

async function graph(metodo, caminho, params = {}) {
  const url = new URL(`https://graph.facebook.com/${V}/${caminho}`);
  const corpo = new URLSearchParams({ ...params, access_token: env.META_PAGE_ACCESS_TOKEN });
  const r = metodo === "GET"
    ? await fetch(`${url}?${corpo}`)
    : await fetch(url, { method: "POST", body: corpo });
  const j = await r.json();
  if (j.error) throw new Error(`Meta (${caminho}): ${j.error.message}`);
  return j;
}

async function supabase(metodo, caminho, corpo, tipo = "application/json") {
  const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/${caminho}`, {
    method: metodo,
    headers: {
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      "Content-Type": tipo,
      "x-upsert": "true",
    },
    body: corpo,
  });
  const texto = await r.text();
  return { ok: r.ok, status: r.status, texto };
}

function lerConteudo() {
  if (!pasta) throw new Error("Informe a pasta do conteúdo. Ex.: node scripts/meta/publicar.mjs sistema-lkt/workspaces/.../meu-post --dry-run");
  const dir = resolve(pasta);
  const dirImgs = join(dir, "instagram");
  if (!existsSync(dirImgs)) throw new Error(`Faltando ${dirImgs}/slide-01.png ...`);
  const slides = readdirSync(dirImgs).filter((f) => /^slide-\d+\.(png|jpe?g)$/i.test(f)).sort();
  if (!slides.length || slides.length > 10) throw new Error(`Precisa de 1 a 10 slides; achei ${slides.length}.`);
  const arqLegenda = join(dir, "legenda.md");
  if (!existsSync(arqLegenda)) throw new Error("Faltando legenda.md.");
  const legenda = readFileSync(arqLegenda, "utf8").replace(/^---[\s\S]*?---\s*/, "").trim();
  if (legenda.length > 2200) throw new Error(`Legenda com ${legenda.length} caracteres (limite do Instagram: 2200).`);
  const hashtags = (legenda.match(/#[\p{L}\d_]+/gu) || []).length;
  if (hashtags > 30) throw new Error(`Legenda com ${hashtags} hashtags (limite: 30).`);
  for (const s of slides) {
    const mb = statSync(join(dirImgs, s)).size / 1e6;
    if (mb > 8) throw new Error(`${s} tem ${mb.toFixed(1)} MB (limite do Instagram: 8 MB).`);
  }
  return { dir, dirImgs, slides, legenda, slug: basename(dir) };
}

async function subirImagens({ dirImgs, slides, slug }) {
  const lista = await supabase("GET", `bucket/${BUCKET}`);
  if (!lista.ok) {
    if (!CRIAR_BUCKET) throw new Error(`Bucket "${BUCKET}" não existe no Supabase. Rode de novo com --criar-bucket (cria bucket PÚBLICO só para imagens de posts).`);
    const criado = await supabase("POST", "bucket", JSON.stringify({ id: BUCKET, name: BUCKET, public: true }));
    if (!criado.ok) throw new Error(`Não consegui criar o bucket: ${criado.texto}`);
    console.log(`✓ Bucket público "${BUCKET}" criado.`);
  }
  const prefixo = `${slug}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const urls = [];
  for (const s of slides) {
    const caminho = `${prefixo}/${s}`;
    const tipo = s.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
    const up = await supabase("POST", `object/${BUCKET}/${caminho}`, readFileSync(join(dirImgs, s)), tipo);
    if (!up.ok) throw new Error(`Upload de ${s} falhou: ${up.texto}`);
    urls.push(`${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${caminho}`);
  }
  // A Meta baixa a imagem pela URL: confirmar que está acessível sem login.
  const teste = await fetch(urls[0], { method: "HEAD" });
  if (!teste.ok) throw new Error(`Imagem não está pública (HTTP ${teste.status}): ${urls[0]}`);
  console.log(`✓ ${urls.length} imagem(ns) com URL pública.`);
  return urls;
}

async function esperarContainer(id) {
  for (let i = 0; i < 30; i++) {
    const { status_code } = await graph("GET", id, { fields: "status_code" });
    if (status_code === "FINISHED") return;
    if (status_code === "ERROR" || status_code === "EXPIRED") throw new Error(`Container ${id}: ${status_code}`);
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`Container ${id} não ficou pronto em 90 s.`);
}

async function postarInstagram(urls, legenda) {
  const ig = env.META_IG_USER_ID;
  let criacao;
  if (urls.length === 1) {
    criacao = (await graph("POST", `${ig}/media`, { image_url: urls[0], caption: legenda })).id;
  } else {
    const filhos = [];
    for (const u of urls) filhos.push((await graph("POST", `${ig}/media`, { image_url: u, is_carousel_item: "true" })).id);
    for (const f of filhos) await esperarContainer(f);
    criacao = (await graph("POST", `${ig}/media`, { media_type: "CAROUSEL", children: filhos.join(","), caption: legenda })).id;
  }
  await esperarContainer(criacao);
  const { id } = await graph("POST", `${ig}/media_publish`, { creation_id: criacao });
  const { permalink } = await graph("GET", id, { fields: "permalink" });
  return permalink || `(id ${id})`;
}

async function postarFacebook(urls, legenda) {
  const page = env.META_PAGE_ID;
  const fotos = [];
  for (const u of urls) fotos.push((await graph("POST", `${page}/photos`, { url: u, published: "false" })).id);
  const params = { message: legenda };
  fotos.forEach((id, i) => { params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id }); });
  const { id } = await graph("POST", `${page}/feed`, params);
  return `https://www.facebook.com/${id}`;
}

try {
  const conteudo = lerConteudo();
  const canais = [IG && "instagram", FB && "facebook"].filter(Boolean);
  const precisa = ["META_PAGE_ID", "META_PAGE_ACCESS_TOKEN", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
  if (IG || DRY) precisa.push("META_IG_USER_ID");
  const faltando = precisa.filter((k) => !env[k]);
  if (faltando.length) throw new Error(`Faltando no .env.local: ${faltando.join(", ")} (rode scripts/meta/configurar-token.mjs).`);

  const page = await graph("GET", env.META_PAGE_ID, { fields: "name" });
  console.log(`Conteúdo: ${conteudo.slug} — ${conteudo.slides.length} slide(s), legenda com ${conteudo.legenda.length} caracteres`);
  console.log(`Página: ${page.name}${env.META_IG_USER_ID ? ` · Instagram ${env.META_IG_USER_ID}` : ""}`);

  if (DRY) {
    console.log("✓ Dry-run: arquivos, legenda e token válidos. Nada foi enviado.");
    process.exit(0);
  }
  if (!canais.length) throw new Error("Escolha o destino: --instagram e/ou --facebook (ou --dry-run).");

  const urls = await subirImagens(conteudo);
  if (IG) console.log(`✓ Instagram: ${await postarInstagram(urls, conteudo.legenda)}`);
  if (FB) console.log(`✓ Facebook: ${await postarFacebook(urls, conteudo.legenda)}`);
} catch (e) {
  console.error(`Erro: ${e.message}`);
  console.error("Nada foi tentado depois do erro. Se o Instagram já publicou, não rode de novo com --instagram.");
  process.exit(1);
}
