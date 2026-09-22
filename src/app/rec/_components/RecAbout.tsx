"use client";
import { forwardRef } from "react";
import { motion } from "framer-motion";
import { R } from "../_lib/tokens";

export const RecAbout = forwardRef<HTMLDivElement, { isMobile: boolean }>(function RecAbout({ isMobile }, ref) {
  return (
    <section ref={ref} style={{ position: "relative" }}>
      <div style={{ maxWidth: "1300px", margin: "0 auto", padding: isMobile ? "4rem 2rem" : "5.5rem 2rem", display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, .9fr) minmax(320px, .72fr)", gap: isMobile ? "2.4rem" : "5rem", alignItems: "center" }}>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: .8, ease: [0.16, 1, 0.3, 1] }}
          style={{ maxWidth: "620px", order: isMobile ? 1 : 0 }}
        >
          <p style={{ ...R.mono, fontSize: ".54rem", letterSpacing: ".2em", textTransform: "uppercase", color: R.red, marginBottom: ".8rem" }}>[Produtora]</p>
          <h2 style={{ ...R.display, fontSize: "clamp(1.8rem,3.4vw,2.6rem)", fontWeight: 600, color: R.text, lineHeight: 1.04, marginBottom: "1.4rem" }}>
            A frente audiovisual da LOKAT, feita por gente.
          </h2>
          <p style={{ ...R.grotesk, fontSize: ".95rem", lineHeight: 1.75, color: R.muted }}>
            A equipe pensa, dirige, filma e finaliza cada projeto com olhar de campanha. Não é só captação: existe processo, direção e linguagem para transformar a história de marcas locais em peças que se movimentam.
          </p>
          <p style={{ ...R.mono, fontSize: ".52rem", lineHeight: 1.6, letterSpacing: ".12em", textTransform: "uppercase", color: R.red, marginTop: "1.2rem" }}>
            Floriano — PI · Roteiro · Direção · Edição
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.25 }}
          transition={{ duration: .8, delay: .08, ease: [0.16, 1, 0.3, 1] }}
          style={{ order: isMobile ? 0 : 1, position: "relative", padding: "2px", borderRadius: "6px", background: `linear-gradient(145deg, ${R.red}, rgba(139,23,26,.18) 34%, transparent 72%)`, boxShadow: "0 0 0 1px rgba(139,23,26,.28), 0 12px 36px rgba(139,23,26,.14)" }}
        >
          <div style={{ position: "relative", overflow: "hidden", borderRadius: "4px", background: R.warm }}>
            <div style={{ position: "absolute", inset: "-18%", background: `radial-gradient(ellipse at 12% 18%, rgba(139,23,26,.34), transparent 38%), radial-gradient(ellipse at 88% 84%, rgba(139,23,26,.22), transparent 42%)`, mixBlendMode: "screen", pointerEvents: "none", zIndex: 1 }} />
            {/* Foto real da equipe, otimizada em WebP para a seção pública da REC. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/rec/about/equipe.webp" alt="Equipe da LOKAT.REC" loading="lazy" style={{ display: "block", width: "100%", aspectRatio: "0.83", objectFit: "cover", objectPosition: "center", filter: "saturate(.92) contrast(1.03)" }} />
          </div>
        </motion.div>
      </div>
    </section>
  );
});
