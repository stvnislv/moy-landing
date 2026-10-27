import { About } from "@/components/About";
import { Contacts } from "@/components/Contacts";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { Hero } from "@/components/Hero";
import { Portfolio } from "@/components/Portfolio";
import { Services } from "@/components/Services";

export default function Home() {
  return (
    <>
      <Header />
      <div id="top" className="mx-auto max-w-[1200px] px-4 sm:px-6">
        <main>
          <Hero />
          <About />
          <Services />
          <Portfolio />
          <Contacts />
        </main>
        <Footer />
      </div>
    </>
  );
}
