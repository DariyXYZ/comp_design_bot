namespace CompDesignBot.Features.Requests;

/// <summary>
/// Действия по существующей заявке из кабинета Mini App. Все они — запись в
/// разговор по заявке двумя адресами сразу: комментарием в задачу Pyrus и
/// сообщением в чат отдела. Отличаются формулировкой и тем, меняют ли
/// состояние задачи. Чистая функция, а не пять маршрутов — иначе одно из
/// действий однажды забудут довести до Pyrus или до чата.
/// </summary>
public static class RequestActions
{
    public static readonly string[] All = ["note", "answer", "accept", "rework", "cancel"];

    /// <summary>Pyrus и Telegram примут больше, но простыня в реестре бесполезна.</summary>
    public const int MessageLimit = 1500;

    public sealed record Plan(string Comment, string Chat, string? Action = null, string? Status = null);

    public sealed record Ref(long Number, string? Topic, string Author);

    public static bool IsAction(string? value) => value is not null && Array.IndexOf(All, value) >= 0;

    public static bool NeedsText(string action) => action is "note" or "answer" or "rework";

    /// <summary>
    /// Что именно записать. <c>null</c> — действию нужен текст, а его не дали:
    /// молча отправлять пустое «вернул на доработку» нельзя.
    /// </summary>
    public static Plan? Build(string action, Ref request, string text)
    {
        var message = text.Trim();
        if (message.Length > MessageLimit)
        {
            message = message[..MessageLimit];
        }

        if (NeedsText(action) && message.Length == 0)
        {
            return null;
        }

        var head = $"Заявка №{request.Number}" + (string.IsNullOrEmpty(request.Topic) ? "" : $" · {request.Topic}");
        var from = $"от заявителя ({request.Author})";

        return action switch
        {
            "note" => new Plan($"Сообщение {from}:\n{message}", $"{head}\nСообщение {from}:\n{message}"),
            // Ответ на вопрос отдела: задача возвращается из «Требуется уточнение» в работу.
            "answer" => new Plan($"Ответ заявителя:\n{message}", $"{head}\nОтвет {from}:\n{message}", Status: BoardStatus.Work),
            // Задача уже закрыта переходом в «Готово» — приёмку фиксируем, состояние не меняем.
            "accept" => new Plan($"Результат принят {from}", $"{head}\nРезультат принят {from}"),
            "rework" => new Plan($"Возвращена на доработку {from}:\n{message}", $"{head}\nВозвращена на доработку {from}:\n{message}", "reopened", BoardStatus.Work),
            "cancel" => message.Length > 0
                ? new Plan($"Отменена {from}:\n{message}", $"{head}\nОтменена {from}:\n{message}", "finished", BoardStatus.Rejected)
                : new Plan($"Отменена {from}", $"{head}\nОтменена {from}", "finished", BoardStatus.Rejected),
            _ => null,
        };
    }
}
