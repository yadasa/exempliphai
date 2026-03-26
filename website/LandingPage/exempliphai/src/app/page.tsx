import { CallToAction } from "@/components/call-to-action";
import { Features } from "@/components/features";
import { HeroSection } from "@/components/hero-section";
import { FAQ } from "@/components/faq";
import { HowItWorks } from "@/components/how-it-works";
import { LogoTicker } from "@/components/logo-ticker";
import { Testimonials } from "@/components/testimonials";

export default function Home() {
  return (
    <>
      <HeroSection />
      <LogoTicker />
      <Features />
      <HowItWorks />
      <Testimonials />
      <FAQ />
      <CallToAction />
    </>
  );
}
