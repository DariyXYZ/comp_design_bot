using CompDesignBot.Features.Identity;
using CompDesignBot.Features.Requests;
using CompDesignBot.Hosting;
using CompDesignBot.Infrastructure.Pyrus;

namespace CompDesignBot.Features.Feed;

/// <summary>
/// Лента задач отдела. Открыта всем, у кого есть приложение: это доска отдела,
/// а не личные данные. С токеном сессии строка помечается, следит ли за ней человек.
/// </summary>
public static class FeedEndpoints
{
    public sealed record FeedTaskDto(
        long TaskId,
        string? Topic,
        string? Project,
        string Excerpt,
        string? Status,
        bool Closed,
        string? Created,
        string? ClosedAt,
        string? Source,
        bool HasCover,
        bool Watching)
    {
        public static FeedTaskDto From(FeedTask t, long? viewerId) => new(
            t.TaskId, t.Topic, t.Project, t.Excerpt, t.Status, t.Closed, t.Created, t.ClosedAt, t.Source, t.HasCover,
            viewerId is { } id && t.Watchers.Contains(id));
    }

    public static RouteGroupBuilder MapFeed(this RouteGroupBuilder api)
    {
        var group = api.MapGroup("/feed");

        group.MapGet("/", async (HttpRequest request, SessionTokens tokens, FeedService feed, CancellationToken ct) =>
        {
            var tasks = await feed.LoadAsync(ct);
            long? viewerId = null;
            var header = request.Headers.Authorization.ToString();
            if (header.Length > 0)
            {
                try
                {
                    viewerId = tokens.ReadToken(SessionTokens.Bearer(header)).Id;
                }
                catch (AuthException)
                {
                    // Просроченный токен не повод прятать ленту — просто без пометок.
                }
            }

            return Results.Json(new { tasks = tasks.Select(t => FeedTaskDto.From(t, viewerId)).ToList() });
        });

        // Обложка — первая картинка из вложений, через сервер: файлы Pyrus доступны
        // только под ключом. Картинки заявок не меняются, поэтому кэш на сутки.
        group.MapGet("/{taskId:long}/cover", async (long taskId, HttpResponse response, FeedService feed, IPyrusClient pyrus, CancellationToken ct) =>
        {
            if (taskId <= 0)
            {
                return ApiSupport.Error(StatusCodes.Status400BadRequest, "Неверный номер задачи");
            }

            var task = await feed.TaskAsync(taskId, ct);
            var image = task is null ? null : FeedService.FirstImage(task);
            if (image?.Url is null)
            {
                return Results.StatusCode(StatusCodes.Status404NotFound);
            }

            var upstream = await pyrus.DownloadAsync(image.Url, ct);
            if (upstream is null || !upstream.IsSuccessStatusCode)
            {
                upstream?.Dispose();
                return Results.StatusCode(StatusCodes.Status502BadGateway);
            }

            response.RegisterForDispose(upstream);
            response.Headers.CacheControl = "public, max-age=86400, stale-while-revalidate=604800";
            var contentType = upstream.Content.Headers.ContentType?.ToString() ?? image.MimeType ?? "image/jpeg";
            return Results.Stream(await upstream.Content.ReadAsStreamAsync(ct), contentType);
        });

        // Подписка на чужую задачу; повторный вызов снимает подписку.
        group.MapPost("/{taskId:long}/watch", async (long taskId, HttpContext http, SessionTokens tokens, FeedService feed, RequestService requests, CancellationToken ct) =>
        {
            if (taskId <= 0)
            {
                return ApiSupport.Error(StatusCodes.Status400BadRequest, "Неверный номер задачи");
            }

            var viewer = ApiSupport.Authorize(http, tokens);
            var watching = await requests.ToggleWatchAsync(taskId, viewer, ct);
            if (watching is null)
            {
                return ApiSupport.Error(StatusCodes.Status404NotFound, "Задача не найдена");
            }

            // Сбросить кэш ленты — подписка должна быть видна сразу.
            feed.Invalidate();
            return Results.Json(new { watching });
        });

        return api;
    }
}
