"use client";
import { forwardRef } from "react";
import { motion } from "framer-motion";
import { R } from "../_lib/tokens";

export const RecAbout = forwardRef<HTMLDivElement, { isMobile: boolean }>(function RecAbout({ isMobile }, ref) {
  return (
    <section ref={ref} style={{ position: "relative" }}>
      <div style={{ maxWidth: "1300px", margin: "0 auto", padding: isMobile ? "4rem 2rem" : "5.5rem 2rem" }}>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: .8, ease: [0.16, 1, 0.3, 1] }}
          style={{ maxWidth: "620px" }}
        >
          <p style={{ ...R.mono, fontSize: ".54rem", letterSpacing: ".2em", textTransform: "uppercase", color: R.red, marginBottom: ".8rem" }}>[Produtora]</p>
          <h2 style={{ ...R.display, fontSize: "clamp(1.8rem,3.4vw,2.6rem)", fontWeight: 600, color: R.text, lineHeight: 1.04, marginBottom: "1.4rem" }}>
            Somos a frente audiovisual da LOKAT.
          </h2>
          <p style={{ ...R.grotesk, fontSize: ".95rem", lineHeight: 1.75, color: R.muted }}>
            Filmamos marcas locais com olhar de campanha — roteiro, direção, captação e edição sob o mesmo comando. Baseados em Floriano — PI.
          </p>
        </motion.div>
      </div>
    </section>
  );
});
