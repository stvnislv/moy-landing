export function SectionTitle({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="text-[clamp(2rem,4.5vw,3.5rem)] leading-[1.05] font-light tracking-[-0.03em]">
      {children}
    </h2>
  );
}
