using System.Collections.Concurrent;

namespace CompDesignBot;

// aiogram держит один FSMContext на ключ (chat_id, user_id) — состояние из
// РАЗНЫХ StatesGroup (NewRequest / DeptReply / FeedbackComment) физически
// одно и то же поле, поэтому набор состояний тут объединён в один enum:
// два одновременных "вопроса" одному человеку невозможны в принципе, именно
// на этом инварианте держится защита от перезаписи в dept.py/feedback.py
// (см. проверку state.get_state() is not None).
public enum BotState
{
    None,
    NewDescription,
    NewPhotos,
    NewSource,
    NewPreview,
    DeptContact,
    DeptReason,
    FeedbackText,
}

public sealed class FsmEntry
{
    public BotState State = BotState.None;
    public readonly Dictionary<string, object?> Data = new();
}

// Порт aiogram.fsm.context.FSMContext + MemoryStorage: состояние и данные
// черновика по ключу (chat_id, user_id). Не переживает рестарт процесса —
// это тот же осознанный компромисс, что и в Python-версии.
public sealed class StateStore
{
    private readonly ConcurrentDictionary<(long ChatId, long UserId), FsmEntry> _entries = new();

    private FsmEntry Entry(long chatId, long userId) =>
        _entries.GetOrAdd((chatId, userId), _ => new FsmEntry());

    public BotState GetState(long chatId, long userId) => Entry(chatId, userId).State;

    public void SetState(long chatId, long userId, BotState state) => Entry(chatId, userId).State = state;

    public void Clear(long chatId, long userId)
    {
        var e = Entry(chatId, userId);
        e.State = BotState.None;
        e.Data.Clear();
    }

    public Dictionary<string, object?> GetData(long chatId, long userId) => Entry(chatId, userId).Data;

    public void UpdateData(long chatId, long userId, string key, object? value) =>
        Entry(chatId, userId).Data[key] = value;
}

// Порт asyncio.Lock-словарей из create.py (_user_locks) и dept.py (_req_locks) —
// один инстанс на каждое из двух назначений, ключ произвольный long (user_id
// либо req_id). Записи, как и в Python, не удаляются — растущий словарь
// долгоживущих локов это осознанное поведение оригинала, не баг.
public sealed class KeyedAsyncLock
{
    private readonly ConcurrentDictionary<long, SemaphoreSlim> _locks = new();

    private SemaphoreSlim Sem(long key) => _locks.GetOrAdd(key, _ => new SemaphoreSlim(1, 1));

    public async Task<IDisposable> LockAsync(long key)
    {
        var sem = Sem(key);
        await sem.WaitAsync().ConfigureAwait(false);
        return new Releaser(sem);
    }

    private sealed class Releaser(SemaphoreSlim sem) : IDisposable
    {
        private bool _disposed;
        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;
            sem.Release();
        }
    }
}
