using System.Net;
using CompDesignBot.Features.Requests;

namespace CompDesignBot.Features.Notifications;

/// <summary>Кто совершил действие в чате отдела — для строки «связаться с …» в уведомлении.</summary>
public sealed record Actor(long Id, string Name, string? Username);

/// <summary>Что показать под уведомлением. Канал сам решает, как это выглядит.</summary>
public enum NotificationKind
{
    Plain,
    /// <summary>Кнопки оценки результата (после «Готово»).</summary>
    AskFeedback,
    /// <summary>Кнопка «открыть приложение» (вопрос от отдела — ответить в кабинете).</summary>
    OpenApp,
}

/// <summary>
/// Уведомление сотруднику. Текст уже экранирован для HTML-канала; строка с
/// контактом отделена, потому что упоминание человека канал рендерит по-своему
/// (в Telegram — @ник или ссылка на профиль).
/// </summary>
public sealed record Notification(
    string Text,
    NotificationKind Kind = NotificationKind.Plain,
    long? TaskId = null,
    Actor? Contact = null,
    string? ContactLine = null);

/// <summary>Доставка уведомлений сотруднику. Реализация — <c>Channels/Telegram/TelegramNotifier</c>.</summary>
public interface INotifier
{
    /// <summary>true — доставлено; false — канал недоступен для этого человека (не разрешил сообщения, закрыл чат).</summary>
    Task<bool> NotifyAsync(long userId, Notification notification, CancellationToken ct = default);
}

/// <summary>Тексты уведомлений по заявке. Пользовательские данные экранируются здесь.</summary>
public static class RequestNotifications
{
    private static string E(string? text) => WebUtility.HtmlEncode(text ?? "");

    /// <summary>Автору: статус изменился; после «Принята»/«Готово» — как связаться с исполнителем.</summary>
    public static Notification StatusChanged(RequestRecord request, string newStatus, Actor actor)
    {
        var text = $"Статус вашей заявки №{request.TaskId} («{E(request.CaseTitle)}») изменился:\n{ChatStatus.Label(newStatus)}";
        return newStatus switch
        {
            ChatStatus.Accepted => new Notification(text, Contact: actor, ContactLine: "\n\nЕсли появятся вопросы — можно написать: {contact}"),
            ChatStatus.Done => new Notification(text, NotificationKind.AskFeedback, request.TaskId, actor, "\n\nДля связи и передачи решения: {contact}"),
            ChatStatus.Clarify => new Notification(text + "\n\nВопрос от отдела придёт следующим сообщением."),
            _ => new Notification(text),
        };
    }

    /// <summary>Подписчику: то же, без строк про контакт — они адресованы автору.</summary>
    public static Notification WatchedStatusChanged(RequestRecord request, string newStatus) =>
        new($"Задача №{request.TaskId} («{E(request.CaseTitle)}»), за которой вы следите:\n{ChatStatus.Label(newStatus)}");

    public static Notification RejectionReason(long taskId, string reason) =>
        new($"Причина отклонения заявки №{taskId}:\n{E(reason)}");

    public static Notification Question(long taskId, string question) =>
        new($"Отделу нужно уточнение по заявке №{taskId}:\n{E(question)}\n\n" +
            "Ответить можно в приложении: откройте заявку в «Задачах» — там поле для ответа.",
            NotificationKind.OpenApp, taskId);
}
