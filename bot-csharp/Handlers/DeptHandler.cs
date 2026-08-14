using System.Text.Json;
using Telegram.Bot;
using Telegram.Bot.Exceptions;
using Telegram.Bot.Types;
using Telegram.Bot.Types.Enums;

namespace CompDesignBot.Handlers;

// Порт handlers/dept.py — кнопки статусов под заявкой в чате отдела.
public static class DeptHandler
{
    // Лучшее, что можно показать для связи по этому актёру; null — неизвестен.
    private static string? ActorDisplay(RequestRecord req, string prefix)
    {
        string? contact = prefix == "accepted_by" ? req.AcceptedByContact : req.FinishedByContact;
        if (!string.IsNullOrEmpty(contact)) return contact;
        string? username = prefix == "accepted_by" ? req.AcceptedByUsername : req.FinishedByUsername;
        if (!string.IsNullOrEmpty(username)) return $"@{username}";
        string? name = prefix == "accepted_by" ? req.AcceptedByName : req.FinishedByName;
        return string.IsNullOrEmpty(name) ? null : name;
    }

    // Фиксирует, кто нажал кнопку (accepted_by/finished_by), и если у него нет
    // @username — просит прислать контакт обычным текстом (один раз на
    // человека, дальше берём из БД actor_contacts).
    private static async Task CaptureActorAsync(CallbackQuery callback, long reqId, string prefix, BotContext ctx)
    {
        var actor = callback.From;
        await Db.SetActorAsync(reqId, prefix, actor.Id, actor.Username, CreateHandler.FullName(actor));
        if (!string.IsNullOrEmpty(actor.Username)) return;

        var deptChatId = callback.Message!.Chat.Id;
        var cached = await Db.GetKnownContactAsync(actor.Id);
        if (cached is not null)
        {
            await Db.SetActorContactAsync(reqId, prefix, cached);
        }
        else if (ctx.States.GetState(deptChatId, actor.Id) != BotState.None)
        {
            // У этого же человека уже открыт вопрос по ДРУГОЙ заявке (кликнул
            // вторую кнопку, не ответив на первую) — не перезаписываем: эта
            // заявка просто останется без контакта (см. DoneContactUnknown).
            Log.Info($"Заявка №{reqId}: не спросили контакт у {actor.Id} — уже открыт вопрос по другой заявке");
        }
        else
        {
            ctx.States.SetState(deptChatId, actor.Id, BotState.DeptContact);
            ctx.States.UpdateData(deptChatId, actor.Id, "req_id", reqId);
            ctx.States.UpdateData(deptChatId, actor.Id, "prefix", prefix);
            await ctx.Bot.SendMessage(deptChatId, Texts.AskActorContact(CreateHandler.FullName(actor), reqId), parseMode: ParseMode.Html);
        }
    }

    // Отклонение без причины заявителю ничего не объясняет — просим коротко
    // пояснить обычным текстом (та же защита от перезаписи чужого открытого вопроса).
    private static async Task CaptureRejectionReasonAsync(CallbackQuery callback, long reqId, BotContext ctx)
    {
        var deptChatId = callback.Message!.Chat.Id;
        var actorId = callback.From.Id;
        if (ctx.States.GetState(deptChatId, actorId) != BotState.None)
        {
            Log.Info($"Заявка №{reqId}: не спросили причину отклонения у {actorId} — уже открыт вопрос по другой заявке");
            return;
        }
        ctx.States.SetState(deptChatId, actorId, BotState.DeptReason);
        ctx.States.UpdateData(deptChatId, actorId, "req_id", reqId);
        await ctx.Bot.SendMessage(deptChatId, Texts.AskRejectionReason(reqId), parseMode: ParseMode.Html);
    }

    public static async Task ChangeStatus(CallbackQuery callback, BotContext ctx)
    {
        // Кнопки работают только в чате отдела: пересланная карточка не должна
        // давать право менять статус кому угодно.
        var chatId = callback.Message!.Chat.Id;
        if (Config.Instance.DeptChatId is not { } deptChatId || chatId != deptChatId)
        {
            await ctx.Bot.AnswerCallbackQuery(callback.Id, "Статусы меняются только в чате отдела", showAlert: true);
            return;
        }

        var parts = callback.Data!.Split(':', 3);
        if (parts.Length != 3 || !long.TryParse(parts[1], out var reqId))
        {
            await ctx.Bot.AnswerCallbackQuery(callback.Id, "Ошибка", showAlert: true);
            return;
        }
        var newStatus = parts[2];
        if (!Texts.Statuses.ContainsKey(newStatus))
        {
            await ctx.Bot.AnswerCallbackQuery(callback.Id, "Неизвестный статус");
            return;
        }

        // Весь остаток — под локом заявки: без него два клика (свои или чужие)
        // почти одновременно читают один и тот же снэпшот статуса до того как
        // первый закоммитил, отсюда дублирующее уведомление автору.
        using (await ctx.ReqLocks.LockAsync(reqId))
        {
            var req = await Db.GetRequestAsync(reqId);
            if (req is null)
            {
                await ctx.Bot.AnswerCallbackQuery(callback.Id, "Заявка не найдена");
                return;
            }
            if (req.Status == newStatus)
            {
                await ctx.Bot.AnswerCallbackQuery(callback.Id, "Уже в этом статусе");
                return;
            }

            // Telegram сам говорит боту, кто нажал кнопку (callback.From — серверные
            // данные, не подделать). "Принята" фиксирует, к кому обращаться по
            // ходу работы; "Готово" — у кого забирать решение. Не всегда один и
            // тот же человек, поэтому оба перехода пишут в свою пару колонок.
            if (newStatus == "accepted") await CaptureActorAsync(callback, reqId, "accepted_by", ctx);
            else if (newStatus == "done") await CaptureActorAsync(callback, reqId, "finished_by", ctx);
            else if (newStatus == "rejected") await CaptureRejectionReasonAsync(callback, reqId, ctx);

            req = await Db.SetStatusAsync(reqId, newStatus);
            await ctx.Bot.AnswerCallbackQuery(callback.Id, $"Статус: {Texts.Statuses[newStatus]}");

            // Перерисовываем тем же рендерером, что и при создании — никакой
            // строковой хирургии. Способ редактирования зависит от того, каким
            // сообщением была отправлена заявка (см. CreateHandler.SendRequest).
            var author = req!.AuthorLine();
            var photos = req.Photos;
            var newMarkup = Keyboards.DeptStatusButtons(reqId);

            // На карточке: пока в работе — кто принял; как только готово — кто сдал.
            string? actorLine = null;
            if (newStatus == "done" && !string.IsNullOrEmpty(req.FinishedByName))
                actorLine = $"Завершил: {req.FinishedByName}";
            else if (!string.IsNullOrEmpty(req.AcceptedByName))
                actorLine = $"Принял: {req.AcceptedByName}";

            try
            {
                if (photos.Count >= 2)
                {
                    var caseTitle = Texts.Cases.TryGetValue(req.CaseKey, out var c) ? c.Title : req.CaseKey;
                    var shortText = $"Заявка №{reqId} · {caseTitle}\n{Texts.Statuses[newStatus]}";
                    if (actorLine is not null) shortText += $"\n{actorLine}";
                    await ctx.Bot.EditMessageText(chatId, callback.Message.MessageId, shortText, replyMarkup: newMarkup);
                }
                else if (photos.Count == 1)
                {
                    var caption = CreateHandler.RequestCard(
                        reqId, req.CaseKey, req.Description, req.SourcePath, author, newStatus,
                        maxLen: CreateHandler.CaptionLimit, actorLine: actorLine);
                    await ctx.Bot.EditMessageCaption(chatId, callback.Message.MessageId, caption, parseMode: ParseMode.Html, replyMarkup: newMarkup);
                }
                else
                {
                    var newText = CreateHandler.RequestCard(
                        reqId, req.CaseKey, req.Description, req.SourcePath, author, newStatus, actorLine: actorLine);
                    await ctx.Bot.EditMessageText(chatId, callback.Message.MessageId, newText, parseMode: ParseMode.Html, replyMarkup: newMarkup);
                }
            }
            catch (ApiRequestException e)
            {
                // Карточка старше 48ч и её больше нельзя редактировать: статус в
                // БД уже сменён, автора всё равно уведомим ниже.
                Log.Warning($"Заявка №{reqId}: не удалось обновить карточку: {e.Message}");
            }

            var caseTitleForNotify = Texts.Cases.TryGetValue(req.CaseKey, out var ci) ? ci.Title : req.CaseKey;
            var notify = Texts.StatusChangedNotify(reqId, caseTitleForNotify, Texts.Statuses[newStatus]);
            if (newStatus == "accepted")
            {
                var contact = ActorDisplay(req, "accepted_by");
                if (contact is not null) notify += Texts.AcceptedContactLine(contact);
            }
            else if (newStatus == "done")
            {
                var contact = ActorDisplay(req, "finished_by");
                notify += contact is not null ? Texts.DoneContactLine(contact) : Texts.DoneContactUnknown;
            }
            // Оценку просим только у «Готово» — на промежуточных статусах оценивать нечего.
            var feedbackMarkup = newStatus == "done" ? Keyboards.FeedbackButtons(reqId) : null;
            try
            {
                if (feedbackMarkup is not null)
                    await ctx.Bot.SendMessage(req.UserId, notify, parseMode: ParseMode.Html, replyMarkup: feedbackMarkup);
                else
                    await ctx.Bot.SendMessage(req.UserId, notify, parseMode: ParseMode.Html);
            }
            catch (Exception)
            {
                Log.Info($"Заявка №{reqId}: автору не доставлено уведомление (закрыл личку?)");
            }
        }
    }

    public static async Task CaptureActorContact(Message message, BotContext ctx)
    {
        var chatId = message.Chat.Id;
        var userId = message.From!.Id;
        var data = ctx.States.GetData(chatId, userId);
        var reqId = data.TryGetValue("req_id", out var r) ? (long?)r : null;
        var prefix = data.TryGetValue("prefix", out var pf) ? (string?)pf : null;
        ctx.States.Clear(chatId, userId);
        var text = (message.Text ?? "").Trim();
        if (reqId is null || prefix is null || text.Length == 0) return;

        await Db.SetKnownContactAsync(userId, text);
        await Db.SetActorContactAsync(reqId.Value, prefix, text);
        await ctx.Bot.SendMessage(chatId, Texts.ActorContactSaved(reqId.Value, text),
            replyParameters: new ReplyParameters { MessageId = message.MessageId });
        var req = await Db.GetRequestAsync(reqId.Value);
        if (req is not null)
        {
            try
            {
                await ctx.Bot.SendMessage(req.UserId, Texts.ContactLateNotify(reqId.Value, text));
            }
            catch (Exception)
            {
                Log.Info($"Заявка №{reqId}: поздний контакт не доставлен автору");
            }
        }
    }

    public static async Task ActorContactWrongType(Message message, BotContext ctx) =>
        await ctx.Bot.SendMessage(message.Chat.Id, "Пришли контакт текстом, пожалуйста.");

    public static async Task CaptureRejectionReason(Message message, BotContext ctx)
    {
        var chatId = message.Chat.Id;
        var userId = message.From!.Id;
        var data = ctx.States.GetData(chatId, userId);
        var reqId = data.TryGetValue("req_id", out var r) ? (long?)r : null;
        ctx.States.Clear(chatId, userId);
        var text = (message.Text ?? "").Trim();
        if (reqId is null || text.Length == 0) return;

        await Db.SetRejectionReasonAsync(reqId.Value, text);
        await ctx.Bot.SendMessage(chatId, Texts.RejectionReasonSaved(reqId.Value),
            replyParameters: new ReplyParameters { MessageId = message.MessageId });
        var req = await Db.GetRequestAsync(reqId.Value);
        if (req is not null)
        {
            try
            {
                await ctx.Bot.SendMessage(req.UserId, Texts.RejectionReasonNotify(reqId.Value, text));
            }
            catch (Exception)
            {
                Log.Info($"Заявка №{reqId}: причина отказа не доставлена автору");
            }
        }
    }

    public static async Task RejectionReasonWrongType(Message message, BotContext ctx) =>
        await ctx.Bot.SendMessage(message.Chat.Id, "Пришли причину текстом, пожалуйста.");
}
