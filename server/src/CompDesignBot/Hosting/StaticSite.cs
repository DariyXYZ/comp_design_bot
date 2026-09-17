namespace CompDesignBot.Hosting;

/// <summary>
/// Mini App — статический экспорт Next.js из wwwroot. Экспорт со слэшем на
/// конце (<c>feed/index.html</c>), а клиент иногда открывает <c>/feed</c> —
/// переводим на слэш, как делал бы сам Next. Всё, что не нашлось, — 404.html экспорта.
/// </summary>
public static class StaticSite
{
    /// <summary>Ставится до <c>UseRouting</c>: иначе fallback-эндпоинт совпадает первым и статика уступает ему.</summary>
    public static WebApplication UseStaticSite(this WebApplication app)
    {
        app.Use(async (context, next) =>
        {
            var path = context.Request.Path.Value ?? "/";
            if (context.Request.Method == HttpMethods.Get
                && !path.EndsWith('/')
                && !path.StartsWith("/api", StringComparison.Ordinal)
                && !Path.HasExtension(path)
                && File.Exists(Path.Combine(app.Environment.WebRootPath ?? "", path.TrimStart('/'), "index.html")))
            {
                context.Response.Redirect(path + "/" + context.Request.QueryString, permanent: true);
                return;
            }

            await next();
        });
        app.UseDefaultFiles();
        app.UseStaticFiles();
        return app;
    }

    public static IEndpointRouteBuilder MapNotFoundPage(this WebApplication app)
    {
        app.MapFallback(async (HttpContext context) =>
        {
            var notFound = Path.Combine(app.Environment.WebRootPath ?? "", "404.html");
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            if (File.Exists(notFound))
            {
                context.Response.ContentType = "text/html; charset=utf-8";
                await context.Response.SendFileAsync(notFound);
            }
        });
        return app;
    }
}
