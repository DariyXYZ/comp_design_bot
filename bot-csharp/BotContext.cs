using Telegram.Bot;

namespace CompDesignBot;

// Общие зависимости для всех хендлеров — замена аргументов bot/state,
// которые aiogram сам подставляет в сигнатуру хендлера через DI.
public sealed class BotContext(ITelegramBotClient bot, StateStore states, KeyedAsyncLock userLocks, KeyedAsyncLock reqLocks)
{
    public ITelegramBotClient Bot { get; } = bot;
    public StateStore States { get; } = states;

    // create.py: _user_locks — один лок на пользователя (альбом фото, дабл-клики).
    public KeyedAsyncLock UserLocks { get; } = userLocks;

    // dept.py: _req_locks — один лок на заявку (гонки при смене статуса).
    public KeyedAsyncLock ReqLocks { get; } = reqLocks;
}
