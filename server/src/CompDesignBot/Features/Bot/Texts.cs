namespace CompDesignBot.Features.Bot;

/// <summary>Все пользовательские тексты бота. Разметка — HTML (parse_mode бота).</summary>
public static class Texts
{
    /// <summary>
    /// Сообщение команды /app. Одна строка: смысл не в тексте, а в клавиатуре с
    /// адресом приложения и кодом входа. Совсем без текста Telegram не примет.
    /// </summary>
    public const string OpenApp = "Приложение отдела:";

    /// <summary>Уходит подписью к картинке, поэтому в пределах лимита подписи — 1024 символа.</summary>
    public const string Welcome =
        "Привет!\n\n" +
        "Это бот Отдела вычислительного проектирования IND.\n\n" +
        "Если форма неслучайна и её можно описать логически — мы поможем: " +
        "параметрика, фасадные паттерны, массинг, оптимизация, " +
        "связка Rhino / Grasshopper / Revit.\n\n" +
        "«Решения и заявки» — приложение отдела: карточки задач, готовые решения с инструкциями, поток работ и ваши заявки\n" +
        "«Мои заявки» — статусы того, что вы уже отправили\n\n" +
        "Команды:\n" +
        "/start — перезагрузка бота\n" +
        "/app — кнопка, открывающая приложение\n" +
        "/my — мои заявки\n" +
        "/info — как это работает";

    public const string Info =
        "Как это работает:\n\n" +
        "1. Открываете приложение кнопкой «✦ Решения и заявки» (или командой /app).\n" +
        "2. Листаете карточки задач. Под каждой — то, что отдел уже сделал: кейсы, готовые инструменты, готовые скрипты.\n" +
        "3. Нашли похожее — заберите файлы и инструкцию, это быстрее заявки.\n" +
        "4. Не подходит — оттуда же создаёте задачу: по теме карточки или по конкретному решению. Описание, проект, срок, картинки.\n" +
        "5. Статусы видны в приложении и в «Мои заявки», об изменениях придёт уведомление.\n\n" +
        "Не нужно идеальное ТЗ — достаточно живого описания задачи. Детали уточним в чате.";

    public static string AskDescription(string caseTitle) =>
        $"Задача: <b>{caseTitle}</b>\n\n" +
        "Опишите её свободным текстом: что за проект, какая стадия, " +
        "что хочется получить. Не нужно идеальное ТЗ — пишите как есть.";

    /// <summary>
    /// Уточняющие вопросы под тип задачи — по одному на строку. Хранить одной
    /// строкой и резать по «?» нельзя: у revit знак вопроса внутри фразы.
    /// </summary>
    private static readonly Dictionary<string, string[]> ClarifyingHints = new(StringComparer.Ordinal)
    {
        ["unique"] = ["Сколько элементов и в чём разница между ними?", "Есть исходная геометрия или рисуем с нуля?"],
        ["reference"] = ["Референс — фото, скетч, сайт?", "Что именно неясно: форма или логика повторения рисунка?"],
        ["curved"] = ["Кривизна по всему объёму или локально?", "Есть 3D-модель массинга или пока только идея?"],
        ["revit"] = ["В каком виде сейчас геометрия — Rhino/Grasshopper файл?", "Нужны параметрические семейства или просто чистая топология?"],
        ["repeat"] = ["В скольких местах повторяется и какое именно действие?", "Логика одинаковая везде или зависит от места?"],
        ["variants"] = ["Сколько вариантов нужно и по каким критериям сравнивать?", "Есть дедлайн на решение?"],
        ["physics"] = ["Что считаем — инсоляцию, ветер, пешеходные потоки, шум?", "Нужен отчёт или просто ответ да/нет?"],
        ["custom"] = ["На что похоже из уже знакомого?", "Что уже пробовали сами?"],
    };

    /// <summary>Блок уточняющих вопросов; пустая строка, если для темы их нет.</summary>
    public static string ClarifyingBlock(string caseKey) =>
        ClarifyingHints.TryGetValue(caseKey, out var hints)
            ? "\n\nЧто обычно важно уточнить:\n" + string.Join('\n', hints)
            : "";

    public const string AskPhotos =
        "Теперь приложите картинки: референсы, скрины модели, схемы. " +
        "Можно несколько — отправляйте по одной или альбомом.\n\n" +
        "Если проблема в конкретной части — отметьте её на фото (стрелкой, кружком " +
        "в любом редакторе на телефоне) и пришлите уже с пометкой, так понятнее.\n\n" +
        "Когда закончите — нажмите «Дальше». Если картинок нет — «Пропустить».";

    /// <summary>Заявка пришла заполненной из Mini App — остаются только картинки: файлы через sendData не проходят.</summary>
    public const string AskPhotosFromWebApp =
        "Заявка получена. Осталось приложить картинки: референсы, скрины модели, " +
        "схемы. Можно несколько — по одной или альбомом.\n\n" +
        "Если проблема в конкретной части — отметьте её на фото (стрелкой, кружком) " +
        "и пришлите уже с пометкой, так понятнее.\n\n" +
        "Когда закончите — «Дальше». Если картинок нет — «Пропустить».";

    public const string AskSource =
        "Укажите путь к исходникам на общем диске (папка проекта, модель), " +
        "чтобы отдел сразу нашёл файлы.\n\n" +
        "Если исходников пока нет — нажмите «Пропустить».";

    public const string PreviewHeader = "Проверьте заявку перед отправкой:";

    public static string SentOk(long reqId) =>
        $"Заявка №{reqId} отправлена в отдел ✅\n\n" +
        "Статус можно смотреть в «Мои заявки». Об изменениях придёт уведомление.";

    public static string SentNoDept(long reqId) =>
        $"Заявка №{reqId} создана в Pyrus, но чат отдела ещё не настроен — " +
        "передайте администратору бота команду /id из чата отдела.";

    public const string SentPyrusFailed =
        "Pyrus не ответил — заявка не создана. Нажми «Отправить» ещё раз через минуту.";

    public static string SentDeptFailed(long reqId) =>
        $"Заявка №{reqId} создана в Pyrus, но не удалось отправить её в чат отдела — " +
        "техническая ошибка уже в логах. Напишите в отдел напрямую или попробуйте позже.";

    /// <summary>Совет про /start идёт первым: чаще всего и помогает — обновляет кнопку, код входа и меню.</summary>
    public const string RestartHint = "Отправьте /start — бот обновит кнопку приложения и меню.";

    public const string SessionReset =
        "Эта кнопка из старой сессии — после перезапуска бота черновики сбрасываются.\n" +
        "Заявка оформляется в приложении: кнопка «✦ Решения и заявки» внизу.\n" +
        RestartHint;

    public const string NoRequests =
        "Вы пока не отправляли заявок.\n" +
        "Откройте приложение кнопкой «✦ Решения и заявки» — заявка создаётся оттуда: " +
        "по теме карточки или по готовому решению.";

    public const string Canceled = "Заявка отменена. Черновик удалён.";

    public static string StatusChangedNotify(long reqId, string caseTitle, string status) =>
        $"Статус вашей заявки №{reqId} («{caseTitle}») изменился:\n{status}";

    public static string WatcherStatusNotify(long reqId, string caseTitle, string status) =>
        $"Задача №{reqId} («{caseTitle}»), за которой вы следите:\n{status}";

    public static string AcceptedContactLine(string contact) => $"\n\nЕсли появятся вопросы — можно написать: {contact}";

    public static string DoneContactLine(string contact) => $"\n\nДля связи и передачи решения: {contact}";

    public static string AskClarifyQuestion(long reqId) =>
        $"Заявка №{reqId}: отмечено «Требуется уточнение».\n" +
        "Напиши сюда вопрос заявителю — перешлю ему, ответ придёт в задачу и в эту ветку.";

    public static string ClarifyQuestionSaved(long reqId) => $"Принято — вопрос по заявке №{reqId} отправлен заявителю.";

    public static string ClarifyQuestionNotify(long reqId, string question) =>
        $"Отделу нужно уточнение по заявке №{reqId}:\n{question}\n\n" +
        "Ответить можно в приложении: откройте заявку в «Задачах» — там поле для ответа.";

    public const string ClarifyStatusLine = "\n\nВопрос от отдела придёт следующим сообщением.";

    public static string AskRejectionReason(long reqId) =>
        $"Заявка №{reqId}: отмечено «Отклонена».\n" +
        "Напиши сюда коротко, почему — перешлю автору заявки.";

    public static string RejectionReasonSaved(long reqId) => $"Принято — причина для заявки №{reqId} сохранена.";

    public static string RejectionReasonNotify(long reqId, string reason) => $"Причина отклонения заявки №{reqId}:\n{reason}";

    public const string FeedbackAskComment =
        "Жаль! Если хочешь — напиши прямо сюда, что пошло не так. " +
        "Можно пропустить, если не хочется писать.";

    public const string FeedbackAskReview = "Напиши сюда, что думаешь о работе отдела. Передам как есть.";
    public const string FeedbackCommentThanks = "Спасибо, передал в отдел!";

    public static string FeedbackDeptNote(long reqId, string caseTitle, string label) =>
        $"Заявка №{reqId} · {caseTitle}\nОбратная связь: {label}";

    public static string FeedbackDeptComment(long reqId, string comment) =>
        $"Заявка №{reqId}: отзыв от заявителя — {comment}";

    public const string DescriptionEmpty = "Описание пустое — напишите пару предложений о задаче.";

    public static string DescriptionTooLong(int length, int max) =>
        $"Описание слишком длинное ({length} символов, максимум {max}). " +
        "Сократите, а детали можно будет добавить в чате с отделом.";

    public const string DescriptionWrongType = "Сначала опишите задачу текстом — картинки будут следующим шагом.";
    public const string PhotoAccepted = "Картинка принята. Ещё — или жмите «Дальше».";
    public const string PhotosWrongType = "Пришлите картинку (фото), или жмите «Дальше» / «Пропустить» под сообщением выше.";
    public const string SourceWrongType = "Пришлите путь текстом, или жмите «Пропустить» под сообщением выше.";
    public const string ChooseCase = "Выберите тип задачи:";
    public const string ReasonWrongType = "Пришли причину текстом, пожалуйста.";
    public const string QuestionWrongType = "Пришли вопрос текстом, пожалуйста.";
    public const string FeedbackWrongType = "Пришли отзыв текстом, пожалуйста — или просто не отвечай, это необязательно.";
}
