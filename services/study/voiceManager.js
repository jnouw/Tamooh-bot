/**
 * Voice channel management for study sessions
 */

/**
 * Set voice channel status message
 */
export async function setVoiceChannelStatus(client, session, isSolo = true) {
  try {
    const guild = client.guilds.cache.get(session.guildId);
    if (!guild) return;

    const vc = guild.channels.cache.get(session.voiceChannelId);
    if (!vc) return;

    const statusMessage = isSolo
      ? "Solo studying"
      : "Group studying - join me!";

    await vc.setVoiceStatus(statusMessage);
    console.log(`[Study] Set VC status to: ${statusMessage}`);
  } catch (error) {
    console.error(`[Study] Failed to set VC status:`, error.message);
  }
}

/**
 * Update voice channel name based on session phase and duration
 */
export async function updateVoiceChannelName(client, session) {
  try {
    const guild = client.guilds.cache.get(session.guildId);
    if (!guild) return;

    const vc = guild.channels.cache.get(session.voiceChannelId);
    if (!vc) return;

    // Get course/topic name (fallback to "Study" if not set)
    const courseName = session.topic || "Study";

    // Calculate current time remaining
    const elapsed = Date.now() - session.startedAt;
    const totalDuration = session.phase === "focus"
      ? session.duration
      : Math.round(session.duration / 5);
    const remaining = Math.max(0, totalDuration - Math.floor(elapsed / 60000));

    // Choose emoji and status based on phase
    const emoji = session.phase === "focus" ? "📚" : "☕";
    const status = session.phase === "focus" ? "Focus" : "Break";

    // Format: Course | Time | Status
    const newName = `${emoji} ${courseName} | ${remaining} min | ${status}`;

    await vc.setName(newName);
    console.log(`[Study] Updated VC name to: ${newName}`);
  } catch (error) {
    console.error(`[Study] Failed to update VC name:`, error.message);
  }
}

/**
 * Mute or unmute all non-bot members in a voice channel
 * When muting: mutes current members in VC and tracks them
 * When unmuting: unmutes ALL tracked users (even if they left the VC)
 */
export async function setVoiceChannelMute(client, session, shouldMute) {
  try {
    const guild = client.guilds.cache.get(session.guildId);
    if (!guild) return;

    const vc = guild.channels.cache.get(session.voiceChannelId);
    if (!vc) return;

    if (shouldMute) {
      // Mute current members in VC
      const members = vc.members.filter(m => !m.user.bot);
      for (const [memberId, member] of members) {
        try {
          await member.voice.setMute(true);
          session.mutedUsers.add(memberId);
        } catch (error) {
          console.error(`[Study] Failed to mute member ${memberId}:`, error.message);
        }
      }
      console.log(`[Study] Muted ${members.size} members in session ${session.id}`);
    } else {
      // Unmute ALL tracked users (even if they left the VC)
      let unmutedCount = 0;
      for (const memberId of session.mutedUsers) {
        try {
          const member = await guild.members.fetch(memberId);
          if (member) {
            try {
              await member.voice.setMute(false);
              unmutedCount++;
            } catch (voiceError) {
              if (voiceError.code === 40032) {
                console.log(`[Study] User ${memberId} not in voice, skipping unmute`);
              } else {
                console.error(`[Study] Failed to unmute member ${memberId}:`, voiceError.message);
              }
            }
          }
        } catch (error) {
          console.error(`[Study] Failed to fetch member ${memberId}:`, error.message);
        }
      }
      // Clear the tracked users
      session.mutedUsers.clear();
      console.log(`[Study] Unmuted ${unmutedCount} members in session ${session.id}`);
    }
  } catch (error) {
    console.error(`[Study] Error ${shouldMute ? 'muting' : 'unmuting'} members:`, error);
  }
}
