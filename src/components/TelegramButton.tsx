import { telegramUrl } from "@/config/site";

type Props = {
  label?: string;
  className?: string;
};

export function TelegramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M21.9 4.3c.3-1.3-.5-1.8-1.4-1.5L2.8 9.6c-1.2.5-1.2 1.2-.2 1.5l4.5 1.4 1.7 5.3c.2.6.4.8.8.8.4 0 .6-.2.9-.4l2.2-2.1 4.6 3.4c.8.5 1.4.2 1.6-.8l3-14.4ZM8 12.2l9.9-6.2c.5-.3.9-.1.5.2l-8.2 7.4-.3 3.4L8 12.2Z" />
    </svg>
  );
}

/** Главная кнопка сайта. Везде одна и та же, чтобы посетитель её узнавал. */
export function TelegramButton({ label = "Написать в Telegram", className = "" }: Props) {
  return (
    <a
      href={telegramUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={`btn btn-primary ${className}`}
    >
      <TelegramIcon className="size-5" />
      {label}
    </a>
  );
}
