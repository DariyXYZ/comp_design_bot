import { CaseDeck } from "./_components/case-deck";

export default function HomePage() {
  return (
    <>
      <header>
        <h1>Когда звать нас</h1>
        <div className="brand">Отдел вычислительного проектирования</div>
      </header>
      <CaseDeck />
    </>
  );
}
