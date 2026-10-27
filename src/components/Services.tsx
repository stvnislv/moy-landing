import { formatPrice, nbsp, site } from "@/config/site";
import { SectionTitle } from "./SectionTitle";

export function Services() {
  return (
    <section id="services" aria-labelledby="services-title" className="py-16 sm:py-24">
      <SectionTitle id="services-title">Услуги и цены</SectionTitle>
      <ul className="mt-10 grid gap-4 sm:mt-12 lg:grid-cols-3 lg:gap-5">
        {site.services.map((service) => (
          <li key={service.title} className="glass flex flex-col rounded-[1.75rem] p-7 sm:p-8">
            <h3 className="text-xl font-medium tracking-tight">{service.title}</h3>
            <p className="mt-2 leading-relaxed text-muted">{nbsp(service.description)}</p>
            <p className="mt-auto pt-8 text-[2rem] leading-none font-light tracking-[-0.03em] whitespace-nowrap">
              {formatPrice(service.priceFrom)}
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-6 text-muted">Точную цену назову, когда узнаю задачу.</p>
    </section>
  );
}
