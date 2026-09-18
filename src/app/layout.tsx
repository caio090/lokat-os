import type { Metadata, Viewport } from "next";
import "./globals.css";

export const dynamic = "force-dynamic";

/**
 * Sprint REC OS 3.0.1 (Fase 29/37): esta exportação nunca existiu — o app
 * inteiro renderizava sem NENHUMA tag <meta name="viewport">, confirmado
 * ao vivo (`curl http://127.0.0.1:3100/` não retornava a tag). Sem ela, o
 * navegador mobile assume a largura de desktop e escala tudo para caber,
 * exigindo zoom manual — a causa raiz mais provável, sozinha, de boa parte
 * dos sintomas mobile reportados nesta sprint (conteúdo cortado, cards
 * maiores que a viewport, zoom necessário após o login).
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  metadataBase: new URL("https://www.lokat.com.br"),
  title: {
    default:  "LOKAT OS — Organize marketing, clientes, produção e resultados",
    template: "%s | LOKAT OS",
  },
  description:
    "LOKAT OS conecta estratégia, conteúdo, operação, CRM, dados e integrações para empresas, agências e equipes trabalharem com mais clareza e resultado.",
  keywords: [
    "sistema operacional de marketing", "plataforma de marketing", "CRM para agências",
    "gestão de marketing", "automação de marketing", "negócios locais",
    "agência de marketing", "gestão de conteúdo", "relatórios de marketing",
    "diagnóstico de marketing", "Cardápio Digital", "integração Meta",
  ],
  alternates: {
    canonical: "https://www.lokat.com.br",
  },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
  },
  openGraph: {
    title:       "LOKAT OS — Organize marketing, clientes, produção e resultados",
    description: "LOKAT OS conecta estratégia, conteúdo, operação, CRM, dados e integrações para empresas, agências e equipes.",
    url:         "https://www.lokat.com.br",
    siteName:    "LOKAT OS",
    locale:      "pt_BR",
    type:        "website",
  },
  twitter: {
    card:        "summary_large_image",
    title:       "LOKAT OS — Organize marketing, clientes, produção e resultados",
    description: "Conecte estratégia, conteúdo, operação, CRM, dados e integrações em uma plataforma.",
  },
  robots: {
    index:  true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="h-full">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Mono:ital,wght@0,400;0,700;1,400&family=Space+Grotesk:wght@300;400;500;600;700&family=Fredoka+One&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="h-full antialiased">{children}</body>
    </html>
  );
}
