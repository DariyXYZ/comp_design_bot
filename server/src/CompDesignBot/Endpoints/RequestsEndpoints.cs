using CompDesignBot.Features.Auth;
using CompDesignBot.Features.Requests;
using CompDesignBot.Infrastructure.Telegram;

namespace CompDesignBot.Endpoints;

/// <summary>
/// Заявки этого человека. Все маршруты требуют токен: id заявителя лежит в
/// поле формы, и без проверки подписи любой прочитал бы чужие заявки.
/// </summary>
public static class RequestsEndpoints
{
    /// <summary>Заявка, как её ждёт кабинет Mini App (<c>PyrusRequest</c> в клиенте).</summary>
    public sealed record RequestDto(
        long TaskId,
        long Number,
        string? Topic,
        string? Project,
        string? Description,
        string? Expected,
        string? Origin,
        string? Deadline,
        string? Created,
        bool Closed,
        string? Status,
        string? Question)
    {
        public static RequestDto From(RequestRecord r) => new(
            r.TaskId, r.Number, NullIfEmpty(r.CaseTitle), r.Project, NullIfEmpty(r.Description), r.Expected, r.Origin,
            r.Deadline, r.Created, r.Closed, NullIfEmpty(r.BoardStatus), r.Question);

        private static string? NullIfEmpty(string value) => value.Length > 0 ? value : null;
    }

    public sealed record ActionBody(string? Action, string? Text);

    public static RouteGroupBuilder MapRequests(this RouteGroupBuilder api)
    {
        var group = api.MapGroup("/requests");

        group.MapGet("/", async (HttpContext http, SessionTokens tokens, RequestStore store, CancellationToken ct) =>
        {
            var (viewer, token) = ApiSupport.RequireViewer(http.Request, tokens);
            ApiSupport.Renew(http.Response, tokens, token);
            if (!store.Enabled)
            {
                // Не ошибка: приложение показывает пустой список с пояснением.
                return Results.Json(new { requests = Array.Empty<RequestDto>(), source = "disabled" });
            }

            var requests = await store.ListUserRequestsOrThrowAsync(viewer.Id, ct);
            return Results.Json(new { requests = requests.Select(RequestDto.From).ToList(), source = "pyrus" });
        });

        group.MapGet("/{taskId:long}", async (long taskId, HttpContext http, SessionTokens tokens, RequestStore store, CancellationToken ct) =>
        {
            if (taskId <= 0)
            {
                return ApiSupport.Error(StatusCodes.Status400BadRequest, "Неверный номер задачи");
            }

            var (viewer, token) = ApiSupport.RequireViewer(http.Request, tokens);
            ApiSupport.Renew(http.Response, tokens, token);
            if (!store.Enabled)
            {
                return ApiSupport.Error(StatusCodes.Status503ServiceUnavailable, "Pyrus не подключён");
            }

            var found = await store.UserRequestOrThrowAsync(taskId, viewer.Id, ct);
            // Одинаковый ответ для «нет такой» и «чужая»: иначе перебором видно, какие заявки есть.
            return found is null
                ? ApiSupport.Error(StatusCodes.Status404NotFound, "Заявка не найдена")
                : Results.Json(new { request = RequestDto.From(found) });
        });

        group.MapPost("/{taskId:long}", async (long taskId, ActionBody? body, HttpContext http, SessionTokens tokens,
            RequestStore store, DeptChat dept, CancellationToken ct) =>
        {
            if (taskId <= 0)
            {
                return ApiSupport.Error(StatusCodes.Status400BadRequest, "Неверный номер задачи");
            }

            if (!RequestActions.IsAction(body?.Action))
            {
                return ApiSupport.Error(StatusCodes.Status400BadRequest, "Неизвестное действие");
            }

            var (viewer, token) = ApiSupport.RequireViewer(http.Request, tokens);
            ApiSupport.Renew(http.Response, tokens, token);
            if (!store.Enabled)
            {
                return ApiSupport.Error(StatusCodes.Status503ServiceUnavailable, "Pyrus не подключён");
            }

            var found = await store.UserRequestOrThrowAsync(taskId, viewer.Id, ct);
            if (found is null)
            {
                return ApiSupport.Error(StatusCodes.Status404NotFound, "Заявка не найдена");
            }

            var author = viewer.Handle is { } handle ? $"{viewer.Name} {handle}" : viewer.Name;
            var plan = RequestActions.Build(body!.Action!, new RequestActions.Ref(found.Number, found.CaseTitle.Length > 0 ? found.CaseTitle : null, author), body.Text ?? "");
            if (plan is null)
            {
                return ApiSupport.Error(StatusCodes.Status400BadRequest, "Нужен текст сообщения");
            }

            // Сначала Pyrus: если он откажет, отдел не получит сообщение о том, чего нет в реестре.
            await store.CommentOrThrowAsync(taskId, plan.Comment, plan.Action, plan.Status, ct);
            var delivered = await dept.TrySendAsync(plan.Chat, html: false, ct: ct);
            return Results.Json(new { ok = true, delivered });
        });

        return api;
    }
}
