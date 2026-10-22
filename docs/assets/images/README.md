# Product screenshot provenance

Current Jellyfin UI captures in this directory were made through Orca's
browser against an isolated Jellyfin **12.1.0** demo with OpenWatchParty plugin
**0.7.0.0** and session server **0.7.0**. The setup wizard captures show the
published `owpctl` **0.7.0** dry-run preview targeting the same local Jellyfin
demo. The Jellyfin UI was set to French; the English guides describe the
equivalent controls. Captures were saved with
`orca-ide screenshot --page <browser-page-id> --json`. The queue, up-next,
host transfer, host role, participant status, chat closeup and installer
images are crops of captured UI to keep the controls readable. There
are no generated or simulated interface images here.

| Image | UI shown |
| --- | --- |
| `tutorial-first-run.png` | First-use Watch Party panel and help |
| `tutorial-player-button.png` | Jellyfin player header and Watch Party button |
| `tutorial-lobby.png` | Online room list and Create Room control |
| `tutorial-guest-home.png`, `watch-parties-home.png` | Guest home and active host room card |
| `tutorial-guest-join.png` | Guest room join flow |
| `tutorial-guest-sync.png`, `watch-party-panel.png`, `watch-party-sync.png` | Room participant list, host badge and sync status |
| `watch-party-panel-closeup.png` | Room bar and chat composer |
| `watch-party-queue.png` | Current and automatically queued episodes |
| `watch-party-up-next.png` | Real three-second up-next countdown with Cancel and Next controls above the live queue |
| `watch-party-host-transfer.png` | Host leave confirmation naming the eligible next host |
| `watch-party-host-role.png` | Participant list after the real host transfer, with the promoted account marked Host |
| `plugin-configuration.png` | Web Client controls, guest sync adjustment enabled, and room appearance sliders |
| `tutorial-setup-form.png` | Actual 0.7.0 setup form with the local demo URL and blank API token; captured before Preview |
| `tutorial-setup-preview.png` | Actual 0.7.0 dry-run plan for the local Jellyfin demo; Install was not selected |
| `tutorial-api-keys.png` | Jellyfin 12.1 API key setup illustration, retained after review |

The optional guest sync setting is visibly enabled in the admin capture and
was persisted with Jellyfin's supported admin configuration API through the
Orca page. The screenshot documents that setting, not a verified guest-side
manual adjustment. Guest-side manual adjustment and host reconnect have no
separate capture. The up-next screenshot shows three seconds remaining in
the normal ten-second countdown.

Screenshots use harmless demo room and account names. The setup preview's
temporary API token field is blank. The plugin's JWT field was masked in the
inspected admin UI and no secret was captured or included in these images.

## Media credits

Movie frames are from [Wing It!](https://studio.blender.org/films/wing-it/)
and [Sprite Fright](https://studio.blender.org/films/sprite-fright/) by
Blender Studio, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
The demo's **Blender Shorts** series groups these open movies for illustrating
the episode queue; it is not an official episodic release.
