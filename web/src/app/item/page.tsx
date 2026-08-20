import { Suspense } from "react";
import { ItemScreen } from "./_components/item-screen";

/**
 * Suspense обязателен: `useSearchParams` внутри экрана читает query, а при
 * `output: 'export'` страница пререндерится без него — без границы сборка
 * падает.
 */
export default function ItemPage() {
  return (
    <Suspense fallback={<div className="scroll" />}>
      <ItemScreen />
    </Suspense>
  );
}
