#!/usr/bin/env node
// Instala/sincroniza o Sistema LKT (skills + estrutura) neste repositório.
//
//   node scripts/sistema-lkt.mjs          # instala ou atualiza
//   node scripts/sistema-lkt.mjs --check  # só mostra o estado, não escreve
//
// Funciona no Mac e no Windows. Procura a biblioteca skill-LKT em
// $LKT_HOME, ../skill-LKT ou ~/skill-LKT (clona em ~/skill-LKT se não achar).
//
// Resultado (fora do deploy pela .vercelignore; fora do Git enquanto o repo for público):
//   .claude/skills/   todas as skills aprovadas do registro LKT
//   .lkt/             manifesto do instalador (hashes; backup/ fica local)
//   sistema-lkt/      memória, arquivos, catálogo, templates, workflows...
//
// Quando o repositório for privado e essas pastas forem versionadas, no outro
// computador basta `git pull`; até lá, rodar este script em cada máquina.
//
// Arquivos que já existem em sistema-lkt/ nunca são sobrescritos: a memória
// preenchida (_memoria/*.md) e o material de clientes ficam intactos.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CHECK = process.argv.includes("--check");
const REMOTE = "https://github.com/caio090/skill-LKT.git";
const BRANCH = "feat/importar-skills-lkt-completas";
const DESTINO = join(REPO, "sistema-lkt");
const PASTAS = [
  "_memoria", "arquivos", "catalogo", "knowledge", "schemas", "prompts",
  "templates", "workflows", "workspaces", "exports",
];
const ARQUIVOS_RAIZ = ["INICIAR_AQUI.txt", "SISTEMA_LKT.txt"];
const SUBPASTAS_VAZIAS = [
  "arquivos/entrada", "arquivos/processados", "arquivos/biblioteca",
  "_memoria/clientes", "_memoria/projetos",
];

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();
}

function acharPython() {
  for (const bin of ["python3", "python", "py"]) {
    const r = spawnSync(bin, ["--version"], { encoding: "utf8" });
    if (r.status === 0 && /Python 3/.test(r.stdout + r.stderr)) return bin;
  }
  throw new Error("Python 3 não encontrado. Instale em https://www.python.org/downloads/");
}

function acharBiblioteca() {
  const candidatos = [process.env.LKT_HOME, join(REPO, "..", "skill-LKT"), join(homedir(), "skill-LKT")].filter(Boolean);
  const achado = candidatos.find((p) => existsSync(join(p, "tools", "instalar_lkt.py")));
  if (achado) return achado;
  if (CHECK) throw new Error("skill-LKT não encontrado. Rode sem --check para clonar.");
  const alvo = join(homedir(), "skill-LKT");
  console.log(`Clonando skill-LKT em ${alvo}...`);
  run("git", ["clone", "--branch", BRANCH, REMOTE, alvo], { stdio: "inherit" });
  return alvo;
}

function atualizarBiblioteca(lib) {
  const sujo = run("git", ["-C", lib, "status", "--porcelain", "--untracked-files=no"]);
  if (sujo) {
    console.log("! skill-LKT tem alterações locais; não vou puxar atualizações (resolva lá e rode de novo).");
    return;
  }
  run("git", ["-C", lib, "fetch", "origin", "--prune"]);
  const atual = run("git", ["-C", lib, "rev-parse", "--abbrev-ref", "HEAD"]);
  if (atual !== BRANCH) run("git", ["-C", lib, "checkout", BRANCH]);
  run("git", ["-C", lib, "merge", "--ff-only", `origin/${BRANCH}`]);
  console.log(`skill-LKT em ${BRANCH} @ ${run("git", ["-C", lib, "rev-parse", "--short", "HEAD"])}`);
}

function instalarSkills(lib, py) {
  const instalador = join(lib, "tools", "instalar_lkt.py");
  const lista = run(py, ["-I", instalador, "--list"], { cwd: lib });
  const linhas = lista.split(/\r?\n/);
  const i = linhas.findIndex((l) => l.startsWith("Skills aprovadas"));
  const skills = (linhas[i + 1] || "").trim().split(/\s+/).filter(Boolean);
  if (!skills.length) throw new Error("Não consegui ler a lista de skills aprovadas.");

  const instaladas = existsSync(join(REPO, ".lkt", "instalacao.json"));
  const args = ["-I", instalador, "--project", REPO];
  if (CHECK) args.push("--check");
  else if (instaladas) args.push("--update", "--apply");
  // Instalação inicial, ou skills novas que entraram no registro depois.
  const novas = ["--profile", "base", ...skills.flatMap((s) => ["--include", s])];
  if (CHECK || instaladas) {
    resumir(CHECK ? "Skills (check)" : "Skills (update)", run(py, args, { cwd: lib }));
  }
  if (!CHECK) {
    const r2 = run(py, ["-I", instalador, "--project", REPO, ...novas, "--apply"], { cwd: lib });
    resumir("Skills (instalação)", r2);
  }
  console.log(`${skills.length} skills aprovadas no registro.`);
}

function resumir(titulo, saida) {
  const cont = {};
  for (const l of saida.split(/\r?\n/)) {
    const m = l.match(/^([A-Z_]+):/);
    if (m && m[1] !== "Modo") cont[m[1]] = (cont[m[1]] || 0) + 1;
  }
  const alertas = saida.split(/\r?\n/).filter((l) => /^(CONFLITO|EXISTENTE_NAO_GERENCIADA|ERRO)/.test(l));
  console.log(`${titulo}: ${Object.entries(cont).map(([k, v]) => `${v} ${k}`).join(", ") || "nada a fazer"}`);
  alertas.forEach((a) => console.log(`  ! ${a}`));
}

function copiarSemSobrescrever(origem, destino, stats) {
  if (statSync(origem).isDirectory()) {
    if (!existsSync(destino) && !CHECK) mkdirSync(destino, { recursive: true });
    for (const nome of readdirSync(origem)) {
      if (nome === ".DS_Store") continue;
      copiarSemSobrescrever(join(origem, nome), join(destino, nome), stats);
    }
  } else if (existsSync(destino)) {
    stats.mantidos++;
  } else {
    if (!CHECK) copyFileSync(origem, destino);
    stats.novos++;
  }
}

function montarEstrutura(lib) {
  const stats = { novos: 0, mantidos: 0 };
  if (!CHECK) mkdirSync(DESTINO, { recursive: true });
  for (const p of PASTAS) {
    if (existsSync(join(lib, p))) copiarSemSobrescrever(join(lib, p), join(DESTINO, p), stats);
  }
  for (const f of ARQUIVOS_RAIZ) {
    if (existsSync(join(lib, f))) copiarSemSobrescrever(join(lib, f), join(DESTINO, f), stats);
  }
  if (!CHECK) for (const s of SUBPASTAS_VAZIAS) mkdirSync(join(DESTINO, s), { recursive: true });
  console.log(`Estrutura sistema-lkt/: ${stats.novos} arquivo(s) ${CHECK ? "faltando" : "novo(s)"}, ${stats.mantidos} já existente(s) mantido(s).`);
}

try {
  const py = acharPython();
  const lib = acharBiblioteca();
  if (!CHECK) atualizarBiblioteca(lib);
  instalarSkills(lib, py);
  montarEstrutura(lib);
  if (!CHECK) {
    console.log("\nPronto. Recarregue o Claude Code (nova conversa) para carregar as skills.");
    console.log("Skills, .lkt e sistema-lkt ficam fora do Git enquanto o repositório for público (ver .gitignore e docs/agentes/sistema-lkt.md).");
  }
} catch (e) {
  console.error(`Erro: ${e.stderr || e.message}`);
  process.exit(1);
}
