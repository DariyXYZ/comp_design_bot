using CompDesignBot.Features.Auth;
using CompDesignBot.Features.Topics;
using CompDesignBot.Infrastructure.Pyrus;

namespace CompDesignBot.Endpoints;

/// <summary>Справочники для формы заявки: проекты бюро, карточки тем, загрузка картинок.</summary>
public static class CatalogEndpoints
{
    /// <summary>Лимит на файл: браузер сжимает картинку до 1600px, здесь страховка.</summary>
    private const long MaxUploadBytes = 4 * 1024 * 1024;

    private static readonly HashSet<string> AllowedImageTypes = ["image/jpeg", "image/png", "image/webp", "image/heic"];

    public static RouteGroupBuilder MapCatalogs(this RouteGroupBuilder api)
    {
        // Карточки тем лежат в коде; маршрут оставлен, чтобы клиент не менялся.
        api.MapGet("/topics", () => Results.Json(new { rows = Cases.All }));

        // Список проектов бюро для подсказки в поле «Проект» — общий справочник
        // Pyrus «Проект» (~900 позиций). Отдаётся целиком, фильтр в браузере.
        api.MapGet("/projects", async (HttpResponse response, IPyrusClient pyrus, ProjectCatalog projects, CancellationToken ct) =>
        {
            if (!pyrus.Enabled)
            {
                return ApiSupport.Error(StatusCodes.Status503ServiceUnavailable, "Pyrus не подключён");
            }

            var items = await projects.ItemsAsync(ct);
            response.Headers.CacheControl = "public, max-age=600, stale-while-revalidate=3600";
            return Results.Json(new { projects = items.Select(i => new { id = i.Id, name = i.Name }).ToList() });
        });

        // Загрузка картинки заявки в Pyrus. sendData файлы не передаёт вовсе, а Pyrus
        // принимает файлы только по guid из files/upload — путь всегда двухшаговый.
        // Требует токен: иначе любой наполнял бы хранилище чужими файлами.
        api.MapPost("/uploads", async (HttpContext http, SessionTokens tokens, IPyrusClient pyrus, CancellationToken ct) =>
        {
            var (_, token) = ApiSupport.RequireViewer(http.Request, tokens);
            ApiSupport.Renew(http.Response, tokens, token);

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
