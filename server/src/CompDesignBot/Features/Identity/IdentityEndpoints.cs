namespace CompDesignBot.Features.Identity;

/// <summary>
/// Вход в Mini App: подписанные Telegram данные запуска меняются на свой токен
/// сессии. Дальше приложение живёт с токеном: клиенты Telegram отдают
/// <c>initData</c> непредсказуемо, и держаться за него нельзя.
/// </summary>
public static class IdentityEndpoints
{
    public static RouteGroupBuilder MapIdentity(this RouteGroupBuilder api)
    {
        api.MapPost("/auth/exchange", (HttpRequest request, SessionTokens tokens) =>
        {
            var initData = request.Headers["x-telegram-init-data"].ToString();
            var viewer = tokens.VerifyInitData(initData);
            return Results.Json(new { token = tokens.IssueToken(viewer), user = viewer });
        });

        return api;
    }
}
