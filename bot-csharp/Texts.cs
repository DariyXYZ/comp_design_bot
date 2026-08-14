namespace CompDesignBot;

public sealed record CaseInfo(string Title, string Hint, string Eta);

// Порт texts.py — все пользовательские тексты бота, дословно. Кейсы — из
// чек-листа отдела (8 карточек). Порядок важен: используется при построении
// клавиатуры выбора задачи и клавиатуры статусов (2 в ряд).
public static class Texts
{
    public static readonly (string Key, CaseInfo Info)[] CaseOrder =
    {
        ("unique", new CaseInfo(
            "Много уникальных элементов",
            "Панели, ламели или МАФы не повторяются один в один — руками это дни рутины.",
            "2–3 дня")),
        ("reference", new CaseInfo(
            "Есть задумка, но неясно как собрать",
            "Референс со сложной формой или паттерном, где рисунок меняется по правилу.",
            "2–3 дня")),
        ("curved", new CaseInfo(
            "Форма здания криволинейная",
            "Объём или фасад не плоский: кривизна целиком или локально.",
            "2–3 дня")),
        ("revit", new CaseInfo(
            "Геометрию нужно передать в Revit",
            "Форма из Rhino/Grasshopper должна жить в Revit — семействами, с чистой топологией.",
            "1–2 дня")),
        ("repeat", new CaseInfo(
            "Действие повторяется по всему проекту",
            "Расстановка, разбивка, подрезка — в десятках мест, при правках всё заново.",
            "1 день")),
        ("variants", new CaseInfo(
            "Нужно перебрать много вариантов",
            "Десятки вариантов паттерна, массинга или панелизации, решение нужно быстро.",
            "1–2 дня")),
        ("physics", new CaseInfo(
            "Нужно просчитать физику проекта",
            "Инсоляция, ветер, пешеходные потоки, шум — осознанно, а не на глаз.",
            "1–2 дня")),
        ("custom", new CaseInfo(
            "Нетиповая или разовая задача",
            "Не попадает в пункты выше: чистка геометрии, скан, графика на 3D-форму, новое.",
            "по договорённости")),
    };

    public static readonly Dictionary<string, CaseInfo> Cases =
        CaseOrder.ToDictionary(x => x.Key, x => x.Info);

    public static readonly (string Key, string Label)[] StatusOrder =
    {
        ("new", "⏸️ На паузе"),
        ("accepted", "👀 Принята"),
        ("in_progress", "⚙️ В работе"),
        ("done", "✅ Готово"),
        ("rejected", "❌ Отклонена"),
    };

    public static readonly Dictionary<string, string> Statuses =
        StatusOrder.ToDictionary(x => x.Key, x => x.Label);

    public const string Welcome =
        "Привет! Это бот Отдела вычислительного проектирования IND.\n\n" +
        "Если форма неслучайна и её можно описать логически — мы поможем: " +
        "параметрика, фасадные паттерны, массинг, оптимизация, связка Rhino/Grasshopper/Revit.\n\n" +
        "• «Возможности отдела» — карточки типовых задач с примерами\n" +
        "• «Создать заявку» — описать задачу и отправить в отдел\n" +
        "• «Мои заявки» — статусы того, что вы уже отправили\n\n" +
        "Меньше руками — больше мозгами + AI 🙂";

    public const string Info =
        "Как это работает:\n\n" +
        "1. Выбираете тип задачи (или «Нетиповая задача», если не подходит ни один).\n" +
        "2. Описываете задачу свободным текстом — что за проект, что хочется получить.\n" +
        "3. Прикладываете картинки: референсы, скрины, схемы (можно пропустить).\n" +
        "4. Указываете путь к исходникам на общем диске (можно пропустить).\n" +
        "5. Заявка уходит в отдел — статус будет виден в «Мои заявки», об изменениях придёт уведомление.\n\n" +
        "Не нужно идеальное ТЗ — достаточно живого описания задачи. Детали уточним в чате.";

    public static string AskDescription(string caseTitle) =>
        $"Задача: <b>{caseTitle}</b>\n\n" +
        "Опишите её свободным текстом: что за проект, какая стадия, " +
        "что хочется получить. Не нужно идеальное ТЗ — пишите как есть.";

    public const string AskPhotos =
        "Теперь приложите картинки: референсы, скрины модели, схемы. " +
        "Можно несколько — отправляйте по одной или альбомом.\n\n" +
        "Когда закончите — нажмите «Дальше». Если картинок нет — «Пропустить».";

    public const string AskSource =
        "Укажите путь к исходникам на общем диске (папка проекта, модель), " +
        "чтобы отдел сразу нашёл файлы.\n\n" +
        "Если исходников пока нет — нажмите «Пропустить».";

    public const string PreviewHeader = "Проверьте заявку перед отправкой:";

    public static string SentOk(long reqId) =>
        $"Заявка №{reqId} отправлена в отдел ✅\n\n" +
        "Статус можно смотреть в «Мои заявки». Об изменениях придёт уведомление.";

    public static string SentNoDept(long reqId) =>
        $"Заявка №{reqId} сохранена, но чат отдела ещё не настроен — " +
        "передайте администратору бота команду /id из чата отдела.";

    public static string SentDeptFailed(long reqId) =>
        $"Заявка №{reqId} сохранена, но не удалось отправить её в чат отдела — " +
        "техническая ошибка уже в логах. Напишите в отдел напрямую или попробуйте позже.";

    public const string SessionReset =
        "Эта кнопка из старой сессии — после перезапуска бота черновики сбрасываются.\n" +
        "Начните заново: «Создать заявку».";

    public const string NoRequests = "Вы пока не отправляли заявок. Нажмите «Создать заявку», чтобы начать.";

    public const string Canceled = "Заявка отменена. Черновик удалён.";

    public static string StatusChangedNotify(long reqId, string caseTitle, string status) =>
        $"Статус вашей заявки №{reqId} («{caseTitle}») изменился:\n{status}";

    public static string AskActorContact(string name, long reqId) =>
        $"{name}, у тебя не указан юзернейм в Telegram — автору заявки №{reqId} " +
        "не с кем будет связаться.\n" +
        "Напиши сюда свой контакт (юзернейм/телефон) — подставлю его.";

    public static string ActorContactSaved(long reqId, string contact) =>
        $"Принято — контакт для заявки №{reqId} сохранён: {contact}";

    public static string AcceptedContactLine(string contact) =>
        $"\n\nЕсли появятся вопросы — можно написать: {contact}";

    public static string DoneContactLine(string contact) =>
        $"\n\nДля связи и передачи решения: {contact}";

    public const string DoneContactUnknown = "\n\nИсполнитель не зафиксирован — уточните в чате отдела.";

    public static string ContactLateNotify(long reqId, string contact) =>
        $"По заявке №{reqId} появился контакт для связи: {contact}";

    public static string AskRejectionReason(long reqId) =>
        $"Заявка №{reqId}: отмечено «Отклонена».\n" +
        "Напиши сюда коротко, почему — перешлю автору заявки.";

    public static string RejectionReasonSaved(long reqId) =>
        $"Принято — причина для заявки №{reqId} сохранена.";

    public static string RejectionReasonNotify(long reqId, string reason) =>
        $"Причина отклонения заявки №{reqId}:\n{reason}";

    public const string FeedbackAskComment =
        "Жаль! Если хочешь — напиши прямо сюда, что пошло не так. " +
        "Можно пропустить, если не хочется писать.";

    public const string FeedbackAskReview = "Напиши сюда, что думаешь о работе отдела. Передам как есть.";

    public const string FeedbackCommentThanks = "Спасибо, передал в отдел!";

    public static string FeedbackDeptNote(long reqId, string caseTitle, string label) =>
        $"Заявка №{reqId} · {caseTitle}\nОбратная связь: {label}";

    public static string FeedbackDeptComment(long reqId, string comment) =>
        $"Заявка №{reqId}: отзыв от заявителя — {comment}";
}
