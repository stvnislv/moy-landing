import { site, telegramUrl } from "@/config/site";

export function Footer() {
  return (
    <footer className="flex flex-wrap justify-between gap-x-6 gap-y-2 pt-6 pb-10 text-muted">
      <p>
        © {new Date().getFullYear()} {site.name}
      </p>
      <a href={telegramUrl} target="_blank" rel="noopener noreferrer" className="hover:text-accent">
        Telegram: @{site.telegram}
      </a>
    </footer>
  );
}
