using Telegram.Bot;
using Telegram.Bot.Exceptions;
using Telegram.Bot.Types;
using Telegram.Bot.Types.Enums;

namespace CompDesignBot.Handlers;

// Порт handlers/feedback.py — оценка результата от заявителя после «Готово»,
// в личке с ботом.
public static class FeedbackHandler
{
    private static readonly Dictionary<string, string> Labels = new() { ["up"] = "👍", ["down"] = "👎" };

    public static async Task RateRequest(CallbackQuery callback, BotContext ctx)
    {
        var parts = callback.Data!.Split(':', 3);
        if (parts.Length != 3 || !long.TryParse(parts[1], out var reqId))
        {
            await ctx.Bot.AnswerCallbackQuery(callback.Id, "Ошибка", showAlert: true);
            return;
        }
        var value = parts[2];
        var chatId = callback.Message!.Chat.Id;

        var req = await Db.GetRequestAsync(reqId);
        // Кнопки уходят персонально автору заявки личным сообщением — но на
        // всякий случай не доверяем чужому callback.From.Id вслепую.
        if (req is null || callback.From.Id != req.UserId)
        {
            await ctx.Bot.AnswerCallbackQuery(callback.Id, "Не удалось сохранить", showAlert: true);
            return;
        }

        if (value == "review")
        {
            // Отзыв не привязан к 👍/👎 — можно оставить независимо от оценки
            // (и даже без неё вовсе), поэтому своя ветка без проверки req.Feedback.
            await ctx.Bot.AnswerCallbackQuery(callback.Id);
            if (ctx.States.GetState(chatId, callback.From.Id) != BotState.None)
            {
                // У этого же человека уже открыт вопрос по ДРУГОЙ заявке — не
                // перезаписываем (потеряли бы первый вопрос молча).
                return;
            }
            ctx.States.SetState(chatId, callback.From.Id, BotState.FeedbackText);
            ctx.States.UpdateData(chatId, callback.From.Id, "req_id", reqId);
            await ctx.Bot.SendMessage(chatId, Texts.FeedbackAskReview);
            return;
        }

        if (!Labels.ContainsKey(value))
        {
            await ctx.Bot.AnswerCallbackQuery(callback.Id, "Неизвестная оценка");
            return;
        }
        if (!string.IsNullOrEmpty(req.Feedback))
        {
            await ctx.Bot.AnswerCallbackQuery(callback.Id, "Уже оценено, спасибо!");
            return;
        }

        await Db.SetFeedbackAsync(reqId, value);
        try
        {
            // 👍/👎 больше не нажать (уже сохранено), но «Оставить отзыв» оставляем.
            await ctx.Bot.EditMessageReplyMarkup(chatId, callback.Message.MessageId, replyMarkup: Keyboards.FeedbackReviewOnlyButton(reqId));
        }
        catch (ApiRequestException) { }
        await ctx.Bot.AnswerCallbackQuery(callback.Id, "Спасибо за оценку!");

        if (Config.Instance.DeptChatId is { } deptChatId)
        {
            var caseTitle = Texts.Cases.TryGetValue(req.CaseKey, out var c) ? c.Title : req.CaseKey;
            int? threadId = (int?)Config.Instance.DeptThreadId;
            try
            {
                await ctx.Bot.SendMessage(deptChatId, Texts.FeedbackDeptNote(reqId, caseTitle, Labels[value]), messageThreadId: threadId);
            }
            catch (Exception)
            {
                Log.Info($"Заявка №{reqId}: оценка не доставлена в чат отдела");
            }
        }

        if (value == "down" && ctx.States.GetState(chatId, callback.From.Id) == BotState.None)
        {
            ctx.States.SetState(chatId, callback.From.Id, BotState.FeedbackText);
            ctx.States.UpdateData(chatId, callback.From.Id, "req_id", reqId);
            await ctx.Bot.SendMessage(chatId, Texts.FeedbackAskComment);
        }
    }

    public static async Task CaptureFeedbackComment(Message message, BotContext ctx)
    {
        var chatId = message.Chat.Id;
        var userId = message.From!.Id;
        var data = ctx.States.GetData(chatId, userId);
        var reqId = data.TryGetValue("req_id", out var r) ? (long?)r : null;
        ctx.States.Clear(chatId, userId);
        var text = (message.Text ?? "").Trim();
        if (reqId is null || text.Length == 0) return;

        await Db.SetFeedbackCommentAsync(reqId.Value, text);
        await ctx.Bot.SendMessage(chatId, Texts.FeedbackCommentThanks);

        if (Config.Instance.DeptChatId is { } deptChatId)
        {
            int? threadId = (int?)Config.Instance.DeptThreadId;
            try
            {
                await ctx.Bot.SendMessage(deptChatId, Texts.FeedbackDeptComment(reqId.Value, text), messageThreadId: threadId);
            }
            catch (Exception)
            {
                Log.Info($"Заявка №{reqId}: отзыв не доставлен в чат отдела");
            }
        }
    }

    public static async Task FeedbackCommentWrongType(Message message, BotContext ctx) =>
        await ctx.Bot.SendMessage(message.Chat.Id, "Пришли отзыв текстом, пожалуйста — или просто не отвечай, это необязательно.");
}
