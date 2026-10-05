using System.Security.Cryptography;
using System.Text;
using OpenWatchParty.Plugin.Controllers;

namespace OpenWatchParty.Plugin;

/// <summary>
/// Content hash of the served web client (loader and modules). It is used as the
/// <c>v</c> query value of the injected loader URL, which the loader forwards to every
/// module URL, so browsers can reuse cached client files until the client code changes.
/// </summary>
internal static class ClientAssetVersion
{
    private const string ResourcePrefix = "OpenWatchParty.Plugin.Web.";
    private const string LoaderResourceName = ResourcePrefix + "plugin.js";

    private static readonly Lazy<string?> s_value = new(ComputeFromAssembly, LazyThreadSafetyMode.ExecutionAndPublication);

    /// <summary>
    /// Gets the client hash, or <c>null</c> when a client file is missing from the
    /// assembly; callers then keep the unversioned URL and its previous behaviour.
    /// </summary>
    internal static string? Value => s_value.Value;

    internal static string? Compute(IEnumerable<string> resourceNames, Func<string, byte[]?> readResource)
    {
        var assets = new List<KeyValuePair<string, byte[]>>();
        foreach (var name in resourceNames)
        {
            var content = readResource(name);
            if (content == null)
            {
                return null;
            }

            assets.Add(new KeyValuePair<string, byte[]>(name, content));
        }

        return Compute(assets);
    }

    internal static string Compute(IEnumerable<KeyValuePair<string, byte[]>> assets)
    {
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        foreach (var (name, content) in assets.OrderBy(asset => asset.Key, StringComparer.Ordinal))
        {
            var nameBytes = Encoding.UTF8.GetBytes(name);
            hash.AppendData(BitConverter.GetBytes(nameBytes.Length));
            hash.AppendData(nameBytes);
            hash.AppendData(BitConverter.GetBytes((long)content.Length));
            hash.AppendData(content);
        }

        return Convert.ToHexString(hash.GetHashAndReset(), 0, 8).ToLowerInvariant();
    }

    private static string? ComputeFromAssembly()
    {
        var assembly = typeof(ClientAssetVersion).Assembly;
        var resourceNames = OpenWatchPartyController.AllowedClientModules
            .Select(path => ResourcePrefix + path.Replace('/', '.'))
            .Append(LoaderResourceName);

        return Compute(resourceNames, name => ReadResource(assembly, name));
    }

    private static byte[]? ReadResource(System.Reflection.Assembly assembly, string name)
    {
        using var stream = assembly.GetManifestResourceStream(name);
        if (stream == null)
        {
            return null;
        }

        using var buffer = new MemoryStream();
        stream.CopyTo(buffer);
        return buffer.ToArray();
    }
}
