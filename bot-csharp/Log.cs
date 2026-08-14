namespace CompDesignBot;

// Мини-логгер вместо ILogger-инфраструктуры — формат строки совпадает с
// logging.basicConfig из main.py (аsctime levelname name: message), чтобы
// логи читались привычно при переносе.
public static class Log
{
    public static void Info(string message) => Write("INFO", message);
    public static void Warning(string message) => Write("WARNING", message);
    public static void Error(string message) => Write("ERROR", message);

    private static void Write(string level, string message) =>
        Console.WriteLine($"{DateTime.Now:yyyy-MM-dd HH:mm:ss,fff} {level} comp_design_bot: {message}");
}
