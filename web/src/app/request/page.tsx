import { Suspense } from "react";
import { RequestForm } from "./_components/request-form";

export default function RequestPage() {
  return (
    <Suspense fallback={<div className="scroll" />}>
      <RequestForm />
    </Suspense>
  );
}
