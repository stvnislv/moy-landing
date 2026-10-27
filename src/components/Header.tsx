"use client";

import { useEffect, useState } from "react";
import { site } from "@/config/site";
import { TelegramButton } from "./TelegramButton";

const links = [
  { href: "#about", label: "Обо мне" },
  { href: "#services", label: "Услуги" },
  ...(site.showPortfolio ? [{ href: "#portfolio", label: "Работы" }] : []),
  { href: "#contacts", label: "Контакты" },
];

export function Header() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className="fixed inset-x-0 top-0 z-50 px-4 pt-3 sm:px-6">
      <div className="glass mx-auto flex h-14 max-w-[1200px] items-center justify-between rounded-full pr-1.5 pl-5">
        <a href="#top" className="text-[1.0625rem] font-medium tracking-tight">
          {site.name}
        </a>

        <nav aria-label="Разделы" className="hidden items-center gap-1 md:flex">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-full px-4 py-2 text-[0.9375rem] text-ink/80 transition-colors hover:bg-white/70 hover:text-ink"
            >
              {link.label}
            </a>
          ))}
          <TelegramButton label="Написать" className="ml-2" />
        </nav>

        <button
          type="button"
          className="glass flex size-11 items-center justify-center rounded-full md:hidden"
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={open ? "Закрыть меню" : "Открыть меню"}
          onClick={() => setOpen((v) => !v)}
        >
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
            {open ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 8h16M4 16h16" />}
          </svg>
        </button>
      </div>

      {open && (
        <nav
          id="mobile-menu"
          aria-label="Разделы"
          className="glass mx-auto mt-2 flex max-w-[1200px] flex-col rounded-[1.75rem] p-2 md:hidden"
        >
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="rounded-2xl px-4 py-3.5 text-lg hover:bg-white/70"
            >
              {link.label}
            </a>
          ))}
          <TelegramButton className="mt-2 w-full" />
        </nav>
      )}
    </header>
  );
}
