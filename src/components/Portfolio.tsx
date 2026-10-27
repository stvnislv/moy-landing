import Image from "next/image";
import { site } from "@/config/site";
import { SectionTitle } from "./SectionTitle";

/** Раздел «Работы». Показывается, когда в конфиге showPortfolio: true. */
export function Portfolio() {
  if (!site.showPortfolio || site.portfolio.length === 0) return null;

  return (
    <section id="portfolio" aria-labelledby="portfolio-title" className="py-16 sm:py-24">
      <SectionTitle id="portfolio-title">Работы</SectionTitle>
      <ul className="mt-10 grid gap-5 sm:mt-12 md:grid-cols-2">
        {site.portfolio.map((work) => (
          <li key={work.title} className="glass overflow-hidden rounded-[1.75rem]">
            {work.image && (
              <div className="relative aspect-[16/10]">
                <Image src={work.image} alt="" fill sizes="(min-width: 768px) 50vw, 100vw" className="object-cover" />
              </div>
            )}
            <div className="p-7 sm:p-8">
              <h3 className="text-xl font-medium tracking-tight">{work.title}</h3>
              <p className="mt-2 leading-relaxed text-muted">{work.description}</p>
              {work.url && (
                <a href={work.url} target="_blank" rel="noopener noreferrer" className="mt-4 inline-block font-medium text-accent underline-offset-4 hover:underline">
                  Открыть сайт
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
