---
title: User Guide
parent: Getting Started
nav_order: 4
---

# User Guide

New here? Start with the [illustrated first watch-party tutorial]({{ '/product/first-watch-party/' | relative_url }})
for installation, screenshots and a complete two-user example.

## Getting Started

Before using OpenWatchParty, ensure your Jellyfin administrator has:
1. Installed the OpenWatchParty plugin
2. Started the session server
3. Confirmed that the plugin dashboard reports the client and session server as ready

## Creating a Watch Party

1. **Start playing a video** - Open any movie or TV episode in Jellyfin
2. **Find the Watch Party button** - Open the player controls and select the **Watch Party** (groups) icon
3. **Click to open the panel** - A slide-out panel appears
4. **Click "Create Room"** - The room is created and named after you (`<you>'s room`)
5. **Wait for participants** - The room appears in everyone's "Available Rooms" list and on the Jellyfin home page

The Watch Party button in the Jellyfin header opens the same panel, but **Create Room** stays disabled, with a hint, until something is playing: a room always starts from the video you are watching.

As the host, you control playback for everyone. When you play, pause, or seek, all participants follow.

![The Watch Party panel during an active session]({{ '/assets/images/watch-party-panel.png' | relative_url }})

## Joining a Watch Party

### From the Header
1. **Click the Watch Party button in the Jellyfin header** - Next to SyncPlay, Cast and Search, on the pages that show the header (in the player, use the OSD button); nothing needs to be playing
2. **Find the room** - Rooms appear in the list with participant counts
3. **Click "Join"** - OpenWatchParty starts the room's movie and syncs you to the host's position

A room marked **No media** has nothing to start for you: play something first, then join it from the player panel.

### From the Player
1. **Open any video** - The same video the host is watching
2. **Click the Watch Party button** - Opens the panel
3. **Find the room** - Rooms appear in the list with participant counts
4. **Click "Join"** - You'll automatically sync to the host's position

### From the Homepage

The Jellyfin homepage displays active watch parties in a dedicated "Watch Parties" section, making it easy to discover and join ongoing sessions.

![Active watch parties on the Jellyfin home page]({{ '/assets/images/watch-parties-home.png' | relative_url }})

**How it works:**

1. **Go to Jellyfin home** - Active watch parties appear in a dedicated section below your media libraries
2. **Browse party cards** - Each card shows:
   - Media cover image (movie poster or episode thumbnail)
   - Room name (generated from the host's username)
   - Participant count (e.g., "2 watching")
   - Play button overlay for quick join
3. **Join options:**
    - **Click the card** - Opens the movie details; play the movie, then join from the player panel
    - **Click the play overlay** - Attempts to start playback and join automatically; use the player panel if it does not complete

**What happens when you click:**

1. The movie details open; start playback if needed
2. In the player, open **Watch Party** and select **Join** if you are not already in the room
3. Your playback syncs to the host's current position after a brief catch-up period

**Notes:**
- The Watch Parties section only appears when there are active rooms
- Cards refresh automatically every 5 seconds
- If a room closes while you're viewing the homepage, the card disappears
- You must be logged into Jellyfin to see and join watch parties

## Host Controls

As the host, your actions control everyone:

| Action | Effect |
|--------|--------|
| Play | All clients start playing |
| Pause | All clients pause |
| Seek | All clients jump to that position |
| Close panel | Room stays active |
| Leave room | Room closes, all participants disconnected |

## Participant Experience

As a participant:

| What Happens | What You See |
|--------------|--------------|
| Host plays | Video starts automatically |
| Host pauses | Video pauses automatically |
| Host seeks | Video jumps to new position |
| Host leaves | "Room closed" notification |
| Drift detected | Playback speed adjusts (0.85x-2.0x) to catch up |

## The Panel Interface

![Close-up of an active room: participants, chat, latency and room ID]({{ '/assets/images/watch-party-panel-closeup.png' | relative_url }})

### Lobby View (Not in a room)
- **Room list** - Active watch parties with names and participant counts; rooms without media are marked "No media"
- **Create room** - "Create Room" button; the room is named after you. Disabled until something is playing
- **Connection status** - Online/Offline indicator
- **Close (X)** - Hides the panel; open it again from the header or the player button

### In-Room View

In a room the panel becomes a single bar at the top right (below the header when opened from it). From left to right:

- **Sync dot** - Your sync status; hover it for the details (the host's is always green)
- **Latency** - Round-trip time from you to the session server, in milliseconds
- **Room name** - Current watch party name; hover it if it is cut short
- **Participants** (groups icon and count) - Opens the list of who is watching, with a **Host** badge on the host (older session servers show only the number of people)
- **Chat** (chat icon) - Opens the chat; a red badge counts unread messages
- **Leave** (exit icon) - Leaves the room right away; for the host it asks **Close the room for everyone?** first
- **Close (X)** - Only hides the bar: you stay in the room

Participants, chat and the host's confirmation open one at a time below the bar; select the same icon again to close it.

## Using Chat

The chat feature allows you to communicate with other watch party participants in real-time.

### Sending Messages
1. Type your message in the chat input field
2. Press **Enter** or click the send icon
3. Your message appears for all participants

### Chat Features
- **Username display** - Messages show the sender's Jellyfin username
- **Timestamps** - Hover a message to see when it was sent
- **Unread badge** - A red badge on the chat icon counts messages that arrived while the chat was closed
- **Message limit** - Messages are limited to 500 characters

### Notes
- Chat history is not saved; late joiners won't see previous messages
- The chat input doesn't interfere with video player controls

## Sync Indicator

Participants see a sync status dot in the room bar that shows how well their playback is aligned with the host. Hover it for the status name.

| Status | Indicator | Meaning |
|--------|-----------|---------|
| In sync | Green dot | Your playback matches the host |
| Out of sync | Yellow pulsing dot | Catching up via playback speed adjustment |
| Waiting for sync | Spinner | Synchronized play is being scheduled |

The "Out of sync" state is normal for a few seconds after joining or after the host seeks. The system automatically adjusts your playback speed to catch up.

![The participant view showing the In sync badge]({{ '/assets/images/watch-party-sync.png' | relative_url }})

## Notifications

OpenWatchParty displays toast notifications to keep you informed about room activity.

### System Notifications (Center)

These appear briefly in the center of the screen:
- **"Host resumed playback"** - The host started playing
- **"Host paused playback"** - The host paused
- **"A participant joined the room"** - Someone joined
- **"A participant left the room"** - Someone left
- **"Room closed"** - The room was closed (host left)

### Chat Notifications (Bottom-Right)

When the chat is closed, incoming messages appear as toasts in the bottom-right corner, so they do not cover the room bar:
- Shows the sender's username and message
- Stacks up to 5 messages
- Click to dismiss, or they fade after 5 seconds

## Tips for Best Experience

### For Hosts
- **Wait for everyone** - Check participant count before starting
- **Announce pauses** - Use external chat to communicate
- **Avoid rapid seeking** - Give clients time to sync

### For Participants
- **Same media** - Make sure you're watching the same title
- **Stable connection** - WiFi or wired connection recommended
- **Let it sync** - Wait a few seconds after joining before judging sync

### Network Considerations
- **Port 3000** - Session server default port must be accessible
- **WebSocket support** - Some firewalls block WebSocket connections
- **HTTPS** - Use WSS (secure WebSocket) in production

## Troubleshooting

### "Watch Party button not visible"
- Open Dashboard > Plugins > OpenWatchParty and verify client injection
- Restart Jellyfin after installing or upgrading the plugin
- Try refreshing the page (Ctrl+F5)

### "Cannot connect to server"
- Check that the session server is running
- Verify the WebSocket URL is correct
- Check firewall rules for port 3000

### "Out of sync with others"
- This is normal for a few seconds after joining
- If persistent, try leaving and rejoining the room
- Check your network connection quality

### "Room closed unexpectedly"
- The host left or disconnected
- Server may have restarted
- Create a new room to continue

For more troubleshooting, see [Troubleshooting Guide]({{ '/operations/troubleshooting/' | relative_url }}).
