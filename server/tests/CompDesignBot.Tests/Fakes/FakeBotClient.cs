using System.Text.Json;
using Telegram.Bot;
using Telegram.Bot.Args;
using Telegram.Bot.Exceptions;
using Telegram.Bot.Requests;
using Telegram.Bot.Requests.Abstractions;
using Telegram.Bot.Types;

namespace CompDesignBot.Tests.Fakes;

/// <summary>
/// Telegram Bot API в памяти: запоминает все запросы и отвечает правдоподобными
/// объектами (у отправленного сообщения есть id и текст). Библиотека строит все
/// вызовы поверх <see cref="SendRequest{TResponse}"/>, поэтому этого достаточно.
/// </summary>
public sealed class FakeBotClient : ITelegramBotClient
{
    private int _nextMessageId = 1000;

    public List<IRequest> Requests { get; } = [];

    /// <summary>Байты, которые «скачиваются» по любому file_path.</summary>
    public byte[] FileBytes { get; set; } = [0xFF, 0xD8, 0xFF];

    public long BotId => 1;

    public bool LocalBotServer => false;

    public TimeSpan Timeout { get; set; } = TimeSpan.FromSeconds(10);

    public IExceptionParser ExceptionsParser { get; set; } = new DefaultExceptionParser();

#pragma warning disable CS0067 // события интерфейса, в фейке не поднимаются
    public event AsyncEventHandler<ApiRequestEventArgs>? OnMakingApiRequest;
    public event AsyncEventHandler<ApiResponseEventArgs>? OnApiResponseReceived;
#pragma warning restore CS0067

    public IEnumerable<T> Sent<T>() where T : IRequest => Requests.OfType<T>();

    public Task<TResponse> SendRequest<TResponse>(IRequest<TResponse> request, CancellationToken cancellationToken = default)
    {
        Requests.Add(request);
        object response = typeof(TResponse) switch
        {
            var t when t == typeof(Message) => MessageFor(request),
            var t when t == typeof(Message[]) => (request as SendMediaGroupRequest)?.Media.Select(_ => MessageFor(request)).ToArray() ?? [],
            var t when t == typeof(bool) => true,
            var t when t == typeof(TGFile) => new TGFile { FileId = (request as GetFileRequest)?.FileId ?? "f", FilePath = "photos/file.jpg" },
            _ => throw new NotSupportedException($"Фейк не умеет отвечать на {request.GetType().Name}"),
        };
        return Task.FromResult((TResponse)response);
    }

    public Task<bool> TestApi(CancellationToken cancellationToken = default) => Task.FromResult(true);

    public async Task DownloadFile(string filePath, Stream destination, CancellationToken cancellationToken = default) =>
        await destination.WriteAsync(FileBytes, cancellationToken);

    public async Task DownloadFile(TGFile file, Stream destination, CancellationToken cancellationToken = default) =>
        await destination.WriteAsync(FileBytes, cancellationToken);

    private Message MessageFor(IRequest request)
    {
        // Текст, подпись и чат берём из самого запроса через JSON: у каждого типа
        // запроса свои свойства, а фейку нужны только общие.
        var json = JsonSerializer.SerializeToElement(request, request.GetType(), JsonBotAPI.Options);
        string? Str(string name) => json.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
        var chatId = json.TryGetProperty("chat_id", out var chat) && chat.ValueKind == JsonValueKind.Number ? chat.GetInt64() : 0;
        var message = new Message
        {
            Id = _nextMessageId++,
            Chat = new Chat { Id = chatId },
            Text = Str("text"),
            Caption = Str("caption"),
            Date = DateTime.UtcNow,
        };
        if (request is SendPhotoRequest)
        {
            message.Photo = [new PhotoSize { FileId = "welcome-file-id", FileUniqueId = "u", Width = 1, Height = 1 }];
        }

        return message;
    }
}
