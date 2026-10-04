namespace OpenWatchParty.Plugin;

internal static class ClientScriptInjection
{
    internal const string Marker = "OpenWatchParty/ClientScript";
    internal const string ScriptPath = "../OpenWatchParty/ClientScript";

    /// <summary>
    /// Loader URL with the client content hash. The loader forwards <c>v</c> to every
    /// module URL, so cached modules stay valid until the client code changes.
    /// </summary>
    internal static string ScriptUrl => BuildScriptUrl(ClientAssetVersion.Value);

    internal static string ScriptTag => $"<script src=\"{ScriptUrl}\" defer></script>";

    internal static string BuildScriptUrl(string? clientVersion)
    {
        return clientVersion == null ? ScriptPath : $"{ScriptPath}?v={clientVersion}";
    }

    internal static string InjectIntoHtml(string? contents)
    {
        if (string.IsNullOrEmpty(contents)
            || contents.Contains(Marker, StringComparison.OrdinalIgnoreCase))
        {
            return contents ?? string.Empty;
        }

        var bodyEndIndex = contents.LastIndexOf("</body>", StringComparison.OrdinalIgnoreCase);
        return bodyEndIndex < 0
            ? contents
            : contents.Insert(bodyEndIndex, $"    {ScriptTag}\n");
    }
}
