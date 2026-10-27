import { nbsp, site } from "@/config/site";
import { SectionTitle } from "./SectionTitle";
import { TelegramButton } from "./TelegramButton";

export function Contacts() {
  const { title, text, note } = site.contacts;

  return (
    <section id="contacts" aria-labelledby="contacts-title" className="py-16 sm:py-24">
      <div className="glass rounded-[2rem] px-6 py-10 sm:px-12 sm:py-16">
        <SectionTitle id="contacts-title">{title}</SectionTitle>
        <p className="mt-4 max-w-[34rem] text-lg leading-relaxed text-muted sm:text-xl">{nbsp(text)}</p>
        <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
          <TelegramButton />
          <span className="text-muted">{note}</span>
        </div>
      </div>
    </section>
  );
}
