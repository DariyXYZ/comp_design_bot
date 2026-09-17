using System.Threading.Channels;
using Telegram.Bot.Types;

namespace CompDesignBot.Channels.Telegram;

/// <summary>
/// Очередь обновлений между webhook и обработчиками. Webhook отвечает 200 сразу:
/// Telegram ждёт ответа считанные секунды и при задержке присылает то же
/// обновление снова, а обработка заявки (Pyrus, альбом в чат) занимает дольше.
/// </summary>
public sealed class UpdateQueue
{
    private readonly Channel<Update> _channel = Channel.CreateUnbounded<Update>(new UnboundedChannelOptions { SingleReader = true });

    public ValueTask EnqueueAsync(Update update, CancellationToken ct) => _channel.Writer.WriteAsync(update, ct);

    public IAsyncEnumerable<Update> ReadAllAsync(CancellationToken ct) => _channel.Reader.ReadAllAsync(ct);
}

/// <summary>
/// Разбирает очередь. Обновления обрабатываются параллельно, как в aiogram:
/// медленный Pyrus у одного человека не должен держать остальных. Гонки внутри
/// одного диалога закрывают локи в обработчиках.
/// </summary>
public sealed class UpdateWorker : BackgroundService
{
    private readonly UpdateQueue _queue;
    private readonly UpdateDispatcher _dispatcher;
    private readonly ILogger<UpdateWorker> _log;

    public UpdateWorker(UpdateQueue queue, UpdateDispatcher dispatcher, ILogger<UpdateWorker> log)
    {
        _queue = queue;
        _dispatcher = dispatcher;
        _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var inFlight = new HashSet<Task>();
        try
        {
            await foreach (var update in _queue.ReadAllAsync(stoppingToken))
            {
                var task = _dispatcher.HandleAsync(update, CancellationToken.None);
                lock (inFlight)
                {
                    inFlight.RemoveWhere(t => t.IsCompleted);
                    inFlight.Add(task);
                }
            }
        }
        catch (OperationCanceledException)
        {
            // Служба останавливается — ниже дожидаемся начатого.
        }

        Task[] pending;
        lock (inFlight)
        {
            pending = [.. inFlight];
        }

        try
        {
            // Даём начатым обработчикам дописать в Pyrus и чат при остановке службы.
            await Task.WhenAll(pending).WaitAsync(TimeSpan.FromSeconds(15), CancellationToken.None);
        }
        catch (Exception e) when (e is TimeoutException or OperationCanceledException)
        {
            _log.LogWarning("Остановка: не все обработчики завершились вовремя");
        }
    }
}
