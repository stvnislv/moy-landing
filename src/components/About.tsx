import Image from "next/image";
import { nbsp, site } from "@/config/site";
import { SectionTitle } from "./SectionTitle";

export function About() {
  const { photo, paragraphs } = site.about;

  return (
    <section id="about" aria-labelledby="about-title" className="grid gap-10 py-16 sm:py-24 md:grid-cols-[1fr_1.4fr] md:gap-16">
      <div className="flex items-center gap-6 md:flex-col md:items-start md:gap-10">
        <SectionTitle id="about-title">Обо мне</SectionTitle>
        <div className="glass relative size-24 shrink-0 overflow-hidden rounded-full md:size-40">
          {photo ? (
            <Image src={photo} alt={site.name} fill sizes="160px" className="object-cover" />
          ) : (
            <span aria-hidden="true" className="flex size-full items-center justify-center text-3xl font-light text-accent md:text-5xl">
              {site.initials}
            </span>
          )}
        </div>
      </div>
      <div className="max-w-[38rem] space-y-5 text-lg leading-relaxed sm:text-xl md:pt-2">
        {paragraphs.map((text) => (
          <p key={text}>{nbsp(text)}</p>
        ))}
      </div>
    </section>
  );
}
