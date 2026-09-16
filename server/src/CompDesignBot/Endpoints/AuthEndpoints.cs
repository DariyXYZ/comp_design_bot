using CompDesignBot.Features.Auth;

namespace CompDesignBot.Endpoints;

/// <summary>
/// Вход в Mini App. Два пути, и оба нужны: код входа из адреса кнопки бота (он
/// работает, даже когда клиент Telegram не отдал данные запуска) и
/// <c>initData</c>, когда клиент его отдал. Оба меняются на свой токен сессии.
/// </summary>
public static class AuthEndpoints
{
    public sealed record RedeemBody(string? Code);

    public static RouteGroupBuilder MapAuth(this RouteGroupBuilder api)
    {
        var group = api.MapGroup("/auth");

        group.MapPost("/exchange", (HttpRequest request, SessionTokens tokens) =>
        {
            var initData = request.Headers["x-telegram-init-data"].ToString();
            var viewer = tokens.VerifyInitData(initData);
            return Results.Json(new { token = tokens.IssueToken(viewer), user = viewer });
        });

        group.MapPost("/redeem", (RedeemBody? body, SessionTokens tokens) =>
        {
            if (string.IsNullOrEmpty(body?.Code))
            {
                return ApiSupport.Error(StatusCodes.Status400BadRequest, "Код не передан");
            }

            var viewer = tokens.ReadLoginCode(body.Code);
            return Results.Json(new { token = tokens.IssueToken(viewer), user = viewer });
        });

        return api;
    }
}
