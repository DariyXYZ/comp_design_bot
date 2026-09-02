/**
 * Маршруты Mini App в одном месте.
 *
 * Пути со слэшем на конце — в `next.config.ts` включён `trailingSlash`, и при
 * статическом экспорте каждый экран лежит как `<путь>/index.html`.
 *
 * Контекст (какая тема выбрана, из какого материала пришли) едет в
 * query-параметрах, а не в состоянии на клиенте: перезагрузка фрейма Telegram
 * не должна терять место в потоке, а ссылку на экран можно дать словами.
 */
export const routes = {
  /** Темы отдела: колода карточек и материалы под текущей карточкой. */
  topics: "/",
  /** Оформленный материал: кейс, инструмент или модуль. */
  item: "/item/",
  /**
   * Прямая ссылка на заявку с контекстом.
   *
   * Экрана за этим адресом больше нет: заявка живёт шторкой над главным
   * экраном. Маршрут остался входом снаружи — он кладёт контекст в черновик и
   * уводит на главный, где шторка открывается уже заполненной основой.
   */
  request: "/request/",
  /** Поток отдела: что в работе и что сделано, со ссылками на папки. */
  feed: "/feed/",
  /** Свои заявки и подписки. */
  myRequests: "/my/",
  /** Карточка заявки: вехи и действия. */
  myRequest: "/my/request/",
} as const;

function withQuery(path: string, params: Record<string, string | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value);
  }
  const qs = query.toString();
  return qs ? `${path}?${qs}` : path;
}

/** Экран материала. */
export function itemHref(id: string) {
  return withQuery(routes.item, { id });
}

/**
 * Заявка с готовым контекстом.
 *
 * Ровно два входа, и оба с контекстом: из темы (заявка по теме) или из
 * материала (заявка по этому кейсу/инструменту). Заявки без контекста в
 * приложении нет — иначе отдел получает заявку, о которой нечего сказать
 * заранее.
 *
 * Внутри приложения основу кладут прямо в черновик (`useRequestDraft`), а этот
 * адрес нужен там, где перехода в обход маршрутизатора не выйдет: ссылка в
 * тексте, сообщение бота, закладка.
 */
export function requestHref(
  origin: { topic: string; topicTitle: string } | { item: string },
) {
  return "item" in origin
    ? withQuery(routes.request, { item: origin.item })
    : withQuery(routes.request, { topic: origin.topic, t: origin.topicTitle });
}

/** Карточка заявки. */
export function myRequestHref(id: string) {
  return withQuery(routes.myRequest, { id });
}

/** Сравнение маршрутов без разницы в слэше на конце. */
export function isSameRoute(pathname: string, route: string): boolean {
  const strip = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") : p);
  return strip(pathname) === strip(route);
}
