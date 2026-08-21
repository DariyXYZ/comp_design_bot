import Link from "next/link";
import { PathField } from "@/components/ui/path-field";
import { ScriptGlyph } from "@/components/ui/script-glyph";
import { FEED, type FeedItem } from "@/features/feed";
import { plural } from "@/lib/plural";
import { requestHref } from "@/config/navigation";

/**
 * Поток отдела: что делается сейчас и что уже сделано.
 *
 * Здесь ничего не оформляют руками — строки приходят из заявок. Поэтому
 * состав строки минимальный: название, проект и путь к папке с файлами.
 * Оформленные материалы с инструкциями живут под темами, а не тут.
 *
 * «В работе» стоит выше «сделано» специально: по этому блоку видно, занят ли
 * отдел и не делают ли уже похожую задачу по тому же проекту.
 */
export default function FeedPage() {
  const inWork = FEED.filter((item) => item.status === "in_work");
  const done = FEED.filter((item) => item.status === "done");

  return (
    <div className="scroll">
      <header className="topics-head">
        <h1>Поток отдела</h1>
        <div className="brand">Задачи и файлы по ним</div>
      </header>

      <div className="load-line">
        <strong>Берём новые задачи</strong>
        <span>
          Ответим за 1–2 дня · {inWork.length}{" "}
          {plural(inWork.length, ["задача", "задачи", "задач"])} в работе
        </span>
      </div>

      <section className="section">
        <div className="section-head">
          <h2>Сейчас в работе</h2>
          <span className="count">{inWork.length}</span>
        </div>
        <div className="rows">
          {inWork.map((item) => (
            <FeedRow key={item.id} item={item} />
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Сделано</h2>
          <span className="count">{done.length}</span>
        </div>
        <div className="rows">
          {done.map((item) => (
            <FeedRow key={item.id} item={item} />
          ))}
        </div>
      </section>

      <p className="feed-foot">
        Заявка создаётся из темы или из готового материала — так у неё сразу
        есть контекст. Если задача ни на что не похожа:{" "}
        <Link
          href={requestHref({
            topic: "custom",
            topicTitle: "Нетиповая или разовая задача",
          })}
        >
          нетиповая задача
        </Link>
        .
      </p>
    </div>
  );
}

/**
 * Строка потока: сверху превью с названием, под ними путь к папке во всю
 * ширину. Путь рядом с текстом получал бы треть строки и рвался на три
 * строчки, а он здесь — главная ценность записи.
 */
function FeedRow({ item }: Readonly<{ item: FeedItem }>) {
  const inWork = item.status === "in_work";
  return (
    <article className="feed-card">
      <div className="feed-top">
        <div className="row-thumb">
          <ScriptGlyph className="glyph" />
        </div>
        <div className="row-text">
          <div className="row-meta">
            <span className={inWork ? "tag tag-work" : "tag"}>
              {inWork ? "В работе" : "Готово"}
            </span>
            {/* У задачи в работе даты в данных нет, а слово «в работе» уже
                стоит в теге — вместо повтора показываем, кто ведёт. */}
            <span className="row-dim">
              {inWork ? (item.owner ? `Ведёт ${item.owner}` : "") : item.when}
            </span>
          </div>
          <h3>{item.title}</h3>
          <p>{item.project}</p>
        </div>
      </div>
      <PathField path={item.files} />
    </article>
  );
}
