using System.Net;
using System.Text.Json;
using CompDesignBot.Features.Requests;
using CompDesignBot.Infrastructure.Pyrus;

namespace CompDesignBot.Tests.Fakes;

/// <summary>
/// Pyrus в памяти: форма с полями доски, задачи как словари значений,
/// комментарии и field_updates применяются к задаче. Достаточно, чтобы прогнать
/// сценарии бота и API без сети.
/// </summary>
public sealed class FakePyrusClient : IPyrusClient
{
    private static readonly string[] FieldNames =
    [
        Field.Topic, Field.Project, Field.Description, Field.Expected, Field.Origin, Field.Source, Field.OriginPath,
        Field.Deadline, Field.Author, Field.TelegramId, Field.RequestNo, Field.Status, Field.ChatMessage,
    ];

    private long _nextTaskId = 379_000_001;

    public bool Enabled { get; set; } = true;

    public Dictionary<long, FakeTask> Tasks { get; } = [];

    public List<(long TaskId, PyrusCommentRequest Request)> Comments { get; } = [];

    public List<string> Uploaded { get; } = [];

    public byte[] DownloadBytes { get; set; } = [1, 2, 3];

    public List<CatalogItem> Catalog { get; set; } = [new(1, "1-19-2026 MR Group АГК БЦ Верейская"), new(2, "1-52-2025 АЛЬФА Маши Порываевой")];

    /// <summary>Заводит задачу напрямую — как будто она уже была на доске.</summary>
    public FakeTask Seed(Action<FakeTask> configure)
    {
        var task = new FakeTask { Id = _nextTaskId++ };
        configure(task);
        Tasks[task.Id] = task;
        return task;
    }

    public Task<PyrusFormSchema?> SchemaAsync(long formId, CancellationToken ct = default)
    {
        var ids = FieldNames.Select((name, i) => (name, id: i + 1)).ToDictionary(p => p.name, p => p.id);
        var types = FieldNames.ToDictionary(n => n, _ => "text");
        var choices = new Dictionary<string, IReadOnlyDictionary<string, int>>
        {
            [Field.Status] = new Dictionary<string, int>
            {
                [BoardStatus.New] = 1,
                [BoardStatus.Work] = 2,
                [BoardStatus.Clarify] = 3,
                [BoardStatus.Done] = 4,
                [BoardStatus.Rejected] = 5,
            },
        };
        return Task.FromResult<PyrusFormSchema?>(new PyrusFormSchema { FieldIds = ids, FieldTypes = types, Choices = choices });
    }

    public Task<long?> CreateFormTaskAsync(long formId, IReadOnlyDictionary<string, object?> values, CancellationToken ct = default)
    {
        var task = new FakeTask { Id = _nextTaskId++ };
        foreach (var (name, value) in values)
        {
            task.Values[name] = Plain(value);
        }

        Tasks[task.Id] = task;
        return Task.FromResult<long?>(task.Id);
    }

    public Task<bool> CommentAsync(long taskId, PyrusCommentRequest request, CancellationToken ct = default)
    {
        if (!Tasks.TryGetValue(taskId, out var task))
        {
            throw new PyrusException($"Pyrus: /tasks/{taskId}/comments ответил 404");
        }

        Comments.Add((taskId, request));
        task.Comments.Add(new PyrusComment { Text = request.Text });
        foreach (var (name, value) in request.SetFields ?? new Dictionary<string, object?>())
        {
            task.Values[name] = Plain(value);
        }

        if (request.Action == "finished")
        {
            task.Closed = true;
        }
        else if (request.Action == "reopened")
        {
            task.Closed = false;
        }

        task.Attachments.AddRange((request.AttachmentGuids ?? []).Select(g => new PyrusAttachment { Name = g + ".jpg", Url = "https://files/" + g, MimeType = "image/jpeg" }));
        return Task.FromResult(true);
    }

    public Task<PyrusTask?> GetTaskAsync(long taskId, CancellationToken ct = default) =>
        Task.FromResult(Tasks.TryGetValue(taskId, out var task) ? task.ToPyrusTask() : null);

    public Task<IReadOnlyList<PyrusTask>> RegisterAsync(long formId, CancellationToken ct = default) =>
        Task.FromResult<IReadOnlyList<PyrusTask>>(Tasks.Values.Select(t => t.ToPyrusTask(withDetails: false)).ToList());

    public Task<string?> UploadFileAsync(string fileName, Stream content, string contentType, CancellationToken ct = default)
    {
        var guid = Guid.NewGuid().ToString("N");
        Uploaded.Add(fileName);
        return Task.FromResult<string?>(guid);
    }

    public Task<HttpResponseMessage?> DownloadAsync(string url, CancellationToken ct = default)
    {
        var response = new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(DownloadBytes) };
        response.Content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("image/jpeg");
        return Task.FromResult<HttpResponseMessage?>(response);
    }

    public Task<IReadOnlyList<CatalogItem>> CatalogItemsAsync(long catalogId, CancellationToken ct = default) =>
        Task.FromResult<IReadOnlyList<CatalogItem>>(Catalog);

    private static string? Plain(object? value) => value switch
    {
        null => null,
        CatalogValue c => c.Text,
        string s => s,
        _ => Convert.ToString(value, System.Globalization.CultureInfo.InvariantCulture),
    };

    public sealed class FakeTask
    {
        public long Id { get; init; }
        public Dictionary<string, string?> Values { get; } = [];
        public List<PyrusComment> Comments { get; } = [];
        public List<PyrusAttachment> Attachments { get; } = [];
        public bool Closed { get; set; }
        public string CreateDate { get; set; } = "2026-09-16T10:00:00Z";

        public string? this[string name]
        {
            get => Values.TryGetValue(name, out var v) ? v : null;
            set => Values[name] = value;
        }

        /// <summary>Как отдаёт Pyrus: поля в разделе «Задача», статус — выбором с choice_names.</summary>
        public PyrusTask ToPyrusTask(bool withDetails = true)
        {
            var fields = new List<object>();
            var id = 1;
            foreach (var (name, value) in Values)
            {
                if (value is null)
                {
                    continue;
                }

                object fieldValue = name == Field.Status
                    ? new { choice_names = new[] { value } }
                    : name is Field.TelegramId or Field.ChatMessage or Field.RequestNo ? long.Parse(value) : value;
                fields.Add(new { id = id++, name, value = fieldValue });
            }

            var json = JsonSerializer.Serialize(new
            {
                id = Id,
                create_date = CreateDate,
                close_date = Closed ? "2026-09-17T10:00:00Z" : null,
                is_closed = Closed,
                fields = new object[] { new { id = 100, name = "Задача", type = "title", value = new { fields } } },
                attachments = withDetails ? Attachments : [],
                comments = withDetails ? Comments.Select(c => new { text = c.Text, attachments = Array.Empty<object>() }) : [],
            });
            return JsonSerializer.Deserialize<PyrusTask>(json)!;
        }
    }
}
