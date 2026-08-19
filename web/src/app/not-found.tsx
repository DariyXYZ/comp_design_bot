import Link from "next/link";

/**
 * Mini App — один экран, так что сюда попадают только опечатки в адресе
 * (или старая ссылка, если появятся вложенные маршруты).
 */
export default function NotFound() {
  return (
    <div className="fallback">
      <h1>Страница не найдена</h1>
      <p>Такого адреса нет. Откройте витрину задач заново.</p>
      <Link className="cta" href="/">
        <span className="cta-label">К списку задач</span>
      </Link>
    </div>
  );
}
