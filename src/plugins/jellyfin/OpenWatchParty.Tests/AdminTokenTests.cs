using System.IdentityModel.Tokens.Jwt;
using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using MediaBrowser.Common.Api;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;
using OpenWatchParty.Plugin.Configuration;
using OpenWatchParty.Plugin.Controllers;
using Xunit;

namespace OpenWatchParty.Plugin.Tests;

/// <summary>
/// Tests for /OpenWatchParty/AdminToken, the short token of the active rooms page.
/// </summary>
[Collection(PluginInstanceCollection.Name)]
public sealed class AdminTokenTests
{
    private const string ValidSecret = "B0vLhmX5ZY1mQ4NfIYBcr8VWxOTQ02cbeQ9x7B3K4ow=";
    private const string AdminUserId = "admin-user";

    [Fact]
    public void AdminToken_RequiresElevation()
    {
        var method = typeof(OpenWatchPartyController).GetMethod(nameof(OpenWatchPartyController.GetAdminToken))!;
        var authorize = method.GetCustomAttribute<AuthorizeAttribute>();

        Assert.NotNull(authorize);
        Assert.Equal(Policies.RequiresElevation, authorize!.Policy);
    }

    [Fact]
    public void AdminToken_IsAnAdministratorTokenForFiveMinutes()
    {
        using var host = new TestPlugin();
        var config = new PluginConfiguration { JwtSecret = ValidSecret, SessionServerUrl = "wss://session.example/ws" };

        using var response = Ok(CreateController().GetAdminTokenForConfiguration(config));
        var token = new JwtSecurityTokenHandler().ReadJwtToken(response.RootElement.GetProperty("token").GetString());

        Assert.Equal(300, response.RootElement.GetProperty("expires_in").GetInt32());
        Assert.Equal("wss://session.example/ws", response.RootElement.GetProperty("session_server_url").GetString());
        Assert.Equal(1, response.RootElement.GetProperty("protocol_version").GetInt32());
        Assert.Equal("admin", token.Claims.Single(claim => claim.Type == "typ").Value);
        Assert.Equal(AdminUserId, token.Subject);
        Assert.InRange((token.ValidTo - token.IssuedAt).TotalSeconds, 298, 302);
    }

    [Fact]
    public void SessionTokens_CarryNoType()
    {
        using var host = new TestPlugin();
        var config = new PluginConfiguration { JwtSecret = ValidSecret };

        var token = new JwtSecurityTokenHandler().ReadJwtToken(
            OpenWatchPartyController.GenerateJwtToken("user", "User", config));

        Assert.DoesNotContain(token.Claims, claim => claim.Type == "typ");
    }

    [Fact]
    public void AdminToken_RequiresAuthentication()
    {
        using var host = new TestPlugin();
        var config = new PluginConfiguration { AllowInsecureNoAuth = true, SessionServerUrl = "wss://session.example/ws" };

        var result = Assert.IsType<ObjectResult>(CreateController().GetAdminTokenForConfiguration(config));
        using var body = JsonDocument.Parse(JsonSerializer.Serialize(result.Value));

        Assert.Equal(409, result.StatusCode);
        Assert.True(body.RootElement.GetProperty("auth_required").GetBoolean());
    }

    [Fact]
    public void AdminToken_UsesTheActivePairingKey()
    {
        using var host = new TestPlugin();
        var store = new RsaSigningKeyStore(host.SigningKeyPath);
        store.Activate(store.GetOrCreate().Jwk.kid);
        var config = new PluginConfiguration { SessionServerUrl = "wss://session.example/ws" };
        host.Restart(config);

        using var response = Ok(CreateController().GetAdminTokenForConfiguration(config));
        var token = new JwtSecurityTokenHandler().ReadJwtToken(response.RootElement.GetProperty("token").GetString());

        Assert.Equal("RS256", token.Header.Alg);
        Assert.Equal("admin", token.Claims.Single(claim => claim.Type == "typ").Value);
    }

    private static JsonDocument Ok(ActionResult result)
    {
        var ok = Assert.IsType<OkObjectResult>(result);
        return JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
    }

    private static OpenWatchPartyController CreateController()
    {
        var context = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity(new[]
            {
                new Claim(ClaimTypes.NameIdentifier, AdminUserId),
                new Claim(ClaimTypes.Name, "Admin")
            }, "Test"))
        };
        return new OpenWatchPartyController(NullLogger<OpenWatchPartyController>.Instance)
        {
            ControllerContext = new ControllerContext { HttpContext = context }
        };
    }
}
