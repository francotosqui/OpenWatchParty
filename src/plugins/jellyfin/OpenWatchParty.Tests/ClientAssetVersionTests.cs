using System.Text;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;
using OpenWatchParty.Plugin.Controllers;
using Xunit;

namespace OpenWatchParty.Plugin.Tests;

public sealed class ClientAssetVersionTests
{
    [Fact]
    public void ValueIsStableShortLowercaseHex()
    {
        var value = ClientAssetVersion.Value;

        Assert.NotNull(value);
        Assert.Matches("^[0-9a-f]{16}$", value);
        Assert.Equal(value, ClientAssetVersion.Value);
    }

    [Fact]
    public void ValueCoversExactlyTheServedLoaderAndModules()
    {
        const string prefix = "OpenWatchParty.Plugin.Web.";
        using var loaderStream = typeof(ClientAssetVersion).Assembly.GetManifestResourceStream(prefix + "plugin.js");
        Assert.NotNull(loaderStream);
        using var loaderBytes = new MemoryStream();
        loaderStream.CopyTo(loaderBytes);
        var served = new List<KeyValuePair<string, byte[]>>
        {
            new(prefix + "plugin.js", loaderBytes.ToArray())
        };

        foreach (var module in OpenWatchPartyController.AllowedClientModules)
        {
            var controller = new OpenWatchPartyController(NullLogger<OpenWatchPartyController>.Instance)
            {
                ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() }
            };
            var result = Assert.IsType<FileContentResult>(controller.GetClientModule(module));
            served.Add(new(prefix + module.Replace('/', '.'), result.FileContents));
        }

        Assert.Equal(ClientAssetVersion.Compute(served), ClientAssetVersion.Value);
    }

    [Fact]
    public void ComputeDoesNotDependOnResourceOrder()
    {
        var first = Asset("OpenWatchParty.Plugin.Web.plugin.js", "loader");
        var second = Asset("OpenWatchParty.Plugin.Web.state.js", "state");

        Assert.Equal(
            ClientAssetVersion.Compute(new[] { first, second }),
            ClientAssetVersion.Compute(new[] { second, first }));
    }

    [Fact]
    public void ComputeChangesWhenClientCodeChanges()
    {
        var baseline = ClientAssetVersion.Compute(new[]
        {
            Asset("OpenWatchParty.Plugin.Web.plugin.js", "loader"),
            Asset("OpenWatchParty.Plugin.Web.state.js", "state")
        });

        var editedModule = ClientAssetVersion.Compute(new[]
        {
            Asset("OpenWatchParty.Plugin.Web.plugin.js", "loader"),
            Asset("OpenWatchParty.Plugin.Web.state.js", "state2")
        });
        var renamedModule = ClientAssetVersion.Compute(new[]
        {
            Asset("OpenWatchParty.Plugin.Web.plugin.js", "loader"),
            Asset("OpenWatchParty.Plugin.Web.store.js", "state")
        });
        var addedModule = ClientAssetVersion.Compute(new[]
        {
            Asset("OpenWatchParty.Plugin.Web.plugin.js", "loader"),
            Asset("OpenWatchParty.Plugin.Web.state.js", "state"),
            Asset("OpenWatchParty.Plugin.Web.ui.header.js", "header")
        });

        Assert.NotEqual(baseline, editedModule);
        Assert.NotEqual(baseline, renamedModule);
        Assert.NotEqual(baseline, addedModule);
    }

    [Fact]
    public void ComputeReturnsNullWhenAClientFileIsMissing()
    {
        var files = new Dictionary<string, byte[]>
        {
            ["OpenWatchParty.Plugin.Web.plugin.js"] = Encoding.UTF8.GetBytes("loader"),
            ["OpenWatchParty.Plugin.Web.state.js"] = Array.Empty<byte>()
        };

        Assert.NotNull(ClientAssetVersion.Compute(files.Keys, name => files.GetValueOrDefault(name)));
        Assert.Null(ClientAssetVersion.Compute(
            files.Keys.Append("OpenWatchParty.Plugin.Web.utils.log.js"),
            name => files.GetValueOrDefault(name)));
    }

    [Fact]
    public void ScriptUrlStaysUnversionedWithoutClientVersion()
    {
        Assert.Equal("../OpenWatchParty/ClientScript", ClientScriptInjection.BuildScriptUrl(null));
        Assert.Equal("../OpenWatchParty/ClientScript?v=0123456789abcdef", ClientScriptInjection.BuildScriptUrl("0123456789abcdef"));
    }

    private static KeyValuePair<string, byte[]> Asset(string name, string content)
    {
        return new KeyValuePair<string, byte[]>(name, Encoding.UTF8.GetBytes(content));
    }
}
