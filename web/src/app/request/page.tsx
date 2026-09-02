import { Suspense } from "react";
import { RequestEntry } from "./_components/request-entry";

/**
 * Suspense обязателен: `useSearchParams` внутри читает query, а страница
 * пререндерится без него — без границы сборка падает.
 */
export default function RequestPage() {
  return (
    <Suspense fallback={<div className="scroll" />}>
      <RequestEntry />
    </Suspense>
  );
}
