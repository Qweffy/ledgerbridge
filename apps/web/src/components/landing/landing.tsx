/* The public marketing landing page (served at `/`). Composes the 8 sections in
   the bundle's order. Ported from landing/app.jsx. */
import { Architecture } from "./architecture";
import { CTA, Footer, Reliability, TechStack } from "./closing";
import { LiveSync } from "./live-sync";
import { Hero, Nav } from "./top";

export function LandingPage() {
  return (
    <div style={{ background: "var(--surface-canvas)", minHeight: "100%" }}>
      <Nav />
      <Hero />
      <LiveSync />
      <Architecture />
      <Reliability />
      <TechStack />
      <CTA />
      <Footer />
    </div>
  );
}
