import { nbsp, site } from "@/config/site";
import { TelegramButton } from "./TelegramButton";

export function Hero() {
  return (
    <section className="intro pt-28 pb-20 sm:pt-40 sm:pb-28">
      <h1 className="text-[clamp(2.5rem,8.4vw,7.5rem)] leading-[0.98] font-light tracking-[-0.035em]">
        {site.name}:
        <br />
        {nbsp(site.role)}
      </h1>
      <p className="mt-6 max-w-[34rem] text-lg leading-relaxed text-muted sm:mt-8 sm:text-xl">
        {nbsp(site.hero.subtitle)}
      </p>
      <div className="mt-8 flex flex-wrap gap-3 sm:mt-10">
        <TelegramButton />
        <a href="#services" className="glass btn">
          Цены
        </a>
      </div>
    </section>
  );
}
