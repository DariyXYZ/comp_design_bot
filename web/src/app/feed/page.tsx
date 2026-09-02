import Link from "next/link";
import { PathField } from "@/components/ui/path-field";
import { Screen } from "@/components/layout/screen";
import { ScriptGlyph } from "@/components/ui/script-glyph";
import { FEED, type FeedItem } from "@/features/feed";
import { plural } from "@/lib/plural";
import { requestHref, routes } from "@/config/navigation";

/**
 * Поток отдела: что делается сейчас и что уже сделано.
 *
 * Здесь ничего не оформляют руками — строки приходят из заявок. Поэтому
 * состав строки минимальный: название, проект и путь к папке с файлами.
 * Оформленные материалы с инструкциями живут под темами, а не тут.
 *
 * «В работе» стоит выше «сделано» специально: по этому блоку видно, занят ли
 * отдел и не делают ли уже похожую задачу по тому же проекту.
 *
 * Экран вложенный: в него заходят плашкой «Задачи» из левого верхнего угла
 * главного экрана, обратно — кнопкой «назад». Нижней панели разделов больше
 * нет, её место занято шторкой заявки.
 */
export default function FeedPage() {
  const inWork = FEED.filter((item) => item.status === "in_work");
  const done = FEED.filter((item) => item.status === "done");

  return (
    <Screen
      title="Задачи отдела"
      subtitle="Что в работе, что сделано и где лежат файлы"
      backHref={routes.topics}
    >
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
    </Screen>
  );
}

/**
 * Строка потока: сверху превью с названием, под ними путь к папке во всю
 * ширину. Путь рядом с текстом получал бы треть строки и рвался на три
 * строчки, а он здесь — главная ценность записи.
 */
function FeedRow({ item }: Readonly<{ item: FeedItem }>) {
  const inWork = item.status === "in_work";
  // У задачи в работе даты нет, а слово «в работе» уже стоит в теге — вместо
  // повтора показываем, кто ведёт. Пусто бывает и там и там: исполнитель
  // назначен не везде, а у закрытого разом не записана дата. Пустой строки в
  // разметке при этом быть не должно — она оставляет дырку в ряду тегов.
  const aside = inWork ? (item.owner ? `Ведёт ${item.owner}` : "") : item.when;
  return (
    <article className="feed-card">
      {/* Обложка — во всю ширину строки, а не в узком превью слева: это вид
          проекта, и в колонке 96 пикселей от него оставалась бы вертикальная
          полоска из середины кадра. Превью слева остаётся там, где обложки
          нет, — знак скрипта в него помещается. */}
      {item.cover ? (
        // Обычный img, а не next/image: оптимизатор в проекте выключен
        // (см. next.config.ts), а картинка уже сжата под этот размер.
        // eslint-disable-next-line @next/next/no-img-element
        <img className="feed-cover" src={item.cover} alt="" loading="lazy" decoding="async" />
      ) : null}
      <div className="feed-top">
        {item.cover ? null : (
          <div className="row-thumb">
            <ScriptGlyph className="glyph" />
          </div>
        )}
        <div className="row-text">
          <div className="row-meta">
            <span className={inWork ? "tag tag-work" : "tag"}>
              {inWork ? "В работе" : "Готово"}
            </span>
            {aside ? <span className="row-dim">{aside}</span> : null}
          </div>
          <h3>{item.title}</h3>
          <p>{item.project}</p>
        </div>
      </div>
      <PathField path={item.files} />
    </article>
  );
}
