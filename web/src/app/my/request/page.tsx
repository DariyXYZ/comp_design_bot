import { Suspense } from "react";
import { RequestCard } from "./_components/request-card";

export default function MyRequestPage() {
  return (
    <Suspense fallback={<div className="scroll" />}>
      <RequestCard />
    </Suspense>
  );
}
