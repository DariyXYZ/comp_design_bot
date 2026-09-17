using CompDesignBot.Features.Identity;
using CompDesignBot.Infrastructure.Pyrus;

namespace CompDesignBot.Hosting;

/// <summary>Общее для маршрутов <c>/api/*</c>: формат ошибок, вход по токену, продление токена.</summary>
public static class ApiSupport
{
    /// <summary>Заголовок, которым сервер возвращает продлённый токен сессии; клиент его читает.</summary>
    public const string SessionTokenHeader = "X-Session-Token";

    /// <summary>Ошибка в формате, который ждёт клиент: <c>{ "error": "…" }</c>.</summary>
    public static IResult Error(int status, string message) => Results.Json(new { error = message }, statusCode: status);

    /// <summary>Кто спрашивает — по токену сессии из <c>Authorization</c>. Бросает <see cref="AuthException"/>.</summary>
    public static (Viewer Viewer, string Token) RequireViewer(HttpRequest request, SessionTokens tokens)
    {
        var token = SessionTokens.Bearer(request.Headers.Authorization);
        return (tokens.ReadToken(token), token);
    }

    /// <summary>Как <see cref="RequireViewer"/>, но сразу ставит заголовок продления на ответ.</summary>
    public static Viewer Authorize(HttpContext http, SessionTokens tokens)
    {
        var (viewer, token) = RequireViewer(http.Request, tokens);
        Renew(http.Response, tokens, token);
        return viewer;
    }

    /// <summary>
    /// Токен на исходе уезжает обратно продлённым. Заголовок ставится и на
    /// ошибочный ответ — клиент читает его на любом.
    /// </summary>
    public static void Renew(HttpResponse response, SessionTokens tokens, string token)
    {
        if (tokens.RenewedToken(token) is { } renewed)
        {
            response.Headers[SessionTokenHeader] = renewed;
            // Приложение и API на одном домене, но если API вынесут — без
            // разрешения браузер спрячет продлённый токен от скрипта.
            response.Headers.AccessControlExposeHeaders = SessionTokenHeader;
        }
    }
}

/// <summary>
/// Единая обработка ошибок API: вход не подтверждён — 401 с причиной, Pyrus не
/// ответил — 502. Один фильтр на группу, чтобы ни один маршрут не забыл.
/// </summary>
public sealed class ApiErrorFilter : IEndpointFilter
{
    private readonly ILogger<ApiErrorFilter> _log;

    public ApiErrorFilter(ILogger<ApiErrorFilter> log)
    {
        _log = log;
    }

    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        try
        {
            return await next(context);
        }
        catch (AuthException e)
        {
            // 401, а не 400: для приложения это именно «вход не подтверждён».
            return ApiSupport.Error(StatusCodes.Status401Unauthorized, e.Message);
        }
        catch (PyrusException e)
        {
            _log.LogError(e, "{Path}: Pyrus не ответил", context.HttpContext.Request.Path);
            return ApiSupport.Error(StatusCodes.Status502BadGateway, "Pyrus не ответил");
        }
    }
}
