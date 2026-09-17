using CompDesignBot.Hosting;
using CompDesignBot.Infrastructure.Pyrus;

namespace CompDesignBot.Features.Catalog;

/// <summary>Справочники для формы заявки: карточки тем и проекты бюро.</summary>
public static class CatalogEndpoints
{
    public static RouteGroupBuilder MapCatalog(this RouteGroupBuilder api)
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

        return api;
    }
}
