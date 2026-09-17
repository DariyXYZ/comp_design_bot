using System.Text.Json.Serialization;
using CompDesignBot.Features.Identity;
using CompDesignBot.Hosting;
using CompDesignBot.Infrastructure.Pyrus;

namespace CompDesignBot.Features.Requests;

/// <summary>
/// Заявки этого человека. Все маршруты требуют токен: id заявителя лежит в
/// поле формы, и без проверки подписи любой прочитал бы чужие заявки.
/// Маршруты тонкие: разобрать вход, вызвать <see cref="RequestService"/>, отдать ответ.
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

    /// <summary>Тело <c>POST /api/requests</c>. Имена как в форме Mini App (snake_case — так уже отправлял клиент).</summary>
    public sealed record SubmitBody(
        [property: JsonPropertyName("case")] string? Case,
        [property: JsonPropertyName("description")] string? Description,
        [property: JsonPropertyName("expected")] string? Expected,
        [property: JsonPropertyName("project")] string? Project,
        [property: JsonPropertyName("project_id")] string? ProjectId,
        [property: JsonPropertyName("deadline")] string? Deadline,
        [property: JsonPropertyName("origin")] string? Origin,
        [property: JsonPropertyName("origin_path")] string? OriginPath,
        [property: JsonPropertyName("source")] string? Source,
        [property: JsonPropertyName("photos")] IReadOnlyList<string>? Photos);

    public sealed record ActionBody(string? Action, string? Text);

    /// <summary>Лимит на файл: браузер сжимает картинку до 1600px, здесь страховка.</summary>
    private const long MaxUploadBytes = 4 * 1024 * 1024;

    private static readonly HashSet<string> AllowedImageTypes = ["image/jpeg", "image/png", "image/webp", "image/heic"];

    public static RouteGroupBuilder MapRequests(this RouteGroupBuilder api)
    {
        var group = api.MapGroup("/requests");

        group.MapGet("/", async (HttpContext http, SessionTokens tokens, RequestService requests, CancellationToken ct) =>
        {
            var viewer = ApiSupport.Authorize(http, tokens);
            if (!requests.Enabled)
            {
                // Не ошибка: приложение показывает пустой список с пояснением.
                return Results.Json(new { requests = Array.Empty<RequestDto>(), source = "disabled" });
            }

            var mine = await requests.ListMineAsync(viewer.Id, ct);
            return Results.Json(new { requests = mine.Select(RequestDto.From).ToList(), source = "pyrus" });
        });

        // Создание заявки из формы Mini App. Через API, а не через бота: у
        // sendData лимит 4 КБ и работа только из кнопки клавиатуры.
        group.MapPost("/", async (SubmitBody? body, HttpContext http, SessionTokens tokens, RequestService requests, CancellationToken ct) =>
        {
            var viewer = ApiSupport.Authorize(http, tokens);
            if (!requests.Enabled)
            {
                return ApiSupport.Error(StatusCodes.Status503ServiceUnavailable, "Pyrus не подключён");
            }

            if (body is null || string.IsNullOrWhiteSpace(body.Case) || string.IsNullOrWhiteSpace(body.Description))
            {
                return ApiSupport.Error(StatusCodes.Status400BadRequest, "Нужны тема и описание");
            }

            SubmitResult result;
            try
            {
                result = await requests.SubmitAsync(new SubmitRequest
                {
                    CaseKey = body.Case,
                    Description = body.Description,
                    Expected = body.Expected,
                    Project = body.Project,
                    ProjectId = long.TryParse(body.ProjectId, out var projectId) && projectId > 0 ? projectId : null,
                    Deadline = body.Deadline,
                    Origin = body.Origin,
                    OriginPath = body.OriginPath,
                    Source = body.Source,
                    PhotoGuids = body.Photos ?? [],
                }, viewer, ct);
            }
            catch (ArgumentException e)
            {
                return ApiSupport.Error(StatusCodes.Status400BadRequest, e.Message);
            }

            return Results.Json(new { taskId = result.TaskId, number = result.TaskId, delivered = result.CardDelivered });
        });

        group.MapGet("/{taskId:long}", async (long taskId, HttpContext http, SessionTokens tokens, RequestService requests, CancellationToken ct) =>
        {
            if (taskId <= 0)
            {
                return ApiSupport.Error(StatusCodes.Status400BadRequest, "Неверный номер задачи");
            }

            var viewer = ApiSupport.Authorize(http, tokens);
            if (!requests.Enabled)
            {
                return ApiSupport.Error(StatusCodes.Status503ServiceUnavailable, "Pyrus не подключён");
            }

            var found = await requests.GetMineAsync(taskId, viewer.Id, ct);
            // Одинаковый ответ для «нет такой» и «чужая»: иначе перебором видно, какие заявки есть.
            return found is null
                ? ApiSupport.Error(StatusCodes.Status404NotFound, "Заявка не найдена")
                : Results.Json(new { request = RequestDto.From(found) });
        });

        group.MapPost("/{taskId:long}", async (long taskId, ActionBody? body, HttpContext http, SessionTokens tokens,
            RequestService requests, CancellationToken ct) =>
        {
            if (taskId <= 0)
            {
                return ApiSupport.Error(StatusCodes.Status400BadRequest, "Неверный номер задачи");
            }

            if (!RequestActions.IsAction(body?.Action))
            {
                return ApiSupport.Error(StatusCodes.Status400BadRequest, "Неизвестное действие");
            }

            var viewer = ApiSupport.Authorize(http, tokens);
            if (!requests.Enabled)
            {
                return ApiSupport.Error(StatusCodes.Status503ServiceUnavailable, "Pyrus не подключён");
            }

            ActionResult? result;
            try
            {
                result = await requests.ActAsync(taskId, viewer, body!.Action!, body.Text ?? "", ct);
            }
            catch (ArgumentException e)
            {
                return ApiSupport.Error(StatusCodes.Status400BadRequest, e.Message);
            }

            return result is null
                ? ApiSupport.Error(StatusCodes.Status404NotFound, "Заявка не найдена")
                : Results.Json(new { ok = true, delivered = result.Delivered });
        });

        // Загрузка картинки заявки в хранилище. Pyrus принимает файлы только по
        // guid из files/upload — путь всегда двухшаговый: сначала загрузка, потом
        // привязка при создании заявки. Требует токен: иначе любой наполнял бы
        // хранилище чужими файлами.
        api.MapPost("/uploads", async (HttpContext http, SessionTokens tokens, IPyrusClient pyrus, CancellationToken ct) =>
        {
            ApiSupport.Authorize(http, tokens);

            if (!http.Request.HasFormContentType)
            {
                return ApiSupport.Error(StatusCodes.Status400BadRequest, "Файл не пришёл");
            }

            var form = await http.Request.ReadFormAsync(ct);
            var file = form.Files.GetFile("file");
            if (file is null)
            {
                return ApiSupport.Error(StatusCodes.Status400BadRequest, "Файл не пришёл");
            }

            if (file.Length > MaxUploadBytes)
            {
                return ApiSupport.Error(StatusCodes.Status413PayloadTooLarge, "Картинка больше 4 МБ — уменьшите её");
            }

            if (file.ContentType.Length > 0 && !AllowedImageTypes.Contains(file.ContentType))
            {
                return ApiSupport.Error(StatusCodes.Status415UnsupportedMediaType, "Это не картинка");
            }

            await using var stream = file.OpenReadStream();
            var guid = await pyrus.UploadFileAsync(
                file.FileName.Length > 0 ? file.FileName : "photo.jpg", stream,
                file.ContentType.Length > 0 ? file.ContentType : "image/jpeg", ct);
            return guid is null
                ? ApiSupport.Error(StatusCodes.Status502BadGateway, "Pyrus не принял файл")
                : Results.Json(new { guid });
        }).DisableAntiforgery();

        return api;
    }
}
