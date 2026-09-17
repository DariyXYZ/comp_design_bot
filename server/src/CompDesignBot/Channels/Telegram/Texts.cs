namespace CompDesignBot.Channels.Telegram;

/// <summary>Все тексты бота. Разметка — HTML (parse_mode бота).</summary>
public static class Texts
{
    /// <summary>
    /// Сообщение с кнопкой приложения. Одна строка: смысл в кнопке, совсем без
    /// текста Telegram сообщение не примет.
    /// </summary>
    public const string OpenApp = "Приложение отдела:";

    /// <summary>Уходит подписью к картинке, поэтому в пределах лимита подписи — 1024 символа.</summary>
    public const string Welcome =
        "Привет!\n\n" +
        "Это бот Отдела вычислительного проектирования IND.\n\n" +
        "Если форма неслучайна и её можно описать логически — мы поможем: " +
        "параметрика, фасадные паттерны, массинг, оптимизация, " +
        "связка Rhino / Grasshopper / Revit.\n\n" +
        "Всё — в приложении «Решения и заявки»: карточки задач, готовые решения с инструкциями, " +
        "поток работ отдела, ваши заявки и их статусы. Заявка создаётся там же.\n\n" +
        "Сюда бот пишет только уведомления: изменился статус, отдел задал вопрос, работа готова.";

    /// <summary>Любой текст в личке, кроме команд: заявки в чате больше нет.</summary>
    public const string UseApp =
        "Заявки, статусы и переписка по ним — в приложении. Откройте его кнопкой ниже.";

    /// <summary>Устаревшая кнопка (из сообщения до переезда или после рестарта).</summary>
    public const string StaleButton =
        "Эта кнопка устарела. Откройте приложение — там всё актуальное.";

    public static string AskClarifyQuestion(long reqId) =>
        $"Заявка №{reqId}: отмечено «Требуется уточнение».\n" +
        "Напиши сюда вопрос заявителю — перешлю ему, ответ придёт в задачу и в эту ветку.";

    public static string ClarifyQuestionSaved(long reqId) => $"Принято — вопрос по заявке №{reqId} отправлен заявителю.";

    public static string AskRejectionReason(long reqId) =>
        $"Заявка №{reqId}: отмечено «Отклонена».\n" +
        "Напиши сюда коротко, почему — перешлю автору заявки.";

    public static string RejectionReasonSaved(long reqId) => $"Принято — причина для заявки №{reqId} сохранена.";

    public const string FeedbackAskComment =
        "Жаль! Если хочешь — напиши прямо сюда, что пошло не так. " +
        "Можно пропустить, если не хочется писать.";

    public const string FeedbackAskReview = "Напиши сюда, что думаешь о работе отдела. Передам как есть.";
    public const string FeedbackCommentThanks = "Спасибо, передал в отдел!";

    public const string ReasonWrongType = "Пришли причину текстом, пожалуйста.";
    public const string QuestionWrongType = "Пришли вопрос текстом, пожалуйста.";
    public const string FeedbackWrongType = "Пришли отзыв текстом, пожалуйста — или просто не отвечай, это необязательно.";
    public const string PyrusUnavailable = "Pyrus не ответил — попробуй ещё раз через минуту.";
}
