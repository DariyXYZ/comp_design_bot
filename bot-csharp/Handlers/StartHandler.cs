using Telegram.Bot;
using Telegram.Bot.Types;
using Telegram.Bot.Types.Enums;

namespace CompDesignBot.Handlers;

// Порт handlers/start.py — старт, меню, инфо, мои заявки, /id.
public static class StartHandler
{
    public static async Task CmdStart(Message message, BotContext ctx)
    {
        // /start посреди заявки сбрасывает черновик, а не молча ест текст.
        ctx.States.Clear(message.Chat.Id, message.From!.Id);
        await ctx.Bot.SendMessage(message.Chat.Id, Texts.Welcome, parseMode: ParseMode.Html, replyMarkup: Keyboards.MainMenu());
    }

    // Работает в любом чате: показывает chat_id и thread_id — для настройки .env.
    public static async Task CmdId(Message message, BotContext ctx)
    {
        var lines = new List<string> { $"chat_id: <code>{message.Chat.Id}</code>" };
        if (message.MessageThreadId is { } threadId)
            lines.Add($"thread_id: <code>{threadId}</code>");
        await ctx.Bot.SendMessage(
            message.Chat.Id, string.Join("\n", lines),
            parseMode: ParseMode.Html,
            replyParameters: new ReplyParameters { MessageId = message.MessageId });
    }

    public static async Task ShowInfo(Message message, BotContext ctx)
    {
        // Любая кнопка меню посреди заявки сбрасывает черновик.
        ctx.States.Clear(message.Chat.Id, message.From!.Id);
        await ctx.Bot.SendMessage(message.Chat.Id, Texts.Info, parseMode: ParseMode.Html);
    }

    public static async Task MyRequests(Message message, BotContext ctx)
    {
        ctx.States.Clear(message.Chat.Id, message.From!.Id);
        var requests = await Db.ListUserRequestsAsync(message.From!.Id);
        if (requests.Count == 0)
        {
            await ctx.Bot.SendMessage(message.Chat.Id, Texts.NoRequests, parseMode: ParseMode.Html);
            return;
        }
        var lines = requests.Select(r =>
        {
            var caseTitle = Texts.Cases.TryGetValue(r.CaseKey, out var c) ? c.Title : r.CaseKey;
            var status = Texts.Statuses.TryGetValue(r.Status, out var s) ? s : r.Status;
            var createdDate = r.CreatedAt.Length >= 10 ? r.CreatedAt[..10] : r.CreatedAt;
            return $"№{r.Id} · {caseTitle}\n{status} · {createdDate}";
        });
        await ctx.Bot.SendMessage(message.Chat.Id, string.Join("\n\n", lines), parseMode: ParseMode.Html);
    }
}
